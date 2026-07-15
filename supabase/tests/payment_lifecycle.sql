begin;

do $$
declare
  v_coach_id uuid := gen_random_uuid();
  v_client_id uuid := gen_random_uuid();
  v_package_id uuid := gen_random_uuid();
  v_first_grant integer;
  v_second_grant integer;
  v_balance integer;
begin
  insert into public.coaches (id, name, email)
  values (v_coach_id, 'Snapshot Test Coach', 'snapshot-test@example.com');
  insert into public.clients (id, coach_id, name)
  values (v_client_id, v_coach_id, 'Snapshot Test Client');
  insert into public.packages (
    id, name, price, session_credits, is_recurring, stripe_product_id,
    stripe_price_id, billing_interval, currency
  ) values (
    v_package_id, 'Original Membership', 200, 8, true, 'prod_snapshot',
    'price_snapshot', 'month', 'usd'
  );
  insert into public.client_subscriptions (
    client_id, package_id, package_name, currency, stripe_customer_id,
    stripe_subscription_id, stripe_price_id, status, credits_per_cycle
  ) values (
    v_client_id, v_package_id, 'Original Membership', 'usd', 'cus_snapshot',
    'sub_snapshot', 'price_snapshot', 'active', 8
  );

  update public.packages set archived = true where id = v_package_id;
  perform public.record_subscription_invoice(
    v_client_id, v_package_id, 200, 'in_snapshot_archived', 'sub_snapshot',
    'pi_snapshot_archived', 'cus_snapshot', 'evt_snapshot_archived'
  );
  select credits_granted into v_first_grant from public.purchases
  where stripe_invoice_id = 'in_snapshot_archived';
  if v_first_grant is distinct from 8 then
    raise exception 'Archived package changed/stopped subscription grant: %', v_first_grant;
  end if;

  update public.packages
  set archived = false, session_credits = 99, name = 'Edited Membership'
  where id = v_package_id;
  perform public.record_subscription_invoice(
    v_client_id, v_package_id, 200, 'in_snapshot_edited', 'sub_snapshot',
    'pi_snapshot_edited', 'cus_snapshot', 'evt_snapshot_edited'
  );
  select credits_granted into v_second_grant from public.purchases
  where stripe_invoice_id = 'in_snapshot_edited';
  select balance into v_balance from public.client_credits where client_id = v_client_id;
  if v_second_grant is distinct from 8 or v_balance is distinct from 16 then
    raise exception 'Package edit changed existing entitlement: grant %, balance %',
      v_second_grant, v_balance;
  end if;
end;
$$;

do $$
declare
  v_admin_id uuid := gen_random_uuid();
  v_client_id uuid := gen_random_uuid();
  v_package_id uuid := gen_random_uuid();
  v_purchase_id uuid := gen_random_uuid();
  v_review_id uuid;
  v_balance integer;
  v_ledger_amount integer;
  v_ledger_role text;
  v_reversed integer;
  v_status text;
begin
  insert into public.coaches (id, name, email, is_admin)
  values (v_admin_id, 'Refund Test Admin', 'refund-test@example.com', true);
  insert into public.clients (id, coach_id, name)
  values (v_client_id, v_admin_id, 'Refund Test Client');
  insert into public.packages (id, name, price, session_credits)
  values (v_package_id, 'Refund Test Pack', 100, 8);
  insert into public.purchases (
    id, client_id, package_id, amount, credits_granted, method, status,
    purchase_type, currency, package_name, stripe_payment_intent_id,
    completed_at
  ) values (
    v_purchase_id, v_client_id, v_package_id, 100, 8, 'stripe', 'completed',
    'one_time', 'usd', 'Refund Test Pack', 'pi_partial_refund', now()
  );
  insert into public.client_credits (client_id, balance) values (v_client_id, 8);
  insert into public.credit_transactions (
    client_id, event_type, amount, balance_after, source_type, source_id,
    created_by_role
  ) values (
    v_client_id, 'purchase_grant', 8, 8, 'purchase', v_purchase_id, 'system'
  );

  perform public.open_payment_review(
    v_purchase_id, 'refund', 'evt_partial_refund', 'Partial refund requires review'
  );
  select id into v_review_id from public.payment_review_cases
  where purchase_id = v_purchase_id and status = 'open';

  begin
    perform public.resolve_payment_review(
      v_review_id, 'resolved', 9, v_admin_id, 'Too many credits'
    );
    raise exception 'Expected the excessive adjustment to be rejected';
  exception
    when others then
      if sqlerrm not like 'Credit adjustment exceeds%' then raise; end if;
  end;

  perform public.resolve_payment_review(
    v_review_id, 'resolved', 3, v_admin_id, 'Reverse three credits'
  );

  select balance into v_balance from public.client_credits where client_id = v_client_id;
  select amount, created_by_role into v_ledger_amount, v_ledger_role
  from public.credit_transactions
  where source_type = 'payment_review_resolution' and source_id = v_review_id;
  select credits_reversed, status into v_reversed, v_status
  from public.payment_review_cases where id = v_review_id;

  if v_balance is distinct from 5
    or v_ledger_amount is distinct from -3
    or v_ledger_role is distinct from 'admin'
    or v_reversed is distinct from 3
    or v_status is distinct from 'resolved' then
    raise exception 'Audited review adjustment failed: balance %, ledger %, role %, reversed %, status %',
      v_balance, v_ledger_amount, v_ledger_role, v_reversed, v_status;
  end if;
end;
$$;

select 'subscription entitlement snapshot scenarios passed' as result;
select 'audited payment review adjustment scenario passed' as result;

rollback;
