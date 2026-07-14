const { getStripeClient } = require('../config/stripe');

function stripeId(value, prefix) {
  const normalized = String(value || '').trim();
  return normalized.startsWith(prefix) ? normalized : null;
}

async function resolveStripePrice(priceId, stripe = getStripeClient()) {
  const normalized = stripeId(priceId, 'price_');
  if (!normalized) throw new Error('Enter a valid Stripe Price ID');

  if (!stripe) throw new Error('Stripe test mode is not configured');
  const price = await stripe.prices.retrieve(normalized, { expand: ['product'] });
  if (!price?.active) throw new Error('Stripe Price must be active');
  if (!Number.isInteger(price.unit_amount) || price.unit_amount < 0) {
    throw new Error('Stripe Price must use a fixed unit amount');
  }

  const product = typeof price.product === 'object' ? price.product : null;
  if (product?.deleted || product?.active === false) throw new Error('Stripe Product must be active');
  if (price.recurring && !['month', 'year'].includes(price.recurring.interval)) {
    throw new Error('Stripe Price must bill monthly or yearly when recurring');
  }

  return {
    stripe_price_id: price.id,
    stripe_product_id: typeof price.product === 'string' ? price.product : product?.id || null,
    price: price.unit_amount / 100,
    currency: String(price.currency || 'usd').toLowerCase(),
    is_recurring: Boolean(price.recurring),
    billing_interval: price.recurring?.interval || null,
  };
}

module.exports = { resolveStripePrice, stripeId };
