const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach } = require('../middleware/auth');
const { validateTimestamp } = require('../validation/business');
const { dateInTz, shiftDate } = require('../utils/time');
const { fetchAllRows } = require('../lib/supabasePage');
const {
  ATTENTION, sessionTotals, adherence, checkInConsistency,
  personalRecordCounts, oldestUnansweredClientMessage, attentionList,
} = require('../lib/analytics');

const router = express.Router();
router.use(requireAuth, requireCoach);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 366 * DAY_MS;

// GET /api/analytics/coach?from=&to=[&coach_id=]
router.get('/coach', async (req, res) => {
  try {
    // Both bounds required and capped — an open-ended range would scan the
    // whole history. Same posture as the studio week view.
    const from = validateTimestamp(req.query?.from, 'From');
    const to = validateTimestamp(req.query?.to, 'To');
    if (!from.ok || !to.ok) {
      return res.status(400).json({ error: 'from and to date-times are required' });
    }
    const fromMs = new Date(from.value).getTime();
    const toMs = new Date(to.value).getTime();
    const spanMs = toMs - fromMs;
    if (spanMs <= 0 || spanMs > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'Range must be positive and at most 366 days' });
    }

    // Only an admin may look at another coach's practice; a coach always
    // gets their own numbers regardless of what they ask for.
    const isAdmin = req.user.role === 'admin';
    const requestedCoachId = typeof req.query?.coach_id === 'string' ? req.query.coach_id : null;
    const coachId = isAdmin && requestedCoachId ? requestedCoachId : req.user.coach.id;

    const nowMs = Date.now();
    // Every day boundary is America/Denver, per the approved spec. Using
    // UTC would roll assignment and check-in windows over a day early in
    // Albuquerque for most of the evening.
    const todayDenver = dateInTz(nowMs);
    const thirtyDaysAgoDenver = shiftDate(todayDenver, -29); // inclusive 30-day window
    const rangeFromDenver = dateInTz(fromMs);
    const rangeToDenver = dateInTz(toMs);

    // The previous equal-length window, for the tile deltas.
    const previousFromIso = new Date(fromMs - spanMs).toISOString();
    const previousFromDenver = dateInTz(fromMs - spanMs);

    const clientsResult = await supabaseAdmin.from('clients')
      .select('id, name, created_at, archived')
      .eq('coach_id', coachId)
      .eq('archived', false);
    if (clientsResult.error) throw clientsResult.error;
    const clients = clientsResult.data || [];
    const clientIds = clients.map((c) => c.id);

    const emptyTotals = sessionTotals([], nowMs);
    if (!clientIds.length) {
      return res.json({
        coach_id: coachId,
        range: { from: from.value, to: to.value },
        sessions: emptyTotals,
        adherence: { assigned: 0, completed: 0, rate: null },
        previous: {
          range: { from: previousFromIso, to: from.value },
          sessions: emptyTotals,
          adherence: { assigned: 0, completed: 0, rate: null },
        },
        check_ins: { clients_measured: 0, average_rate_7: null, average_rate_30: null },
        personal_records_30d: 0,
        attention: [],
        coverage: { complete: true },
      });
    }

    // Assignments are fetched across the union of every window that needs
    // them: the selected range, the previous equal window (deltas), and the
    // fixed last-30-days that attention trigger B is defined on. Trigger B
    // must NOT follow the range toggle — a client is not less behind
    // because the coach switched to a 7-day view.
    const assignmentFloor = [previousFromDenver, thirtyDaysAgoDenver].sort()[0];
    const assignmentCeiling = [rangeToDenver, todayDenver].sort().slice(-1)[0];

    // Sessions are fetched across [previous window start, range end) in one
    // read and split in JS, so the delta costs no extra round trip.
    const [
      sessionsSpan, assignmentsAll, checkIns, metricRows, messageRows, pendingRequests, recentCompleted,
    ] = await Promise.all([
      fetchAllRows((lo, hi) => supabaseAdmin.from('sessions')
        .select('status, scheduled_at')
        .eq('coach_id', coachId).eq('archived', false)
        .gte('scheduled_at', previousFromIso).lt('scheduled_at', to.value)
        .order('scheduled_at', { ascending: true }).order('id', { ascending: true }).range(lo, hi)),
      fetchAllRows((lo, hi) => supabaseAdmin.from('workout_assignments')
        .select('id, client_id, assigned_for')
        .in('client_id', clientIds).eq('archived', false).eq('assignment_mode', 'dated')
        .gte('assigned_for', assignmentFloor).lte('assigned_for', assignmentCeiling)
        .order('assigned_for', { ascending: true }).order('id', { ascending: true }).range(lo, hi)),
      fetchAllRows((lo, hi) => supabaseAdmin.from('check_ins')
        .select('client_id, check_in_date')
        .in('client_id', clientIds).eq('archived', false)
        .gte('check_in_date', thirtyDaysAgoDenver)
        .order('check_in_date', { ascending: true }).order('id', { ascending: true }).range(lo, hi)),
      fetchAllRows((lo, hi) => supabaseAdmin.from('metrics')
        .select('id, client_id, improvement_direction')
        .in('client_id', clientIds).eq('archived', false)
        .order('id', { ascending: true }).range(lo, hi)),
      // Deliberately NOT time-windowed. A cutoff here would silently drop
      // the longest-ignored clients off the attention list — the exact
      // false "all clear" the list exists to prevent.
      fetchAllRows((lo, hi) => supabaseAdmin.from('messages')
        .select('client_id, sender_role, created_at')
        .eq('coach_id', coachId).eq('archived', false)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(lo, hi)),
      fetchAllRows((lo, hi) => supabaseAdmin.from('booking_requests')
        .select('client_id, created_at')
        .eq('coach_id', coachId).eq('archived', false).eq('status', 'pending')
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(lo, hi)),
      // Trigger A, part one: who has completed a session recently. Bounded
      // by the threshold itself, so it stays small.
      fetchAllRows((lo, hi) => supabaseAdmin.from('sessions')
        .select('client_id, scheduled_at')
        .eq('coach_id', coachId).eq('archived', false).eq('status', 'completed')
        .gte('scheduled_at', new Date(nowMs - ATTENTION.sessionGapDays * DAY_MS).toISOString())
        .order('scheduled_at', { ascending: false }).order('id', { ascending: true }).range(lo, hi)),
    ]);

    // Trigger A, part two: only clients with nothing recent need their
    // history checked at all, and that set is the dormant handful rather
    // than the whole roster.
    const recentlyActive = new Set((recentCompleted.rows).map((row) => row.client_id));
    const dormantCandidates = clientIds.filter((id) => !recentlyActive.has(id));
    let historyCompleted = { rows: [], complete: true };
    if (dormantCandidates.length) {
      historyCompleted = await fetchAllRows((lo, hi) => supabaseAdmin.from('sessions')
        .select('client_id, scheduled_at')
        .in('client_id', dormantCandidates)
        .eq('coach_id', coachId).eq('archived', false).eq('status', 'completed')
        .order('scheduled_at', { ascending: false }).order('id', { ascending: true }).range(lo, hi));
    }

    const lastCompletedByClient = new Map();
    const everCompletedClientIds = new Set();
    for (const row of [...recentCompleted.rows, ...historyCompleted.rows]) {
      everCompletedClientIds.add(row.client_id);
      const current = lastCompletedByClient.get(row.client_id);
      if (!current || row.scheduled_at > current) lastCompletedByClient.set(row.client_id, row.scheduled_at);
    }

    // Completed dated workouts, keyed on assignments already in hand.
    const assignmentIds = assignmentsAll.rows.map((a) => a.id);
    let completedAssignmentIds = new Set();
    let logsCoverage = { complete: true };
    if (assignmentIds.length) {
      const logs = await fetchAllRows((lo, hi) => supabaseAdmin.from('workout_logs')
        .select('dated_workout_assignment_id')
        .in('dated_workout_assignment_id', assignmentIds)
        .eq('status', 'completed').eq('archived', false)
        .order('dated_workout_assignment_id', { ascending: true }).order('id', { ascending: true }).range(lo, hi));
      logsCoverage = { complete: logs.complete };
      completedAssignmentIds = new Set(logs.rows.map((l) => l.dated_workout_assignment_id));
    }

    // PRs need each metric's FULL history — the window bounds what is
    // reported, never what is compared against. Neutral metrics can never
    // produce a PR, so their entries are never fetched.
    const scoredMetrics = metricRows.rows
      .filter((m) => m.improvement_direction === 'higher' || m.improvement_direction === 'lower');
    const entriesByMetric = new Map();
    let entriesCoverage = { complete: true };
    if (scoredMetrics.length) {
      const metricIds = scoredMetrics.map((m) => m.id);
      const entries = await fetchAllRows((lo, hi) => supabaseAdmin.from('metric_entries')
        .select('id, metric_id, value, recorded_on, created_at')
        .in('metric_id', metricIds).eq('archived', false)
        .order('recorded_on', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }).range(lo, hi));
      entriesCoverage = { complete: entries.complete };
      for (const entry of entries.rows) {
        const list = entriesByMetric.get(entry.metric_id) || [];
        list.push(entry);
        entriesByMetric.set(entry.metric_id, list);
      }
    }

    const unansweredByClient = new Map();
    const messagesByClient = new Map();
    for (const message of messageRows.rows) {
      const list = messagesByClient.get(message.client_id) || [];
      list.push(message);
      messagesByClient.set(message.client_id, list);
    }
    for (const [clientId, thread] of messagesByClient) {
      const oldest = oldestUnansweredClientMessage(thread);
      if (oldest) unansweredByClient.set(clientId, oldest);
    }

    const oldestPendingRequestByClient = new Map();
    for (const request of pendingRequests.rows) {
      if (!oldestPendingRequestByClient.has(request.client_id)) {
        oldestPendingRequestByClient.set(request.client_id, request.created_at);
      }
    }

    // Split the single session read into the two windows.
    const currentSessions = [];
    const previousSessions = [];
    for (const session of sessionsSpan.rows) {
      const at = new Date(session.scheduled_at).getTime();
      if (at >= fromMs) currentSessions.push(session);
      else if (at >= fromMs - spanMs) previousSessions.push(session);
    }

    // Three adherence computations off one read: the tile (selected range),
    // its delta (previous equal window), and trigger B (fixed 30 days).
    // Half-open [lo, hi) Denver date buckets. An inclusive upper bound would
    // put the assignment dated exactly on the boundary into BOTH the current
    // and previous windows, and would stretch a nominal seven-day period
    // across eight calendar dates.
    const inWindow = (lo, hiExclusive) => assignmentsAll.rows
      .filter((a) => a.assigned_for && a.assigned_for >= lo && a.assigned_for < hiExclusive);
    const rangeAdherence = adherence(inWindow(rangeFromDenver, rangeToDenver), completedAssignmentIds, todayDenver);
    const previousAdherence = adherence(inWindow(previousFromDenver, rangeFromDenver), completedAssignmentIds, todayDenver);
    // Trigger B's fixed window ends tomorrow-exclusive so today still counts.
    const attentionAdherence = adherence(
      inWindow(thirtyDaysAgoDenver, shiftDate(todayDenver, 1)), completedAssignmentIds, todayDenver
    );

    const consistency = checkInConsistency(checkIns.rows, todayDenver);
    const prCounts = personalRecordCounts(scoredMetrics, entriesByMetric, thirtyDaysAgoDenver);

    const measured = clientIds.filter((id) => consistency.has(id));
    const averageRate = (key) => (measured.length
      ? measured.reduce((sum, id) => sum + consistency.get(id)[key], 0) / measured.length
      : null);

    const rateShape = (result) => ({
      assigned: result.assigned, completed: result.completed, rate: result.rate,
    });

    const coverageParts = [
      sessionsSpan, assignmentsAll, checkIns, metricRows, messageRows,
      pendingRequests, recentCompleted, historyCompleted, logsCoverage, entriesCoverage,
    ];

    return res.json({
      coach_id: coachId,
      range: { from: from.value, to: to.value },
      sessions: sessionTotals(currentSessions, nowMs),
      adherence: rateShape(rangeAdherence),
      // The immediately preceding equal-length window, so the dashboard can
      // render deltas without a second call.
      previous: {
        range: { from: previousFromIso, to: from.value },
        sessions: sessionTotals(previousSessions, nowMs),
        adherence: rateShape(previousAdherence),
      },
      // Fixed 7/30-day windows — these never follow the range toggle.
      check_ins: {
        clients_measured: measured.length,
        average_rate_7: averageRate('rate_7'),
        average_rate_30: averageRate('rate_30'),
      },
      personal_records_30d: [...prCounts.values()].reduce((sum, n) => sum + n, 0),
      // Trigger B is computed on the fixed 30-day window above, never on
      // the selected range.
      attention: attentionList({
        clients,
        lastCompletedByClient,
        everCompletedClientIds,
        adherencePerClient: attentionAdherence.per_client,
        checkInsPerClient: consistency,
        unansweredByClient,
        oldestPendingRequestByClient,
        nowMs,
      }),
      // True only when every paged read ran to completion. A false here
      // means some aggregate is partial and the UI must say so rather than
      // implying an all-clear.
      coverage: { complete: coverageParts.every((part) => part.complete) },
    });
  } catch (error) {
    logError('coach analytics error', error);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});

module.exports = router;
