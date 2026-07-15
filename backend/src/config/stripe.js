function isStripeTestSecret(value) {
  return typeof value === 'string' && (value.startsWith('sk_test_') || value.startsWith('rk_test_'));
}

function isStripeTestPublishable(value) {
  return typeof value === 'string' && value.startsWith('pk_test_');
}

function stripeConfiguration(env = process.env) {
  const secretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  const publishableKey = String(env.STRIPE_PUBLISHABLE_KEY || '').trim();

  if (!secretKey) {
    return { configured: false, reason: 'missing', secretKey: null, publishableKey: null };
  }
  if (!isStripeTestSecret(secretKey)) {
    return { configured: false, reason: 'test_mode_required', secretKey: null, publishableKey: null };
  }
  if (publishableKey && !isStripeTestPublishable(publishableKey)) {
    return { configured: false, reason: 'test_mode_required', secretKey: null, publishableKey: null };
  }
  return { configured: true, reason: null, secretKey, publishableKey: publishableKey || null };
}

function createStripeClient(env, StripeClient) {
  const configuration = stripeConfiguration(env);
  if (!configuration.configured) return null;
  return new StripeClient(configuration.secretKey, { apiVersion: '2026-02-25.clover' });
}

function getStripeClient(env = process.env) {
  const Stripe = require('stripe');
  return createStripeClient(env, Stripe);
}

module.exports = {
  createStripeClient,
  getStripeClient,
  isStripeTestPublishable,
  isStripeTestSecret,
  stripeConfiguration,
};
