// Look A propagation in the backend (20261114130000): substitution targets and
// coach backups carry the replacement's own upper load and per side; history
// reports the prescription each occurrence was logged against.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { normalizeTargets } = require('../src/lib/sessionEvents');
const { createExerciseHistoryHandler } = require('../src/routes/workoutLogs');

test('substitution targets accept the replacement upper load and per side', () => {
  assert.deepEqual(normalizeTargets({ sets: 3, reps: '8', load_value: 50, load_unit: 'kg', load_max: 60, per_side: true }),
    { sets: 3, reps: '8', load_value: 50, load_unit: 'kg', load_max: 60, per_side: true });
  assert.deepEqual(normalizeTargets({ load_value: 50, load_max: 50 }), { load_value: 50, load_unit: 'lb' }, 'equal upper is the single number');
  assert.deepEqual(normalizeTargets({ load_value: 50, per_side: false }), { load_value: 50, load_unit: 'lb' });
  for (const bad of [{ load_max: 60 }, { load_value: 50, load_max: 40 }, { load_value: 50, load_max: 'x' }, { per_side: 'yes' }]) {
    assert.throws(() => normalizeTargets(bad), (e) => e.status === 400 || /must/.test(e.message), JSON.stringify(bad));
  }
});

function res() { return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
const log = { id: 'log', client_id: 'client', status: 'active', archived: false, exercises: [{ id: 'ex', exercise_library_id: 'lib', archived: false }] };
const req = { params: { id: 'log', exerciseId: 'ex' }, query: {}, user: { role: 'client', client: { id: 'client' } } };
const row = { workout_log_id: 'old', completed_at: '2026-11-10T10:00:00Z', exercise_name: 'Fictional Split Squat', set_number: 1,
  actual_load_value: 32, actual_load_unit: 'lb', actual_reps: 8, actual_rpe: null, tracking_type: 'reps_weight', workout_log_exercise_id: 'old-ex' };

test('history occurrences carry their own prescription (v3)', async () => {
  const r = res();
  await createExerciseHistoryHandler({ findLog: async () => log, runHistory: async () => ({ data: [{ ...row,
    prescribed_load_value: 30, prescribed_load_unit: 'lb', prescribed_load_max: '35', per_side: true }], error: null }) })(req, r);
  assert.deepEqual(r.body.occurrences[0].prescribed, { load_value: 30, load_unit: 'lb', load_max: 35, per_side: true });
  assert.equal(r.body.occurrences[0].sets[0].actual_load_value, 32, 'performed values unchanged');
});

test('history rows without the v3 columns report no prescription, not an invented one', async () => {
  const r = res();
  await createExerciseHistoryHandler({ findLog: async () => log, runHistory: async () => ({ data: [row], error: null }) })(req, r);
  assert.equal(r.body.occurrences[0].prescribed, null);
});
