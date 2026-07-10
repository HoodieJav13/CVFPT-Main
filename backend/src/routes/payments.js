const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');
const { completePurchase, addCredits, getBalance } = require('../utils/credits');
const { createStripeClient, stripeConfiguration } = require('../config/stripe');

const router = express.Router();

function getStripe() {
  const Stripe = require('stripe');
  return createStripeClient(process.env, Stripe);
}

const NOT_CONFIGURED_MSG = 'Online payments are not yet configured. Please pay your coach directly, or check back soon.';

// POST /api/payments/webhook (Stripe) - MUST be before requireAuth
router.post('/webhook', async (req, res) => {
  try {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) {
      console.warn('Stripe webhook received but Stripe is not configured - ignoring');
      return res.status(503).json({ error: 'Stripe not configured' });
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
    } catch (err) {
      console.error('Webhook signature verification failed', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { data: purchase } = await supabaseAdmin.from('purchases').select('*')
        .eq('stripe_session_id', session.id).maybeSingle();
      if (purchase) await completePurchase(purchase.id);
    }
    return res.json({ received: true });
  } catch (e) {
    console.error('webhook error', e);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.use(requireAuth);

// GET /api/payments/config
router.get('/config', async (_req, res) => {
  const configuration = stripeConfiguration(process.env);
  return res.json({
    configured: configuration.configured,
    publishable_key: configuration.configured ? configuration.publishableKey : null,
    message: configuration.configured ? null : NOT_CONFIGURED_MSG,
  });
});

// POST /api/payments/checkout { package_id } (client)
router.post('/checkout', requireClient, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: NOT_CONFIGURED_MSG, not_configured: true });
    const { data: pkg } = await supabaseAdmin.from('packages').select('*')
      .eq('id', req.body?.package_id).eq('archived', false).maybeSingle();
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const frontendUrl = process.env.FRONTEND_URL || '';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `CVF PT - ${pkg.name}`, description: `${pkg.session_credits} session credits` },
          unit_amount: Math.round(Number(pkg.price) * 100),
        },
        quantity: 1,
      }],
      success_url: `${frontendUrl}/client/packages?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/client/packages?checkout=cancelled`,
      metadata: { client_id: req.user.client.id, package_id: pkg.id },
    });

    const { error } = await supabaseAdmin.from('purchases').insert({
      client_id: req.user.client.id,
      package_id: pkg.id,
      amount: pkg.price,
      credits_granted: pkg.session_credits,
      method: 'stripe',
      status: 'pending',
      stripe_session_id: session.id,
    });
    if (error) throw error;
    return res.json({ url: session.url });
  } catch (e) {
    console.error('checkout error', e);
    return res.status(500).json({ error: 'Failed to start checkout. Please try again.' });
  }
});

// GET /api/payments/verify?session_id= (client) - fallback when webhook is not configured
router.get('/verify', requireClient, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: NOT_CONFIGURED_MSG });
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    const { data: purchase } = await supabaseAdmin.from('purchases').select('*')
      .eq('stripe_session_id', sessionId).eq('client_id', req.user.client.id).maybeSingle();
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    if (purchase.status === 'completed') {
      return res.json({ status: 'completed', credits: await getBalance(req.user.client.id) });
    }
    const session = await stripe.checkout.sessions.retrieve(String(sessionId));
    if (session.payment_status === 'paid') {
      await completePurchase(purchase.id);
      return res.json({ status: 'completed', credits: await getBalance(req.user.client.id) });
    }
    return res.json({ status: session.payment_status });
  } catch (e) {
    console.error('verify error', e);
    return res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// POST /api/payments/manual (coach records cash/manual purchase) { client_id, package_id, amount? }
router.post('/manual', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.body?.client_id).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data: pkg } = await supabaseAdmin.from('packages').select('*').eq('id', req.body?.package_id).maybeSingle();
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    const amount = req.body?.amount !== undefined && !isNaN(Number(req.body.amount)) ? Number(req.body.amount) : Number(pkg.price);
    const { data: purchase, error } = await supabaseAdmin.from('purchases').insert({
      client_id: clientRow.id,
      package_id: pkg.id,
      amount,
      credits_granted: pkg.session_credits,
      method: 'manual',
      status: 'completed',
      recorded_by_coach_id: req.user.coach.id,
    }).select('*, package:packages(id, name)').single();
    if (error) throw error;
    const balance = await addCredits(clientRow.id, pkg.session_credits);
    return res.status(201).json({ purchase, credits: balance });
  } catch (e) {
    console.error('manual purchase error', e);
    return res.status(500).json({ error: 'Failed to record purchase' });
  }
});

// GET /api/payments/history (client own)
router.get('/history', requireClient, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('purchases')
      .select('*, package:packages(id, name)')
      .eq('client_id', req.user.client.id).eq('archived', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('history error', e);
    return res.status(500).json({ error: 'Failed to load payment history' });
  }
});

// GET /api/payments/history/:clientId (coach)
router.get('/history/:clientId', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.params.clientId).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.from('purchases')
      .select('*, package:packages(id, name), recorded_by:coaches(id, name)')
      .eq('client_id', clientRow.id).eq('archived', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('coach history error', e);
    return res.status(500).json({ error: 'Failed to load payment history' });
  }
});

// GET /api/payments/credits (client own)
router.get('/credits', requireClient, async (req, res) => {
  return res.json({ balance: await getBalance(req.user.client.id) });
});

// GET /api/payments/credits/:clientId (coach)
router.get('/credits/:clientId', requireCoach, async (req, res) => {
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.params.clientId).maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
  return res.json({ balance: await getBalance(clientRow.id) });
});

module.exports = router;
