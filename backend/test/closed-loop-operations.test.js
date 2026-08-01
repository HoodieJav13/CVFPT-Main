const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { supabaseAdmin: {} },
};

const { configured, renderEmail, sendEmail, sessionFacts } = require('../src/services/email');
const { secretMatches } = require('../src/routes/internal');
const { safeProperties, safeRoute, ALLOWED } = require('../src/routes/telemetry');

const root = path.resolve(__dirname, '../..');

test('coach action queue puts directly resolvable work first and removes duplicate analytics reasons', async () => {
  const { buildCoachActionQueue } = await import(pathToFileURL(path.join(root, 'frontend/src/lib/coachActionQueue.js')));
  const dashboard = {
    stale_sessions: [{ id: 's1', client: { name: 'Sarah' } }],
    pending_bookings: [{ id: 'b1', client_id: 'c1', client: { name: 'Sarah' } }],
    recent_messages: [{ id: 'm1', client_id: 'c2', sender_role: 'client', read_by_recipient: false, client: { name: 'David' } }],
    recent_check_ins: [{ id: 'ci1', client_id: 'c3', client: { name: 'Emily' } }],
  };
  const attention = [
    { client_id: 'c1', client_name: 'Sarah', reasons: [{ code: 'pending_request', label: 'waiting' }, { code: 'low_adherence', label: 'low adherence' }] },
    { client_id: 'c2', client_name: 'David', reasons: [{ code: 'unanswered_message', label: 'unanswered' }] },
  ];
  const rows = buildCoachActionQueue(dashboard, attention);
  assert.deepEqual(rows.slice(0, 4).map((row) => row.kind), ['stale_session', 'booking', 'message', 'check_in']);
  assert.equal(rows.filter((row) => row.kind === 'attention').length, 1);
  assert.equal(rows.find((row) => row.kind === 'attention').href, '/coach/clients/c1?tab=programs');
  assert.equal(rows.find((row) => row.kind === 'message').action, 'Reply');
});

test('client Today plan chooses resume, due assignment, program, then honest fallback', async () => {
  const { chooseClientTodayPlan } = await import(pathToFileURL(path.join(root, 'frontend/src/lib/clientTodayPlan.js')));
  assert.equal(chooseClientTodayPlan({ activeLog: { id: 'log', workout_name: 'Lift' }, complete: true }).kind, 'active');
  const due = chooseClientTodayPlan({
    activeLog: null,
    assignments: { workouts: [{ id: 'a1', assignment_mode: 'dated', assigned_for: '2020-01-01', workout: { name: 'Due lift' } }], programs: [] },
    history: [], complete: true,
  });
  assert.equal(due.kind, 'dated');
  assert.deepEqual(due.source, { workout_assignment_id: 'a1' });
  const program = chooseClientTodayPlan({
    assignments: { workouts: [], programs: [{ id: 'p1', program: { name: 'Foundation', days: [{ id: 'd1', workout: { name: 'Day one' } }] } }] },
    history: [], complete: true,
  });
  assert.equal(program.kind, 'program');
  assert.equal(chooseClientTodayPlan({ assignments: null, history: [], todayCheckIn: {}, complete: false }).kind, 'unavailable');
});

test('email rendering escapes user-derived facts and is inert without owner configuration', async () => {
  const rendered = renderEmail({
    headline: 'Booked <now>', intro: 'Hello & welcome', facts: ['<script>'],
    actionLabel: 'Open', actionUrl: 'https://example.com/client',
  });
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.equal(configured({}), false);
  assert.deepEqual(await sendEmail({ to: ['nobody@example.com'] }, 'test/key', {}), { skipped: 'unconfigured' });
});

test('session email facts use Denver display and contain no arbitrary record fields', () => {
  const facts = sessionFacts({ scheduled_at: '2026-08-06T17:00:00.000Z', duration_minutes: 60, location: 'CVF Studio', private_note: 'never' }, 'Sarah Martinez');
  assert.match(facts[0], /Thu, Aug 6, 11:00 AM/);
  assert.deepEqual(facts.slice(1), ['60 minutes', 'CVF Studio', 'With Sarah']);
  assert.doesNotMatch(JSON.stringify(facts), /never/);
});

test('cron secret comparison fails closed and accepts the exact bearer token', () => {
  assert.equal(secretMatches(undefined, 'secret'), false);
  assert.equal(secretMatches('Bearer wrong', 'secret'), false);
  assert.equal(secretMatches('Bearer secret', 'secret'), true);
  assert.equal(secretMatches('Bearer secret', ''), false);
});

test('telemetry accepts only the documented event and privacy-safe property vocabulary', () => {
  assert.equal(ALLOWED.has('workout_completed'), true);
  assert.equal(ALLOWED.has('message_content'), false);
  assert.deepEqual(safeProperties({ route: '/client/workouts/31af8388-5ab4-4b8a-9aaf-6e1a4a85f075', offline: true, email: 'secret@example.com', notes: 'private', source: 'client_tracker' }), {
    route: '/client/workouts', offline: true, source: 'client_tracker',
  });
  assert.equal(safeRoute('/coach/clients/31af8388-5ab4-4b8a-9aaf-6e1a4a85f075'), '/coach/clients');
  assert.deepEqual(safeProperties({ route: '/secret@example.com', source: 'private note', outcome: 'anything' }), {});
});

test('migrations keep email preference and telemetry behind the service-role boundary', () => {
  const emailMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260801091539_email_digest_preferences.sql'), 'utf8');
  const telemetryMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260801091657_product_telemetry.sql'), 'utf8');
  assert.match(emailMigration, /digest_opt_out boolean not null default false/g);
  assert.match(telemetryMigration, /alter table public\.product_events enable row level security/i);
  assert.match(telemetryMigration, /grant select, insert, update on table public\.product_events to service_role/i);
  assert.doesNotMatch(telemetryMigration, /grant[^;]*delete/i);
  assert.doesNotMatch(telemetryMigration, /create policy/i);
});

test('every approved instant email trigger and the authenticated digest cron are wired', () => {
  const bookings = fs.readFileSync(path.join(root, 'backend/src/routes/bookings.js'), 'utf8');
  const sessions = fs.readFileSync(path.join(root, 'backend/src/routes/sessions.js'), 'utf8');
  const internal = fs.readFileSync(path.join(root, 'backend/src/routes/internal.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'backend/src/app.js'), 'utf8');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'backend/vercel.json'), 'utf8'));
  for (const event of ['booking-pending', 'booking-auto-client', 'booking-auto-coach', 'booking-approved', 'booking-declined']) {
    assert.match(bookings, new RegExp(event));
  }
  assert.match(sessions, /notifySessionCancelled/);
  assert.match(internal, /secretMatches\(req\.get\('authorization'\), process\.env\.CRON_SECRET\)/);
  assert.ok(app.indexOf("app.use('/api/internal'") < app.indexOf("app.use('/api/auth'"));
  assert.deepEqual(vercel.crons, [{ path: '/api/internal/digest', schedule: '0 13 * * *' }]);
});

test('email background work is lifecycle-bound and provider failure cannot fail domain writes', () => {
  const source = fs.readFileSync(path.join(root, 'backend/src/services/email.js'), 'utf8');
  assert.match(source, /waitUntil\(safeTask\)/);
  assert.match(source, /catch\(\(error\) => \{[\s\S]*logError\('email delivery error'/);
  assert.match(source, /if \(!configured\(env\)\) return \{ skipped: 'unconfigured' \}/);
  assert.match(source, /fetchAllRows/);
  assert.match(source, /footerUrl:.*email-settings=1/);
});

test('responsive hardening keeps primary actions in-flow and labels horizontal tabs', () => {
  const common = fs.readFileSync(path.join(root, 'frontend/src/components/common.jsx'), 'utf8');
  const sessions = fs.readFileSync(path.join(root, 'frontend/src/pages/coach/Sessions.jsx'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'frontend/src/pages/coach/ClientDetail.jsx'), 'utf8');
  assert.match(common, /flex-col[\s\S]*sm:flex-row/);
  assert.match(sessions, /grid w-full grid-cols-3/);
  assert.match(detail, /Swipe tabs for more/);
  assert.match(detail, /aria-label="Client detail sections"/);
});
