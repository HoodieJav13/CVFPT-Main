-- Preserve the entitlement sold at subscription creation. Package rows remain
-- editable catalog records; they are not the source of truth for renewals.

alter table public.client_subscriptions
  add column if not exists package_name text,
  add column if not exists currency text;

update public.client_subscriptions subscription
set package_name = package.name,
    currency = package.currency
from public.packages package
where package.id = subscription.package_id
  and (subscription.package_name is null or subscription.currency is null);

alter table public.client_subscriptions
  alter column package_name set not null,
  alter column currency set not null;

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
  v_subscription public.client_subscriptions%rowtype;
  v_purchase public.purchases%rowtype;
  v_balance integer;
begin
  select * into v_purchase from public.purchases
  where stripe_invoice_id = p_stripe_invoice_id and archived = false;
  if found then
    select coalesce(balance, 0) into v_balance
    from public.client_credits where client_id = v_purchase.client_id;
    return jsonb_build_object(
      'purchase', to_jsonb(v_purchase),
      'credits', coalesce(v_balance, 0),
      'duplicate', true
    );
  end if;

  select * into v_subscription
  from public.client_subscriptions
  where stripe_subscription_id = p_stripe_subscription_id
    and client_id = p_client_id
    and package_id = p_package_id
    and archived = false
  for update;
  if not found then return null; end if;

  insert into public.purchases (
    client_id, package_id, amount, credits_granted, method, status,
    purchase_type, currency, package_name, stripe_price_id,
    stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
    stripe_payment_intent_id, completed_at
  ) values (
    v_subscription.client_id, v_subscription.package_id, p_amount,
    v_subscription.credits_per_cycle, 'stripe', 'completed',
    'subscription_cycle', v_subscription.currency,
    v_subscription.package_name, v_subscription.stripe_price_id,
    p_stripe_customer_id, v_subscription.stripe_subscription_id,
    p_stripe_invoice_id, p_stripe_payment_intent_id, now()
  ) returning * into v_purchase;

  insert into public.client_credits (client_id, balance)
  values (v_subscription.client_id, 0) on conflict (client_id) do nothing;
  update public.client_credits
  set balance = balance + v_subscription.credits_per_cycle, updated_at = now()
  where client_id = v_subscription.client_id returning balance into v_balance;

  insert into public.credit_transactions (
    client_id, event_type, amount, balance_after, source_type, source_id,
    created_by_role, created_by_id
  ) values (
    v_subscription.client_id, 'purchase_grant',
    v_subscription.credits_per_cycle, v_balance,
    'subscription_invoice', v_purchase.id, 'system', null
  );

  insert into public.processed_stripe_events (
    stripe_event_id, event_type, stripe_object_id
  ) values (
    p_stripe_event_id, 'invoice.paid', p_stripe_invoice_id
  ) on conflict (stripe_event_id) do nothing;

  return jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'credits', v_balance,
    'duplicate', false
  );
end;
$$;

revoke execute on function public.record_subscription_invoice(
  uuid, uuid, numeric, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_subscription_invoice(
  uuid, uuid, numeric, text, text, text, text, text
) to service_role;
