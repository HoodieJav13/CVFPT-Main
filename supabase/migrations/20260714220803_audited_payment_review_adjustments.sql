-- Manual refund/dispute review must perform the chosen credit adjustment and
-- record it in the ledger atomically with the review decision.

create or replace function public.open_payment_review(
  p_purchase_id uuid,
  p_review_type text,
  p_stripe_event_id text,
  p_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_review public.payment_review_cases%rowtype;
  v_balance integer;
  v_consumed integer;
  v_prior_balance integer;
  v_uses_after integer;
  v_granted_at timestamptz;
  v_reversible integer;
begin
  if p_review_type not in ('refund', 'dispute') then
    raise exception 'Invalid review type';
  end if;
  if exists (
    select 1 from public.processed_stripe_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return jsonb_build_object('duplicate', true);
  end if;

  select * into v_purchase from public.purchases
  where id = p_purchase_id and archived = false for update;
  if not found then return null; end if;

  insert into public.processed_stripe_events (
    stripe_event_id, event_type, stripe_object_id
  ) values (
    p_stripe_event_id, p_review_type || '.manual_review',
    v_purchase.stripe_payment_intent_id
  );

  insert into public.client_credits (client_id, balance)
  values (v_purchase.client_id, 0) on conflict (client_id) do nothing;
  select balance into v_balance from public.client_credits
  where client_id = v_purchase.client_id for update;

  select greatest(coalesce(balance_after, amount) - amount, 0), created_at
  into v_prior_balance, v_granted_at
  from public.credit_transactions
  where source_id = v_purchase.id
    and event_type = 'purchase_grant'
    and archived = false
  order by created_at
  limit 1;
  v_prior_balance := coalesce(v_prior_balance, 0);

  select coalesce(sum(-amount), 0)::integer into v_uses_after
  from public.credit_transactions
  where client_id = v_purchase.client_id
    and event_type = 'session_use'
    and archived = false
    and (v_granted_at is null or created_at > v_granted_at);

  v_consumed := least(
    greatest(v_purchase.credits_granted, 0),
    greatest(v_uses_after - v_prior_balance, 0)
  );
  v_reversible := least(
    v_balance,
    greatest(v_purchase.credits_granted - v_consumed, 0)
  );
  v_consumed := greatest(v_consumed, v_purchase.credits_granted - v_reversible);

  select * into v_review from public.payment_review_cases
  where purchase_id = v_purchase.id and status = 'open' and archived = false
  for update;
  if not found then
    insert into public.payment_review_cases (
      client_id, purchase_id, review_type, credits_requested,
      credits_reversed, credits_consumed, stripe_event_id, note
    ) values (
      v_purchase.client_id, v_purchase.id, p_review_type,
      v_purchase.credits_granted, 0, v_consumed, p_stripe_event_id,
      nullif(trim(p_note), '')
    ) returning * into v_review;
  end if;

  update public.purchases set status = 'review_required'
  where id = v_purchase.id returning * into v_purchase;
  return jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'review', to_jsonb(v_review),
    'credits', v_balance,
    'credits_reversible', v_reversible,
    'duplicate', false
  );
end;
$$;
drop function if exists public.resolve_payment_review(uuid, text, uuid, text);
create function public.resolve_payment_review(
  p_review_id uuid,
  p_resolution text,
  p_credit_adjustment integer,
  p_admin_coach_id uuid,
  p_resolution_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_review public.payment_review_cases%rowtype;
  v_balance integer;
  v_remaining_reversible integer;
begin
  if p_resolution not in ('resolved', 'dismissed') then
    raise exception 'Invalid resolution';
  end if;
  if nullif(trim(p_resolution_note), '') is null then
    raise exception 'Resolution note is required';
  end if;
  if p_credit_adjustment is null or p_credit_adjustment < 0 then
    raise exception 'Credit adjustment must be a non-negative whole number';
  end if;
  if p_resolution = 'dismissed' and p_credit_adjustment <> 0 then
    raise exception 'Dismissed reviews cannot apply a credit adjustment';
  end if;

  select * into v_review from public.payment_review_cases
  where id = p_review_id and status = 'open' and archived = false
  for update;
  if not found then return null; end if;

  perform 1 from public.purchases
  where id = v_review.purchase_id and archived = false
  for update;
  if not found then return null; end if;

  insert into public.client_credits (client_id, balance)
  values (v_review.client_id, 0) on conflict (client_id) do nothing;
  select balance into v_balance from public.client_credits
  where client_id = v_review.client_id for update;

  v_remaining_reversible := greatest(
    v_review.credits_requested - v_review.credits_reversed - v_review.credits_consumed,
    0
  );
  if p_credit_adjustment > v_remaining_reversible
    or p_credit_adjustment > v_balance then
    raise exception 'Credit adjustment exceeds the % credits still reversible',
      least(v_remaining_reversible, v_balance);
  end if;

  if p_credit_adjustment > 0 then
    update public.client_credits
    set balance = balance - p_credit_adjustment, updated_at = now()
    where client_id = v_review.client_id returning balance into v_balance;

    insert into public.credit_transactions (
      client_id, coach_id, event_type, amount, balance_after, note,
      source_type, source_id, created_by_role, created_by_id
    ) values (
      v_review.client_id, p_admin_coach_id, 'refund',
      -p_credit_adjustment, v_balance, trim(p_resolution_note),
      'payment_review_resolution', v_review.id, 'admin', p_admin_coach_id
    );
  end if;

  update public.payment_review_cases
  set status = p_resolution,
      credits_reversed = credits_reversed + p_credit_adjustment,
      resolution_note = trim(p_resolution_note),
      resolved_by_coach_id = p_admin_coach_id,
      resolved_at = now()
  where id = v_review.id
  returning * into v_review;

  update public.purchases
  set status = case when v_review.review_type = 'refund' then 'refunded' else 'disputed' end
  where id = v_review.purchase_id and status = 'review_required';

  return jsonb_build_object(
    'review', to_jsonb(v_review),
    'credits', v_balance,
    'credit_adjustment', p_credit_adjustment
  );
end;
$$;
revoke execute on function public.open_payment_review(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.open_payment_review(uuid, text, text, text) to service_role;
revoke execute on function public.resolve_payment_review(uuid, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_payment_review(uuid, text, integer, uuid, text) to service_role;
