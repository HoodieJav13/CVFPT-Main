// Whole week / outside-activity contract (strict allowlists + Denver dates).
// Duplicated as browser ESM at frontend/src/lib/outsideActivities.js — keep the
// types, limits, date math and summary in sync; backend/test/whole-week-lib.test.js
// checks parity. The SQL RPC repeats every check; this layer only refuses bad
// input before any database call.
const { DEFAULT_TZ, dateInTz, denverWallClockToUtc } = require('../utils/time');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACTIVITY_TYPES = ['sport_practice', 'game', 'run', 'hike', 'extra_training', 'other'];
const LIMITS = { labelChars: 80, noteChars: 1000, maxDurationSeconds: 86400, minEffort: 1, maxEffort: 10, bodyBytes: 16384 };
const FIELD_KEYS = ['activity_type', 'occurred_on', 'label', 'duration_seconds', 'effort_rpe', 'note'];
const CLIENT_PREFERENCE_KEYS = ['activity_client_off', 'checkin_prompt_client_off'];
const COACH_PREFERENCE_KEYS = ['activity_coach_enabled', 'checkin_prompt_coach_enabled'];

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Strict YYYY-MM-DD that names a real calendar day (rejects 2026-02-30). */
function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(DATE_RE);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

// Pure calendar arithmetic on date strings: no local timezone is ever involved.
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, -((weekday + 6) % 7));
}

function denverToday(now = new Date()) {
  return dateInTz(now, DEFAULT_TZ);
}

/** Inclusive Denver week bounds as UTC instants: DST-safe (23/25-hour days). */
function weekInstantRange(weekStart) {
  return {
    start: denverWallClockToUtc(weekStart, '00:00'),
    end: denverWallClockToUtc(addDays(weekStart, 7), '00:00'),
  };
}

/** Explicit week selection: absent = this Denver week; must be a past/current Monday. */
function parseWeekStart(raw, today) {
  const current = mondayOf(today);
  if (raw === undefined || raw === null || raw === '') return current;
  if (!isCalendarDate(raw)) throw invalid('week_start must be a real YYYY-MM-DD date');
  if (mondayOf(raw) !== raw) throw invalid('week_start must be a Monday');
  if (raw > current) throw invalid('Future weeks are not available');
  return raw;
}

function parseActivityCursor(raw, clientId, weekStart) {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > 512) throw invalid('Invalid activity page cursor');
  let cursor;
  try { cursor = JSON.parse(raw); } catch { throw invalid('Invalid activity page cursor'); }
  if (!plainObject(cursor) || Object.keys(cursor).sort().join(',') !== 'client_id,id,occurred_on,week_start'
    || cursor.client_id !== clientId || cursor.week_start !== weekStart
    || typeof cursor.id !== 'string' || !UUID.test(cursor.id)
    || !isCalendarDate(cursor.occurred_on) || cursor.occurred_on < weekStart || cursor.occurred_on > addDays(weekStart, 6)) {
    throw invalid('Invalid activity page cursor');
  }
  return cursor;
}

function optionalText(value, max, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (Array.from(trimmed).length > max) throw invalid(`${label} must be ${max.toLocaleString('en-US')} characters or fewer`);
  return trimmed;
}

function optionalWhole(value, min, max, message) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalid(message);
  return value;
}

/** Normalizes the six editable fields. Unknown duration/effort stay null, never 0. */
function normalizeActivityFields(body, today) {
  if (!ACTIVITY_TYPES.includes(body.activity_type)) throw invalid('Choose an activity type');
  if (!isCalendarDate(body.occurred_on)) throw invalid('Choose a real calendar date');
  if (body.occurred_on > today) throw invalid('Activity dates cannot be in the future (America/Denver)');
  return {
    activity_type: body.activity_type,
    occurred_on: body.occurred_on,
    label: optionalText(body.label, LIMITS.labelChars, 'Label'),
    duration_seconds: optionalWhole(body.duration_seconds, 1, LIMITS.maxDurationSeconds,
      'Duration must be a whole number of seconds from 1 to 86400, or unknown'),
    effort_rpe: optionalWhole(body.effort_rpe, LIMITS.minEffort, LIMITS.maxEffort, 'Effort must be a whole number from 1 to 10, or unknown'),
    note: optionalText(body.note, LIMITS.noteChars, 'Note'),
  };
}

function plainObject(body) {
  return Boolean(body) && typeof body === 'object' && !Array.isArray(body);
}

function requireRequestId(body) {
  if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)) throw invalid('Invalid activity request');
  return body.request_id.toLowerCase();
}

function onlyKeys(body, allowed) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw invalid('Invalid activity request');
}

/** POST create body -> RPC request. Omitted optional fields mean unknown. */
function createRequest(body, today) {
  if (!plainObject(body)) throw invalid('Invalid activity request');
  onlyKeys(body, ['request_id', 'revision', ...FIELD_KEYS]);
  const requestId = requireRequestId(body);
  if (body.revision !== 0) throw invalid('Invalid activity revision');
  return { action: 'create', request_id: requestId, revision: 0, fields: normalizeActivityFields(body, today) };
}

/** PATCH: omitted fields retain their value; explicit null clears optional fields. */
function updateRequest(body, today) {
  if (!plainObject(body)) throw invalid('Invalid activity request');
  onlyKeys(body, ['request_id', 'revision', ...FIELD_KEYS]);
  const supplied = FIELD_KEYS.filter((key) => Object.hasOwn(body, key));
  if (!supplied.length) throw invalid('Choose an activity field to correct');
  const requestId = requireRequestId(body);
  if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw invalid('Invalid activity revision');
  const normalized = normalizeActivityFields({ activity_type: 'other', occurred_on: today, ...body }, today);
  return { action: 'update', request_id: requestId, revision: body.revision,
    fields: Object.fromEntries(supplied.map((key) => [key, normalized[key]])) };
}

function archiveRequest(body) {
  if (!plainObject(body)) throw invalid('Invalid activity request');
  onlyKeys(body, ['request_id', 'revision']);
  const requestId = requireRequestId(body);
  if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw invalid('Invalid activity revision');
  return { action: 'archive', request_id: requestId, revision: body.revision };
}

/** Role-separated: a client sends only its own opt-out bits, a coach only enable bits. */
function preferenceRequest(body, role) {
  if (!plainObject(body)) throw invalid('Invalid preference request');
  const allowed = role === 'client' ? CLIENT_PREFERENCE_KEYS : COACH_PREFERENCE_KEYS;
  const keys = Object.keys(body).filter((key) => key !== 'revision');
  if (!keys.length) throw invalid('Choose a preference to change');
  const other = role === 'client' ? COACH_PREFERENCE_KEYS : CLIENT_PREFERENCE_KEYS;
  if (keys.some((key) => other.includes(key))) {
    throw Object.assign(new Error(role === 'client' ? 'Only your coach can turn this on' : 'Only the client can change their own choice'), { status: 403 });
  }
  if (keys.some((key) => !allowed.includes(key) || typeof body[key] !== 'boolean')) throw invalid('Invalid preference request');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw invalid('Invalid preference revision');
  return Object.fromEntries([['revision', body.revision], ...keys.map((key) => [key, body[key]])]);
}

/** Known subtotal + missing count. Never a score, load ratio or zero-effort claim. */
function summarizeOutsideActivities(rows = []) {
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

/** Completed PT workouts bucketed by Denver calendar day of completion. */
function bucketCompletedWorkouts(logs, weekStart) {
  const days = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [addDays(weekStart, index), 0]));
  for (const log of logs || []) {
    if (!log?.completed_at) continue;
    const day = dateInTz(log.completed_at, DEFAULT_TZ);
    if (day in days) days[day] += 1;
  }
  return { completed_count: Object.values(days).reduce((sum, count) => sum + count, 0), by_day: days };
}

const ERROR_CODES = new Set(['request_mismatch', 'revision_conflict', 'collection_off', 'archived']);
function wholeWeekErrorStatus(error) {
  if (error?.status) return error.status;
  return ({ P0400: 400, P0403: 403, P0404: 404, P0409: 409, '42P01': 503, '42883': 503, PGRST202: 503, PGRST205: 503 })[error?.code] || 500;
}
function wholeWeekErrorCode(error) {
  return ERROR_CODES.has(error?.hint) ? error.hint : null;
}

module.exports = {
  UUID,
  ACTIVITY_TYPES,
  LIMITS,
  FIELD_KEYS,
  isCalendarDate,
  addDays,
  mondayOf,
  denverToday,
  weekInstantRange,
  parseWeekStart,
  parseActivityCursor,
  normalizeActivityFields,
  createRequest,
  updateRequest,
  archiveRequest,
  preferenceRequest,
  summarizeOutsideActivities,
  bucketCompletedWorkouts,
  wholeWeekErrorStatus,
  wholeWeekErrorCode,
};
