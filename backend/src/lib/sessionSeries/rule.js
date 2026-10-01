const crypto = require('node:crypto');
const { shiftDate } = require('../../utils/time');
const { validateUuid } = require('../../validation/business');

const MAX_SLOTS = 52;
const HORIZON_DAYS = 365;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

const invalid = (error) => ({ ok: false, error });
const valid = (value) => ({ ok: true, value });

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isTime = (value) => typeof value === 'string' && TIME_RE.test(value);
const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
const mondayOf = (dateStr) => shiftDate(dateStr, -((weekdayOf(dateStr) + 6) % 7));

function horizonBounds(startDate, today) {
  return { min: today, max: shiftDate(startDate, HORIZON_DAYS) };
}

// Shape + rule validation. `today` is the Denver date (YYYY-MM-DD).
function parseRule(raw, { today }) {
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

// Expands a parsed rule. Returns at most MAX_SLOTS + 1 slots (the extra one,
// when present, signals exceededMax). Slots beyond the horizon are never
// returned; exceededHorizon says the rule wanted more than fit.
function expandSeriesRule(rule) {
  const bounds = horizonBounds(rule.start_date, rule.start_date);
  const slots = [];
  let exceededHorizon = false;
  let exceededMax = false;
  const firstMonday = mondayOf(rule.start_date);
  const wantCount = Object.hasOwn(rule.end, 'count') ? rule.end.count : Infinity;
  const until = Object.hasOwn(rule.end, 'until') ? rule.end.until : null;

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

  function finish() { return { slots, exceededMax, exceededHorizon }; }
}

function validateSlotShapes(rawSlots) {
  if (!Array.isArray(rawSlots) || rawSlots.length < 1 || rawSlots.length > MAX_SLOTS) {
    return invalid(`Choose between 1 and ${MAX_SLOTS} sessions`);
  }
  const seen = new Set();
  const value = [];
  for (const slot of rawSlots) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return invalid('Each session needs a key, date and time');
    if (typeof slot.key !== 'string' || !slot.key.trim() || slot.key.length > 64) return invalid('Each session needs a key');
    if (seen.has(slot.key)) return invalid('Session keys must be unique');
    seen.add(slot.key);
    if (!isRealDate(slot.date)) return invalid('Each session needs a valid date');
    if (!isTime(slot.time)) return invalid('Each session needs a valid time');
    let workoutId = null;
    if (slot.workout_id !== undefined && slot.workout_id !== null) {
      const check = validateUuid(slot.workout_id, 'Workout ID');
      if (!check.ok) return invalid(check.error);
      workoutId = check.value;
    }
    value.push({ key: slot.key, date: slot.date, time: slot.time, workout_id: workoutId });
  }
  return valid(value);
}

// One horizon definition for generation, edits, additions, suggestions and creation.
function slotHorizonError(slots, startDate, today) {
  const bounds = horizonBounds(startDate, today);
  for (const slot of slots) {
    if (slot.date < bounds.min) return 'Sessions cannot be in the past';
    if (slot.date > bounds.max) return 'Sessions must be within one year of the start date';
  }
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Hash of the normalized request body. Slots are sorted so row order cannot
// change the hash; everything else is key-sorted by canonicalJson.
function requestHash(normalizedBody) {
  const body = { ...normalizedBody };
  if (Array.isArray(body.slots)) {
    body.slots = [...body.slots].sort((a, b) => `${a.date}T${a.time}|${a.key}`.localeCompare(`${b.date}T${b.time}|${b.key}`));
  }
  return crypto.createHash('sha256').update(canonicalJson(body)).digest('hex');
}

module.exports = {
  isRealDate, isTime,
  MAX_SLOTS, HORIZON_DAYS, parseRule, expandSeriesRule, horizonBounds, validateSlotShapes,
  slotHorizonError, canonicalJson, requestHash,
};
