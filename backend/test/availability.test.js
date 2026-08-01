const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateWindow, validateTimeOff, validateSlotQuery } = require('../src/lib/availability');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260731194500_availability.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'availability.js'), 'utf8');
const bookings = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'bookings.js'), 'utf8');

test('availability schema encodes the accepted docket decisions', () => {
  // A3: 30/45/60 requestable, 90 + assessment coach-only, assessment 90 min.
  assert.match(migration, /\('30min', '30 minutes', 30, true\)/);
  assert.match(migration, /\('45min', '45 minutes', 45, true\)/);
  assert.match(migration, /\('60min', '60 minutes', 60, true\)/);
  assert.match(migration, /\('90min', '90 minutes', 90, false\)/);
  assert.match(migration, /\('assessment', 'Assessment', 90, false\)/);
  // A1: template + overrides; A2: tstzrange time off; A8: capacity modeled.
  assert.match(migration, /create table if not exists public\.coach_availability \(/);
  assert.match(migration, /create table if not exists public\.coach_availability_overrides \(/);
  assert.match(migration, /span tstzrange not null check \(not isempty\(span\)\)/);
  assert.match(migration, /capacity integer not null default 1 check \(capacity between 1 and 10\)/);
});

test('slot RPC enforces lead, horizon, timezone, capacity, and S3', () => {
  assert.match(migration, /v_lead timestamptz := now\(\) \+ interval '12 hours'/);
  assert.match(migration, /v_horizon date := \(now\(\) at time zone v_tz\)::date \+ 21/);
  assert.match(migration, /v_tz text := 'America\/Denver'/);
  // Overrides fully replace the template that date.
  assert.match(migration, /and not exists \(\s*select 1 from public\.coach_availability_overrides o2/);
  // Cancelled and archived sessions free their slot.
  assert.match(migration, /s\.status <> 'cancelled'\s*and s\.archived = false/);
  // Service-role only, like every transactional RPC.
  assert.match(migration, /revoke execute on function public\.get_open_slots\(uuid, integer, date, date\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.get_open_slots\(uuid, integer, date, date\) to service_role;/);
});

test('window validation: weekday bounds, time order, capacity clamp', () => {
  assert.equal(validateWindow({ weekday: 1, start_time: '06:00', end_time: '11:00' }).ok, true);
  assert.equal(validateWindow({ weekday: 1, start_time: '06:00', end_time: '11:00' }).value.capacity, 1);
  assert.equal(validateWindow({ weekday: 7, start_time: '06:00', end_time: '11:00' }).ok, false);
  assert.equal(validateWindow({ weekday: 1, start_time: '11:00', end_time: '06:00' }).ok, false);
  assert.equal(validateWindow({ weekday: 1, start_time: '6:00', end_time: '11:00' }).ok, false);
  assert.equal(validateWindow({ weekday: 1, start_time: '06:00', end_time: '11:00', capacity: 11 }).ok, false);
  assert.equal(validateWindow({ on_date: '2026-08-07', start_time: '06:00', end_time: '14:00' }, { requireDate: true }).ok, true);
  assert.equal(validateWindow({ on_date: 'friday', start_time: '06:00', end_time: '14:00' }, { requireDate: true }).ok, false);
});

test('time-off and slot-query validation', () => {
  assert.equal(validateTimeOff({ starts_at: '2026-08-10T13:00:00Z', ends_at: '2026-08-10T20:00:00Z' }).ok, true);
  assert.equal(validateTimeOff({ starts_at: '2026-08-10T20:00:00Z', ends_at: '2026-08-10T13:00:00Z' }).ok, false);
  assert.equal(validateTimeOff({}).ok, false);
  assert.equal(validateSlotQuery({ duration: '60' }).ok, true);
  assert.equal(validateSlotQuery({ duration: '60', from: '2026-08-01', to: '2026-08-14' }).value.from, '2026-08-01');
  assert.equal(validateSlotQuery({ duration: '5' }).ok, false);
  assert.equal(validateSlotQuery({}).ok, false);
});

test('routes scope writes to the calling coach and slots to the client\'s own coach', () => {
  // Every mutation targets req.user.coach.id — no coach_id from the body.
  const writes = routes.match(/coach_id: req\.user\.coach\.id|eq\('coach_id', req\.user\.coach\.id\)|eq\('coach_id', coachId\)|coach_id: coachId/g) || [];
  assert.ok(writes.length >= 6, `expected >=6 own-coach scopes, saw ${writes.length}`);
  // The template writer resolves the coach once, from the session only.
  assert.match(routes, /const coachId = req\.user\.coach\.id;/);
  assert.doesNotMatch(routes, /req\.body\.coach_id|body\?\.coach_id/);
  // Clients get slots for their own coach only; the coach id never comes from the query.
  assert.match(routes, /p_coach_id: req\.user\.client\.coach_id/);
  assert.doesNotMatch(routes, /req\.query\.coach_id/);
  assert.match(routes, /router\.get\('\/slots', requireClient/);
});

test('impact UI: failed checks show error+retry, expired spans skip, jump link exists', () => {
  const editor = fs.readFileSync(
    path.join(root, 'frontend', 'src', 'components', 'AvailabilityEditor.jsx'),
    'utf8',
  );
  // A failed check must never render as "no affected sessions".
  assert.match(editor, /availability-timeoff-impact-error/);
  assert.match(editor, /availability-timeoff-impact-retry/);
  assert.match(editor, /setFailed\(true\)/);
  // Historical rows don't fire requests: fully-past spans are skipped.
  assert.match(editor, /const expired = endsAt && new Date\(endsAt\) <= new Date\(\);/);
  // The promised jump link: Open Sessions closes the drawer onto Sessions.
  assert.match(editor, /availability-timeoff-open-sessions/);
  assert.match(editor, /onOpenSessions=\{\(\) => onOpenChange\(false\)\}/);
});

test('time-off impact lists own-coach overlapping sessions and never cancels them', () => {
  // Coach-only, scoped to the caller; cancelled/archived excluded.
  assert.match(routes, /router\.get\('\/impact', requireCoach/);
  assert.match(routes, /\.neq\('status', 'cancelled'\)/);
  // Overlap tail check: the query window widens by the 240-minute max
  // duration, then the exact end-after-start filter runs in code.
  assert.match(routes, /240 \* 60000/);
  assert.match(routes, /new Date\(s\.scheduled_at\)\.getTime\(\) \+ \(s\.duration_minutes \* 60000\) > startMs/);
  // Read-only: the impact route performs no writes.
  const impactBlock = routes.slice(routes.indexOf("router.get('/impact'"), routes.indexOf("// GET /api/availability/mine"));
  assert.doesNotMatch(impactBlock, /\.update\(|\.insert\(|\.delete\(/);
});

test('review blocker 1: RLS enabled on all four tables, service-role grants without DELETE', () => {
  for (const table of ['session_types', 'coach_availability', 'coach_availability_overrides', 'coach_time_off']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`grant select, insert, update on table public\\.${table} to service_role;`));
  }
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*on table/i);
  // The API boundary stays Express-only: no client-facing policies exist.
  assert.doesNotMatch(migration, /create policy/i);
});

test('review blocker 2: soft delete only — archived flags, filtered reads, no API hard deletes', () => {
  const archivedColumns = migration.match(/archived boolean not null default false/g) || [];
  assert.equal(archivedColumns.length, 3);
  // The slot RPC ignores archived windows, overrides (both branches), and time off.
  assert.match(migration, /and not a\.archived/);
  assert.match(migration, /and o\.on_date = v_day and not o\.archived/);
  assert.match(migration, /and o2\.on_date = v_day and not o2\.archived/);
  assert.match(migration, /and not t\.archived/);
  // Routes archive instead of deleting, and reads filter archived rows.
  assert.doesNotMatch(routes, /\.delete\(\)/);
  const archives = routes.match(/\.update\(\{ archived: true \}\)/g) || [];
  assert.equal(archives.length, 2);
  const filteredReads = routes.match(/\.eq\('archived', false\)/g) || [];
  assert.ok(filteredReads.length >= 5, `expected >=5 archived filters, saw ${filteredReads.length}`);
});

test('review blocker 3: weekly replacement is one atomic service-role RPC', () => {
  assert.match(migration, /create or replace function public\.replace_coach_availability\(/);
  assert.match(migration, /set archived = true\s*where coach_id = p_coach_id and not archived;/);
  assert.match(migration, /revoke execute on function public\.replace_coach_availability\(uuid, jsonb\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.replace_coach_availability\(uuid, jsonb\) to service_role;/);
  assert.match(routes, /supabaseAdmin\.rpc\('replace_coach_availability'/);
  assert.doesNotMatch(routes, /from\('coach_availability'\)\.delete/);
});

test('review blockers 4+5: bookings fail closed on duration and enforce slot membership', () => {
  // No size guard: an empty session_types table rejects everything.
  assert.match(bookings, /if \(!requestable\.has\(validation\.value\.duration_minutes\)\)/);
  assert.doesNotMatch(bookings, /requestable\.size &&/);
  // With any active published hours, the request must be an offered slot
  // from the same RPC the picker uses (lead/horizon/time off included).
  assert.match(bookings, /supabaseAdmin\.rpc\('get_open_slots'/);
  assert.match(bookings, /\.eq\('archived', false\)/);
  assert.match(bookings, /new Date\(slot\.starts_at\)\.getTime\(\) === requestedMs/);
  assert.match(bookings, /timeZone: 'America\/Denver'/);
});
