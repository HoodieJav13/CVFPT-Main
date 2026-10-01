// Pure logic for the recurring-sessions composer: program-day mapping, selection
// summary, and labels. No imports from '@/' so it runs under `node --test`.

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function shiftDate(dateStr, days) {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

export function weekdayOfDate(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

export function sortRows(rows) {
  return [...rows].sort((a, b) => `${a.date}T${a.time}|${a.key}`.localeCompare(`${b.date}T${b.time}|${b.key}`));
}

// Maps program days onto the SELECTED rows in chronological order.
//  - Automatic rows take days in sequence from `startingDay`, wrapping after the last day.
//  - Unselected rows take no day (later rows move up).
//  - A pinned row (pins[key], including null = "no workout") keeps its choice, consumes
//    its normal position, and never changes what the following row receives.
export function mapWorkouts({ rows, programDays = [], startingDay = 1, pins = {} }) {
  const days = [...programDays].sort((a, b) => a.day_number - b.day_number);
  const start = Math.max(0, days.findIndex((day) => day.day_number === startingDay));
  const mapping = {};
  let position = 0;
  for (const row of sortRows(rows)) {
    if (!row.selected) continue;
    const automatic = days.length ? (days[(start + position) % days.length].workout_id ?? null) : null;
    mapping[row.key] = Object.hasOwn(pins, row.key) ? pins[row.key] : automatic;
    position += 1;
  }
  return mapping;
}

export function summarizeSelection(rows) {
  const selected = sortRows(rows).filter((row) => row.selected);
  return { selected: selected.length, total: rows.length, lastDate: selected.length ? selected[selected.length - 1].date : null };
}

export function ruleLabel(rule) {
  const days = MONDAY_FIRST.filter((day) => (rule?.weekdays || []).includes(day)).map((day) => WEEKDAY_SHORT[day]).join('/');
  return rule?.interval_weeks === 2 ? `Every 2 weeks · ${days}` : `Weekly · ${days}`;
}

export function badgeLabel(series, ordinal) {
  return `${ruleLabel(series.rule)} · Session ${ordinal} of ${series.created_count}`;
}

// "Also assign this program" starts ticked only when the client does not already have the program.
// Apply it ONLY when the coach explicitly chooses a program — never while restoring a saved draft, and
// never because program metadata finished loading — so a deliberate "do not assign" survives recovery.
export function assignDefault(program, clientId) {
  return Boolean(program) && !(program.active_assignments || []).some((assignment) => assignment.client?.id === clientId);
}

// ---- Fallback reconstruction of the editor from a frozen create-request body ----
// Used only for restored records that have no editor snapshot. A body cannot say which
// candidates were deselected or which starting day was chosen, so rows return selected and
// every workout is pinned to what was submitted.

export function rowsFromBody(body) {
  return (body?.slots || []).map((slot) => ({
    key: slot.key, date: slot.date, time: slot.time, selected: true, conflict: null, suggestions: [],
  }));
}

export function pinsFromBody(body) {
  return Object.fromEntries((body?.slots || []).map((slot) => [slot.key, slot.workout_id ?? null]));
}

export function configFromBody(body) {
  const rule = body?.rule || {};
  const end = rule.end || {};
  return {
    weekdays: [...(rule.weekdays || [])],
    intervalWeeks: rule.interval_weeks === 2 ? 2 : 1,
    endMode: end.until ? 'until' : 'count',
    count: end.count ?? 12,
    until: end.until || '',
    programId: body?.program_id || '',
    startingDay: 1,
    assignProgram: Boolean(body?.assign_program),
    notify: body?.notify !== false,
  };
}
