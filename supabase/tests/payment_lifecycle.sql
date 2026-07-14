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

select 'subscription entitlement snapshot scenarios passed' as result;

rollback;
