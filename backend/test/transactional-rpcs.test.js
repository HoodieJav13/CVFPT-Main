const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = [
  '20260710202908_transactional_business_mutations.sql',
  '20260711051129_transactional_program_writes.sql',
].map((name) => fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8')).join('\n');
const dataApiGrantMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260711060556_restrict_data_api_to_service_role.sql'),
  'utf8',
);
const versionedBaseline = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260710151327_baseline_schema.sql'),
  'utf8',
);
const programFrequencyMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260711234414_allow_one_to_five_day_programs.sql'),
  'utf8',
);
const paymentMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260714040224_stripe_subscriptions_offline_payments_and_credit_reviews.sql'),
  'utf8',
);
const baseline = fs.readFileSync(path.join(root, 'backend', 'migration.sql'), 'utf8');

const functions = [
  ['approve_booking', 'uuid'],
  ['complete_session', 'uuid'],
  ['complete_purchase', 'uuid'],
  ['record_manual_purchase', 'uuid, uuid, numeric, uuid'],
  ['save_workout', 'uuid, uuid, text, text, text, jsonb'],
  ['save_program', 'uuid, uuid, boolean, text, text, integer, jsonb'],
  ['create_waiver_version', 'text'],
  ['record_cash_payment', 'uuid, uuid, numeric, uuid, text'],
  ['request_courtesy_grant', 'uuid, integer, text, text, uuid, text'],
  ['review_courtesy_grant', 'uuid, boolean, uuid, text'],
  ['record_subscription_invoice', 'uuid, uuid, numeric, text, text, text, text, text'],
  ['record_payment_reversal', 'uuid, text, text, text'],
  ['open_payment_review', 'uuid, text, text, text'],
  ['resolve_payment_review', 'uuid, text, uuid, text'],
];

test('transactional RPCs are invoker-security and service-role-only', () => {
  for (const [name, signature] of functions) {
    const declaration = new RegExp(
      `create or replace function public\\.${name}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`,
    );
    const rpcMigrations = `${migration}\n${paymentMigration}`;
    assert.match(rpcMigrations, declaration, `${name} must use invoker security with an empty search path`);
    assert.match(
      rpcMigrations,
      new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon, authenticated;`),
    );
    assert.match(
      rpcMigrations,
      new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to service_role;`),
    );
  }
});

test('priority import RPC is invoker-security and unavailable to public API roles', () => {
  assert.match(
    versionedBaseline,
    /create or replace function (?:public\.)?commit_program_import[\s\S]*?security invoker[\s\S]*?set search_path = ''/,
  );
  assert.doesNotMatch(
    versionedBaseline.match(/create or replace function (?:public\.)?commit_program_import[\s\S]*?\$\$;/)?.[0] || '',
    /security definer/i,
  );
  assert.match(
    versionedBaseline,
    /revoke execute on function public\.commit_program_import\(uuid, text, jsonb\) from public;/,
  );
  assert.match(
    versionedBaseline,
    /revoke execute on function public\.commit_program_import\(uuid, text, jsonb\) from anon, authenticated;/,
  );
  assert.match(
    versionedBaseline,
    /grant execute on function public\.commit_program_import\(uuid, text, jsonb\) to service_role;/,
  );
});

test('one-to-five day programs preserve transactional RPC security', () => {
  assert.match(
    programFrequencyMigration,
    /add constraint programs_frequency_days_check\s+check \(frequency_days between 1 and 5\);/,
  );
  for (const [name, signature] of [
    ['commit_program_import', 'uuid, text, jsonb'],
    ['save_program', 'uuid, uuid, boolean, text, text, integer, jsonb'],
  ]) {
    assert.match(
      programFrequencyMigration,
      new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`),
    );
    assert.match(
      programFrequencyMigration,
      new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\)[\\s\\S]*?from public, anon, authenticated;`),
    );
    assert.match(
      programFrequencyMigration,
      new RegExp(`grant execute on function public\\.${name}\\(${signature}\\)[\\s\\S]*?to service_role;`),
    );
  }
  assert.match(programFrequencyMigration, /v_frequency is null or v_frequency < 1 or v_frequency > 5/);
  assert.match(programFrequencyMigration, /p_frequency_days is null or p_frequency_days < 1 or p_frequency_days > 5/);
  assert.match(baseline, /v_frequency is null or v_frequency < 1 or v_frequency > 5/);
  assert.doesNotMatch(programFrequencyMigration, /security definer/i);
});

test('Data API table grants are service-role-only and prohibit hard deletes', () => {
  for (const sql of [dataApiGrantMigration, baseline]) {
    const statements = sql.replace(/^--.*$/gm, '');
    assert.match(
      sql,
      /revoke all privileges on all tables in schema public\s+from public, anon, authenticated, service_role;/,
    );
    assert.match(
      sql,
      /grant select, insert, update on all tables in schema public to service_role;/,
    );
    assert.match(
      sql,
      /revoke all privileges on all sequences in schema public\s+from public, anon, authenticated, service_role;/,
    );
    assert.match(sql, /grant usage, select on all sequences in schema public to service_role;/);
    assert.doesNotMatch(statements, /grant[^;]*delete[^;]*service_role;/i);
  }
  for (const table of ['client_subscriptions', 'courtesy_grant_requests', 'payment_review_cases', 'processed_stripe_events']) {
    assert.match(paymentMigration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(paymentMigration, new RegExp(`revoke all privileges on public\\.${table} from public, anon, authenticated, service_role;`));
    assert.match(paymentMigration, new RegExp(`grant select, insert, update on public\\.${table} to service_role;`));
  }
  assert.doesNotMatch(paymentMigration.replace(/^--.*$/gm, ''), /grant[^;]*delete[^;]*service_role;/i);
});

test('state transitions use row locks, conditional state, and ledger idempotency', () => {
  assert.match(migration, /update public\.booking_requests[\s\S]*?status = 'pending'[\s\S]*?returning \* into v_booking/);
  assert.match(migration, /from public\.sessions[\s\S]*?for update;[\s\S]*?v_session\.status <> 'scheduled'/);
  assert.match(migration, /from public\.purchases[\s\S]*?for update;[\s\S]*?v_purchase\.status = 'completed'/);
  assert.match(migration, /idx_credit_transactions_source_event/);
  assert.match(migration, /idx_waiver_signatures_client_version/);
  assert.match(paymentMigration, /idx_purchases_stripe_invoice_unique/);
  assert.match(paymentMigration, /idx_payment_reviews_one_open_per_purchase/);
  assert.match(paymentMigration, /from public\.purchases[\s\S]*?for update;[\s\S]*?credits_consumed/);
});

test('HTTP handlers delegate multi-record mutations to transactional RPCs', () => {
  const bookings = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'bookings.js'), 'utf8');
  const sessions = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'sessions.js'), 'utf8');
  const payments = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'payments.js'), 'utf8');
  const credits = fs.readFileSync(path.join(root, 'backend', 'src', 'utils', 'credits.js'), 'utf8');
  const programs = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'programs.js'), 'utf8');
  const waivers = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'waivers.js'), 'utf8');

  assert.match(bookings, /\.rpc\('approve_booking'/);
  assert.match(sessions, /\.rpc\('complete_session'/);
  for (const rpc of [
    'record_cash_payment', 'request_courtesy_grant', 'review_courtesy_grant',
    'record_subscription_invoice', 'record_payment_reversal', 'open_payment_review',
    'resolve_payment_review',
  ]) {
    assert.match(payments, new RegExp(`\\.rpc\\('${rpc}'`));
  }
  assert.match(credits, /\.rpc\('complete_purchase'/);
  assert.match(programs, /\.rpc\('save_workout'/);
  assert.match(programs, /\.rpc\('save_program'/);
  assert.match(waivers, /\.rpc\('create_waiver_version'/);
  assert.doesNotMatch(credits, /setBalance|addCredits|deductCredit/);
});
