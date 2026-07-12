const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const backendDraftTools = require('../src/lib/programDraft.cjs');

const FLAT_PASTE = `ATG DB Incline 3x12
DB fly 2x12
Lower traps 3x8
Powell raise 2x10
Flat bench 2x7 to true failure
Decline bench 2x7 to true failure
Pullovers 2x12
Tiddy lift 2x10`;

const MIXED_PASTE = `Lower Strength
Goblet Squat 3x8-10 stay tall
Rest 90s - Tempo 3-1-1 - Brace hard
Coach review this line
Second unmatched note

ATG DB Incline 3X12
Unmatched day note`;

let frontendDraftToolsPromise;

function frontendDraftTools() {
  if (!frontendDraftToolsPromise) {
    frontendDraftToolsPromise = fs.readFile(
      path.join(__dirname, '../../frontend/src/lib/programDraft.js'),
      'utf8',
    ).then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
  }
  return frontendDraftToolsPromise;
}

function fillProgramName(draft, name = 'Verified Paste Program') {
  return {
    ...draft,
    program: { ...draft.program, name },
  };
}

test('flat paste produces one day and preserves all eight exercises', () => {
  const draft = backendDraftTools.parsePasteDraft(FLAT_PASTE);

  assert.deepEqual(draft.program, {
    name: '',
    description: '',
    frequency_days: 1,
    source: 'paste',
  });
  assert.equal(draft.days.length, 1);
  assert.equal(draft.days[0].name, 'Day 1');
  assert.equal(draft.days[0].goal, '');
  assert.equal(draft.days[0].notes, '');
  assert.deepEqual(
    draft.days[0].exercises.map(({ name, sets, reps }) => ({ name, sets, reps })),
    [
      { name: 'ATG DB Incline', sets: '3', reps: '12' },
      { name: 'DB fly', sets: '2', reps: '12' },
      { name: 'Lower traps', sets: '3', reps: '8' },
      { name: 'Powell raise', sets: '2', reps: '10' },
      { name: 'Flat bench', sets: '2', reps: '7' },
      { name: 'Decline bench', sets: '2', reps: '7' },
      { name: 'Pullovers', sets: '2', reps: '12' },
      { name: 'Tiddy lift', sets: '2', reps: '10' },
    ],
  );
  assert.equal(draft.days[0].exercises[4].client_notes, 'to true failure');
  assert.equal(draft.days[0].exercises[5].client_notes, 'to true failure');
  assert.ok(draft.days[0].exercises.every((exercise) => exercise.video_url === ''));
  assert.deepEqual(draft.import_meta.warnings, []);

  const validation = backendDraftTools.validateDraft(fillProgramName(draft));
  assert.equal(validation.valid, true);
});

test('mixed blocks preserve titles, auto-name untitled days, parse detail, and flag notes', () => {
  const draft = backendDraftTools.parsePasteDraft(MIXED_PASTE);

  assert.equal(draft.program.frequency_days, 2);
  assert.deepEqual(draft.days.map((day) => day.name), ['Lower Strength', 'Day 2']);
  assert.equal(draft.days[0].goal, '');
  assert.equal(draft.days[0].notes, 'Coach review this line; Second unmatched note');
  assert.equal(draft.days[1].notes, 'Unmatched day note');
  assert.equal(draft.days[0].exercises[0].name, 'Goblet Squat');
  assert.equal(draft.days[0].exercises[0].sets, '3');
  assert.equal(draft.days[0].exercises[0].reps, '8-10');
  assert.equal(draft.days[0].exercises[0].rest, '90s');
  assert.equal(draft.days[0].exercises[0].tempo, '3-1-1');
  assert.equal(draft.days[0].exercises[0].client_notes, 'stay tall Brace hard');
  assert.equal(draft.days[1].exercises[0].sets, '3');
  assert.equal(draft.days[1].exercises[0].reps, '12');
  assert.deepEqual(draft.import_meta.warnings, [
    'Day 1, line 4: kept unmatched text as a day note: "Coach review this line"',
    'Day 1, line 5: kept unmatched text as a day note: "Second unmatched note"',
    'Day 2, line 2: kept unmatched text as a day note: "Unmatched day note"',
  ]);

  const validation = backendDraftTools.validateDraft(fillProgramName(draft));
  assert.equal(validation.valid, true);
});

test('empty and garbage pastes report the stable no-exercise error', () => {
  for (const input of ['', ' \n\t ', 'This is only a note', 'Day title\nRest 90s']) {
    assert.throws(
      () => backendDraftTools.parsePasteDraft(input),
      (error) => {
        assert.equal(error.message, "Couldn't find any exercises in this text.");
        assert.equal(error.code, 'NO_EXERCISES_FOUND');
        assert.deepEqual(error.validation, { no_exercises: true });
        return true;
      },
    );
  }
});

test('CSV and PDF drafts retain the existing 3-to-5-day validation', () => {
  const csv = [
    'program_name,frequency_days,day_number,workout_name,exercise_name,sets,reps',
    'CSV Regression,3,1,Day 1,Squat,3,8',
    'CSV Regression,3,2,Day 2,Row,3,10',
    'CSV Regression,3,3,Day 3,Press,3,12',
  ].join('\n');
  const csvDraft = backendDraftTools.parseCsvDraft(csv, { sourceType: 'csv' });
  assert.equal(backendDraftTools.validateDraft(csvDraft).valid, true);

  for (const sourceType of ['csv', 'pdf']) {
    const oneDayDraft = {
      ...csvDraft,
      program: { ...csvDraft.program, frequency_days: 1 },
      days: csvDraft.days.slice(0, 1),
      import_meta: { ...csvDraft.import_meta, source_type: sourceType },
    };
    const validation = backendDraftTools.validateDraft(oneDayDraft);
    assert.equal(validation.valid, false);
    assert.deepEqual(
      validation.errors.find((error) => error.path === 'program.frequency_days'),
      { path: 'program.frequency_days', message: 'Choose 3, 4, or 5 days per week' },
    );
  }
});

test('frontend and backend paste parsers remain behaviorally identical', async () => {
  const frontend = await frontendDraftTools();
  assert.equal(typeof frontend.parsePasteDraft, 'function');
  assert.equal(typeof frontend.default.parsePasteDraft, 'function');

  for (const input of [FLAT_PASTE, MIXED_PASTE, 'Push Day\nBench Press 4x6\nRest: 2m — Tempo: 3-1-1 — pause on chest']) {
    assert.deepEqual(frontend.parsePasteDraft(input), backendDraftTools.parsePasteDraft(input));
  }

  for (const input of ['', 'Not an exercise']) {
    let frontendError;
    let backendError;
    try { frontend.parsePasteDraft(input); } catch (error) { frontendError = error; }
    try { backendDraftTools.parsePasteDraft(input); } catch (error) { backendError = error; }
    assert.deepEqual(
      { message: frontendError?.message, code: frontendError?.code, validation: frontendError?.validation },
      { message: backendError?.message, code: backendError?.code, validation: backendError?.validation },
    );
  }
});
