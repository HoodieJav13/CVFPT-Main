const test = require('node:test');
const assert = require('node:assert/strict');

const { createSecretKeyFetch } = require('../src/lib/supabaseFetch');

test('secret-key fetch sends the project secret only as apikey', async () => {
  const secret = 'sb_secret_test_value';
  let received;
  const wrappedFetch = createSecretKeyFetch(secret, async (_input, init) => {
    received = new Headers(init.headers);
    return new Response(null, { status: 204 });
  });

  await wrappedFetch('https://example.supabase.co/rest/v1/clients', {
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
    },
  });

  assert.equal(received.get('apikey'), secret);
  assert.equal(received.has('authorization'), false);
});

test('secret-key fetch preserves a real user access token', async () => {
  const secret = 'sb_secret_test_value';
  const userToken = 'user.jwt.value';
  let received;
  const wrappedFetch = createSecretKeyFetch(secret, async (_input, init) => {
    received = new Headers(init.headers);
    return new Response(null, { status: 204 });
  });

  await wrappedFetch('https://example.supabase.co/auth/v1/user', {
    headers: {
      apikey: secret,
      Authorization: `Bearer ${userToken}`,
    },
  });

  assert.equal(received.get('apikey'), secret);
  assert.equal(received.get('authorization'), `Bearer ${userToken}`);
});
