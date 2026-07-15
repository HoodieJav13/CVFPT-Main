const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStripePrice } = require('../src/services/stripeCatalog');

test('Stripe catalog resolution returns only persisted package fields', async () => {
  const stripe = {
    prices: {
      retrieve: async (priceId, options) => {
        assert.equal(priceId, 'price_monthly');
        assert.deepEqual(options, { expand: ['product'] });
        return {
          id: priceId,
          active: true,
          unit_amount: 12500,
          currency: 'USD',
          recurring: { interval: 'month' },
          product: { id: 'prod_training', name: 'Monthly Training', active: true },
        };
      },
    },
  };

  assert.deepEqual(await resolveStripePrice('price_monthly', stripe), {
    stripe_price_id: 'price_monthly',
    stripe_product_id: 'prod_training',
    price: 125,
    currency: 'usd',
    is_recurring: true,
    billing_interval: 'month',
  });
});

test('Stripe catalog resolution rejects inactive or variable-amount Prices', async () => {
  const inactiveStripe = { prices: { retrieve: async () => ({ active: false }) } };
  await assert.rejects(() => resolveStripePrice('price_inactive', inactiveStripe), /must be active/);

  const variableStripe = {
    prices: {
      retrieve: async () => ({ active: true, unit_amount: null, product: 'prod_variable' }),
    },
  };
  await assert.rejects(() => resolveStripePrice('price_variable', variableStripe), /fixed unit amount/);
});

test('Stripe catalog resolution rejects unsupported recurring intervals cleanly', async () => {
  const weeklyStripe = {
    prices: {
      retrieve: async () => ({
        id: 'price_weekly',
        active: true,
        unit_amount: 5000,
        currency: 'usd',
        recurring: { interval: 'week' },
        product: { id: 'prod_weekly', active: true },
      }),
    },
  };
  await assert.rejects(
    () => resolveStripePrice('price_weekly', weeklyStripe),
    /must bill monthly or yearly/,
  );
});
