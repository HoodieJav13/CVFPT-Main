// Coach-created quick sessions: the create contract and its request
// fingerprint (docs/superpowers/specs/2026-10-09-quick-sessions-design.md, R2).
// Backend-only. The browser never sends or sees the hash; actor identity comes
// from authentication in the route, never from this body.
const crypto = require('node:crypto');
const { normalizeSupersetGroups } = require('./supersets');
const { normalizeTracking } = require('./workoutMetrics');

// Existing create/update writer normalization for workout exercise lists:
// typed metrics merged over the previous row, then full superset labeling.
function trackingExercises(exercises, previous = []) {
  const old = new Map(previous.map((row) => [row.id, row]));
  return normalizeSupersetGroups(exercises.map((row) => {
    const merged = { ...old.get(row.id), ...row };
    return { ...row, ...normalizeTracking(merged) };
  }));
}

const QUICK_SESSION_HASH_VERSION = 1;

// Persisted prescription fields, in the order the shared writer stores them.
// Any later accepted behavior-bearing field needs a new hash version.
const PRESCRIPTION_FIELDS = [
  'exercise_library_id', 'custom_name', 'sets', 'reps', 'default_load_value', 'default_load_unit',
  'rest', 'tempo', 'target_rpe', 'client_notes', 'coach_notes', 'video_url', 'superset_group',
  'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit',
];

const TOP_LEVEL_FIELDS = new Set(['request_id', 'client_id', 'assigned_for', 'name', 'notes', 'exercises']);
const EXERCISE_FIELDS = new Set([...PRESCRIPTION_FIELDS, 'name', 'notes']);
const NEVER_ACCEPTED = new Set([
  'id', 'actor', 'actor_id', 'coach_id', 'created_by', 'created_by_coach_id', 'create_request_hash', 'hash',
  'is_template', 'private', 'hidden', 'workout_id', 'assignment_id', 'library_template_id', 'kind',
]);
const TEXT_FIELDS = ['sets', 'reps', 'rest', 'tempo', 'target_rpe', 'coach_notes', 'video_url'];
const TEXT_LIMIT = 2000;
const NAME_LIMIT = 120;
const MAX_EXERCISES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnsupported(source, allowed, where) {
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) continue;
    if (NEVER_ACCEPTED.has(key)) throw invalid(`${where} field "${key}" is not accepted`);
    throw invalid(`Unsupported ${where.toLowerCase()} field "${key}"`);
  }
}

function canonicalUuid(value, message) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(message);
  return value.toLowerCase();
}

function validIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function blank(value) {
  return value === undefined || value === null || value === '';
}

// Matches save_workout's `nullif(x ->> 'field', '')`: JSON numbers render as
// their text, empty text is null, visible text is stored as typed.
function writerText(value, field, limit = TEXT_LIMIT) {
  if (blank(value)) return null;
  let text;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  else throw invalid(`Exercise ${field} must be text`);
  if (text.length > limit) throw invalid(`Exercise ${field} must be ${limit} characters or fewer`);
  return text;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

// Mirrors the writer's kept-row rule (see supersets.isKeptExercise).
function isKept(row) {
  if (!blank(row.exercise_library_id)) return true;
  return String(row.custom_name ?? row.name ?? '').trim() !== '';
}

function normalizeExercise(row) {
  const customSource = row.custom_name ?? row.name;
  const clientNotesSource = row.client_notes ?? row.notes;
  const out = {
    exercise_library_id: blank(row.exercise_library_id)
      ? null : canonicalUuid(row.exercise_library_id, 'Each exercise needs a valid library exercise'),
    custom_name: writerText(customSource, 'name', 200),
  };
  for (const field of TEXT_FIELDS) out[field] = writerText(row[field], field);
  out.client_notes = writerText(clientNotesSource, 'client_notes');
  if (blank(row.default_load_value)) {
    out.default_load_value = null;
    out.default_load_unit = null;
  } else {
    const value = finiteNumber(row.default_load_value);
    const unit = blank(row.default_load_unit) ? 'lb' : row.default_load_unit;
    if (value === null || value < 0 || !['lb', 'kg'].includes(unit)) {
      throw invalid('Each default load needs a non-negative weight in lb or kg');
    }
    out.default_load_value = value;
    out.default_load_unit = unit;
  }
  out.superset_group = row.superset_group ?? null;
  out.tracking_type = row.tracking_type;
  for (const metric of ['duration', 'distance']) {
    out[`${metric}_value`] = row[`${metric}_value`];
    out[`${metric}_unit`] = row[`${metric}_unit`];
  }
  return Object.fromEntries(PRESCRIPTION_FIELDS.map((field) => [field, out[field] === undefined ? null : out[field]]));
}

function normalizeExercises(exercises) {
  if (!Array.isArray(exercises)) throw invalid('Add at least one exercise');
  if (exercises.length > MAX_EXERCISES) throw invalid(`A quick session holds up to ${MAX_EXERCISES} exercises`);
  for (const row of exercises) {
    if (!isPlainObject(row)) throw invalid('Each exercise must be an object');
    rejectUnsupported(row, EXERCISE_FIELDS, 'Exercise');
  }
  // Full typed-metric and superset normalization over the whole list, so a
  // skipped blank row can neither bridge nor split a group.
  const tracked = trackingExercises(exercises);
  const kept = tracked.filter(isKept).map(normalizeExercise);
  if (!kept.length) throw invalid('Add at least one exercise');
  return kept;
}

function normalizeQuickSessionCreate(body, { today } = {}) {
  if (!validIsoDate(today)) throw new Error('normalizeQuickSessionCreate requires an injected Denver today');
  if (!isPlainObject(body)) throw invalid('A quick session request id is required');
  rejectUnsupported(body, TOP_LEVEL_FIELDS, 'Quick session');
  const requestId = canonicalUuid(body.request_id, 'A quick session request id is required');
  const clientId = canonicalUuid(body.client_id, 'Choose a client');

  let assignedFor = today;
  if (!blank(body.assigned_for)) {
    if (!validIsoDate(body.assigned_for)) throw invalid('Choose a valid date');
    assignedFor = body.assigned_for;
  }

  if (!blank(body.name) && typeof body.name !== 'string') throw invalid('The session name must be text');
  const title = typeof body.name === 'string' ? body.name.trim() : '';
  if (title.length > NAME_LIMIT) throw invalid(`The session name must be ${NAME_LIMIT} characters or fewer`);

  if (!blank(body.notes) && typeof body.notes !== 'string') throw invalid('Session notes must be text');
  // Assignment notes are stored trimmed (save_workout_assignment_with_loads).
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  if (notes && notes.length > TEXT_LIMIT) throw invalid(`Session notes must be ${TEXT_LIMIT} characters or fewer`);

  return {
    request_id: requestId,
    payload: {
      version: QUICK_SESSION_HASH_VERSION,
      client_id: clientId,
      assigned_for: assignedFor,
      name: title || `Quick session · ${assignedFor}`,
      notes,
      exercises: normalizeExercises(body.exercises),
    },
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Quick session fingerprints hold finite numbers only');
    return Object.is(value, -0) ? 0 : value;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function quickSessionHash(payload) {
  const digest = crypto.createHash('sha256').update(Buffer.from(canonicalJson(payload), 'utf8')).digest('hex');
  return `v${QUICK_SESSION_HASH_VERSION}:${digest}`;
}

module.exports = {
  PRESCRIPTION_FIELDS,
  QUICK_SESSION_HASH_VERSION,
  canonicalJson,
  normalizeQuickSessionCreate,
  quickSessionHash,
  trackingExercises,
};
