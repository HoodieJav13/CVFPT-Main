const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260710202908_transactional_business_mutations.sql'),
  'utf8',
);

const functions = [
  ['approve_booking', 'uuid'],
  ['complete_session', 'uuid'],
  ['complete_purchase', 'uuid'],
  ['record_manual_purchase', 'uuid, uuid, numeric, uuid'],
];

test('transactional RPCs are invoker-security and service-role-only', () => {
  for (const [name, signature] of functions) {
    const declaration = new RegExp(
      `create or replace function public\\.${name}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`,
    );
    assert.match(migration, declaration, `${name} must use invoker security with an empty search path`);
    assert.match(
      migration,
      new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon, authenticated;`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to service_role;`),
    );
  }
});

test('state transitions use row locks, conditional state, and ledger idempotency', () => {
  assert.match(migration, /update public\.booking_requests[\s\S]*?status = 'pending'[\s\S]*?returning \* into v_booking/);
  assert.match(migration, /from public\.sessions[\s\S]*?for update;[\s\S]*?v_session\.status <> 'scheduled'/);
  assert.match(migration, /from public\.purchases[\s\S]*?for update;[\s\S]*?v_purchase\.status = 'completed'/);
  assert.match(migration, /idx_credit_transactions_source_event/);
  assert.match(migration, /idx_waiver_signatures_client_version/);
});

test('HTTP handlers delegate multi-record mutations to transactional RPCs', () => {
  const bookings = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'bookings.js'), 'utf8');
  const sessions = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'sessions.js'), 'utf8');
  const payments = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'payments.js'), 'utf8');
  const credits = fs.readFileSync(path.join(root, 'backend', 'src', 'utils', 'credits.js'), 'utf8');

  assert.match(bookings, /\.rpc\('approve_booking'/);
  assert.match(sessions, /\.rpc\('complete_session'/);
  assert.match(payments, /\.rpc\('record_manual_purchase'/);
  assert.match(credits, /\.rpc\('complete_purchase'/);
  assert.doesNotMatch(credits, /setBalance|addCredits|deductCredit/);
});
