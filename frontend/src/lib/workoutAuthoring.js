// Workout Authoring Studio (docs/workout-authoring/first-slice.md): typed,
// pasted or keyboard-dictated text becomes one editable workout-builder form.
// Parsing is the deterministic Program Draft authoring parser; this module adds
// the review the coach completes before anything reaches the builder: exact
// catalog matches, explicit choices for duplicate or unknown names, and explicit
// decisions for prescriptions and lines the parser could not read. Nothing here
// calls the API or changes the exercise catalog.
import { normalizeName, parseAuthoringText } from './programDraft.js';
import { chooseLibraryExercise } from './trainingLibrary.js';
import { normalizeTracking, trackingType, tracks } from './workoutMetrics.js';

const PRESCRIPTION_FIELDS = ['sets', 'reps', 'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit'];
const SUGGESTION_LIMIT = 3;
const NOT_LINKED = { exercise_library_id: '', video_link_mode: null, video_url: '' };
const BLANK_EXERCISE = { name: '', sets: '', reps: '', rest: '', tempo: '', client_notes: '', coach_notes: '' };

// Review-only keys; the builder gives accepted rows their own _uid.
let reviewKey = 0;
const nextKey = () => `authoring-${++reviewKey}`;
const filled = (value) => value !== null && value !== undefined && String(value).trim() !== '';

function nameTokens(name) {
  const tokens = normalizeName(name).split(/[^a-z0-9]+/).filter((token) => token.length > 1)
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));
  return [...new Set(tokens)];
}

// Possible catalog matches by shared words. Only shown as suggestions; never picked automatically.
export function suggestCatalogExercises(library, name, limit = SUGGESTION_LIMIT) {
  const wanted = nameTokens(name);
  if (!wanted.length) return [];
  return (library || [])
    .map((entry) => {
      const tokens = nameTokens(entry.name);
      const shared = wanted.filter((token) => tokens.includes(token)).length;
      return { entry, score: shared / Math.max(wanted.length, tokens.length) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name) || String(a.entry.id).localeCompare(String(b.entry.id)))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

// One exact (normalized) catalog name links at once, with the same fields the
// builder's picker sets. Several catalog rows with that exact name, or none,
// leave the row unlinked with the typed name kept until the coach chooses.
export function resolveCatalogName(library, name) {
  const value = String(name ?? '');
  const key = normalizeName(value);
  const base = { ...NOT_LINKED, name: value, candidate_ids: [], suggestion_ids: [] };
  if (!key) return { ...base, catalog: 'unnamed' };
  const exact = (library || []).filter((entry) => normalizeName(entry.name) === key);
  if (exact.length === 1) {
    const { custom_name: linkedName, ...link } = chooseLibraryExercise(NOT_LINKED, exact[0], value);
    return { ...base, ...link, name: linkedName, catalog: 'matched' };
  }
  if (exact.length > 1) return { ...base, catalog: 'ambiguous', candidate_ids: exact.map((entry) => entry.id) };
  return { ...base, catalog: 'unmatched', suggestion_ids: suggestCatalogExercises(library, value).map((entry) => entry.id) };
}

function reviewRow(exercise, annotation, library) {
  return {
    key: nextKey(),
    source_line: annotation?.source_line || '',
    source_name: exercise.name,
    sets: exercise.sets ?? '',
    reps: exercise.reps ?? '',
    tracking_type: trackingType(exercise),
    duration_value: exercise.duration_value ?? '',
    duration_unit: exercise.duration_unit ?? null,
    distance_value: exercise.distance_value ?? '',
    distance_unit: exercise.distance_unit ?? null,
    rest: exercise.rest ?? '',
    tempo: exercise.tempo ?? '',
    client_notes: exercise.client_notes ?? '',
    coach_notes: exercise.coach_notes ?? '',
    prescription_issue: annotation?.prescription_issue || null,
    prescription_edited: false,
    ...resolveCatalogName(library, exercise.name),
  };
}

// { ok: true, review } or { ok: false, error: { message, lines } } for text with no exercise.
export function buildAuthoringReview(text, library = []) {
  let parsed;
  try {
    parsed = parseAuthoringText(text);
  } catch (error) {
    if (error?.code !== 'NO_EXERCISES_FOUND') throw error;
    return { ok: false, error: { message: error.message, lines: error.validation?.unrecognized_lines || [] } };
  }
  const days = parsed.draft.days.map((day, index) => {
    const meta = parsed.review.days[index];
    return {
      key: nextKey(),
      day_number: day.day_number,
      name: day.name,
      exercises: day.exercises.map((exercise, position) => reviewRow(exercise, meta.exercises[position], library)),
      // Plain text lines start as workout notes; lines with numbers or workout words need a decision.
      extra_lines: meta.extra_lines.map(({ line, signal }) => ({ key: nextKey(), line, signal, choice: signal ? null : 'note' })),
    };
  });
  return {
    ok: true,
    review: { parser_version: parsed.draft.import_meta.parser_version, days, selected_day: days.length === 1 ? 0 : null },
  };
}

function trackingProblem(row) {
  try {
    normalizeTracking(row);
    return null;
  } catch (error) {
    return error.message;
  }
}

export function rowIssues(row) {
  const label = String(row.name || '').trim() || row.source_name || 'this exercise';
  const issues = [];
  if (row.catalog === 'unnamed' || !String(row.name || '').trim()) issues.push({ code: 'name_required', message: 'Enter an exercise name.' });
  else if (row.catalog === 'ambiguous') issues.push({ code: 'catalog_ambiguous', message: `Several catalog exercises are named "${label}". Choose one.` });
  else if (row.catalog === 'unmatched') issues.push({ code: 'catalog_unmatched', message: `"${label}" is not in the exercise catalog. Choose a catalog exercise or keep it as a custom exercise.` });
  if (row.prescription_issue) issues.push({ code: 'prescription_unresolved', message: `Could not read "${row.prescription_issue.raw}" for ${label}. Edit it or keep it as a coach note.` });
  const tracking = trackingProblem(row);
  if (tracking) issues.push({ code: 'tracking_invalid', message: `${label}: ${tracking}.` });
  return issues;
}

export function dayIssues(day) {
  const issues = [];
  if (!String(day.name || '').trim()) issues.push({ code: 'workout_name_required', message: 'Enter a workout day name.' });
  if (!day.exercises.length) issues.push({ code: 'no_exercises', message: 'Add at least one exercise.' });
  day.extra_lines.filter((entry) => !entry.choice).forEach((entry) => {
    issues.push({ code: 'line_unresolved', key: entry.key, message: `Decide whether "${entry.line}" is a workout note or an exercise.` });
  });
  day.exercises.forEach((row) => rowIssues(row).forEach((issue) => issues.push({ ...issue, key: row.key })));
  return issues;
}

export function selectedDay(review) {
  return review && review.selected_day != null ? review.days[review.selected_day] || null : null;
}

// Every unresolved item; accepting is allowed only when this is empty.
export function reviewIssues(review) {
  if (!review) return [{ code: 'no_draft', message: 'Build a draft first.' }];
  const day = selectedDay(review);
  if (!day) return [{ code: 'day_unselected', message: 'Choose which day to bring into the builder.' }];
  return dayIssues(day);
}

export function selectDay(review, index) {
  return review?.days[index] ? { ...review, selected_day: index } : review;
}

export function updateSelectedDay(review, update) {
  if (!selectedDay(review)) return review;
  return { ...review, days: review.days.map((day, index) => (index === review.selected_day ? update(day) : day)) };
}

export function updateDayRow(day, key, update) {
  return { ...day, exercises: day.exercises.map((row) => (row.key === key ? update(row) : row)) };
}

export function removeDayRow(day, key) {
  return { ...day, exercises: day.exercises.filter((row) => row.key !== key) };
}

export function addBlankRow(day) {
  return { ...day, exercises: [...day.exercises, reviewRow(BLANK_EXERCISE, null, [])] };
}

// Typing a new name re-runs the exact-name match and drops any earlier choice.
export function renameRow(row, name, library) {
  return { ...row, ...resolveCatalogName(library, name) };
}

export function updateRow(row, fields) {
  const edited = PRESCRIPTION_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(fields, field));
  return { ...row, ...fields, prescription_edited: row.prescription_edited || edited };
}

// Only an entry that was offered (a same-name duplicate or a suggestion) can be chosen.
export function chooseCatalogEntry(row, entry) {
  if (!entry || ![...row.candidate_ids, ...row.suggestion_ids].includes(entry.id)) return row;
  const { custom_name: linkedName, ...link } = chooseLibraryExercise(row, entry, entry.name);
  return { ...row, ...link, name: linkedName, catalog: 'matched', candidate_ids: [], suggestion_ids: [] };
}

// A custom exercise stays only in this workout; nothing is added to the catalog.
// Not offered for a duplicated catalog name: the builder links exact catalog
// names, so that name would not stay custom. Renaming it first is the way.
export function keepAsCustom(row) {
  if (row.catalog !== 'unmatched') return row;
  const { custom_name: name, ...link } = chooseLibraryExercise(row, null, row.name);
  return { ...row, ...link, name, catalog: 'custom', suggestion_ids: [] };
}

export function keepPrescriptionAsCoachNote(row) {
  if (!row.prescription_issue) return row;
  const note = `As written: ${row.prescription_issue.raw}`;
  return { ...row, coach_notes: [row.coach_notes, note].filter(filled).join(' '), prescription_issue: null };
}

export function canUseEnteredPrescription(row) {
  if (!row.prescription_issue || !row.prescription_edited || trackingProblem(row)) return false;
  return filled(row.sets) || filled(row.reps) || filled(row.duration_value) || filled(row.distance_value);
}

export function acceptEnteredPrescription(row) {
  return canUseEnteredPrescription(row) ? { ...row, prescription_issue: null } : row;
}

export function resolveExtraLine(day, key, choice, library) {
  const entry = day.extra_lines.find((line) => line.key === key);
  if (!entry) return day;
  if (choice === 'note') return { ...day, extra_lines: day.extra_lines.map((line) => (line.key === key ? { ...line, choice: 'note' } : line)) };
  if (choice !== 'exercise') return day;
  const issue = entry.signal ? { raw: entry.line, reason: 'This line was not recognized as an exercise.' } : null;
  const row = reviewRow({ ...BLANK_EXERCISE, name: entry.line }, { source_line: entry.line, prescription_issue: issue }, library);
  return { ...day, extra_lines: day.extra_lines.filter((line) => line.key !== key), exercises: [...day.exercises, row] };
}

// A fresh builder form built only from primitives, so later builder edits can
// never reach back into the review (and the reverse). makeRow is the builder's
// own row factory, which gives each row a new _uid.
export function reviewDayToWorkoutForm(day, library = [], makeRow = (fields) => ({ ...fields })) {
  const byId = new Map((library || []).map((entry) => [entry.id, entry]));
  return {
    name: String(day.name || '').trim(),
    description: day.extra_lines.filter((line) => line.choice === 'note').map((line) => line.line).join('\n'),
    goal: '',
    exercises: day.exercises.map((row) => {
      const type = trackingType(row);
      const duration = tracks(row, 'duration') && filled(row.duration_value);
      const distance = tracks(row, 'distance') && filled(row.distance_value);
      const name = String(row.name || '').trim();
      return makeRow({
        exercise_library_id: row.exercise_library_id || '',
        custom_name: row.exercise_library_id ? (byId.get(row.exercise_library_id)?.name || name) : name,
        sets: String(row.sets ?? ''),
        reps: type === 'reps_weight' ? String(row.reps ?? '') : '',
        tracking_type: type,
        duration_value: duration ? row.duration_value : '',
        duration_unit: duration ? (row.duration_unit || 's') : null,
        distance_value: distance ? row.distance_value : '',
        distance_unit: distance ? (row.distance_unit || 'm') : null,
        rest: String(row.rest ?? ''),
        tempo: String(row.tempo ?? ''),
        client_notes: String(row.client_notes ?? ''),
        coach_notes: String(row.coach_notes ?? ''),
        video_link_mode: row.video_link_mode ?? null,
        video_url: row.video_url || '',
      });
    }),
  };
}

// Holds an accepted form until the builder takes it. take() empties the slot
// synchronously, so a repeated effect or second tap cannot apply it twice.
export function createHandoff() {
  let pending = null;
  return {
    offer(value) { pending = value; },
    take() {
      const value = pending;
      pending = null;
      return value;
    },
  };
}

// One accept per studio opening: claimed synchronously on the first tap and
// released only when the builder declines or the studio is opened again.
export function createAcceptLatch() {
  let claimed = false;
  return {
    claim() {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    release() { claimed = false; },
  };
}
