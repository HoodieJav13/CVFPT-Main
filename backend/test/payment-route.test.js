const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const payments = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'payments.js'), 'utf8');
const packages = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'packages.js'), 'utf8');

test('Stripe checkout uses catalog Prices for both one-time and subscription modes', () => {
  assert.match(payments, /mode: 'subscription'[\s\S]*?line_items: \[\{ price: pkg\.stripe_price_id/);
  assert.match(payments, /mode: 'payment'[\s\S]*?line_items: \[\{ price: pkg\.stripe_price_id/);
  assert.doesNotMatch(payments, /price_data:/);
  assert.match(packages, /resolveStripePrice\(value\.stripe_price_id\)/);
});

test('webhook is authoritative for credits and covers renewal and reversal events', () => {
  assert.match(payments, /constructEvent\(req\.rawBody, req\.headers\['stripe-signature'\], secret\)/);
  for (const eventType of [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.expired',
    'invoice.paid',
    'invoice.payment_failed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'charge.refunded',
    'charge.dispute.created',
  ]) {
    assert.match(payments, new RegExp(eventType.replaceAll('.', '\\.')));
  }
  const verifyRoute = payments.match(/router\.get\('\/verify'[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(verifyRoute, /completePurchase/);
  assert.match(payments, /\.rpc\('record_subscription_invoice'/);
  assert.match(payments, /\.rpc\('record_payment_reversal'/);
  assert.match(payments, /\.rpc\('open_payment_review'/);
});

test('cash and courtesy operations remain distinct audited routes', () => {
  assert.match(payments, /router\.post\('\/cash', requireCoach/);
  assert.match(payments, /router\.post\('\/courtesy', requireCoach/);
  assert.match(payments, /router\.get\('\/courtesy\/pending', requireAdmin/);
  assert.match(payments, /router\.get\('\/reviews', requireAdmin/);
  assert.doesNotMatch(payments, /router\.post\('\/manual'/);
});
