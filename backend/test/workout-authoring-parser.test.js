// Workout authoring parser (docs/workout-authoring/first-slice.md). The backend
// CommonJS Program Draft copy and the browser ESM copy are independent runtimes
// held to the SAME vectors here, because the two deploy roots may never import
// each other. Also pins that the shared paste walker refactor left
// parsePasteDraft's output unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const backend = require('../src/lib/programDraft.cjs');

const loadFrontend = () => import('../../frontend/src/lib/programDraft.js');

const AUTHORING_VECTORS = [
  'Goblet squat 3x10',
  'Goblet squat 3 sets of 8 to 10 reps, rest 90 seconds, tempo 3-1-1, chest tall',
  'Plank 3 x 30 sec\nSplit squat 3x10/side\nPush-ups 15 reps\nLunge walk 3 sets',
  'Row erg 4x500m\nRun 1.5 mi\nSled carry 2x40 yards\nBike 3 x 1 km in 3 min',
  'Assault bike 3x10 cal\nPlank 3x30-45 sec\nBurpees 3 rounds\nRun 2 hours\nCurl 3x12.5\nPlank 3x0 sec\nPlank 3x30 sec 45 sec',
  'Day 1 Lower\nGoblet squat 3x10\nRest 90s - Tempo 3-1-1 - chest tall\nKeep it smooth\nGoblet squat three sets of ten\nDay 2 Upper\nCable row 3x12',
  'Goblet squat three sets of ten\nPlank 30 sec',
  '1. Goblet squat 3x10\n- Plank 3 x 30 sec\n\nTuesday\nRun 5 km',
  'Carry 3x40 furlongs\nRow 3x500 m in 2-3 min\nPlank 3x30 sec + 2 hours\nPlank 3x30 sec + 2 mysteryunits\nPlank 3x30 sec + 2',
  'Goblet squat 3x8−10\nGoblet squat 3x8, slow lower\nGoblet squat 3x8 @ 50kg',
];
const PASTE_VECTORS = [
  'ATG DB Incline 3x12\nDB fly 2x12\nFlat bench 2x7 to true failure',
  'Lower Strength A\nGoblet Squat 3x8-10\nRest 90s - Tempo 3-1-1 - Slow lower\nMobility notes\n\nUpper\nCable Row 3x10',
  'Plank 3x30 sec',
  'Split squat 3x10/side\nRun 1.5 mi',
];

function thrown(parse, text) {
  try {
    parse(text);
  } catch (error) {
    return { message: error.message, code: error.code, validation: error.validation };
  }
  return null;
}

test('authoring parser: backend and browser copies produce identical drafts and review notes', async () => {
  const frontend = await loadFrontend();
  assert.equal(backend.AUTHORING_PARSER_VERSION, frontend.AUTHORING_PARSER_VERSION);
  for (const text of AUTHORING_VECTORS) {
    assert.deepEqual(backend.parseAuthoringText(text), frontend.parseAuthoringText(text), text);
  }
  for (const text of ['', '   ', 'Goblet squat three sets of ten', 'Mobility notes only']) {
    const error = thrown(backend.parseAuthoringText, text);
    assert.equal(error.code, 'NO_EXERCISES_FOUND', text);
    assert.deepEqual(error, thrown(frontend.parseAuthoringText, text), text);
  }
});

test('authoring parser keeps units and never turns an unreadable prescription into reps', () => {
  const day = backend.parseAuthoringText('Plank 3 x 30 sec\nRow erg 4x500m\nAssault bike 3x10 cal').draft.days[0];
  const review = backend.parseAuthoringText('Plank 3 x 30 sec\nRow erg 4x500m\nAssault bike 3x10 cal').review.days[0];
  assert.deepEqual(
    day.exercises.map(({ sets, reps, tracking_type, duration_value, duration_unit, distance_value, distance_unit }) => (
      [sets, reps, tracking_type, duration_value, duration_unit, distance_value, distance_unit])),
    [
      ['3', '', 'duration', 30, 's', null, null],
      ['4', '', 'distance', null, null, 500, 'm'],
      ['3', '', 'reps_weight', null, null, null, null],
    ],
  );
  assert.deepEqual(review.exercises.map((annotation) => annotation.prescription_issue && annotation.prescription_issue.raw), [null, null, '3x10 cal']);
});

test('paste parser output is unchanged and identical in both copies', async () => {
  const frontend = await loadFrontend();
  for (const text of PASTE_VECTORS) {
    assert.deepEqual(backend.parsePasteDraft(text), frontend.parsePasteDraft(text), text);
  }
  const legacy = backend.parsePasteDraft('Plank 3x30 sec').days[0].exercises[0];
  assert.deepEqual([legacy.sets, legacy.reps, legacy.client_notes, legacy.tracking_type], ['3', '30', 'sec', 'reps_weight']);
  const detailed = backend.parsePasteDraft(PASTE_VECTORS[1]);
  assert.equal(detailed.import_meta.source_type, 'paste');
  assert.equal(detailed.program.frequency_days, 2);
  assert.deepEqual(detailed.days.map((day) => day.name), ['Lower Strength A', 'Upper']);
  assert.deepEqual(
    (({ sets, reps, rest, tempo, client_notes }) => ({ sets, reps, rest, tempo, client_notes }))(detailed.days[0].exercises[0]),
    { sets: '3', reps: '8-10', rest: '90s', tempo: '3-1-1', client_notes: 'Slow lower' },
  );
  assert.equal(detailed.days[0].notes, 'Mobility notes');
  // A line the paste parser does not read stays a day note, exactly as before.
  assert.equal(backend.parsePasteDraft(PASTE_VECTORS[3]).days[0].notes, 'Run 1.5 mi');
  for (const text of ['', 'Mobility notes only']) {
    const error = thrown(backend.parsePasteDraft, text);
    assert.deepEqual(error, { message: "Couldn't find any exercises in this text.", code: 'NO_EXERCISES_FOUND', validation: { no_exercises: true } });
    assert.deepEqual(thrown(frontend.parsePasteDraft, text), error);
  }
});
