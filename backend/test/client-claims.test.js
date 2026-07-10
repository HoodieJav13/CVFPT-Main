const test = require('node:test');
const assert = require('node:assert/strict');
const { linkInvitedClient } = require('../src/services/clientClaims');

function fakeSupabase(result) {
  const calls = [];
  const query = {
    update(value) { calls.push(['update', value]); return this; },
    eq(field, value) { calls.push(['eq', field, value]); return this; },
    is(field, value) { calls.push(['is', field, value]); return this; },
    select(value) { calls.push(['select', value]); return this; },
    maybeSingle() { calls.push(['maybeSingle']); return Promise.resolve(result); },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

test('client claim repeats invited, unclaimed, active predicates in the update', async () => {
  const linked = { id: 'client-a', auth_user_id: 'user-a' };
  const fake = fakeSupabase({ data: linked, error: null });
  const result = await linkInvitedClient(fake.client, {
    clientId: 'client-a',
    authUserId: 'user-a',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });

  assert.deepEqual(result, { data: linked, error: null });
  assert.ok(fake.calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === 'client-a'));
  assert.ok(fake.calls.some((call) => call[0] === 'eq' && call[1] === 'invited' && call[2] === true));
  assert.ok(fake.calls.some((call) => call[0] === 'is' && call[1] === 'auth_user_id' && call[2] === null));
  assert.ok(fake.calls.some((call) => call[0] === 'eq' && call[1] === 'archived' && call[2] === false));
  assert.equal(fake.calls.at(-1)[0], 'maybeSingle');
});

test('client claim reports a lost race as no linked row', async () => {
  const fake = fakeSupabase({ data: null, error: null });
  const result = await linkInvitedClient(fake.client, {
    clientId: 'client-a',
    authUserId: 'user-a',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
  assert.deepEqual(result, { data: null, error: null });
});
