import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthoringText, parsePasteDraft } from '../../src/lib/programDraft.js';
import {
  acceptEnteredPrescription, addBlankRow, buildAuthoringReview, canUseEnteredPrescription, chooseCatalogEntry,
  createAcceptLatch, createHandoff, keepAsCustom, keepPrescriptionAsCoachNote, renameRow, resolveCatalogName,
  resolveExtraLine, reviewDayToWorkoutForm, reviewIssues, selectDay, selectedDay, updateDayRow, updateRow,
  updateSelectedDay,
} from '../../src/lib/workoutAuthoring.js';

// Fictional catalog. Two rows share the exact name "Cable Row".
const deepFreeze = (value) => {
  Object.values(value).forEach((child) => { if (child && typeof child === 'object') deepFreeze(child); });
  return Object.freeze(value);
};
const LIBRARY = deepFreeze([
  { id: 'lib_goblet', name: 'Goblet Squat', category: 'Strength', video_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' },
  { id: 'lib_row_a', name: 'Cable Row', category: 'Strength', equipment: 'Cable' },
  { id: 'lib_row_b', name: 'cable  row', category: 'Strength', equipment: 'Machine' },
  { id: 'lib_rdl', name: 'Romanian Deadlift' },
]);
const LIBRARY_SNAPSHOT = JSON.stringify(LIBRARY);

const firstExercise = (text) => parseAuthoringText(text).draft.days[0].exercises[0];
const firstAnnotation = (text) => parseAuthoringText(text).review.days[0].exercises[0];
const reviewOf = (text, library = LIBRARY) => {
  const result = buildAuthoringReview(text, library);
  assert.equal(result.ok, true);
  return result.review;
};
const rowsOf = (review) => selectedDay(review).exercises;
const editRow = (review, index, update) => updateSelectedDay(review, (day) => updateDayRow(day, day.exercises[index].key, update));
let uid = 0;
const makeRow = (fields) => ({ id: '', target_rpe: '', default_load_value: '', default_load_unit: 'lb', superset_group: null, ...fields, _uid: `exercise-test-${++uid}` });

test('sets x reps, ranges and spoken set phrasing keep reps as written', () => {
  assert.deepEqual(
    (({ sets, reps, tracking_type }) => ({ sets, reps, tracking_type }))(firstExercise('Goblet squat 3x10')),
    { sets: '3', reps: '10', tracking_type: 'reps_weight' },
  );
  assert.equal(firstExercise('Goblet squat 3 x 8-10').reps, '8-10');
  assert.equal(firstExercise('Goblet squat 3 sets of 8 to 10 reps').reps, '8-10');
  assert.equal(firstExercise('Goblet squat 3 by 12').reps, '12');
  assert.equal(firstExercise('Split squat 3x10/side').reps, '10/side');
  assert.equal(firstExercise('Push-ups 15 reps').sets, '');
  assert.equal(firstExercise('Push-ups 15 reps').reps, '15');
  assert.equal(firstExercise('Lunge walk 3 sets').sets, '3');
});

test('duration and distance keep their values and units and never become reps', () => {
  const plank = firstExercise('Plank 3 x 30 sec');
  assert.deepEqual(
    [plank.sets, plank.reps, plank.tracking_type, plank.duration_value, plank.duration_unit, plank.distance_value],
    ['3', '', 'duration', 30, 's', null],
  );
  const compact = firstExercise('Plank 3x30 seconds');
  assert.deepEqual([compact.reps, compact.duration_value, compact.duration_unit], ['', 30, 's']);
  assert.deepEqual((({ duration_value, duration_unit }) => [duration_value, duration_unit])(firstExercise('Bike 2 x 5 min')), [5, 'min']);
  const row = firstExercise('Row erg 4x500m');
  assert.deepEqual([row.sets, row.tracking_type, row.distance_value, row.distance_unit, row.reps], ['4', 'distance', 500, 'm', '']);
  const run = firstExercise('Run 1.5 mi');
  assert.deepEqual([run.sets, run.tracking_type, run.distance_value, run.distance_unit], ['', 'distance', 1.5, 'mi']);
  assert.deepEqual((({ distance_value, distance_unit }) => [distance_value, distance_unit])(firstExercise('Sled carry 2x40 yards')), [40, 'yd']);
  assert.deepEqual((({ distance_value, distance_unit }) => [distance_value, distance_unit])(firstExercise('Run 5 km')), [5, 'km']);
  const both = firstExercise('Bike 3 x 1 km in 3 min');
  assert.deepEqual(
    [both.tracking_type, both.distance_value, both.distance_unit, both.duration_value, both.duration_unit],
    ['duration_distance', 1, 'km', 3, 'min'],
  );
});

test('the existing paste parser is unchanged: it still reads "3x30 sec" as reps, which authoring does not', () => {
  const legacy = parsePasteDraft('Plank 3x30 sec').days[0].exercises[0];
  assert.deepEqual([legacy.reps, legacy.client_notes, legacy.tracking_type], ['30', 'sec', 'reps_weight']);
  assert.equal(firstExercise('Plank 3x30 sec').reps, '');
  assert.equal(firstExercise('Plank 3x30 sec').duration_value, 30);
});

test('unsupported or ambiguous prescriptions become explicit issues with their raw text', () => {
  const cases = [
    ['Assault bike 3x10 cal', '3x10 cal', '3'],
    ['Plank 3x30-45 sec', '3x30-45 sec', '3'],
    ['Burpees 3 rounds', '3 rounds', ''],
    ['Run 2 hours', '2 hours', ''],
    ['Curl 3x12.5', '3x12.5', '3'],
    ['Plank 3x0 sec', '3x0 sec', '3'],
    ['Plank 3x30 sec 45 sec', '3x30 sec 45 sec', '3'],
  ];
  for (const [line, raw, sets] of cases) {
    const exercise = firstExercise(line);
    const issue = firstAnnotation(line).prescription_issue;
    assert.ok(issue, `${line} should be unresolved`);
    assert.equal(issue.raw, raw, line);
    assert.ok(issue.reason.length > 0, line);
    assert.equal(exercise.reps, '', `${line} must not become reps`);
    assert.equal(exercise.tracking_type, 'reps_weight', line);
    assert.equal(exercise.duration_value, null, line);
    assert.equal(exercise.distance_value, null, line);
    assert.equal(exercise.sets, sets, line);
  }
  assert.equal(firstAnnotation('Goblet squat 3x10').prescription_issue, null);
});

test('unknown suffixes and secondary targets block accept and retain the full prescription on a note choice', () => {
  for (const [text, raw] of [
    ['Carry 3x40 furlongs', '3x40 furlongs'],
    ['Row 3x500 m in 2-3 min', '3x500 m in 2-3 min'],
    ['Plank 3x30 sec + 2 hours', '3x30 sec + 2 hours'],
    ['Plank 3x30 sec + 2 mysteryunits', '3x30 sec + 2 mysteryunits'],
    ['Plank 3x30 sec + 2', '3x30 sec + 2'],
  ]) {
    const library = [{ id: 'existing', name: text.split(' 3x')[0] }];
    let review = reviewOf(text, library);
    assert.deepEqual(reviewIssues(review).map((issue) => issue.code), ['prescription_unresolved'], text);
    assert.equal(rowsOf(review)[0].prescription_issue.raw, raw, text);
    assert.equal(rowsOf(review)[0].reps, '', text);
    review = editRow(review, 0, keepPrescriptionAsCoachNote);
    assert.deepEqual(reviewIssues(review), [], text);
    assert.equal(rowsOf(review)[0].coach_notes, `As written: ${raw}`, text);
  }
  assert.equal(firstExercise('Goblet squat 3x8−10').reps, '8-10');
  assert.equal(firstExercise('Goblet squat 3x8, slow lower').client_notes, 'slow lower');
  assert.equal(firstExercise('Goblet squat 3x8 @ 50kg').client_notes, '@ 50kg');
});

test('rest, tempo and cues are preserved from the same line and from a following rest line', () => {
  const inline = firstExercise('Romanian deadlift 3 sets of 8 to 10 reps, rest 90 seconds, tempo 3-1-1, soft knees, hips back');
  assert.deepEqual([inline.reps, inline.rest, inline.tempo, inline.client_notes], ['8-10', '90 seconds', '3-1-1', 'soft knees, hips back']);
  const nextLine = firstExercise('Goblet squat 3x10\nRest 90s - Tempo 3-1-1 - chest tall');
  assert.deepEqual([nextLine.rest, nextLine.tempo, nextLine.client_notes], ['90s', '3-1-1', 'chest tall']);
  const cue = firstExercise('Flat bench 2x7 to true failure');
  assert.deepEqual([cue.reps, cue.client_notes], ['7', 'to true failure']);
});

test('day headers split dictated text without blank lines; unreadable lines are flagged, plain ones kept as notes', () => {
  const parsed = parseAuthoringText('Day 1 Lower\nGoblet squat 3x10\nKeep it smooth\nGoblet squat three sets of ten\nDay 2 Upper\nCable row 3x12');
  assert.deepEqual(parsed.draft.days.map((day) => day.name), ['Day 1 Lower', 'Day 2 Upper']);
  assert.deepEqual(parsed.review.days[0].extra_lines, [
    { line: 'Keep it smooth', signal: false },
    { line: 'Goblet squat three sets of ten', signal: true },
  ]);
  // A first line that reads like a prescription is not used as the day name.
  const demoted = parseAuthoringText('Goblet squat three sets of ten\nPlank 30 sec');
  assert.equal(demoted.draft.days[0].name, 'Day 1');
  assert.deepEqual(demoted.review.days[0].extra_lines, [{ line: 'Goblet squat three sets of ten', signal: true }]);
});

test('blank text and text with no exercise give an actionable result instead of a draft', () => {
  const blank = buildAuthoringReview('   \n ', LIBRARY);
  assert.equal(blank.ok, false);
  assert.match(blank.error.message, /Couldn't find any exercises/);
  const spelled = buildAuthoringReview('Goblet squat three sets of ten', LIBRARY);
  assert.equal(spelled.ok, false);
  assert.deepEqual(spelled.error.lines, ['Goblet squat three sets of ten']);
});

test('catalog: exact unique names link at once; duplicates and unknown names wait for the coach', () => {
  const matched = resolveCatalogName(LIBRARY, 'goblet squat');
  assert.deepEqual(
    [matched.catalog, matched.exercise_library_id, matched.name, matched.video_link_mode, matched.video_url],
    ['matched', 'lib_goblet', 'Goblet Squat', 'inherit', ''],
  );
  const ambiguous = resolveCatalogName(LIBRARY, 'Cable Row');
  assert.deepEqual([ambiguous.catalog, ambiguous.exercise_library_id, ambiguous.name], ['ambiguous', '', 'Cable Row']);
  assert.deepEqual(ambiguous.candidate_ids, ['lib_row_a', 'lib_row_b']);
  const unmatched = resolveCatalogName(LIBRARY, 'Row erg');
  assert.deepEqual([unmatched.catalog, unmatched.exercise_library_id, unmatched.name], ['unmatched', '', 'Row erg']);
  assert.deepEqual([...unmatched.suggestion_ids].sort(), ['lib_row_a', 'lib_row_b']);
  assert.equal(resolveCatalogName(LIBRARY, 'Squat jumps').catalog, 'unmatched');
  assert.equal(JSON.stringify(LIBRARY), LIBRARY_SNAPSHOT);
});

test('every unresolved item blocks accepting until the coach decides', () => {
  let review = reviewOf('Upper\nCable row 3x10\nRow erg 4x500m\nSled push 4 rounds\nGoblet squat 3x10\nKeep RPE around 7');
  assert.deepEqual(reviewIssues(review).map((issue) => issue.code).sort(), [
    'catalog_ambiguous', 'catalog_unmatched', 'catalog_unmatched', 'line_unresolved', 'prescription_unresolved',
  ]);
  const [cable, erg, sled] = rowsOf(review);
  // A duplicate name cannot be kept custom; only an offered catalog row resolves it.
  assert.equal(keepAsCustom(cable), cable);
  assert.equal(chooseCatalogEntry(cable, LIBRARY[0]), cable);
  review = editRow(review, 0, (row) => chooseCatalogEntry(row, LIBRARY[2]));
  review = editRow(review, 1, keepAsCustom);
  review = editRow(review, 2, keepAsCustom);
  assert.deepEqual(reviewIssues(review).map((issue) => issue.code).sort(), ['line_unresolved', 'prescription_unresolved']);
  review = editRow(review, 2, keepPrescriptionAsCoachNote);
  const line = selectedDay(review).extra_lines[0];
  review = updateSelectedDay(review, (day) => resolveExtraLine(day, line.key, 'note', LIBRARY));
  assert.deepEqual(reviewIssues(review), []);
  const rows = rowsOf(review);
  assert.deepEqual([rows[0].exercise_library_id, rows[0].name, rows[0].video_link_mode], ['lib_row_b', 'cable  row', 'inherit']);
  assert.deepEqual([rows[1].catalog, rows[1].exercise_library_id, rows[1].name], ['custom', '', 'Row erg']);
  assert.equal(rows[2].coach_notes, 'As written: 4 rounds');
  assert.equal(rows[2].source_line, 'Sled push 4 rounds');
  assert.equal(erg.source_name, 'Row erg');
  assert.equal(sled.prescription_issue.raw, '4 rounds');
  assert.equal(JSON.stringify(LIBRARY), LIBRARY_SNAPSHOT);
});

test('an edited prescription resolves only after a real edit and an explicit choice', () => {
  let review = reviewOf('Sled push 4 rounds');
  let [row] = rowsOf(review);
  assert.equal(canUseEnteredPrescription(row), false);
  assert.equal(acceptEnteredPrescription(row), row);
  row = updateRow(row, { client_notes: 'heavy' });
  assert.equal(canUseEnteredPrescription(row), false);
  row = updateRow(row, { tracking_type: 'distance', distance_value: '20', distance_unit: 'yd' });
  assert.equal(canUseEnteredPrescription(row), true);
  assert.equal(acceptEnteredPrescription(row).prescription_issue, null);
  review = editRow(review, 0, () => keepAsCustom(acceptEnteredPrescription(row)));
  assert.deepEqual(reviewIssues(review), []);
});

test('renaming re-runs the exact match and drops an earlier choice', () => {
  const [row] = rowsOf(reviewOf('Squat thing 3x10'));
  const custom = keepAsCustom(row);
  assert.equal(custom.catalog, 'custom');
  const renamed = renameRow(custom, 'Goblet Squat', LIBRARY);
  assert.deepEqual([renamed.catalog, renamed.exercise_library_id], ['matched', 'lib_goblet']);
  const again = renameRow(renamed, 'Goblet Squat 2', LIBRARY);
  assert.deepEqual([again.catalog, again.exercise_library_id, again.video_link_mode], ['unmatched', '', null]);
  assert.equal(again.source_name, 'Squat thing');
});

test('multiple days need a deliberate selection, and edits stay with their day', () => {
  let review = reviewOf('Day 1\nGoblet squat 3x10\nDay 2\nRomanian deadlift 3x8');
  assert.equal(review.selected_day, null);
  assert.deepEqual(reviewIssues(review).map((issue) => issue.code), ['day_unselected']);
  review = selectDay(review, 1);
  review = editRow(review, 0, (row) => updateRow(row, { sets: '4' }));
  review = selectDay(review, 0);
  assert.equal(rowsOf(review)[0].sets, '3');
  review = selectDay(review, 1);
  assert.equal(rowsOf(review)[0].sets, '4');
  assert.deepEqual(reviewIssues(review), []);
  assert.equal(reviewOf('Goblet squat 3x10').selected_day, 0);
});

test('a day with no exercises or a blank added row is actionable, not acceptable', () => {
  let review = reviewOf('Goblet squat 3x10');
  review = updateSelectedDay(review, (day) => ({ ...day, exercises: [] }));
  assert.deepEqual(reviewIssues(review).map((issue) => issue.code), ['no_exercises']);
  review = updateSelectedDay(review, addBlankRow);
  assert.deepEqual(reviewIssues(review).map((issue) => issue.code), ['name_required']);
  review = updateSelectedDay(review, (day) => ({ ...day, name: ' ' }));
  assert.ok(reviewIssues(review).some((issue) => issue.code === 'workout_name_required'));
});

test('the accepted form is a fresh builder form with library links, units, rest, tempo and cues', () => {
  let review = reviewOf('Lower\nGoblet squat 3 sets of 8 to 10, rest 90 seconds, tempo 3-1-1, chest tall\nPlank 3 x 30 sec\nRow erg 4x500m\nKeep it smooth');
  review = editRow(review, 1, keepAsCustom);
  review = editRow(review, 2, keepAsCustom);
  assert.deepEqual(reviewIssues(review), []);
  const day = selectedDay(review);
  const form = reviewDayToWorkoutForm(day, LIBRARY, makeRow);
  assert.equal(form.name, 'Lower');
  assert.equal(form.description, 'Keep it smooth');
  assert.equal(form.goal, '');
  const [squat, plank, erg] = form.exercises;
  assert.deepEqual(
    (({ exercise_library_id, custom_name, sets, reps, tracking_type, rest, tempo, client_notes, coach_notes, video_link_mode, video_url }) => (
      { exercise_library_id, custom_name, sets, reps, tracking_type, rest, tempo, client_notes, coach_notes, video_link_mode, video_url }))(squat),
    {
      exercise_library_id: 'lib_goblet', custom_name: 'Goblet Squat', sets: '3', reps: '8-10', tracking_type: 'reps_weight',
      rest: '90 seconds', tempo: '3-1-1', client_notes: 'chest tall', coach_notes: '', video_link_mode: 'inherit', video_url: '',
    },
  );
  assert.deepEqual(
    [plank.exercise_library_id, plank.custom_name, plank.reps, plank.tracking_type, plank.duration_value, plank.duration_unit, plank.distance_value, plank.distance_unit, plank.video_link_mode],
    ['', 'Plank', '', 'duration', 30, 's', '', null, null],
  );
  assert.deepEqual([erg.tracking_type, erg.distance_value, erg.distance_unit, erg.duration_value, erg.duration_unit], ['distance', 500, 'm', '', null]);
  // The library demo URL is never copied into the row.
  assert.ok(form.exercises.every((row) => row.video_url === ''));
});

test('accepted forms are independent of the review and of each other', () => {
  const review = reviewOf('Goblet squat 3x10\nPlank 3 x 30 sec');
  const day = selectedDay(review);
  const before = JSON.stringify(day);
  const first = reviewDayToWorkoutForm(day, LIBRARY, makeRow);
  const second = reviewDayToWorkoutForm(day, LIBRARY, makeRow);
  assert.notEqual(first.exercises[0], second.exercises[0]);
  assert.notEqual(first.exercises[0]._uid, second.exercises[0]._uid);
  assert.equal(new Set([...first.exercises, ...second.exercises].map((row) => row._uid)).size, 4);
  first.exercises[0].sets = '9';
  first.exercises.push(makeRow({ custom_name: 'Extra' }));
  first.name = 'Changed';
  assert.equal(JSON.stringify(day), before);
  assert.equal(second.exercises[0].sets, '3');
  assert.equal(second.exercises.length, 2);
  assert.equal(JSON.stringify(LIBRARY), LIBRARY_SNAPSHOT);
});

test('handoff and accept latch are consumed synchronously so nothing is applied twice', () => {
  const handoff = createHandoff();
  assert.equal(handoff.take(), null);
  const form = { name: 'A', exercises: [] };
  handoff.offer(form);
  assert.equal(handoff.take(), form);
  assert.equal(handoff.take(), null);

  const latch = createAcceptLatch();
  assert.equal(latch.claim(), true);
  assert.equal(latch.claim(), false);
  latch.release();
  assert.equal(latch.claim(), true);
});
