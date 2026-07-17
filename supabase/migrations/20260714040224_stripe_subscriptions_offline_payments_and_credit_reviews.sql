-- Stripe Billing remains the source of truth for online money movement.
-- The CVF PT credit ledger remains the source of truth for session entitlement.

alter table public.packages
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text,
  add column if not exists billing_interval text,
  add column if not exists currency text not null default 'usd',
  add column if not exists credits_rollover boolean not null default true;
alter table public.packages
  drop constraint if exists packages_billing_interval_check;
alter table public.packages
  add constraint packages_billing_interval_check
  check (billing_interval is null or billing_interval in ('month', 'year'));
create unique index if not exists idx_packages_stripe_price
  on public.packages(stripe_price_id)
  where stripe_price_id is not null;
alter table public.purchases
  drop constraint if exists purchases_method_check;
alter table public.purchases
  add constraint purchases_method_check
  check (method in ('stripe', 'cash', 'manual'));
alter table public.purchases
  drop constraint if exists purchases_status_check;
alter table public.purchases
  add constraint purchases_status_check
  check (status in ('pending', 'completed', 'failed', 'refunded', 'disputed', 'review_required'));
alter table public.purchases
  add column if not exists purchase_type text not null default 'one_time',
  add column if not exists currency text not null default 'usd',
  add column if not exists package_name text,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists cash_receipt_number text,
  add column if not exists note text,
  add column if not exists completed_at timestamptz;
alter table public.purchases
  drop constraint if exists purchases_purchase_type_check;
alter table public.purchases
  add constraint purchases_purchase_type_check
  check (purchase_type in ('one_time', 'subscription_cycle', 'cash'));
update public.purchases p
set package_name = pkg.name,
    stripe_price_id = pkg.stripe_price_id,
    currency = pkg.currency,
    purchase_type = case when p.method = 'manual' then 'cash' else 'one_time' end,
    completed_at = case when p.status = 'completed' then p.created_at else p.completed_at end
from public.packages pkg
where pkg.id = p.package_id
  and (p.package_name is null or p.completed_at is null);
create unique index if not exists idx_purchases_stripe_session_unique
  on public.purchases(stripe_session_id)
  where stripe_session_id is not null;
create unique index if not exists idx_purchases_stripe_invoice_unique
  on public.purchases(stripe_invoice_id)
  where stripe_invoice_id is not null;
create unique index if not exists idx_purchases_cash_receipt_unique
  on public.purchases(cash_receipt_number)
  where cash_receipt_number is not null;
create index if not exists idx_purchases_stripe_subscription
  on public.purchases(stripe_subscription_id)
  where stripe_subscription_id is not null;
create index if not exists idx_purchases_stripe_payment_intent
  on public.purchases(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create table if not exists public.client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  package_id uuid not null references public.packages(id),
  stripe_checkout_session_id text unique,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text not null,
  status text not null default 'checkout_pending'
    check (status in ('checkout_pending', 'trialing', 'active', 'past_due', 'paused', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired')),
  credits_per_cycle integer not null check (credits_per_cycle > 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_subscriptions_client
  on public.client_subscriptions(client_id, created_at desc);
create table if not exists public.courtesy_grant_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  credits integer not null check (credits > 0 and credits <= 10000),
  reason text not null check (reason in ('family', 'photography_barter', 'promotion', 'service_recovery', 'correction', 'other')),
  note text,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  requested_by_coach_id uuid not null references public.coaches(id),
  reviewed_by_coach_id uuid references public.coaches(id),
  reviewed_at timestamptz,
  review_note text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_courtesy_grants_client
  on public.courtesy_grant_requests(client_id, created_at desc);
create index if not exists idx_courtesy_grants_pending
  on public.courtesy_grant_requests(status, created_at)
  where status = 'pending' and archived = false;
create table if not exists public.payment_review_cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  purchase_id uuid not null references public.purchases(id),
  review_type text not null check (review_type in ('refund', 'dispute')),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  credits_requested integer not null check (credits_requested >= 0),
  credits_reversed integer not null default 0 check (credits_reversed >= 0),
  credits_consumed integer not null default 0 check (credits_consumed >= 0),
  stripe_event_id text unique,
  note text,
  resolution_note text,
  resolved_by_coach_id uuid references public.coaches(id),
  resolved_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_reviews_open
  on public.payment_review_cases(status, created_at)
  where status = 'open' and archived = false;
create unique index if not exists idx_payment_reviews_one_open_per_purchase
  on public.payment_review_cases(purchase_id)
  where status = 'open' and archived = false;
create table if not exists public.processed_stripe_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_object_id text,
  processed_at timestamptz not null default now()
);
alter table public.client_subscriptions enable row level security;
alter table public.courtesy_grant_requests enable row level security;
alter table public.payment_review_cases enable row level security;
alter table public.processed_stripe_events enable row level security;
revoke all privileges on public.client_subscriptions from public, anon, authenticated, service_role;
revoke all privileges on public.courtesy_grant_requests from public, anon, authenticated, service_role;
revoke all privileges on public.payment_review_cases from public, anon, authenticated, service_role;
revoke all privileges on public.processed_stripe_events from public, anon, authenticated, service_role;
grant select, insert, update on public.client_subscriptions to service_role;
grant select, insert, update on public.courtesy_grant_requests to service_role;
grant select, insert, update on public.payment_review_cases to service_role;
grant select, insert, update on public.processed_stripe_events to service_role;
create or replace function public.complete_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_balance integer;
begin
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id and archived = false
  for update;

  if not found then return null; end if;
  if v_purchase.status = 'completed' then
    select coalesce(balance, 0) into v_balance
    from public.client_credits where client_id = v_purchase.client_id;
    return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', coalesce(v_balance, 0));
  end if;
  if v_purchase.status <> 'pending' then return null; end if;

  insert into public.client_credits (client_id, balance)
  values (v_purchase.client_id, 0)
  on conflict (client_id) do nothing;

  update public.client_credits
  set balance = balance + v_purchase.credits_granted, updated_at = now()
  where client_id = v_purchase.client_id
  returning balance into v_balance;

  update public.purchases
  set status = 'completed', completed_at = now()
  where id = v_purchase.id and status = 'pending'
  returning * into v_purchase;

  if v_purchase.credits_granted <> 0 then
    insert into public.credit_transactions (
      client_id, coach_id, event_type, amount, balance_after,
      source_type, source_id, created_by_role, created_by_id
    ) values (
      v_purchase.client_id, v_purchase.recorded_by_coach_id, 'purchase_grant',
      v_purchase.credits_granted, v_balance, 'purchase', v_purchase.id, 'system', null
    ) on conflict do nothing;
  end if;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', v_balance);
end;
$$;
create or replace function public.record_cash_payment(
  p_client_id uuid,
  p_package_id uuid,
  p_amount numeric,
  p_recorded_by_coach_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_package public.packages%rowtype;
  v_purchase public.purchases%rowtype;
  v_balance integer;
  v_receipt text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Cash payment amount must be greater than zero';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'Cash payment note is too long';
  end if;

  select * into v_package from public.packages
  where id = p_package_id and archived = false;
  if not found then return null; end if;
  perform 1 from public.clients where id = p_client_id and archived = false;
  if not found then return null; end if;

  v_receipt := 'CVF-CASH-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.purchases (
    client_id, package_id, amount, credits_granted, method, status,
    purchase_type, currency, package_name, stripe_price_id,
    cash_receipt_number, note, recorded_by_coach_id, completed_at
  ) values (
    p_client_id, v_package.id, p_amount, v_package.session_credits, 'cash', 'completed',
    'cash', v_package.currency, v_package.name, v_package.stripe_price_id,
    v_receipt, nullif(trim(p_note), ''), p_recorded_by_coach_id, now()
  ) returning * into v_purchase;

  insert into public.client_credits (client_id, balance)
  values (p_client_id, 0) on conflict (client_id) do nothing;
  update public.client_credits
  set balance = balance + v_package.session_credits, updated_at = now()
  where client_id = p_client_id returning balance into v_balance;

  if v_package.session_credits <> 0 then
    insert into public.credit_transactions (
      client_id, coach_id, event_type, amount, balance_after, note,
      source_type, source_id, created_by_role, created_by_id
    ) values (
      p_client_id, p_recorded_by_coach_id, 'purchase_grant', v_package.session_credits,
      v_balance, nullif(trim(p_note), ''), 'cash_payment', v_purchase.id,
      'coach', p_recorded_by_coach_id
    );
  end if;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', v_balance);
end;
$$;
create or replace function public.request_courtesy_grant(
  p_client_id uuid,
  p_credits integer,
  p_reason text,
  p_note text,
  p_actor_coach_id uuid,
  p_actor_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.courtesy_grant_requests%rowtype;
  v_balance integer;
  v_requires_approval boolean;
begin
  if p_credits is null or p_credits <= 0 or p_credits > 10000 then
    raise exception 'Courtesy credits must be between 1 and 10000';
  end if;
  if p_reason not in ('family', 'photography_barter', 'promotion', 'service_recovery', 'correction', 'other') then
    raise exception 'Invalid courtesy reason';
  end if;
  if p_reason = 'other' and nullif(trim(p_note), '') is null then
    raise exception 'A note is required for other courtesy grants';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'Courtesy note is too long';
  end if;
  if p_actor_role not in ('coach', 'admin') then
    raise exception 'Invalid actor role';
  end if;

  perform 1 from public.clients where id = p_client_id and archived = false;
  if not found then return null; end if;
  v_requires_approval := p_actor_role = 'coach' and p_credits > 10;

  insert into public.courtesy_grant_requests (
    client_id, credits, reason, note, status, requested_by_coach_id,
    reviewed_by_coach_id, reviewed_at
  ) values (
    p_client_id, p_credits, p_reason, nullif(trim(p_note), ''),
    case when v_requires_approval then 'pending' else 'approved' end,
    p_actor_coach_id,
    case when p_actor_role = 'admin' then p_actor_coach_id else null end,
    case when v_requires_approval then null else now() end
  ) returning * into v_request;

  if v_requires_approval then
    select coalesce(balance, 0) into v_balance from public.client_credits where client_id = p_client_id;
    return jsonb_build_object('request', to_jsonb(v_request), 'credits', coalesce(v_balance, 0), 'pending_approval', true);
  end if;

  insert into public.client_credits (client_id, balance)
  values (p_client_id, 0) on conflict (client_id) do nothing;
  update public.client_credits
  set balance = balance + p_credits, updated_at = now()
  where client_id = p_client_id returning balance into v_balance;

  insert into public.credit_transactions (
    client_id, coach_id, event_type, amount, balance_after, note,
    source_type, source_id, created_by_role, created_by_id
  ) values (
    p_client_id, p_actor_coach_id, 'manual_grant', p_credits, v_balance,
    nullif(trim(p_note), ''), 'courtesy_grant', v_request.id,
    p_actor_role, p_actor_coach_id
  );

  return jsonb_build_object('request', to_jsonb(v_request), 'credits', v_balance, 'pending_approval', false);
end;
$$;
create or replace function public.review_courtesy_grant(
  p_request_id uuid,
  p_approve boolean,
  p_admin_coach_id uuid,
  p_review_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.courtesy_grant_requests%rowtype;
  v_balance integer;
begin
  select * into v_request from public.courtesy_grant_requests
  where id = p_request_id and status = 'pending' and archived = false
  for update;
  if not found then return null; end if;

  update public.courtesy_grant_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by_coach_id = p_admin_coach_id,
      reviewed_at = now(),
      review_note = nullif(trim(p_review_note), '')
  where id = v_request.id returning * into v_request;

  select coalesce(balance, 0) into v_balance from public.client_credits where client_id = v_request.client_id;
  if not p_approve then
    return jsonb_build_object('request', to_jsonb(v_request), 'credits', coalesce(v_balance, 0));
  end if;

  insert into public.client_credits (client_id, balance)
  values (v_request.client_id, 0) on conflict (client_id) do nothing;
  update public.client_credits
  set balance = balance + v_request.credits, updated_at = now()
  where client_id = v_request.client_id returning balance into v_balance;

  insert into public.credit_transactions (
    client_id, coach_id, event_type, amount, balance_after, note,
    source_type, source_id, created_by_role, created_by_id
  ) values (
    v_request.client_id, v_request.requested_by_coach_id, 'manual_grant',
    v_request.credits, v_balance, v_request.note, 'courtesy_grant', v_request.id,
    'admin', p_admin_coach_id
  );

  return jsonb_build_object('request', to_jsonb(v_request), 'credits', v_balance);
end;
$$;
create or replace function public.record_subscription_invoice(
  p_client_id uuid,
  p_package_id uuid,
  p_amount numeric,
  p_stripe_invoice_id text,
  p_stripe_subscription_id text,
  p_stripe_payment_intent_id text,
  p_stripe_customer_id text,
  p_stripe_event_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_package public.packages%rowtype;
  v_purchase public.purchases%rowtype;
  v_balance integer;
begin
  select * into v_purchase from public.purchases
  where stripe_invoice_id = p_stripe_invoice_id and archived = false;
  if found then
    select coalesce(balance, 0) into v_balance from public.client_credits where client_id = v_purchase.client_id;
    return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', coalesce(v_balance, 0), 'duplicate', true);
  end if;

  select * into v_package from public.packages where id = p_package_id and archived = false;
  if not found or not v_package.is_recurring then return null; end if;

  insert into public.purchases (
    client_id, package_id, amount, credits_granted, method, status,
    purchase_type, currency, package_name, stripe_price_id,
    stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
    stripe_payment_intent_id, completed_at
  ) values (
    p_client_id, v_package.id, p_amount, v_package.session_credits, 'stripe', 'completed',
    'subscription_cycle', v_package.currency, v_package.name, v_package.stripe_price_id,
    p_stripe_customer_id, p_stripe_subscription_id, p_stripe_invoice_id,
    p_stripe_payment_intent_id, now()
  ) returning * into v_purchase;

  insert into public.client_credits (client_id, balance)
  values (p_client_id, 0) on conflict (client_id) do nothing;
  update public.client_credits
  set balance = balance + v_package.session_credits, updated_at = now()
  where client_id = p_client_id returning balance into v_balance;

  insert into public.credit_transactions (
    client_id, event_type, amount, balance_after, source_type, source_id,
    created_by_role, created_by_id
  ) values (
    p_client_id, 'purchase_grant', v_package.session_credits, v_balance,
    'subscription_invoice', v_purchase.id, 'system', null
  );

  insert into public.processed_stripe_events (stripe_event_id, event_type, stripe_object_id)
  values (p_stripe_event_id, 'invoice.paid', p_stripe_invoice_id)
  on conflict (stripe_event_id) do nothing;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', v_balance, 'duplicate', false);
end;
$$;
create or replace function public.record_payment_reversal(
  p_purchase_id uuid,
  p_review_type text,
  p_stripe_event_id text,
  p_note text default null
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
  v_reversed integer;
  v_consumed integer;
  v_prior_balance integer;
  v_uses_after integer;
  v_granted_at timestamptz;
begin
  if p_review_type not in ('refund', 'dispute') then raise exception 'Invalid review type'; end if;
  if exists (select 1 from public.processed_stripe_events where stripe_event_id = p_stripe_event_id) then
    return jsonb_build_object('duplicate', true);
  end if;

  select * into v_purchase from public.purchases
  where id = p_purchase_id and archived = false for update;
  if not found then return null; end if;

  insert into public.processed_stripe_events (stripe_event_id, event_type, stripe_object_id)
  values (p_stripe_event_id, p_review_type, v_purchase.stripe_payment_intent_id);

  if v_purchase.status in ('refunded', 'disputed') then
    return jsonb_build_object('purchase', to_jsonb(v_purchase), 'duplicate', true);
  end if;

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
  -- Credits are consumed FIFO: the balance that existed before this purchase
  -- is exhausted before this purchase's credit lot.
  v_consumed := least(
    greatest(v_purchase.credits_granted, 0),
    greatest(v_uses_after - v_prior_balance, 0)
  );
  v_reversed := least(v_balance, greatest(v_purchase.credits_granted - v_consumed, 0));
  v_consumed := greatest(v_consumed, v_purchase.credits_granted - v_reversed);
  if v_reversed > 0 then
    update public.client_credits
    set balance = balance - v_reversed, updated_at = now()
    where client_id = v_purchase.client_id returning balance into v_balance;
    insert into public.credit_transactions (
      client_id, event_type, amount, balance_after, note, source_type, source_id,
      created_by_role, created_by_id
    ) values (
      v_purchase.client_id, 'refund', -v_reversed, v_balance, nullif(trim(p_note), ''),
      'payment_reversal', v_purchase.id, 'system', null
    );
  end if;

  if v_consumed > 0 then
    select * into v_review from public.payment_review_cases
    where purchase_id = v_purchase.id and status = 'open' and archived = false
    for update;
    if found then
      update public.payment_review_cases
      set review_type = p_review_type,
          credits_requested = v_purchase.credits_granted,
          credits_reversed = v_reversed,
          credits_consumed = v_consumed,
          note = concat_ws(E'\n', note, nullif(trim(p_note), ''))
      where id = v_review.id returning * into v_review;
    else
      insert into public.payment_review_cases (
        client_id, purchase_id, review_type, credits_requested, credits_reversed,
        credits_consumed, stripe_event_id, note
      ) values (
        v_purchase.client_id, v_purchase.id, p_review_type, v_purchase.credits_granted,
        v_reversed, v_consumed, p_stripe_event_id, nullif(trim(p_note), '')
      ) returning * into v_review;
    end if;
  end if;

  update public.purchases
  set status = case
        when v_consumed > 0 then 'review_required'
        when p_review_type = 'refund' then 'refunded'
        else 'disputed'
      end
  where id = v_purchase.id returning * into v_purchase;

  return jsonb_build_object(
    'purchase', to_jsonb(v_purchase), 'review', to_jsonb(v_review),
    'credits', v_balance, 'credits_reversed', v_reversed,
    'credits_consumed', v_consumed, 'duplicate', false
  );
end;
$$;
create or replace function public.resolve_payment_review(
  p_review_id uuid,
  p_resolution text,
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
begin
  if p_resolution not in ('resolved', 'dismissed') then raise exception 'Invalid resolution'; end if;
  if nullif(trim(p_resolution_note), '') is null then raise exception 'Resolution note is required'; end if;

  update public.payment_review_cases
  set status = p_resolution, resolution_note = trim(p_resolution_note),
      resolved_by_coach_id = p_admin_coach_id, resolved_at = now()
  where id = p_review_id and status = 'open' and archived = false
  returning * into v_review;
  if not found then return null; end if;
  update public.purchases
  set status = case when v_review.review_type = 'refund' then 'refunded' else 'disputed' end
  where id = v_review.purchase_id and status = 'review_required';
  return to_jsonb(v_review);
end;
$$;
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
begin
  if p_review_type not in ('refund', 'dispute') then raise exception 'Invalid review type'; end if;
  if exists (select 1 from public.processed_stripe_events where stripe_event_id = p_stripe_event_id) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_purchase from public.purchases
  where id = p_purchase_id and archived = false for update;
  if not found then return null; end if;

  insert into public.processed_stripe_events (stripe_event_id, event_type, stripe_object_id)
  values (p_stripe_event_id, p_review_type || '.manual_review', v_purchase.stripe_payment_intent_id);
  select coalesce(balance, 0) into v_balance from public.client_credits
  where client_id = v_purchase.client_id;

  select * into v_review from public.payment_review_cases
  where purchase_id = v_purchase.id and status = 'open' and archived = false;
  if not found then
    insert into public.payment_review_cases (
      client_id, purchase_id, review_type, credits_requested, credits_reversed,
      credits_consumed, stripe_event_id, note
    ) values (
      v_purchase.client_id, v_purchase.id, p_review_type, v_purchase.credits_granted, 0,
      greatest(v_purchase.credits_granted - coalesce(v_balance, 0), 0),
      p_stripe_event_id, nullif(trim(p_note), '')
    ) returning * into v_review;
  end if;
  update public.purchases set status = 'review_required'
  where id = v_purchase.id returning * into v_purchase;
  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'review', to_jsonb(v_review), 'duplicate', false);
end;
$$;
revoke execute on function public.complete_purchase(uuid) from public, anon, authenticated;
revoke execute on function public.record_cash_payment(uuid, uuid, numeric, uuid, text) from public, anon, authenticated;
revoke execute on function public.request_courtesy_grant(uuid, integer, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.review_courtesy_grant(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke execute on function public.record_subscription_invoice(uuid, uuid, numeric, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.record_payment_reversal(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_payment_review(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.open_payment_review(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_purchase(uuid) to service_role;
grant execute on function public.record_cash_payment(uuid, uuid, numeric, uuid, text) to service_role;
grant execute on function public.request_courtesy_grant(uuid, integer, text, text, uuid, text) to service_role;
grant execute on function public.review_courtesy_grant(uuid, boolean, uuid, text) to service_role;
grant execute on function public.record_subscription_invoice(uuid, uuid, numeric, text, text, text, text, text) to service_role;
grant execute on function public.record_payment_reversal(uuid, text, text, text) to service_role;
grant execute on function public.resolve_payment_review(uuid, text, uuid, text) to service_role;
grant execute on function public.open_payment_review(uuid, text, text, text) to service_role;
