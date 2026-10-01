const test = require('node:test');
const assert = require('node:assert/strict');

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { supabaseAdmin: {} },
};

const { providerErrorCode } = require('../src/services/email');

test('provider error code names the rejected field without its value', () => {
  assert.equal(
    providerErrorCode({ name: 'validation_error', message: 'Invalid `reply_to` field. The email address needs to follow the `email@example.com` format.', statusCode: 400 }),
    'validation_error.reply_to',
  );
  assert.equal(
    providerErrorCode({ name: 'validation_error', message: 'Invalid `to` field: nobody@example', statusCode: 422 }),
    'validation_error.to',
  );
});

test('provider error code falls back to the error name', () => {
  assert.equal(providerErrorCode({ name: 'rate_limit_exceeded', message: 'Too many requests.' }), 'rate_limit_exceeded');
  assert.equal(providerErrorCode({ statusCode: 500 }), '500');
  assert.equal(providerErrorCode(undefined), 'provider_error');
});

test('provider error codes pass the logger safe-code filter', () => {
  const code = providerErrorCode({ name: 'validation_error', message: 'Invalid `reply_to` field' });
  assert.match(code, /^[A-Za-z0-9_.-]{1,64}$/);
});
