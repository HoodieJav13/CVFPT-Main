-- Atomic state transitions for operations that span business records and credits.
-- These functions are invoked only by the Express backend's service-role client.

create unique index if not exists idx_credit_transactions_source_event
  on public.credit_transactions(source_type, source_id, event_type)
  where source_id is not null and archived = false;

-- Waivers remain append-only. This prevents concurrent duplicate signatures
-- without updating or deleting any legal record.
create unique index if not exists idx_waiver_signatures_client_version
  on public.waiver_signatures(client_id, waiver_version_id);

create or replace function public.approve_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.booking_requests%rowtype;
  v_session public.sessions%rowtype;
begin
  update public.booking_requests
  set status = 'approved', updated_at = now()
  where id = p_booking_id
    and status = 'pending'
    and archived = false
  returning * into v_booking;

  if not found then
    return null;
  end if;

  insert into public.sessions (
    client_id, coach_id, scheduled_at, duration_minutes, location
  ) values (
    v_booking.client_id,
    v_booking.coach_id,
    v_booking.requested_time,
    v_booking.duration_minutes,
    v_booking.location
  )
  returning * into v_session;

  return jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'session', to_jsonb(v_session)
  );
end;
$$;

create or replace function public.complete_session(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_balance integer;
  v_deducted boolean := false;
begin
  select * into v_session
  from public.sessions
  where id = p_session_id and archived = false
  for update;

  if not found or v_session.status <> 'scheduled' then
    return null;
  end if;

  insert into public.client_credits (client_id, balance)
  values (v_session.client_id, 0)
  on conflict (client_id) do nothing;

  select balance into v_balance
  from public.client_credits
  where client_id = v_session.client_id
  for update;

  if v_balance > 0 then
    update public.client_credits
    set balance = balance - 1, updated_at = now()
    where client_id = v_session.client_id
    returning balance into v_balance;
    v_deducted := true;

    insert into public.credit_transactions (
      client_id, coach_id, event_type, amount, balance_after,
      source_type, source_id, created_by_role, created_by_id
    ) values (
      v_session.client_id,
      v_session.coach_id,
      'session_use',
      -1,
      v_balance,
      'session',
      v_session.id,
      'system',
      null
    );
  end if;

  update public.sessions
  set status = 'completed', credit_deducted = v_deducted, updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'credit_deducted', v_deducted,
    'credits_remaining', v_balance
  );
end;
$$;

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

  if not found then
    return null;
  end if;

  if v_purchase.status = 'completed' then
    select coalesce(balance, 0) into v_balance
    from public.client_credits
    where client_id = v_purchase.client_id;
    return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', coalesce(v_balance, 0));
  end if;

  if v_purchase.status <> 'pending' then
    return null;
  end if;

  insert into public.client_credits (client_id, balance)
  values (v_purchase.client_id, 0)
  on conflict (client_id) do nothing;

  update public.client_credits
  set balance = balance + v_purchase.credits_granted, updated_at = now()
  where client_id = v_purchase.client_id
  returning balance into v_balance;

  update public.purchases
  set status = 'completed'
  where id = v_purchase.id and status = 'pending'
  returning * into v_purchase;

  if v_purchase.credits_granted <> 0 then
    insert into public.credit_transactions (
      client_id, coach_id, event_type, amount, balance_after,
      source_type, source_id, created_by_role, created_by_id
    ) values (
      v_purchase.client_id,
      v_purchase.recorded_by_coach_id,
      'purchase_grant',
      v_purchase.credits_granted,
      v_balance,
      'purchase',
      v_purchase.id,
      'system',
      null
    );
  end if;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', v_balance);
end;
$$;

create or replace function public.record_manual_purchase(
  p_client_id uuid,
  p_package_id uuid,
  p_amount numeric,
  p_recorded_by_coach_id uuid
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
  if p_amount is null or p_amount < 0 then
    raise exception 'Purchase amount must be non-negative';
  end if;

  select * into v_package
  from public.packages
  where id = p_package_id and archived = false;
  if not found then
    return null;
  end if;

  perform 1 from public.clients where id = p_client_id and archived = false;
  if not found then
    return null;
  end if;

  insert into public.purchases (
    client_id, package_id, amount, credits_granted, method,
    status, recorded_by_coach_id
  ) values (
    p_client_id,
    v_package.id,
    p_amount,
    v_package.session_credits,
    'manual',
    'completed',
    p_recorded_by_coach_id
  )
  returning * into v_purchase;

  insert into public.client_credits (client_id, balance)
  values (p_client_id, 0)
  on conflict (client_id) do nothing;

  update public.client_credits
  set balance = balance + v_package.session_credits, updated_at = now()
  where client_id = p_client_id
  returning balance into v_balance;

  if v_package.session_credits <> 0 then
    insert into public.credit_transactions (
      client_id, coach_id, event_type, amount, balance_after,
      source_type, source_id, created_by_role, created_by_id
    ) values (
      p_client_id,
      p_recorded_by_coach_id,
      'manual_grant',
      v_package.session_credits,
      v_balance,
      'purchase',
      v_purchase.id,
      'coach',
      p_recorded_by_coach_id
    );
  end if;

  return jsonb_build_object('purchase', to_jsonb(v_purchase), 'credits', v_balance);
end;
$$;

revoke execute on function public.approve_booking(uuid) from public, anon, authenticated;
revoke execute on function public.complete_session(uuid) from public, anon, authenticated;
revoke execute on function public.complete_purchase(uuid) from public, anon, authenticated;
revoke execute on function public.record_manual_purchase(uuid, uuid, numeric, uuid) from public, anon, authenticated;

grant execute on function public.approve_booking(uuid) to service_role;
grant execute on function public.complete_session(uuid) to service_role;
grant execute on function public.complete_purchase(uuid) to service_role;
grant execute on function public.record_manual_purchase(uuid, uuid, numeric, uuid) to service_role;
