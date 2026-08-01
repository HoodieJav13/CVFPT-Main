const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach } = require('../middleware/auth');
const { validateTimestamp } = require('../validation/business');
const {
  sessionTotals, adherence, checkInConsistency,
  personalRecordCounts, oldestUnansweredClientMessage, attentionList,
} = require('../lib/analytics');

const router = express.Router();
router.use(requireAuth, requireCoach);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 366 * DAY_MS;

// Bounded reads for the fixed-window metrics. These are generous for a
// three-coach studio; they exist so a long-lived database can never turn
// one dashboard load into an unbounded scan. Anything truncated is
// reported in the response rather than silently dropped.
const COMPLETED_SESSION_SCAN = 2000;
const MESSAGE_WINDOW_DAYS = 90;

function dateOnly(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// GET /api/analytics/coach?from=&to=[&coach_id=]
router.get('/coach', async (req, res) => {
  try {
    // Both bounds required and capped — the same posture as the studio
    // week view; an open-ended range would scan the whole history.
    const from = validateTimestamp(req.query?.from, 'From');
    const to = validateTimestamp(req.query?.to, 'To');
    if (!from.ok || !to.ok) {
      return res.status(400).json({ error: 'from and to date-times are required' });
    }
    const spanMs = new Date(to.value).getTime() - new Date(from.value).getTime();
    if (spanMs <= 0 || spanMs > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'Range must be positive and at most 366 days' });
    }

    // Only an admin may look at another coach's practice. A coach always
    // gets their own numbers regardless of what they ask for.
    const isAdmin = req.user.role === 'admin';
    const requestedCoachId = typeof req.query?.coach_id === 'string' ? req.query.coach_id : null;
    const coachId = isAdmin && requestedCoachId ? requestedCoachId : req.user.coach.id;

    const nowMs = Date.now();
    const todayIso = dateOnly(new Date(nowMs).toISOString());
    const thirtyDaysAgo = dateOnly(new Date(nowMs - 30 * DAY_MS).toISOString());
    const messageWindowStart = new Date(nowMs - MESSAGE_WINDOW_DAYS * DAY_MS).toISOString();

    const clientsResult = await supabaseAdmin.from('clients')
      .select('id, name, created_at, archived')
      .eq('coach_id', coachId)
      .eq('archived', false);
    if (clientsResult.error) throw clientsResult.error;
    const clients = clientsResult.data || [];
    const clientIds = clients.map((c) => c.id);

    if (!clientIds.length) {
      return res.json({
        coach_id: coachId,
        range: { from: from.value, to: to.value },
        sessions: sessionTotals([], nowMs),
        adherence: { assigned: 0, completed: 0, rate: null },
        check_ins: { clients_measured: 0, average_rate_7: null, average_rate_30: null },
        personal_records_30d: 0,
        attention: [],
        truncated: {},
      });
    }

    // A fixed set of grouped reads — never one query per client.
    const [
      rangeSessions, completedSessions, assignments, checkIns,
      metrics, messages, pendingRequests,
    ] = await Promise.all([
      supabaseAdmin.from('sessions')
        .select('status, scheduled_at')
        .eq('coach_id', coachId).eq('archived', false)
        .gte('scheduled_at', from.value).lt('scheduled_at', to.value),
      // Fixed-window trigger A needs the latest completed session per
      // client plus whether they have ever completed one. Ordered newest
      // first, so the first row seen per client is their latest.
      supabaseAdmin.from('sessions')
        .select('client_id, scheduled_at')
        .eq('coach_id', coachId).eq('archived', false).eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(COMPLETED_SESSION_SCAN),
      supabaseAdmin.from('workout_assignments')
        .select('id, client_id, assigned_for')
        .in('client_id', clientIds).eq('archived', false)
        .eq('assignment_mode', 'dated')
        .gte('assigned_for', dateOnly(from.value)).lte('assigned_for', dateOnly(to.value)),
      supabaseAdmin.from('check_ins')
        .select('client_id, check_in_date')
        .in('client_id', clientIds).eq('archived', false)
        .gte('check_in_date', thirtyDaysAgo),
      supabaseAdmin.from('metrics')
        .select('id, client_id, improvement_direction')
        .in('client_id', clientIds).eq('archived', false),
      supabaseAdmin.from('messages')
        .select('client_id, sender_role, created_at')
        .eq('coach_id', coachId).eq('archived', false)
        .gte('created_at', messageWindowStart)
        .order('created_at', { ascending: true }),
      supabaseAdmin.from('booking_requests')
        .select('client_id, created_at')
        .eq('coach_id', coachId).eq('archived', false).eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ]);
    const failed = [rangeSessions, completedSessions, assignments, checkIns, metrics, messages, pendingRequests]
      .find((result) => result.error);
    if (failed) throw failed.error;

    // Completed dated workouts: one further read keyed on the assignments
    // we already have, rather than a per-assignment lookup.
    const assignmentIds = (assignments.data || []).map((a) => a.id);
    let completedAssignmentIds = new Set();
    if (assignmentIds.length) {
      const logs = await supabaseAdmin.from('workout_logs')
        .select('dated_workout_assignment_id')
        .in('dated_workout_assignment_id', assignmentIds)
        .eq('status', 'completed').eq('archived', false);
      if (logs.error) throw logs.error;
      completedAssignmentIds = new Set((logs.data || []).map((l) => l.dated_workout_assignment_id));
    }

    // PR walk needs each metric's FULL history, not just the window — see
    // the design note. Only metrics with a direction can produce a PR, so
    // neutral ones are never fetched.
    const scoredMetrics = (metrics.data || [])
      .filter((m) => m.improvement_direction === 'higher' || m.improvement_direction === 'lower');
    const entriesByMetric = new Map();
    if (scoredMetrics.length) {
      const entries = await supabaseAdmin.from('metric_entries')
        .select('metric_id, value, recorded_on')
        .in('metric_id', scoredMetrics.map((m) => m.id))
        .eq('archived', false)
        .order('recorded_on', { ascending: true });
      if (entries.error) throw entries.error;
      for (const entry of entries.data || []) {
        const list = entriesByMetric.get(entry.metric_id) || [];
        list.push(entry);
        entriesByMetric.set(entry.metric_id, list);
      }
    }

    // Fold the grouped rows into the shapes the aggregation helpers want.
    const lastCompletedByClient = new Map();
    const everCompletedClientIds = new Set();
    for (const row of completedSessions.data || []) {
      everCompletedClientIds.add(row.client_id);
      if (!lastCompletedByClient.has(row.client_id)) {
        lastCompletedByClient.set(row.client_id, row.scheduled_at);
      }
    }

    const messagesByClient = new Map();
    for (const message of messages.data || []) {
      const list = messagesByClient.get(message.client_id) || [];
      list.push(message);
      messagesByClient.set(message.client_id, list);
    }
    const unansweredByClient = new Map();
    for (const [clientId, thread] of messagesByClient) {
      const oldest = oldestUnansweredClientMessage(thread);
      if (oldest) unansweredByClient.set(clientId, oldest);
    }

    const oldestPendingRequestByClient = new Map();
    for (const request of pendingRequests.data || []) {
      if (!oldestPendingRequestByClient.has(request.client_id)) {
        oldestPendingRequestByClient.set(request.client_id, request.created_at);
      }
    }

    const adherenceResult = adherence(assignments.data || [], completedAssignmentIds, todayIso);
    const consistency = checkInConsistency(checkIns.data || [], todayIso);
    const prCounts = personalRecordCounts(scoredMetrics, entriesByMetric, thirtyDaysAgo);

    const measured = clientIds.filter((id) => consistency.has(id));
    const averageRate = (key) => (measured.length
      ? measured.reduce((sum, id) => sum + consistency.get(id)[key], 0) / measured.length
      : null);

    return res.json({
      coach_id: coachId,
      range: { from: from.value, to: to.value },
      sessions: sessionTotals(rangeSessions.data || [], nowMs),
      adherence: {
        assigned: adherenceResult.assigned,
        completed: adherenceResult.completed,
        rate: adherenceResult.rate,
      },
      // Fixed 7/30-day windows — these never follow the range toggle.
      check_ins: {
        clients_measured: measured.length,
        average_rate_7: averageRate('rate_7'),
        average_rate_30: averageRate('rate_30'),
      },
      personal_records_30d: [...prCounts.values()].reduce((sum, n) => sum + n, 0),
      attention: attentionList({
        clients,
        lastCompletedByClient,
        everCompletedClientIds,
        adherencePerClient: adherenceResult.per_client,
        checkInsPerClient: consistency,
        unansweredByClient,
        oldestPendingRequestByClient,
        nowMs,
      }),
      // Surfaced, not silent: if either bounded read hit its ceiling the
      // client can say so rather than implying full coverage.
      truncated: {
        completed_sessions: (completedSessions.data || []).length >= COMPLETED_SESSION_SCAN,
        message_window_days: MESSAGE_WINDOW_DAYS,
      },
    });
  } catch (error) {
    logError('coach analytics error', error);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});

module.exports = router;
