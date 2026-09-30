const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractPdfText } = require('../src/lib/pdfText');
const {
  generateLogSheetPdf,
  generateProgramPdf,
  logSheetFilename,
  setBoxCount,
} = require('../src/lib/programPdf');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'programs.js'), 'utf8');

function routeBlock(signature) {
  const start = routeSource.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const end = routeSource.indexOf('\nrouter.', start + signature.length);
  return routeSource.slice(start, end === -1 ? undefined : end);
}

const squat = {
  id: 'ex-squat',
  custom_name: 'Back Squat',
  sets: '3',
  reps: '5',
  rest: '2 min',
  client_notes: 'Brace before each rep',
  coach_notes: 'PRIVATE watch left knee',
  video_url: 'https://example.com/squat',
};
const row = {
  id: 'ex-row',
  library_exercise: { name: 'Cable Row' },
  sets: '3-4',
  reps: '10',
  default_load_value: 60,
  default_load_unit: 'lb',
  coach_notes: 'PRIVATE second note',
};

test('write-in boxes follow a plain set count and fall back to 4 otherwise', () => {
  assert.equal(setBoxCount('3'), 3);
  assert.equal(setBoxCount(5), 5);
  assert.equal(setBoxCount(' 2 '), 2);
  assert.equal(setBoxCount('3-4'), 4);
  assert.equal(setBoxCount('AMRAP'), 4);
  assert.equal(setBoxCount(''), 4);
  assert.equal(setBoxCount(null), 4);
  assert.equal(setBoxCount('0'), 4);
  assert.equal(setBoxCount('25'), 10);
});

test('log sheet filename is sanitized and marked as a log', () => {
  assert.equal(logSheetFilename('Strength / Phase 1'), 'CVF-Strength-Phase-1-Log.pdf');
  assert.equal(logSheetFilename(''), 'CVF-Workout-Log.pdf');
});

test('client log sheet shows assigned loads and never coach-only notes', async () => {
  const pdf = await generateLogSheetPdf({
    title: 'Lower Body Strength',
    clientName: 'Pat Client',
    note: 'Take it easy on week one',
    sections: [
      {
        title: 'Day 1: Legs',
        goal: 'Strength',
        exercises: [squat, row],
        loads: [{ workout_exercise_id: 'ex-squat', load_value: 135, load_unit: 'lb' }],
      },
    ],
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const text = await extractPdfText(pdf);
  assert.match(text, /Lower Body Strength/);
  assert.match(text, /Pat Client/);
  assert.match(text, /Take it easy on week one/);
  assert.match(text, /Back Squat/);
  assert.match(text, /Target: 135 lb/);
  assert.match(text, /Cable Row/);
  assert.match(text, /Target: 60 lb/);
  assert.match(text, /Brace before each rep/);
  assert.match(text, /SET 3/);
  assert.doesNotMatch(text, /PRIVATE/);
});

test('coach export still renders from the shared module', async () => {
  const pdf = await generateProgramPdf(
    { name: 'Coach Program', frequency_days: 1, days: [{ day_number: 1, workout: { name: 'Legs', exercises: [squat] } }] },
    { coach: { name: 'Coach Sam' } },
    { includeCoachNotes: true },
  );
  const text = await extractPdfText(pdf);
  assert.match(text, /Coach Program/);
  assert.match(text, /Coach Sam/);
  assert.match(text, /PRIVATE watch left knee/);
});

test('client log-sheet routes are client-only, rate limited, and scoped to the caller', () => {
  const program = routeBlock("router.get('/client/assignments/:assignmentId/log-sheet.pdf', requireClient, pdfExportLimiter,");
  assert.match(program, /from\('program_assignments'\)/);
  assert.match(program, /\.eq\('client_id', req\.user\.client\.id\)/);
  assert.match(program, /\.eq\('archived', false\)/);
  assert.match(program, /status\(404\)/);
  assert.match(program, /exercise_loads|programAssignmentLoads/);
  assert.doesNotMatch(program, /coach_notes|includeCoachNotes/);

  const workout = routeBlock("router.get('/client/workout-assignments/:assignmentId/log-sheet.pdf', requireClient, pdfExportLimiter,");
  assert.match(workout, /from\('workout_assignments'\)/);
  assert.match(workout, /\.eq\('client_id', req\.user\.client\.id\)/);
  assert.match(workout, /\.eq\('archived', false\)/);
  assert.match(workout, /status\(404\)/);
  assert.match(workout, /workoutAssignmentLoads/);
  assert.doesNotMatch(workout, /coach_notes|includeCoachNotes/);
});

test('coach export route keeps its coach guard', () => {
  assert.match(routeSource, /router\.get\('\/:id\/export\.pdf', requireCoach, pdfExportLimiter,/);
});
