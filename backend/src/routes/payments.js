const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const {
  requireAuth, requireAdmin, requireCoach, requireClient, canAccessClient,
} = require('../middleware/auth');
const { completePurchase, getBalance } = require('../utils/credits');
const { getStripeClient, stripeConfiguration } = require('../config/stripe');
const { validateCashPayment, validateCourtesyGrant } = require('../validation/business');

const router = express.Router();
const NOT_CONFIGURED_MSG = 'Online payments are not yet configured. Please pay your coach directly, or check back soon.';
const ACTIVE_SUBSCRIPTION_STATUSES = ['checkout_pending', 'trialing', 'active', 'past_due', 'paused', 'unpaid', 'incomplete'];

function getStripe() {
  return getStripeClient();
}

function frontendUrl() {
  const value = String(process.env.FRONTEND_URL || '').trim();
  try {
    const parsed = new URL(value);
    const hasExactOriginShape = parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && !parsed.username
      && !parsed.password;
    return ['http:', 'https:'].includes(parsed.protocol) && hasExactOriginShape
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function stripeObjectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function epochIso(value) {
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

function invoiceSubscriptionId(invoice) {
  return stripeObjectId(invoice.subscription)
    || stripeObjectId(invoice.parent?.subscription_details?.subscription)
    || null;
}

function invoicePaymentIntentId(invoice) {
  return stripeObjectId(invoice.payment_intent)
    || stripeObjectId(invoice.payments?.data?.find((item) => item.payment?.payment_intent)?.payment?.payment_intent)
    || null;
}

async function eventAlreadyProcessed(eventId) {
  const { data, error } = await supabaseAdmin.from('processed_stripe_events')
    .select('stripe_event_id').eq('stripe_event_id', eventId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function recordProcessedEvent(event) {
  const object = event.data?.object;
  const { error } = await supabaseAdmin.from('processed_stripe_events').upsert({
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_object_id: object?.id || null,
    processed_at: new Date().toISOString(),
  }, { onConflict: 'stripe_event_id', ignoreDuplicates: true });
  if (error) throw error;
}

function subscriptionPeriod(subscription) {
  const item = subscription.items?.data?.[0];
  return {
    start: subscription.current_period_start || item?.current_period_start || null,
    end: subscription.current_period_end || item?.current_period_end || null,
  };
}

async function syncSubscription(subscription, fallback = {}) {
  const existingResult = await supabaseAdmin.from('client_subscriptions').select('*')
    .eq('stripe_subscription_id', subscription.id).maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const existing = existingResult.data;
  const clientId = subscription.metadata?.client_id || fallback.clientId || existing?.client_id;
  const metadataPackageId = subscription.metadata?.package_id || fallback.packageId || existing?.package_id;
  const localId = subscription.metadata?.local_subscription_id || fallback.localId || existing?.id;
  const currentPriceId = subscription.items?.data?.[0]?.price?.id || null;
  if (!clientId || (!metadataPackageId && !currentPriceId)) return null;

  let packageQuery = supabaseAdmin.from('packages').select('*').eq('archived', false);
  packageQuery = currentPriceId
    ? packageQuery.eq('stripe_price_id', currentPriceId)
    : packageQuery.eq('id', metadataPackageId);
  const { data: pkg, error: packageError } = await packageQuery.maybeSingle();
  if (packageError) throw packageError;
  if (!pkg) return null;

  const period = subscriptionPeriod(subscription);
  const values = {
    client_id: clientId,
    package_id: pkg.id,
    stripe_customer_id: stripeObjectId(subscription.customer),
    stripe_subscription_id: subscription.id,
    stripe_price_id: currentPriceId || pkg.stripe_price_id,
    status: subscription.status === 'canceled' ? 'canceled' : subscription.status,
    credits_per_cycle: pkg.session_credits,
    current_period_start: epochIso(period.start),
    current_period_end: epochIso(period.end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };

  let query = supabaseAdmin.from('client_subscriptions').update(values);
  if (localId) query = query.eq('id', localId);
  else query = query.eq('stripe_subscription_id', subscription.id);
  const { data: updated, error: updateError } = await query.select().maybeSingle();
  if (updateError) throw updateError;
  if (updated) return updated;

  const { data, error } = await supabaseAdmin.from('client_subscriptions').insert(values).select().single();
  if (error) {
    if (error.code === '23505') {
      const { data: existing, error: existingError } = await supabaseAdmin.from('client_subscriptions')
        .select('*').eq('stripe_subscription_id', subscription.id).maybeSingle();
      if (existingError) throw existingError;
      return existing;
    }
    throw error;
  }
  return data;
}

async function handleCheckoutCompleted(stripe, session) {
  if (session.mode === 'subscription') {
    const subscriptionId = stripeObjectId(session.subscription);
    if (!subscriptionId) return;
    const subscription = typeof session.subscription === 'object'
      ? session.subscription
      : await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscription(subscription, {
      clientId: session.metadata?.client_id,
      packageId: session.metadata?.package_id,
      localId: session.metadata?.local_subscription_id,
    });
    return;
  }

  const purchaseId = session.metadata?.purchase_id;
  let purchase = null;
  if (purchaseId) {
    const result = await supabaseAdmin.from('purchases').select('*').eq('id', purchaseId).eq('archived', false).maybeSingle();
    if (result.error) throw result.error;
    purchase = result.data;
  } else {
    const result = await supabaseAdmin.from('purchases').select('*')
      .eq('stripe_session_id', session.id).eq('archived', false).maybeSingle();
    if (result.error) throw result.error;
    purchase = result.data;
  }
  if (!purchase) return;

  const { error } = await supabaseAdmin.from('purchases').update({
    stripe_session_id: session.id,
    stripe_customer_id: stripeObjectId(session.customer),
    stripe_payment_intent_id: stripeObjectId(session.payment_intent),
  }).eq('id', purchase.id);
  if (error) throw error;
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    await completePurchase(purchase.id);
  }
}

async function handleInvoicePaid(stripe, event) {
  const invoice = event.data.object;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const synced = await syncSubscription(subscription);
  if (!synced) return;

  if (!['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason)) return;
  if (!Number.isFinite(invoice.amount_paid) || invoice.amount_paid <= 0) return;

  const { data, error } = await supabaseAdmin.rpc('record_subscription_invoice', {
    p_client_id: synced.client_id,
    p_package_id: synced.package_id,
    p_amount: invoice.amount_paid / 100,
    p_stripe_invoice_id: invoice.id,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_payment_intent_id: invoicePaymentIntentId(invoice),
    p_stripe_customer_id: stripeObjectId(invoice.customer),
    p_stripe_event_id: event.id,
  });
  if (error) throw error;
  return data;
}

async function findPurchaseForStripeObject(paymentIntentId, invoiceId = null) {
  if (paymentIntentId) {
    const { data, error } = await supabaseAdmin.from('purchases').select('*')
      .eq('stripe_payment_intent_id', paymentIntentId).eq('archived', false)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  if (invoiceId) {
    const { data, error } = await supabaseAdmin.from('purchases').select('*')
      .eq('stripe_invoice_id', invoiceId).eq('archived', false).maybeSingle();
    if (error) throw error;
    return data;
  }
  return null;
}

async function handlePaymentReversal(event, reviewType, paymentIntentId, invoiceId, note) {
  const purchase = await findPurchaseForStripeObject(paymentIntentId, invoiceId);
  if (!purchase) return null;
  const { data, error } = await supabaseAdmin.rpc('record_payment_reversal', {
    p_purchase_id: purchase.id,
    p_review_type: reviewType,
    p_stripe_event_id: event.id,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

async function findStripeCustomerId(clientId) {
  const [subscriptionResult, purchaseResult] = await Promise.all([
    supabaseAdmin.from('client_subscriptions').select('stripe_customer_id')
      .eq('client_id', clientId).eq('archived', false)
      .not('stripe_customer_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('purchases').select('stripe_customer_id')
      .eq('client_id', clientId).eq('archived', false)
      .not('stripe_customer_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (subscriptionResult.error) throw subscriptionResult.error;
  if (purchaseResult.error) throw purchaseResult.error;
  return subscriptionResult.data?.stripe_customer_id || purchaseResult.data?.stripe_customer_id || null;
}

async function openPaymentReview(event, reviewType, paymentIntentId, invoiceId, note) {
  const purchase = await findPurchaseForStripeObject(paymentIntentId, invoiceId);
  if (!purchase) return null;
  const { data, error } = await supabaseAdmin.rpc('open_payment_review', {
    p_purchase_id: purchase.id,
    p_review_type: reviewType,
    p_stripe_event_id: event.id,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

// Stripe webhook must remain before authentication middleware.
router.post('/webhook', async (req, res) => {
  try {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return res.status(503).json({ error: 'Stripe not configured' });

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], secret);
    } catch (error) {
      logError('Webhook signature verification failed', error);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    if (await eventAlreadyProcessed(event.id)) return res.json({ received: true, duplicate: true });

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutCompleted(stripe, event.data.object);
        await recordProcessedEvent(event);
        break;
      case 'checkout.session.expired': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const { error } = await supabaseAdmin.from('client_subscriptions').update({
            status: 'incomplete_expired', archived: true, updated_at: new Date().toISOString(),
          }).eq('stripe_checkout_session_id', session.id).eq('status', 'checkout_pending');
          if (error) throw error;
        } else {
          const { error } = await supabaseAdmin.from('purchases').update({ status: 'failed' })
            .eq('stripe_session_id', session.id).eq('status', 'pending');
          if (error) throw error;
        }
        await recordProcessedEvent(event);
        break;
      }
      case 'invoice.paid':
        await handleInvoicePaid(stripe, event);
        if (!(await eventAlreadyProcessed(event.id))) await recordProcessedEvent(event);
        break;
      case 'invoice.payment_failed': {
        const subscriptionId = invoiceSubscriptionId(event.data.object);
        if (subscriptionId) await syncSubscription(await stripe.subscriptions.retrieve(subscriptionId));
        await recordProcessedEvent(event);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object);
        await recordProcessedEvent(event);
        break;
      case 'charge.refunded': {
        const charge = event.data.object;
        const fullRefund = Number(charge.amount_refunded) >= Number(charge.amount);
        if (fullRefund) {
          await handlePaymentReversal(
            event, 'refund', stripeObjectId(charge.payment_intent), stripeObjectId(charge.invoice), 'Stripe payment refunded',
          );
        } else {
          await openPaymentReview(
            event,
            'refund',
            stripeObjectId(charge.payment_intent),
            stripeObjectId(charge.invoice),
            `Stripe payment partially refunded (${charge.amount_refunded} of ${charge.amount} minor currency units)`,
          );
        }
        if (!(await eventAlreadyProcessed(event.id))) await recordProcessedEvent(event);
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        let paymentIntentId = stripeObjectId(dispute.payment_intent);
        let invoiceId = stripeObjectId(dispute.invoice);
        if (dispute.charge && (!paymentIntentId || !invoiceId)) {
          const charge = await stripe.charges.retrieve(stripeObjectId(dispute.charge));
          paymentIntentId = stripeObjectId(charge.payment_intent);
          invoiceId = stripeObjectId(charge.invoice);
        }
        await handlePaymentReversal(event, 'dispute', paymentIntentId, invoiceId, 'Stripe payment disputed');
        if (!(await eventAlreadyProcessed(event.id))) await recordProcessedEvent(event);
        break;
      }
      default:
        await recordProcessedEvent(event);
    }
    return res.json({ received: true });
  } catch (error) {
    logError('webhook error', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.use(requireAuth);

router.get('/config', (_req, res) => {
  const configuration = stripeConfiguration(process.env);
  const configured = configuration.configured && Boolean(frontendUrl());
  return res.json({
    configured,
    message: configured ? null : NOT_CONFIGURED_MSG,
  });
});

router.post('/checkout', requireClient, async (req, res) => {
  let localRecord = null;
  let recordType = null;
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: NOT_CONFIGURED_MSG, not_configured: true });
    const { data: pkg, error: packageError } = await supabaseAdmin.from('packages').select('*')
      .eq('id', req.body?.package_id).eq('archived', false).maybeSingle();
    if (packageError) throw packageError;
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    if (!pkg.stripe_price_id) return res.status(409).json({ error: 'This package is not linked to a Stripe Price yet' });

    const redirectOrigin = frontendUrl();
    if (!redirectOrigin) return res.status(503).json({ error: NOT_CONFIGURED_MSG, not_configured: true });
    const baseMetadata = { client_id: req.user.client.id, package_id: pkg.id };
    const customerId = await findStripeCustomerId(req.user.client.id);

    if (pkg.is_recurring) {
      const activeResult = await supabaseAdmin.from('client_subscriptions').select('id, status, stripe_checkout_session_id')
        .eq('client_id', req.user.client.id).eq('archived', false)
        .in('status', ACTIVE_SUBSCRIPTION_STATUSES).limit(1).maybeSingle();
      if (activeResult.error) throw activeResult.error;
      if (activeResult.data) {
        if (activeResult.data.status === 'checkout_pending') {
          if (activeResult.data.stripe_checkout_session_id) {
            const pendingSession = await stripe.checkout.sessions.retrieve(activeResult.data.stripe_checkout_session_id);
            if (pendingSession.status === 'open' && pendingSession.url) {
              return res.json({ url: pendingSession.url, mode: 'subscription', resumed: true });
            }
          }
          const { error } = await supabaseAdmin.from('client_subscriptions').update({
            status: 'incomplete_expired', archived: true, updated_at: new Date().toISOString(),
          }).eq('id', activeResult.data.id);
          if (error) throw error;
        } else {
          return res.status(409).json({ error: 'You already have a subscription. Use Manage billing to change it.' });
        }
      }

      const insertResult = await supabaseAdmin.from('client_subscriptions').insert({
        client_id: req.user.client.id,
        package_id: pkg.id,
        stripe_price_id: pkg.stripe_price_id,
        status: 'checkout_pending',
        credits_per_cycle: pkg.session_credits,
      }).select().single();
      if (insertResult.error) throw insertResult.error;
      localRecord = insertResult.data;
      recordType = 'subscription';

      const metadata = { ...baseMetadata, local_subscription_id: localRecord.id };
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
        success_url: `${redirectOrigin}/client/packages?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${redirectOrigin}/client/packages?checkout=cancelled`,
        client_reference_id: req.user.client.id,
        metadata,
        subscription_data: { metadata },
        ...(customerId ? { customer: customerId } : {}),
      }, { idempotencyKey: `cvf-subscription-checkout-${localRecord.id}` });

      const { error } = await supabaseAdmin.from('client_subscriptions')
        .update({ stripe_checkout_session_id: session.id }).eq('id', localRecord.id);
      if (error) throw error;
      return res.json({ url: session.url, mode: 'subscription' });
    }

    const insertResult = await supabaseAdmin.from('purchases').insert({
      client_id: req.user.client.id,
      package_id: pkg.id,
      amount: pkg.price,
      credits_granted: pkg.session_credits,
      method: 'stripe',
      status: 'pending',
      purchase_type: 'one_time',
      currency: pkg.currency,
      package_name: pkg.name,
      stripe_price_id: pkg.stripe_price_id,
    }).select().single();
    if (insertResult.error) throw insertResult.error;
    localRecord = insertResult.data;
    recordType = 'purchase';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
      success_url: `${redirectOrigin}/client/packages?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${redirectOrigin}/client/packages?checkout=cancelled`,
      client_reference_id: req.user.client.id,
      ...(customerId ? { customer: customerId } : { customer_creation: 'always' }),
      metadata: { ...baseMetadata, purchase_id: localRecord.id },
    }, { idempotencyKey: `cvf-payment-checkout-${localRecord.id}` });

    const { error } = await supabaseAdmin.from('purchases')
      .update({ stripe_session_id: session.id }).eq('id', localRecord.id);
    if (error) throw error;
    return res.json({ url: session.url, mode: 'payment' });
  } catch (error) {
    if (localRecord && recordType === 'purchase') {
      await supabaseAdmin.from('purchases').update({ status: 'failed' }).eq('id', localRecord.id);
    } else if (localRecord && recordType === 'subscription') {
      await supabaseAdmin.from('client_subscriptions')
        .update({ status: 'incomplete_expired', archived: true, updated_at: new Date().toISOString() })
        .eq('id', localRecord.id);
    }
    logError('checkout error', error);
    return res.status(500).json({ error: 'Failed to start checkout. Please try again.' });
  }
});

// The redirect confirms UX state only; webhook processing grants credits.
router.get('/verify', requireClient, async (req, res) => {
  try {
    const sessionId = String(req.query.session_id || '');
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    const { data: purchase, error: purchaseError } = await supabaseAdmin.from('purchases').select('status')
      .eq('stripe_session_id', sessionId).eq('client_id', req.user.client.id).eq('archived', false).maybeSingle();
    if (purchaseError) throw purchaseError;
    if (purchase) return res.json({ status: purchase.status, credits: await getBalance(req.user.client.id) });

    const { data: subscription, error: subscriptionError } = await supabaseAdmin.from('client_subscriptions')
      .select('status').eq('stripe_checkout_session_id', sessionId)
      .eq('client_id', req.user.client.id).eq('archived', false).maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!subscription) return res.status(404).json({ error: 'Checkout not found' });
    return res.json({ status: subscription.status, credits: await getBalance(req.user.client.id) });
  } catch (error) {
    logError('verify error', error);
    return res.status(500).json({ error: 'Failed to verify payment' });
  }
});

router.get('/subscriptions', requireClient, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('client_subscriptions')
    .select('*, package:packages(id, name, price, session_credits, billing_interval)')
    .eq('client_id', req.user.client.id).eq('archived', false)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to load subscriptions' });
  return res.json(data);
});

router.post('/portal', requireClient, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: NOT_CONFIGURED_MSG });
    const { data, error } = await supabaseAdmin.from('client_subscriptions').select('stripe_customer_id')
      .eq('client_id', req.user.client.id).eq('archived', false)
      .not('stripe_customer_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) return res.status(404).json({ error: 'No Stripe billing profile found' });
    const redirectOrigin = frontendUrl();
    if (!redirectOrigin) return res.status(503).json({ error: NOT_CONFIGURED_MSG });
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${redirectOrigin}/client/packages`,
      ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
        : {}),
    });
    return res.json({ url: session.url });
  } catch (error) {
    logError('billing portal error', error);
    return res.status(500).json({ error: 'Failed to open billing management' });
  }
});

async function accessibleClient(req, clientId) {
  const { data, error } = await supabaseAdmin.from('clients').select('*')
    .eq('id', clientId).eq('archived', false).maybeSingle();
  if (error) throw error;
  return data && canAccessClient(req.user, data) ? data : null;
}

router.post('/cash', requireCoach, async (req, res) => {
  try {
    const validation = validateCashPayment(req.body || {});
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const client = await accessibleClient(req, validation.value.client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.rpc('record_cash_payment', {
      p_client_id: client.id,
      p_package_id: validation.value.package_id,
      p_amount: validation.value.amount,
      p_recorded_by_coach_id: req.user.coach.id,
      p_note: validation.value.note,
    });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Client or package not found' });
    return res.status(201).json(data);
  } catch (error) {
    logError('cash payment error', error);
    return res.status(500).json({ error: 'Failed to record cash payment' });
  }
});

router.post('/courtesy', requireCoach, async (req, res) => {
  try {
    const validation = validateCourtesyGrant(req.body || {});
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const client = await accessibleClient(req, validation.value.client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.rpc('request_courtesy_grant', {
      p_client_id: client.id,
      p_credits: validation.value.credits,
      p_reason: validation.value.reason,
      p_note: validation.value.note,
      p_actor_coach_id: req.user.coach.id,
      p_actor_role: req.user.role,
    });
    if (error) throw error;
    return res.status(data?.pending_approval ? 202 : 201).json(data);
  } catch (error) {
    logError('courtesy grant error', error);
    return res.status(500).json({ error: 'Failed to add courtesy credits' });
  }
});

router.get('/courtesy/pending', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('courtesy_grant_requests')
    .select('*, client:clients(id, name), requested_by:coaches!courtesy_grant_requests_requested_by_coach_id_fkey(id, name)')
    .eq('status', 'pending').eq('archived', false).order('created_at');
  if (error) return res.status(500).json({ error: 'Failed to load courtesy approvals' });
  return res.json(data);
});

router.post('/courtesy/:id/review', requireAdmin, async (req, res) => {
  try {
    if (typeof req.body?.approve !== 'boolean') return res.status(400).json({ error: 'Approval decision is required' });
    const { data, error } = await supabaseAdmin.rpc('review_courtesy_grant', {
      p_request_id: req.params.id,
      p_approve: req.body.approve,
      p_admin_coach_id: req.user.coach.id,
      p_review_note: req.body.note ? String(req.body.note).trim() : null,
    });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Pending courtesy request not found' });
    return res.json(data);
  } catch (error) {
    logError('courtesy review error', error);
    return res.status(500).json({ error: 'Failed to review courtesy request' });
  }
});

router.get('/reviews', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('payment_review_cases')
    .select('*, client:clients(id, name), purchase:purchases(id, amount, currency, package_name, method, created_at)')
    .eq('archived', false).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to load payment reviews' });
  return res.json(data);
});

router.post('/reviews/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const resolution = String(req.body?.resolution || '');
    const note = String(req.body?.note || '').trim();
    if (!['resolved', 'dismissed'].includes(resolution) || !note) {
      return res.status(400).json({ error: 'Resolution and note are required' });
    }
    const { data, error } = await supabaseAdmin.rpc('resolve_payment_review', {
      p_review_id: req.params.id,
      p_resolution: resolution,
      p_admin_coach_id: req.user.coach.id,
      p_resolution_note: note,
    });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Open payment review not found' });
    return res.json(data);
  } catch (error) {
    logError('payment review resolution error', error);
    return res.status(500).json({ error: 'Failed to resolve payment review' });
  }
});

async function paymentActivity(clientId, includePrivate) {
  const [purchaseResult, creditResult, courtesyResult] = await Promise.all([
    supabaseAdmin.from('purchases')
      .select('*, package:packages(id, name), recorded_by:coaches(id, name)')
      .eq('client_id', clientId).eq('archived', false),
    supabaseAdmin.from('credit_transactions')
      .select('*').eq('client_id', clientId).eq('archived', false)
      .in('event_type', ['manual_grant', 'session_use', 'refund', 'correction', 'admin_adjustment']),
    supabaseAdmin.from('courtesy_grant_requests')
      .select('*').eq('client_id', clientId).eq('archived', false),
  ]);
  if (purchaseResult.error) throw purchaseResult.error;
  if (creditResult.error) throw creditResult.error;
  if (courtesyResult.error) throw courtesyResult.error;
  const courtesyById = new Map((courtesyResult.data || []).map((item) => [item.id, item]));

  const purchases = (purchaseResult.data || []).map((purchase) => ({
    id: `purchase:${purchase.id}`,
    type: purchase.method === 'cash' || purchase.method === 'manual' ? 'cash_payment' : 'stripe_payment',
    title: purchase.package_name || purchase.package?.name || 'Package',
    amount: Number(purchase.amount),
    currency: purchase.currency,
    credits: purchase.credits_granted,
    purchase_type: purchase.purchase_type,
    status: purchase.status,
    receipt_number: purchase.cash_receipt_number,
    note: includePrivate ? purchase.note : null,
    created_at: purchase.completed_at || purchase.created_at,
  }));
  const transactions = (creditResult.data || []).map((transaction) => {
    const courtesy = transaction.source_type === 'courtesy_grant'
      ? courtesyById.get(transaction.source_id) : null;
    return {
      id: `credit:${transaction.id}`,
      type: transaction.event_type === 'manual_grant' ? 'courtesy_grant' : transaction.event_type,
      title: transaction.event_type === 'manual_grant' ? 'Courtesy credits'
        : transaction.event_type === 'session_use' ? 'Session completed'
          : transaction.event_type === 'refund' ? 'Payment reversal' : 'Credit adjustment',
      credits: transaction.amount,
      balance_after: transaction.balance_after,
      status: courtesy?.status || 'completed',
      reason: includePrivate ? courtesy?.reason || null : null,
      note: includePrivate ? transaction.note : null,
      created_at: transaction.created_at,
    };
  });
  return [...purchases, ...transactions]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

router.get('/activity', requireClient, async (req, res) => {
  try {
    return res.json(await paymentActivity(req.user.client.id, false));
  } catch (error) {
    logError('client payment activity error', error);
    return res.status(500).json({ error: 'Failed to load payment activity' });
  }
});

router.get('/activity/:clientId', requireCoach, async (req, res) => {
  try {
    const client = await accessibleClient(req, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    return res.json(await paymentActivity(client.id, true));
  } catch (error) {
    logError('coach payment activity error', error);
    return res.status(500).json({ error: 'Failed to load payment activity' });
  }
});

router.get('/history', requireClient, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('purchases').select('*, package:packages(id, name)')
    .eq('client_id', req.user.client.id).eq('archived', false).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to load payment history' });
  return res.json(data);
});

router.get('/history/:clientId', requireCoach, async (req, res) => {
  try {
    const client = await accessibleClient(req, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.from('purchases')
      .select('*, package:packages(id, name), recorded_by:coaches(id, name)')
      .eq('client_id', client.id).eq('archived', false).order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    logError('coach history error', error);
    return res.status(500).json({ error: 'Failed to load payment history' });
  }
});

router.get('/credits', requireClient, async (req, res) => {
  return res.json({ balance: await getBalance(req.user.client.id) });
});

router.get('/credits/:clientId', requireCoach, async (req, res) => {
  const client = await accessibleClient(req, req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  return res.json({ balance: await getBalance(client.id) });
});

module.exports = router;
