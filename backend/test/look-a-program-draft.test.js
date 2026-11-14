// Look A Program Draft: the load, unit, upper load and per side travel through
// CSV import, the draft, validation and program export identically in the
// browser and backend copies (frontend/src/lib/programDraft.js and
// backend/src/lib/programDraft.cjs; never imported across deploy roots).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const backend = require('../src/lib/programDraft.cjs');
let frontendPromise;
const frontend = () => (frontendPromise ||= import(require('node:url').pathToFileURL(path.join(__dirname, '../../frontend/src/lib/programDraft.js'))).then((m) => m.default || m));

const CSV = `program_name,frequency_days,day_number,workout_name,exercise_name,sets,reps,load_value,load_unit,load_max,per_side
Fictional,3,1,A,Split Squat,3,8,30,lb,35,yes
Fictional,3,2,B,Front Squat,3,5,60,kg,,
Fictional,3,3,C,Plank,3,30s,,,,`;

test('CSV load columns become draft keys only when set (both copies identical)', async () => {
  const fe = await frontend();
  const b = backend.parseCsvDraft(CSV, { sourceType: 'csv' });
  const f = fe.parseCsvDraft(CSV, { sourceType: 'csv' });
  assert.deepEqual(f, b);
  const [split] = b.draft ? b.draft.days[0].exercises : b.days[0].exercises;
  const draft = b.draft || b;
  assert.deepEqual(
    { v: split.default_load_value, u: split.default_load_unit, m: split.prescribed_load_max, p: split.per_side },
    { v: 30, u: 'lb', m: 35, p: true },
  );
  const front = draft.days[1].exercises[0];
  assert.equal(front.default_load_unit, 'kg', 'recorded kg stays kg');
  assert.equal('prescribed_load_max' in front, false);
  assert.equal('per_side' in front, false);
  const plank = draft.days[2].exercises[0];
  for (const key of ['default_load_value', 'default_load_unit', 'prescribed_load_max', 'per_side']) assert.equal(key in plank, false, key);
  assert.equal(backend.validateDraft(draft).valid, true, JSON.stringify(backend.validateDraft(draft).errors));
});

test('a load without a unit defaults to lb', () => {
  const draft = backend.normalizeDraft({ program: { name: 'x', frequency_days: 3 }, days: [{ exercises: [{ name: 'A', default_load_value: '40' }] }] });
  assert.equal(draft.days[0].exercises[0].default_load_unit, 'lb');
  assert.equal(draft.days[0].exercises[0].default_load_value, 40);
});

test('invalid loads are validation errors with the same paths in both copies', async () => {
  const fe = await frontend();
  const input = { program: { name: 'x', frequency_days: 3 }, import_meta: { source_type: 'csv' }, days: [1, 2, 3].map((n) => ({ day_number: n, exercises: [
    { name: 'A', default_load_value: 'heavy' },
    { name: 'B', default_load_value: 50, default_load_unit: 'stone' },
    { name: 'C', default_load_value: 50, prescribed_load_max: 40 },
    { name: 'D', prescribed_load_max: 40 },
    { name: 'E', default_load_value: 50, per_side: 'sometimes' },
  ] })) };
  const b = backend.validateDraft(input);
  const f = fe.validateDraft(input);
  assert.deepEqual(f, b);
  const day1 = b.errors.filter((e) => e.path.startsWith('days.0.')).map((e) => e.path);
  assert.deepEqual(day1, [
    'days.0.exercises.0.default_load_value',
    'days.0.exercises.1.default_load_unit',
    'days.0.exercises.2.prescribed_load_max',
    'days.0.exercises.3.prescribed_load_max',
    'days.0.exercises.4.per_side',
  ]);
});

test('program export carries the facts and round-trips through validation', async () => {
  const fe = await frontend();
  const program = { name: 'Fictional', frequency_days: 3, days: [1, 2, 3].map((n) => ({ day_number: n, workout: { name: `D${n}`, exercises: [
    { custom_name: 'Split Squat', sets: '3', reps: '8', default_load_value: 30, default_load_unit: 'lb', prescribed_load_max: 35, per_side: true, video_link_mode: null },
    { custom_name: 'Plank', sets: '3', reps: '30s', default_load_value: null, default_load_unit: null, prescribed_load_max: null, per_side: false, video_link_mode: null },
  ] } })) };
  const b = backend.draftFromProgram(program);
  assert.deepEqual(fe.draftFromProgram(program), b);
  assert.deepEqual([b.days[0].exercises[0].prescribed_load_max, b.days[0].exercises[0].per_side], [35, true]);
  assert.equal('per_side' in b.days[0].exercises[1], false, 'per_side false is not written');
  assert.equal(backend.validateDraft(b).valid, true);
});

test('the CSV template shows the load columns', () => {
  const [header, , , press] = backend.csvTemplate().split('\n');
  assert.match(header, /load_value,load_unit,load_max,per_side/);
  assert.match(press, /,30,lb,35,yes,/);
});
