const test = require('node:test');
const assert = require('node:assert/strict');
const { createStripeClient, stripeConfiguration } = require('../src/config/stripe');

const key = (...parts) => parts.join('_');

test('Stripe remains disabled without a secret key', () => {
  assert.deepEqual(stripeConfiguration({}), {
    configured: false,
    reason: 'missing',
    secretKey: null,
    publishableKey: null,
  });
});

test('Stripe rejects live and malformed secret keys without retaining their values', () => {
  for (const secret of [key('sk', 'live', 'sample'), key('rk', 'live', 'sample'), 'malformed']) {
    const result = stripeConfiguration({ STRIPE_SECRET_KEY: secret });
    assert.equal(result.configured, false);
    assert.equal(result.reason, 'test_mode_required');
    assert.equal(result.secretKey, null);
  }
});

test('Stripe rejects a live publishable key even with a test secret', () => {
  const result = stripeConfiguration({
    STRIPE_SECRET_KEY: key('sk', 'test', 'sample'),
    STRIPE_PUBLISHABLE_KEY: key('pk', 'live', 'sample'),
  });
  assert.equal(result.configured, false);
  assert.equal(result.publishableKey, null);
});

test('Stripe accepts only test-mode configuration and constructs the client once', () => {
  const secret = key('sk', 'test', 'sample');
  const publishable = key('pk', 'test', 'sample');
  const constructed = [];
  class FakeStripe {
    constructor(value) {
      constructed.push(value);
    }
  }

  const configuration = stripeConfiguration({
    STRIPE_SECRET_KEY: secret,
    STRIPE_PUBLISHABLE_KEY: publishable,
  });
  assert.equal(configuration.configured, true);
  assert.equal(configuration.publishableKey, publishable);
  assert.ok(createStripeClient({ STRIPE_SECRET_KEY: secret }, FakeStripe));
  assert.deepEqual(constructed, [secret]);
});

test('Stripe client is never constructed for live-mode configuration', () => {
  let constructed = false;
  class FakeStripe {
    constructor() {
      constructed = true;
    }
  }
  const client = createStripeClient({ STRIPE_SECRET_KEY: key('sk', 'live', 'sample') }, FakeStripe);
  assert.equal(client, null);
  assert.equal(constructed, false);
});
