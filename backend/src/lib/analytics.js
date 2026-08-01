// Pure aggregation helpers for the coach analytics dashboard.
//
// Everything here takes already-fetched rows and returns plain objects, so
// the metric rules from docs/coach-analytics-design.md are unit-testable
// without a database. The route does the fetching (a fixed number of
// grouped queries, never per client) and calls into these.

const DAY_MS = 24 * 60 * 60 * 1000;

// Attention thresholds — owner-approved 2026-08-01. Deliberately constants
// here rather than a settings screen; retuning means editing this block.
const ATTENTION = {
  sessionGapDays: 21,
  adherenceFloor: 0.5,
  adherenceMinEligible: 3,
  checkInGapDays: 14,
  unansweredMessageDays: 3,
  pendingRequestHours: 48,
  newClientGraceDays: 14,
};

/**
 * Sessions in the selected range, grouped by status.
 *
 * `stale` — past-dated rows still marked 'scheduled' — is split out rather
 * than folded into scheduled: it means the session happened but was never
 * completed, which silently corrupts both this tile and attention trigger A.
 */
function sessionTotals(sessions = [], nowMs = Date.now()) {
  let completed = 0;
  let upcoming = 0;
  let stale = 0;
  let cancelled = 0;
  for (const session of sessions) {
    if (session.status === 'completed') completed += 1;
    else if (session.status === 'cancelled') cancelled += 1;
    else if (session.status === 'scheduled') {
      if (new Date(session.scheduled_at).getTime() >= nowMs) upcoming += 1;
      else stale += 1;
    }
  }
  const settled = completed + cancelled;
  return {
    completed,
    scheduled: upcoming + stale,
    upcoming,
    stale,
    cancelled,
    // Denominator excludes still-scheduled sessions so the rate doesn't
    // swing as the future fills in.
    cancellation_rate: settled > 0 ? cancelled / settled : null,
  };
}

/**
 * Dated-workout adherence.
 *
 * Only assignments whose `assigned_for` has already passed are counted —
 * future-dated work is not yet missable. Clients with no eligible
 * assignments are omitted from `per_client` entirely rather than recorded
 * as 0%: someone training on an undated active program is not adherent
 * or non-adherent, they are simply not measured by this metric.
 */
function adherence(assignments = [], completedAssignmentIds = new Set(), todayIso = null) {
  const cutoff = todayIso || new Date().toISOString().slice(0, 10);
  const perClient = new Map();
  let assigned = 0;
  let completed = 0;
  for (const assignment of assignments) {
    if (!assignment.assigned_for || assignment.assigned_for > cutoff) continue;
    assigned += 1;
    const done = completedAssignmentIds.has(assignment.id);
    if (done) completed += 1;
    const entry = perClient.get(assignment.client_id) || { eligible: 0, completed: 0 };
    entry.eligible += 1;
    if (done) entry.completed += 1;
    perClient.set(assignment.client_id, entry);
  }
  return {
    assigned,
    completed,
    rate: assigned > 0 ? completed / assigned : null,
    per_client: perClient,
  };
}

/**
 * Check-in consistency over fixed 7- and 30-day windows (never the
 * dashboard range — see the design note).
 *
 * Counts distinct `check_in_date` values. The partial unique index already
 * guarantees one active row per client per day, so this is defence against
 * the archived/active pair the partial index permits and against a future
 * query that forgets the archive filter.
 */
function checkInConsistency(checkIns = [], todayIso = null) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
  const dayCutoff = (days) => new Date(todayMs - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const cutoff7 = dayCutoff(7);
  const cutoff30 = dayCutoff(30);

  const perClient = new Map();
  for (const row of checkIns) {
    if (!row.check_in_date) continue;
    const entry = perClient.get(row.client_id) || { d7: new Set(), d30: new Set(), latest: null };
    if (row.check_in_date >= cutoff30) entry.d30.add(row.check_in_date);
    if (row.check_in_date >= cutoff7) entry.d7.add(row.check_in_date);
    if (!entry.latest || row.check_in_date > entry.latest) entry.latest = row.check_in_date;
    perClient.set(row.client_id, entry);
  }
  const result = new Map();
  for (const [clientId, entry] of perClient) {
    result.set(clientId, {
      last_7_days: entry.d7.size,
      last_30_days: entry.d30.size,
      rate_7: entry.d7.size / 7,
      rate_30: entry.d30.size / 30,
      latest_date: entry.latest,
    });
  }
  return result;
}

/**
 * Personal records set within the window, per client.
 *
 * `is_personal_best` is computed, not stored, so this cannot be a filter:
 * entries must be walked in `recorded_on` order across the metric's FULL
 * history, marking an entry a PR when it beats everything strictly before
 * it. The window bounds which PRs are reported, never which history is
 * compared against — filtering first would crown the window's opening
 * entry whenever an older, better entry exists.
 *
 * `improvement_direction = 'neutral'` (the column default) never produces
 * a PR by design.
 */
function personalRecordCounts(metrics = [], entriesByMetric = new Map(), sinceIso = null) {
  const since = sinceIso || new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  const perClient = new Map();

  for (const metric of metrics) {
    const direction = metric.improvement_direction;
    if (direction !== 'higher' && direction !== 'lower') continue;
    const entries = (entriesByMetric.get(metric.id) || [])
      .slice()
      .sort((a, b) => (a.recorded_on < b.recorded_on ? -1 : a.recorded_on > b.recorded_on ? 1 : 0));

    let best = null;
    for (const entry of entries) {
      const value = Number(entry.value);
      if (!Number.isFinite(value)) continue;
      const beatsBest = best === null
        ? false // the very first entry has nothing to beat; it is a baseline, not a PR
        : (direction === 'higher' ? value > best : value < best);
      if (beatsBest && entry.recorded_on >= since) {
        perClient.set(metric.client_id, (perClient.get(metric.client_id) || 0) + 1);
      }
      if (best === null || (direction === 'higher' ? value > best : value < best)) best = value;
    }
  }
  return perClient;
}

/**
 * Days a client has been waiting on a reply, measured from the OLDEST
 * client message sent after the last coach reply.
 *
 * Measuring from the newest would let a follow-up reset the client's own
 * timer, dropping them off the list exactly when they are being ignored
 * hardest.
 *
 * `messages` for one client must arrive sorted by `created_at` ascending.
 */
function oldestUnansweredClientMessage(messages = []) {
  let oldestPending = null;
  for (const message of messages) {
    if (message.sender_role === 'coach') {
      oldestPending = null; // a reply clears everything before it
    } else if (message.sender_role === 'client' && oldestPending === null) {
      oldestPending = message.created_at;
    }
  }
  return oldestPending;
}

/**
 * Build the needs-attention list.
 *
 * Every row names the trigger(s) that fired in plain language — a list
 * that says "needs attention" without saying why is a guilt generator,
 * not a tool. All windows here are fixed and never follow the dashboard
 * range toggle.
 */
function attentionList({
  clients = [],
  lastCompletedByClient = new Map(),
  everCompletedClientIds = new Set(),
  adherencePerClient = new Map(),
  checkInsPerClient = new Map(),
  unansweredByClient = new Map(),
  oldestPendingRequestByClient = new Map(),
  nowMs = Date.now(),
} = {}) {
  const rows = [];
  for (const client of clients) {
    if (client.archived) continue;
    const reasons = [];

    // A — dormant, but only once they have actually started training.
    const lastCompleted = lastCompletedByClient.get(client.id);
    if (everCompletedClientIds.has(client.id)) {
      const days = lastCompleted
        ? Math.floor((nowMs - new Date(lastCompleted).getTime()) / DAY_MS)
        : null;
      if (days !== null && days >= ATTENTION.sessionGapDays) {
        reasons.push({ code: 'session_gap', label: `No session in ${days} days`, days });
      }
    }

    // B — adherence, only with a real denominator of past-due assignments.
    const adherenceEntry = adherencePerClient.get(client.id);
    if (adherenceEntry && adherenceEntry.eligible >= ATTENTION.adherenceMinEligible) {
      const rate = adherenceEntry.completed / adherenceEntry.eligible;
      if (rate < ATTENTION.adherenceFloor) {
        reasons.push({
          code: 'low_adherence',
          label: `${adherenceEntry.completed} of ${adherenceEntry.eligible} workouts completed`,
          rate,
        });
      }
    }

    // C — no current information about this person.
    const checkIns = checkInsPerClient.get(client.id);
    const checkInDays = checkIns?.latest_date
      ? Math.floor((nowMs - new Date(`${checkIns.latest_date}T00:00:00.000Z`).getTime()) / DAY_MS)
      : null;
    const noRecentCheckIn = checkInDays === null || checkInDays >= ATTENTION.checkInGapDays;
    if (noRecentCheckIn) {
      reasons.push({
        code: 'no_check_in',
        label: checkInDays === null ? 'No check-ins yet' : `No check-in in ${checkInDays} days`,
        days: checkInDays,
      });
    }

    // D — coach-owned: a client waiting on a reply.
    const oldestUnanswered = unansweredByClient.get(client.id);
    if (oldestUnanswered) {
      const days = Math.floor((nowMs - new Date(oldestUnanswered).getTime()) / DAY_MS);
      if (days >= ATTENTION.unansweredMessageDays) {
        reasons.push({ code: 'unanswered_message', label: `${days} days without a reply`, days });
      }
    }

    // E — coach-owned: a booking request left hanging.
    const oldestPending = oldestPendingRequestByClient.get(client.id);
    if (oldestPending) {
      const hours = Math.floor((nowMs - new Date(oldestPending).getTime()) / (60 * 60 * 1000));
      if (hours >= ATTENTION.pendingRequestHours) {
        reasons.push({ code: 'pending_request', label: `Booking request waiting ${hours} hours`, hours });
      }
    }

    if (!reasons.length) continue;

    // A brand-new client has not had time to establish a check-in habit,
    // so C alone does not put them on the list.
    const clientAgeDays = client.created_at
      ? Math.floor((nowMs - new Date(client.created_at).getTime()) / DAY_MS)
      : null;
    const onlyNoCheckIn = reasons.length === 1 && reasons[0].code === 'no_check_in';
    if (onlyNoCheckIn && clientAgeDays !== null && clientAgeDays < ATTENTION.newClientGraceDays) continue;

    rows.push({ client_id: client.id, client_name: client.name, reasons });
  }

  // Most reasons first, so the people in the most trouble surface first.
  rows.sort((a, b) => b.reasons.length - a.reasons.length);
  return rows;
}

module.exports = {
  ATTENTION,
  sessionTotals,
  adherence,
  checkInConsistency,
  personalRecordCounts,
  oldestUnansweredClientMessage,
  attentionList,
};
