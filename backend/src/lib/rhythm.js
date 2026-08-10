// Program 011 A: week rhythm — the client's dated-assignment week at a
// glance, the next-day catch-up, and the week-based streak. Pure date-string
// math (YYYY-MM-DD calendar dates, no timezones — callers pass Denver-local
// "today" from utils/time). Weeks start Monday.

function parseDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDate(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  return formatDate(parseDate(dateStr) + days * 86400000);
}

/** Monday of the week containing dateStr. */
function weekStart(dateStr) {
  const day = new Date(parseDate(dateStr)).getUTCDay();
  return addDays(dateStr, -((day + 6) % 7));
}

/**
 * assignments: [{ id, assigned_for: 'YYYY-MM-DD', workout_name }]
 * completedIds: Set of assignment ids with a completed log.
 *
 * Returns the current Monday-start week (7 day cells), yesterday's missed
 * assignments (the catch-up prompt), and the week streak.
 *
 * Streak rules (owner decisions, design-plans/011): week-based, morale-safe.
 * A week counts when it had at least one dated assignment and all of them
 * are completed. The current in-progress week never breaks the streak (it
 * joins it early if already fully done). Weeks with no assignments are
 * skipped rather than breaking the chain (deload/vacation weeks are not
 * failures). Lookback capped at 26 weeks.
 */
function buildWeekRhythm({ assignments = [], completedIds = new Set(), today }) {
  const monday = weekStart(today);
  const byDate = new Map();
  for (const assignment of assignments) {
    if (!assignment.assigned_for) continue;
    const rows = byDate.get(assignment.assigned_for) || [];
    rows.push(assignment);
    byDate.set(assignment.assigned_for, rows);
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    const dayAssignments = (byDate.get(date) || []).map((assignment) => ({
      id: assignment.id,
      workout_name: assignment.workout_name || null,
      completed: completedIds.has(assignment.id),
    }));
    const state = dayAssignments.length === 0
      ? 'rest'
      : dayAssignments.every((a) => a.completed)
        ? 'done'
        : date === today
          ? 'today'
          : date < today ? 'to_make_up' : 'upcoming';
    return { date, state, assignments: dayAssignments };
  });

  const yesterday = addDays(today, -1);
  const yesterdayMissed = (byDate.get(yesterday) || []).filter((a) => !completedIds.has(a.id));

  const weekComplete = (weekMonday) => {
    let total = 0;
    let done = 0;
    for (let index = 0; index < 7; index += 1) {
      const rows = byDate.get(addDays(weekMonday, index)) || [];
      total += rows.length;
      done += rows.filter((a) => completedIds.has(a.id)).length;
    }
    if (total === 0) return 'empty';
    return done === total ? 'complete' : 'incomplete';
  };

  let streak = 0;
  // Current week joins the streak early when already fully complete, and
  // never breaks it while still in progress.
  const currentState = weekComplete(monday);
  if (currentState === 'complete') streak += 1;
  for (let back = 1; back <= 26; back += 1) {
    const state = weekComplete(addDays(monday, -7 * back));
    if (state === 'complete') streak += 1;
    else if (state === 'incomplete') break;
    // 'empty' weeks are skipped: neither counted nor streak-breaking.
  }

  const weekTotal = days.reduce((sum, day) => sum + day.assignments.length, 0);
  const weekDone = days.reduce((sum, day) => sum + day.assignments.filter((a) => a.completed).length, 0);

  return {
    week_start: monday,
    days,
    yesterday_missed: yesterdayMissed.map((a) => ({ id: a.id, workout_name: a.workout_name || null })),
    week_streak: streak,
    week_done: weekDone,
    week_total: weekTotal,
  };
}

module.exports = { addDays, buildWeekRhythm, weekStart };
