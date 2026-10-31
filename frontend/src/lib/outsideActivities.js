// Whole week / outside-activity helpers (browser ESM). Duplicated from the
// backend CommonJS at backend/src/lib/outsideActivities.js — keep types, limits,
// date math and the summary in sync; backend/test/whole-week-lib.test.js checks
// parity. Browser checks give early feedback only; the server stays authoritative.
// No '@/' imports: Node unit tests load this file directly.

const TZ = 'America/Denver';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const ACTIVITY_TYPES = ['sport_practice', 'game', 'run', 'hike', 'extra_training', 'other'];
export const LIMITS = { labelChars: 80, noteChars: 1000, maxDurationSeconds: 86400, minEffort: 1, maxEffort: 10, bodyBytes: 16384 };
export const ACTIVITY_LABELS = {
  sport_practice: 'Sport practice',
  game: 'Game',
  run: 'Run',
  hike: 'Hike',
  extra_training: 'Extra training',
  other: 'Other',
};

export function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(DATE_RE);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

// Pure calendar arithmetic on date strings: the device timezone never matters.
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

export function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, -((weekday + 6) % 7));
}

export function denverToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Week explicitly named in the URL, else this Denver week. Never re-derived at midnight. */
export function resolveWeekStart(param, now = new Date()) {
  const current = mondayOf(denverToday(now));
  if (isCalendarDate(param) && mondayOf(param) === param && param <= current) return param;
  return current;
}

/** "Sun, Mar 8" for a stored YYYY-MM-DD, formatted as a calendar day (no TZ shift). */
export function formatDay(dateStr, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!isCalendarDate(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatWeekRange(weekStart) {
  return `${formatDay(weekStart, { month: 'short', day: 'numeric' })} – ${formatDay(addDays(weekStart, 6), { month: 'short', day: 'numeric' })}`;
}

export function formatDuration(seconds) {
  if (!Number.isInteger(seconds)) return 'Duration unknown';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, seconds > 0 ? 1 : 0)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Known subtotal + missing count. Never a score, load ratio or zero-effort claim. */
export function summarizeOutsideActivities(rows = []) {
  const live = rows.filter((row) => !row.archived);
  const known = live.filter((row) => Number.isInteger(row.duration_seconds));
  return {
    activity_count: live.length,
    known_duration_seconds: known.reduce((sum, row) => sum + row.duration_seconds, 0),
    known_duration_count: known.length,
    unknown_duration_count: live.length - known.length,
    unknown_effort_count: live.filter((row) => !Number.isInteger(row.effort_rpe)).length,
  };
}

/** Copy for the ledger total. Empty means "nothing logged", never rest or zero load. */
export function summaryText(summary) {
  if (!summary || !summary.activity_count) return 'No outside activities logged this week.';
  const count = `${summary.activity_count} ${summary.activity_count === 1 ? 'activity' : 'activities'}`;
  if (!summary.known_duration_count) return `${count} logged; duration unknown for all of them.`;
  const known = `Logged ${formatDuration(summary.known_duration_seconds)} across ${count}`;
  if (!summary.unknown_duration_count) return `${known}.`;
  return `${known}; ${summary.unknown_duration_count} ${summary.unknown_duration_count === 1 ? 'has' : 'have'} unknown duration.`;
}

/**
 * Form state -> exact request fields. Blank stays null (unknown), never 0.
 * Returns { fields } or { error }.
 */
export function formToFields(form, today) {
  if (!ACTIVITY_TYPES.includes(form.activity_type)) return { error: 'Choose an activity type.' };
  if (!isCalendarDate(form.occurred_on)) return { error: 'Choose a real date.' };
  if (form.occurred_on > today) return { error: 'Activity dates cannot be in the future.' };
  const label = String(form.label || '').trim();
  if (Array.from(label).length > LIMITS.labelChars) return { error: `Label must be ${LIMITS.labelChars} characters or fewer.` };
  const note = String(form.note || '').trim();
  if (Array.from(note).length > LIMITS.noteChars) return { error: 'Note must be 1,000 characters or fewer.' };
  let durationSeconds = null;
  const minutes = String(form.duration_minutes ?? '').trim();
  // An untouched stored duration keeps its exact seconds (no silent rounding).
  if (minutes && minutes === form.shown_duration_minutes && Number.isInteger(form.stored_duration_seconds)) {
    durationSeconds = form.stored_duration_seconds;
  } else if (minutes) {
    if (!/^\d{1,4}$/.test(minutes) || Number(minutes) < 1 || Number(minutes) * 60 > LIMITS.maxDurationSeconds) {
      return { error: 'Minutes must be a whole number from 1 to 1440, or blank if unknown.' };
    }
    durationSeconds = Number(minutes) * 60;
  }
  let effort = null;
  const rpe = String(form.effort_rpe ?? '').trim();
  if (rpe) {
    if (!/^\d{1,2}$/.test(rpe) || Number(rpe) < LIMITS.minEffort || Number(rpe) > LIMITS.maxEffort) {
      return { error: 'Effort must be 1 to 10, or blank if unknown.' };
    }
    effort = Number(rpe);
  }
  return {
    fields: {
      activity_type: form.activity_type,
      occurred_on: form.occurred_on,
      label: label || null,
      duration_seconds: durationSeconds,
      effort_rpe: effort,
      note: note || null,
    },
  };
}

export function activityToForm(activity) {
  const shown = Number.isInteger(activity.duration_seconds) ? String(Math.max(1, Math.round(activity.duration_seconds / 60))) : '';
  return {
    activity_type: activity.activity_type,
    occurred_on: activity.occurred_on,
    label: activity.label || '',
    duration_minutes: shown,
    shown_duration_minutes: shown,
    stored_duration_seconds: Number.isInteger(activity.duration_seconds) ? activity.duration_seconds : null,
    effort_rpe: Number.isInteger(activity.effort_rpe) ? String(activity.effort_rpe) : '',
    note: activity.note || '',
  };
}

export function emptyActivityForm(today) {
  return { activity_type: '', occurred_on: today, label: '', duration_minutes: '', effort_rpe: '', note: '' };
}

/** Who can see this, stated plainly (coach/admin visibility). */
export function visibilityText(week) {
  const coach = week?.coach_name ? `${week.coach_name} (assigned coach)` : 'the assigned coach';
  return week?.viewer_role === 'client'
    ? `Shared with ${coach} and CVF admins.`
    : `Visible to the client, ${coach} and CVF admins.`;
}

export function collectionText(preferences, viewerRole) {
  switch (preferences?.activity_collection) {
    case 'on': return null;
    case 'client_opted_out': return viewerRole === 'client'
      ? 'You turned off outside-activity logging. Earlier entries stay visible to your coach.'
      : 'The client turned off outside-activity logging. Earlier shared entries stay visible; nobody can add new ones.';
    case 'coach_off': return viewerRole === 'client'
      ? 'Outside-activity logging is not turned on for you.'
      : 'Outside-activity logging is off for this client.';
    default: return viewerRole === 'client'
      ? 'Outside-activity logging is off unless your coach turns it on.'
      : 'Outside-activity logging is off by default. Turn it on if this client wants to share outside training.';
  }
}
