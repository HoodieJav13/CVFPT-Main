// Authoring checks for the Look A prescription facts (upper load, per side)
// before the save RPC; the database re-checks every writer (look_a_load_range).
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLookAPrescription, isLoadRangeError } = require('../src/lib/lookAPrescription');
const { clientSafeExercise } = require('../src/lib/trainingLibrary');

test('omitted keys stay omitted so the database keeps the stored value', () => {
  const [row] = normalizeLookAPrescription([{ id: 'x', default_load_value: 100 }]);
  assert.equal('prescribed_load_max' in row, false);
  assert.equal('per_side' in row, false);
});

test('explicit null or empty clears the upper load; numbers and numeric strings are kept', () => {
  assert.equal(normalizeLookAPrescription([{ prescribed_load_max: '' }])[0].prescribed_load_max, null);
  assert.equal(normalizeLookAPrescription([{ prescribed_load_max: null }])[0].prescribed_load_max, null);
  assert.equal(normalizeLookAPrescription([{ default_load_value: 170, prescribed_load_max: '180' }])[0].prescribed_load_max, 180);
  assert.equal(normalizeLookAPrescription([{ default_load_value: 170, prescribed_load_max: 170 }])[0].prescribed_load_max, 170, 'equal is stored as no range by the database');
});

test('invalid upper loads and per side values are 400s', () => {
  for (const row of [
    { prescribed_load_max: 'abc' }, { prescribed_load_max: -1 }, { prescribed_load_max: 5000 }, { prescribed_load_max: '1e3' },
    { default_load_value: 180, prescribed_load_max: 170 }, { default_load_value: null, prescribed_load_max: 170 },
    { per_side: 'yes' }, { per_side: 1 }, { per_side: null },
  ]) {
    assert.throws(() => normalizeLookAPrescription([row]), (e) => e.status === 400, JSON.stringify(row));
  }
  assert.equal(normalizeLookAPrescription([{ per_side: true }])[0].per_side, true);
});

test('the database range refusal is recognised for a 400', () => {
  assert.equal(isLoadRangeError({ code: '22023', message: 'The upper load must be higher than the load it starts from.' }), true);
  assert.equal(isLoadRangeError({ code: '22023', message: 'something else' }), false);
  assert.equal(isLoadRangeError(null), false);
});

test('the client tracker receives the two facts', () => {
  const safe = clientSafeExercise({ id: 'x', prescribed_load_max: 180, per_side: true, coach_notes: 'private', library_exercise: null });
  assert.equal(safe.prescribed_load_max, 180);
  assert.equal(safe.per_side, true);
  assert.equal(safe.coach_notes, undefined);
});
