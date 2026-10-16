// Coach editor demo references (docs/exercise-guides/design.md): opening,
// selecting, editing, duplicating and Quick-projecting an inheriting exercise
// must never freeze the library link into the workout row.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDemoChoice, applyDemoUrl, chooseLibraryExercise, demoChoice, demoFieldsFromRow, demoProblem, projectQuickForm,
} from '../../src/lib/trainingLibrary.js';
import { buildQuickSessionBody } from '../../src/lib/quickSessionRequest.js';

const LIB = { id: 'lib-1', name: 'Synthetic Goblet Squat', video_url: 'https://youtu.be/AAAAAAAAAAA' };
const OTHER = { id: 'lib-2', name: 'Synthetic Band Row', video_url: 'https://youtu.be/BBBBBBBBBBB' };
const OVERRIDE = 'https://youtu.be/CCCCCCCCCCC';
const LEGACY = 'https://example.com/legacy-demo';

test('opening a saved row never copies the library link into the form', () => {
  const inherit = demoFieldsFromRow({ video_link_mode: 'inherit', video_url: null, library_exercise: LIB });
  assert.deepEqual(inherit, { video_link_mode: 'inherit', video_url: '' });
  assert.deepEqual(demoFieldsFromRow({ video_link_mode: 'override', video_url: OVERRIDE, library_exercise: LIB }), { video_link_mode: 'override', video_url: OVERRIDE });
  // Unclassified legacy rows keep NULL; an empty legacy row stays empty (library fallback stays live).
  assert.deepEqual(demoFieldsFromRow({ video_link_mode: null, video_url: LEGACY, library_exercise: LIB }), { video_link_mode: null, video_url: LEGACY });
  assert.deepEqual(demoFieldsFromRow({ video_url: null, library_exercise: LIB }), { video_link_mode: null, video_url: '' });
});

test('selecting a library exercise inherits; reselecting the same one keeps an explicit choice', () => {
  const blankRow = { exercise_library_id: '', custom_name: '', video_link_mode: null, video_url: '' };
  const picked = chooseLibraryExercise(blankRow, LIB, LIB.name);
  assert.deepEqual(picked, { exercise_library_id: 'lib-1', custom_name: LIB.name, video_link_mode: 'inherit', video_url: '' });
  const overridden = { ...picked, video_link_mode: 'override', video_url: OVERRIDE };
  assert.deepEqual(chooseLibraryExercise(overridden, LIB, LIB.name), { exercise_library_id: 'lib-1', custom_name: LIB.name });
  // A different exercise is a new choice: it inherits that exercise's demo, not the old link.
  assert.deepEqual(chooseLibraryExercise(overridden, OTHER, OTHER.name), { exercise_library_id: 'lib-2', custom_name: OTHER.name, video_link_mode: 'inherit', video_url: '' });
  // A custom name cannot inherit; an explicit custom link survives.
  assert.deepEqual(chooseLibraryExercise(picked, null, 'Synthetic custom'), { exercise_library_id: '', custom_name: 'Synthetic custom', video_link_mode: null, video_url: '' });
  assert.deepEqual(chooseLibraryExercise(overridden, null, 'Synthetic custom'), { exercise_library_id: '', custom_name: 'Synthetic custom' });
});

test('demo choices and explicit actions', () => {
  const lib = { exercise_library_id: 'lib-1' };
  assert.equal(demoChoice({ ...lib, video_link_mode: 'inherit', video_url: '' }), 'library');
  assert.equal(demoChoice({ ...lib, video_link_mode: null, video_url: '' }), 'library');
  assert.equal(demoChoice({ ...lib, video_link_mode: null, video_url: LEGACY }), 'legacy');
  assert.equal(demoChoice({ ...lib, video_link_mode: 'override', video_url: OVERRIDE }), 'custom');
  assert.equal(demoChoice({ exercise_library_id: '', video_link_mode: null, video_url: '' }), 'none');
  assert.equal(demoChoice({ exercise_library_id: '', video_link_mode: 'override', video_url: OVERRIDE }), 'custom');

  const legacyRow = { ...lib, video_link_mode: null, video_url: LEGACY };
  assert.deepEqual(applyDemoChoice(legacyRow, 'library'), { video_link_mode: 'inherit', video_url: '' });
  assert.deepEqual(applyDemoChoice(legacyRow, 'custom'), { video_link_mode: 'override', video_url: LEGACY });
  assert.deepEqual(applyDemoUrl(legacyRow, OVERRIDE), { video_link_mode: 'override', video_url: OVERRIDE });
  assert.deepEqual(applyDemoUrl({ exercise_library_id: '', video_link_mode: 'override', video_url: OVERRIDE }, ''), { video_link_mode: null, video_url: '' });
  assert.equal(demoProblem({ ...lib, video_link_mode: 'override', video_url: '  ' }), 'Add a link, or choose the library demo.');
  assert.equal(demoProblem({ ...lib, video_link_mode: 'override', video_url: 'javascript:alert(1)' }), 'Use an http(s) link.');
  assert.equal(demoProblem({ ...lib, video_link_mode: 'inherit', video_url: '' }), null);
});

test('Quick projection: inherit becomes the existing empty URL, override the existing URL, no mode key', () => {
  const form = { assigned_for: '2031-01-01', name: 'Synthetic quick', notes: '', exercises: [
    { exercise_library_id: 'lib-1', custom_name: LIB.name, sets: '3', video_link_mode: 'inherit', video_url: LIB.video_url },
    { exercise_library_id: 'lib-1', custom_name: LIB.name, sets: '3', video_link_mode: 'override', video_url: OVERRIDE },
    { exercise_library_id: '', custom_name: 'Synthetic custom', sets: '1', video_link_mode: null, video_url: '' },
  ] };
  const projected = projectQuickForm(form);
  assert.notEqual(projected, form, 'the form is not mutated');
  assert.equal(form.exercises[0].video_url, LIB.video_url);
  const body = buildQuickSessionBody(projected, { requestId: 'r', clientId: 'c', today: '2031-01-01' });
  assert.deepEqual(body.exercises.map((row) => row.video_url), [undefined, OVERRIDE, undefined]);
  for (const row of body.exercises) assert.equal('video_link_mode' in row, false);
});
