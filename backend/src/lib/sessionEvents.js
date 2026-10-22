// pt-session-events/v1 helpers (L12/PT-Sub): request validation and the
// bounded catalog suggestion rule. Pure functions only, so the rules are
// unit-tested without a database (backend/test/session-events.test.js).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRIGGERS = ['equipment_busy', 'equipment_missing', 'cannot_do', 'location', 'other'];
const TRIGGER_LABELS = {
  equipment_busy: 'equipment busy',
  equipment_missing: 'equipment missing',
  cannot_do: 'cannot do it today',
  location: 'training elsewhere',
  other: 'other reason',
};
const CONTRACT_FIELDS = ['event_id', 'base_revision', 'local_seq', 'offline', 'plan_revision_seen'];

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function optionalCount(value, name) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) throw invalid(`${name} must be a whole number`);
  return value;
}

// Splits a set PATCH body into the contract envelope and the ordinary fields.
function setEventEnvelope(body = {}) {
  if (!Object.hasOwn(body, 'event_id')) return null;
  if (!isUuid(body.event_id)) throw invalid('A valid event_id is required');
  const fields = { ...body };
  CONTRACT_FIELDS.forEach((key) => delete fields[key]);
  return {
    eventId: body.event_id.toLowerCase(),
    baseRevision: optionalCount(body.base_revision, 'base_revision'),
    localSeq: optionalCount(body.local_seq, 'local_seq'),
    offline: body.offline === true,
    planRevisionSeen: optionalCount(body.plan_revision_seen, 'plan_revision_seen'),
    fields,
  };
}

function cleanText(value, limit, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${name} must be text`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > limit) throw invalid(`${name} must be ${limit} characters or fewer`);
  return text;
}

// Substitute targets are never inferred: blank stays null.
function normalizeTargets(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw invalid('targets must be an object');
  const out = {};
  if (input.sets !== undefined && input.sets !== null && input.sets !== '') {
    const sets = Number(input.sets);
    if (!Number.isInteger(sets) || sets < 1 || sets > 10) throw invalid('Sets must be 1 to 10');
    out.sets = sets;
  }
  const reps = cleanText(input.reps === undefined || input.reps === null ? null : String(input.reps), 20, 'Reps');
  if (reps) out.reps = reps;
  if (input.load_value !== undefined && input.load_value !== null && input.load_value !== '') {
    const load = Number(input.load_value);
    if (!Number.isFinite(load) || load < 0 || load > 2000) throw invalid('Load must be zero or more');
    const unit = input.load_unit || 'lb';
    if (!['lb', 'kg'].includes(unit)) throw invalid('Load unit must be lb or kg');
    out.load_value = load;
    out.load_unit = unit;
  }
  return out;
}

function substitutionRequest(body = {}) {
  if (!isUuid(body.id)) throw invalid('A valid substitution id is required');
  if (!isUuid(body.replacement_log_exercise_id)) throw invalid('A valid replacement id is required');
  if (!['coach_backup', 'catalog_suggestion'].includes(body.source)) throw invalid('Choose a coach backup or a suggestion');
  if (!isUuid(body.exercise_library_id)) throw invalid('Choose an exercise');
  if (body.source === 'coach_backup' && !isUuid(body.backup_id)) throw invalid('A coach backup id is required');
  if (!TRIGGERS.includes(body.trigger)) throw invalid('Choose why you are swapping');
  const chosenAt = body.chosen_at && !Number.isNaN(Date.parse(body.chosen_at)) ? new Date(body.chosen_at).toISOString() : null;
  return {
    id: body.id.toLowerCase(),
    replacementLogExerciseId: body.replacement_log_exercise_id.toLowerCase(),
    source: body.source,
    backupId: body.source === 'coach_backup' ? body.backup_id.toLowerCase() : null,
    exerciseLibraryId: body.exercise_library_id.toLowerCase(),
    trigger: body.trigger,
    reason: cleanText(body.reason, 200, 'Reason'),
    targets: normalizeTargets(body.targets || {}),
    offline: body.offline === true,
    chosenAt,
  };
}

// Who may use a choice right away (owner answers 21/22 + offline exception).
function substitutionPolicy({ source, actorRole, offline }) {
  if (actorRole === 'coach') return { activate: true, reviewStatus: 'none', notice: null };
  if (source === 'coach_backup') return { activate: true, reviewStatus: 'none', notice: offline ? 'substitution_offline' : 'substitution_used' };
  if (offline) return { activate: true, reviewStatus: 'pending', notice: 'substitution_offline' };
  return { activate: false, reviewStatus: 'none', notice: 'substitution_request' };
}

function words(value) {
  return String(value || '').toLowerCase().trim();
}

function equipmentItems(value) {
  return words(value).split(/\s*(?:,|\/|\+|\bw\/)\s*/).map((item) => item.trim()).filter(Boolean);
}

// Bounded, transparent catalog suggestions. Never an equivalence claim.
function rankSuggestions({ original, catalog, excludeIds = [], availableEquipment = [], limit = 8 }) {
  const skip = new Set([original?.id, ...excludeIds].filter(Boolean));
  const have = new Set(availableEquipment.map(words).filter(Boolean));
  const muscle = words(original?.primary_muscle);
  const category = words(original?.category);
  const rows = [];
  for (const row of catalog || []) {
    if (!row || skip.has(row.id) || row.archived || row.hidden || row.review_status !== 'approved') continue;
    const rationale = [];
    let score = 0;
    if (muscle && words(row.primary_muscle) === muscle) { score += 2; rationale.push(`Same primary muscle (${row.primary_muscle})`); }
    if (category && words(row.category) === category) { score += 1; rationale.push(`Same category (${row.category})`); }
    // A known primary muscle must match; category alone is only a fallback
    // when the original has no muscle recorded (too broad otherwise).
    if (muscle ? words(row.primary_muscle) !== muscle : !score) continue;
    const needs = equipmentItems(row.equipment);
    if (have.size) {
      if (needs.some((item) => !have.has(item) && item !== 'bodyweight')) continue;
      score += 1;
      rationale.push(needs.length ? `Uses equipment you have (${row.equipment})` : 'No equipment listed');
    } else if (row.equipment) {
      rationale.push(`Needs: ${row.equipment}`);
    }
    rows.push({ id: row.id, name: row.name, category: row.category, primary_muscle: row.primary_muscle, equipment: row.equipment, score, rationale });
  }
  return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

function triggerLabel(trigger) {
  return TRIGGER_LABELS[trigger] || 'other reason';
}

module.exports = {
  UUID_RE, TRIGGERS, isUuid, setEventEnvelope, normalizeTargets, substitutionRequest, substitutionPolicy,
  rankSuggestions, equipmentItems, triggerLabel, cleanText,
};
