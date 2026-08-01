// Unit tests for the analytics aggregation rules. These exercise the real
// functions with real inputs — the metric definitions in
// docs/coach-analytics-design.md are enforced here, not pattern-matched.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ATTENTION,
  sessionTotals,
  adherence,
  checkInConsistency,
  personalRecordCounts,
  oldestUnansweredClientMessage,
  attentionList,
} = require('../src/lib/analytics');

const NOW = new Date('2026-08-01T12:00:00.000Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 24 * 3600 * 1000).toISOString();

test('session totals split stale past-dated scheduled rows from upcoming', () => {
  const totals = sessionTotals([
    { status: 'completed', scheduled_at: daysAgo(3) },
    { status: 'completed', scheduled_at: daysAgo(10) },
    { status: 'cancelled', scheduled_at: daysAgo(5) },
    { status: 'scheduled', scheduled_at: daysAgo(2) },  // happened, never completed
    { status: 'scheduled', scheduled_at: daysAgo(-4) }, // genuinely upcoming
  ], NOW);
  assert.equal(totals.completed, 2);
  assert.equal(totals.cancelled, 1);
  assert.equal(totals.stale, 1);
  assert.equal(totals.upcoming, 1);
  assert.equal(totals.scheduled, 2);
  // Rate excludes still-scheduled rows: 1 cancelled / (2 completed + 1).
  assert.equal(totals.cancellation_rate, 1 / 3);
});

test('cancellation rate is null rather than 0 when nothing has settled', () => {
  const totals = sessionTotals([{ status: 'scheduled', scheduled_at: daysAgo(-1) }], NOW);
  assert.equal(totals.cancellation_rate, null);
});

test('adherence counts only past-due assignments and omits unmeasured clients', () => {
  const result = adherence([
    { id: 'a1', client_id: 'c1', assigned_for: '2026-07-20' },
    { id: 'a2', client_id: 'c1', assigned_for: '2026-07-22' },
    { id: 'a3', client_id: 'c1', assigned_for: '2026-09-01' }, // future: not yet missable
    { id: 'a4', client_id: 'c2', assigned_for: '2026-07-25' },
  ], new Set(['a1', 'a4']), '2026-08-01');

  assert.equal(result.assigned, 3);
  assert.equal(result.completed, 2);
  assert.equal(result.rate, 2 / 3);
  assert.deepEqual(result.per_client.get('c1'), { eligible: 2, completed: 1 });
  // c3 has no dated assignments at all — absent, not recorded as 0%.
  assert.equal(result.per_client.has('c3'), false);
});

test('check-in consistency counts distinct dates in fixed 7/30 windows', () => {
  const consistency = checkInConsistency([
    { client_id: 'c1', check_in_date: '2026-08-01' },
    { client_id: 'c1', check_in_date: '2026-08-01' }, // duplicate collapses
    { client_id: 'c1', check_in_date: '2026-07-30' },
    { client_id: 'c1', check_in_date: '2026-07-10' }, // inside 30, outside 7
    { client_id: 'c1', check_in_date: '2026-05-01' }, // outside both
  ], '2026-08-01');

  const entry = consistency.get('c1');
  assert.equal(entry.last_7_days, 2);
  assert.equal(entry.last_30_days, 3);
  assert.equal(entry.rate_7, 2 / 7);
  assert.equal(entry.latest_date, '2026-08-01');
});

test('PRs compare against full history, not just the reported window', () => {
  const metrics = [{ id: 'm1', client_id: 'c1', improvement_direction: 'higher' }];
  const entriesByMetric = new Map([['m1', [
    { recorded_on: '2026-01-01', value: 100 }, // baseline
    { recorded_on: '2026-02-01', value: 225 }, // PR, but outside the window
    { recorded_on: '2026-07-20', value: 200 }, // inside window, does NOT beat 225
    { recorded_on: '2026-07-28', value: 230 }, // inside window, genuine PR
  ]]]);
  const counts = personalRecordCounts(metrics, entriesByMetric, '2026-07-02');
  // If the window were applied before the walk, 200 would be crowned a PR.
  assert.equal(counts.get('c1'), 1);
});

test('lower-is-better metrics count descending PRs; neutral metrics never do', () => {
  const lower = personalRecordCounts(
    [{ id: 'm1', client_id: 'c1', improvement_direction: 'lower' }],
    new Map([['m1', [
      { recorded_on: '2026-07-10', value: 12 },
      { recorded_on: '2026-07-20', value: 11 }, // faster: a PR
      { recorded_on: '2026-07-25', value: 13 }, // slower: not a PR
    ]]]),
    '2026-07-01'
  );
  assert.equal(lower.get('c1'), 1);

  const neutral = personalRecordCounts(
    [{ id: 'm2', client_id: 'c1', improvement_direction: 'neutral' }],
    new Map([['m2', [
      { recorded_on: '2026-07-10', value: 180 },
      { recorded_on: '2026-07-20', value: 200 },
    ]]]),
    '2026-07-01'
  );
  assert.equal(neutral.get('c1'), undefined);
});

test('unanswered message is the oldest since the last coach reply, not the newest', () => {
  const oldest = oldestUnansweredClientMessage([
    { sender_role: 'client', created_at: daysAgo(20) },
    { sender_role: 'coach', created_at: daysAgo(19) },  // clears everything before
    { sender_role: 'client', created_at: daysAgo(6) },  // start of the wait
    { sender_role: 'client', created_at: daysAgo(1) },  // follow-up must NOT reset it
  ]);
  assert.equal(oldest, daysAgo(6));

  // A coach reply after the last client message means nothing is pending.
  assert.equal(oldestUnansweredClientMessage([
    { sender_role: 'client', created_at: daysAgo(5) },
    { sender_role: 'coach', created_at: daysAgo(4) },
  ]), null);
});

test('attention list: each approved trigger fires and names itself', () => {
  const clients = [
    { id: 'gap', name: 'Gap', created_at: daysAgo(200) },
    { id: 'adh', name: 'Adherence', created_at: daysAgo(200) },
    { id: 'msg', name: 'Message', created_at: daysAgo(200) },
    { id: 'req', name: 'Request', created_at: daysAgo(200) },
  ];
  const rows = attentionList({
    clients,
    lastCompletedByClient: new Map([
      ['gap', daysAgo(24)],
      ['adh', daysAgo(2)], ['msg', daysAgo(2)], ['req', daysAgo(2)],
    ]),
    everCompletedClientIds: new Set(['gap', 'adh', 'msg', 'req']),
    adherencePerClient: new Map([['adh', { eligible: 4, completed: 1 }]]),
    checkInsPerClient: new Map([
      ['gap', { latest_date: '2026-07-31' }], ['adh', { latest_date: '2026-07-31' }],
      ['msg', { latest_date: '2026-07-31' }], ['req', { latest_date: '2026-07-31' }],
    ]),
    unansweredByClient: new Map([['msg', daysAgo(5)]]),
    oldestPendingRequestByClient: new Map([['req', daysAgo(3)]]),
    nowMs: NOW,
  });
  const byId = Object.fromEntries(rows.map((r) => [r.client_id, r.reasons.map((x) => x.code)]));
  assert.deepEqual(byId.gap, ['session_gap']);
  assert.deepEqual(byId.adh, ['low_adherence']);
  assert.deepEqual(byId.msg, ['unanswered_message']);
  assert.deepEqual(byId.req, ['pending_request']);
  assert.match(rows.find((r) => r.client_id === 'gap').reasons[0].label, /No session in 24 days/);
});

test('attention list respects every suppression rule', () => {
  const healthy = { latest_date: '2026-07-31' };
  const rows = attentionList({
    clients: [
      // Never trained: trigger A must not fire.
      { id: 'new', name: 'Never Started', created_at: daysAgo(60) },
      // Only 2 eligible assignments — below the minimum denominator.
      { id: 'thin', name: 'Thin Data', created_at: daysAgo(60) },
      // Brand-new client whose ONLY trigger is the check-in gap.
      { id: 'fresh', name: 'Fresh', created_at: daysAgo(3) },
      // Archived clients never appear.
      { id: 'gone', name: 'Archived', created_at: daysAgo(60), archived: true },
    ],
    lastCompletedByClient: new Map([['thin', daysAgo(1)]]),
    everCompletedClientIds: new Set(['thin']),
    adherencePerClient: new Map([['thin', { eligible: 2, completed: 0 }]]),
    checkInsPerClient: new Map([['thin', healthy]]),
    unansweredByClient: new Map(),
    oldestPendingRequestByClient: new Map(),
    nowMs: NOW,
  });
  // 'new' still surfaces for the check-in gap (it is 60 days old), but must
  // NOT carry a session_gap reason.
  const newRow = rows.find((r) => r.client_id === 'new');
  assert.deepEqual(newRow.reasons.map((r) => r.code), ['no_check_in']);
  assert.equal(rows.find((r) => r.client_id === 'thin'), undefined);
  assert.equal(rows.find((r) => r.client_id === 'fresh'), undefined);
  assert.equal(rows.find((r) => r.client_id === 'gone'), undefined);
});

test('attention rows sort by how many triggers fired', () => {
  const rows = attentionList({
    clients: [
      { id: 'one', name: 'One', created_at: daysAgo(90) },
      { id: 'three', name: 'Three', created_at: daysAgo(90) },
    ],
    lastCompletedByClient: new Map([['one', daysAgo(1)], ['three', daysAgo(40)]]),
    everCompletedClientIds: new Set(['one', 'three']),
    adherencePerClient: new Map([['three', { eligible: 5, completed: 0 }]]),
    checkInsPerClient: new Map([['one', { latest_date: '2026-07-31' }], ['three', { latest_date: '2026-07-31' }]]),
    unansweredByClient: new Map([['one', daysAgo(4)]]),
    oldestPendingRequestByClient: new Map(),
    nowMs: NOW,
  });
  assert.equal(rows[0].client_id, 'three');
  assert.equal(rows[0].reasons.length, 2);
});

test('approved threshold constants are the ones the owner signed off', () => {
  assert.deepEqual(ATTENTION, {
    sessionGapDays: 21,
    adherenceFloor: 0.5,
    adherenceMinEligible: 3,
    checkInGapDays: 14,
    unansweredMessageDays: 3,
    pendingRequestHours: 48,
    newClientGraceDays: 14,
  });
});
