// Preview-mode port of the recurring-session rule, Denver time conversion,
// and suggestion times. Sources of truth (do not import them — the frontend
// and backend deploy separately):
//   backend/src/lib/sessionSeries/rule.js
//   backend/src/lib/sessionSeries/alternatives.js
//   backend/src/utils/time.js
// tests/unit/previewSeries.test.mjs holds the backend's test vectors; a
// backend rule change must update this file and those vectors together.

const TZ = 'America/Denver';
export const MAX_SLOTS = 52;
const HORIZON_DAYS = 365;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const STEP_MINUTES = 15;
const WINDOW_MINUTES = 180;
const FIRST_START = 5 * 60; // 05:00 — the DateTimePicker's first allowed start time
const LAST_START = 20 * 60 + 45; // 20:45 — and its last
const MAX_SUGGESTIONS_PER_ROW = 3;

const invalid = (error) => ({ ok: false, error });
const valid = (value) => ({ ok: true, value });
const pad = (n) => String(n).padStart(2, '0');

export function shiftDate(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

export function todayInDenver(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function tzOffsetMinutes(instantMs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date(instantMs));
  const name = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (parseInt(match[2], 10) * 60 + parseInt(match[3] || '0', 10));
}

// Spring-forward gap resolves forward; fall-back ambiguity picks the first occurrence.
export function denverWallClockToUtc(dateStr, timeStr) {
  if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
  const d = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = timeStr.match(TIME_RE);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const naive = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  const check = new Date(naive);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const offsetBefore = tzOffsetMinutes(naive - 86400000);
  const offsetAfter = tzOffsetMinutes(naive + 86400000);
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => naive - offset * 60000)
    .filter((utc) => naive - utc === tzOffsetMinutes(utc) * 60000);
  const instant = candidates.length ? Math.min(...candidates) : naive - offsetBefore * 60000;
  return new Date(instant).toISOString();
}

export function formatDenverDisplay(instant) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(instant instanceof Date ? instant : new Date(instant));
}

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isTime = (value) => typeof value === 'string' && TIME_RE.test(value);
const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
const mondayOf = (dateStr) => shiftDate(dateStr, -((weekdayOf(dateStr) + 6) % 7));
const horizonBounds = (startDate, today) => ({ min: today, max: shiftDate(startDate, HORIZON_DAYS) });

export function parseRule(raw, { today }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Repeat settings are required');
  if (!isRealDate(raw.start_date)) return invalid('Start date must be a valid date');
  if (raw.start_date < today) return invalid('A series cannot start in the past');
  if (!isTime(raw.time)) return invalid('Time must be HH:mm');
  if (!Number.isInteger(raw.duration_minutes) || raw.duration_minutes < 15 || raw.duration_minutes > 240) {
    return invalid('Duration must be a whole number between 15 and 240 minutes');
  }
  if (!Array.isArray(raw.weekdays) || !raw.weekdays.length || raw.weekdays.length > 7
    || !raw.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    || new Set(raw.weekdays).size !== raw.weekdays.length) {
    return invalid('Choose one or more weekdays');
  }
  if (raw.interval_weeks !== 1 && raw.interval_weeks !== 2) return invalid('Repeat every 1 or 2 weeks');
  const end = raw.end;
  if (!end || typeof end !== 'object' || Array.isArray(end)) return invalid('Choose how the series ends');
  const hasCount = Object.hasOwn(end, 'count');
  const hasUntil = Object.hasOwn(end, 'until');
  if (hasCount === hasUntil) return invalid('End after a number of sessions or on a date, not both');
  const bounds = horizonBounds(raw.start_date, today);
  let normalizedEnd;
  if (hasCount) {
    if (!Number.isInteger(end.count) || end.count < 1 || end.count > MAX_SLOTS) {
      return invalid(`A series has between 1 and ${MAX_SLOTS} sessions`);
    }
    normalizedEnd = { count: end.count };
  } else {
    if (!isRealDate(end.until)) return invalid('End date must be a valid date');
    if (end.until < raw.start_date) return invalid('End date cannot be before the start date');
    if (end.until > bounds.max) return invalid('A series can run at most one year from its start date');
    normalizedEnd = { until: end.until };
  }
  let location = null;
  if (raw.location !== undefined && raw.location !== null && raw.location !== '') {
    if (typeof raw.location !== 'string') return invalid('Location must be text');
    location = raw.location.trim() || null;
  }
  const weekdays = MONDAY_FIRST.filter((day) => raw.weekdays.includes(day));
  return valid({
    start_date: raw.start_date, time: raw.time, duration_minutes: raw.duration_minutes,
    weekdays, interval_weeks: raw.interval_weeks, end: normalizedEnd, location,
  });
}

// Returns at most MAX_SLOTS + 1 slots (the extra one signals exceededMax).
export function expandSeriesRule(rule) {
  const bounds = horizonBounds(rule.start_date, rule.start_date);
  const slots = [];
  let exceededHorizon = false;
  let exceededMax = false;
  const firstMonday = mondayOf(rule.start_date);
  const wantCount = Object.hasOwn(rule.end, 'count') ? rule.end.count : Infinity;
  const until = Object.hasOwn(rule.end, 'until') ? rule.end.until : null;
  const finish = () => ({ slots, exceededMax, exceededHorizon });

  for (let week = 0; week < 120 && !exceededMax; week += rule.interval_weeks) {
    for (const weekday of rule.weekdays) {
      const date = shiftDate(firstMonday, week * 7 + ((weekday + 6) % 7));
      if (date < rule.start_date) continue;
      if (until && date > until) return finish();
      if (slots.length >= wantCount) return finish();
      if (date > bounds.max) { exceededHorizon = true; return finish(); }
      slots.push({ key: `g${slots.length + 1}`, date, time: rule.time });
      if (slots.length > MAX_SLOTS) { exceededMax = true; break; }
    }
  }
  return finish();
}

export function slotHorizonError(slots, startDate, today) {
  const bounds = horizonBounds(startDate, today);
  for (const slot of slots) {
    if (slot.date < bounds.min) return 'Sessions cannot be in the past';
    if (slot.date > bounds.max) return 'Sessions must be within one year of the start date';
  }
  return null;
}

export function pastError(slots, nowMs) {
  return slots.some((slot) => !slot.scheduled_at || new Date(slot.scheduled_at).getTime() <= nowMs)
    ? 'Sessions cannot be in the past' : null;
}

// Same-day alternatives around the requested time, nearest first: +15, -15, +30, -30, ...
export function candidateTimes({ date, time }) {
  const [hour, minute] = time.split(':').map(Number);
  const base = hour * 60 + minute;
  const out = [];
  for (let delta = STEP_MINUTES; delta <= WINDOW_MINUTES; delta += STEP_MINUTES) {
    for (const sign of [1, -1]) {
      const candidate = base + sign * delta;
      if (candidate < FIRST_START || candidate > LAST_START) continue;
      out.push({ date, time: `${pad(Math.floor(candidate / 60))}:${pad(candidate % 60)}` });
    }
  }
  return out;
}

// findExisting(scheduledAtIso) -> { scope, session } | null for sessions already on the calendar.
// Suggestions are never in the past: the server refuses those at save time.
export function checkSlots({ slots, durationMinutes, findExisting, nowMs = Date.now() }) {
  const span = Number(durationMinutes) * 60000;
  const timed = slots.map((slot) => ({ ...slot, scheduled_at: denverWallClockToUtc(slot.date, slot.time) }));
  const startOf = (row) => new Date(row.scheduled_at).getTime();
  const batchHit = (key, scheduledAt) => {
    const start = new Date(scheduledAt).getTime();
    return timed.find((other) => other.key !== key && startOf(other) < start + span && start < startOf(other) + span) || null;
  };
  return timed.map((slot) => {
    let conflict = null;
    const existing = findExisting(slot.scheduled_at);
    if (existing) {
      conflict = {
        scope: existing.scope,
        session: { id: existing.session.id, scheduled_at: existing.session.scheduled_at, duration_minutes: existing.session.duration_minutes },
        display: formatDenverDisplay(existing.session.scheduled_at),
      };
    } else {
      const other = batchHit(slot.key, slot.scheduled_at);
      if (other) conflict = { scope: 'batch', with_key: other.key, display: null };
    }
    const suggestions = conflict
      ? candidateTimes(slot)
        .map((candidate) => ({ ...candidate, scheduled_at: denverWallClockToUtc(candidate.date, candidate.time) }))
        .filter((candidate) => new Date(candidate.scheduled_at).getTime() > nowMs)
        .filter((candidate) => !findExisting(candidate.scheduled_at) && !batchHit(slot.key, candidate.scheduled_at))
        .slice(0, MAX_SUGGESTIONS_PER_ROW)
        .map((candidate) => ({ ...candidate, display: formatDenverDisplay(candidate.scheduled_at) }))
      : [];
    return {
      key: slot.key, date: slot.date, time: slot.time, scheduled_at: slot.scheduled_at,
      display: formatDenverDisplay(slot.scheduled_at), conflict, suggestions,
    };
  });
}
