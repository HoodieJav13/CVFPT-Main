// Look A swap targets (LOOK-A-INTEGRATION-REVIEW.md case 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { swapRequestTargets, swapLoadUnit, swapTargetsText } from '../../src/lib/swapTargets.js';

const backup = { kind: 'backup', item: { targets: { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true } } };

test('a kept coach backup sends its range, per side and kg', () => {
  assert.deepEqual(swapRequestTargets({ ...backup, targets: { sets: '3', reps: '8', load_value: '30' } }),
    { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true });
  assert.equal(swapLoadUnit(backup), 'kg');
});

test('a changed load is one number in the backup unit; per side stays', () => {
  assert.deepEqual(swapRequestTargets({ ...backup, targets: { sets: '3', reps: '8', load_value: '32.5' } }),
    { sets: 3, reps: '8', load_value: 32.5, load_unit: 'kg', per_side: true });
});

test('a cleared load sends no load and no range', () => {
  assert.deepEqual(swapRequestTargets({ ...backup, targets: { sets: '3', reps: '', load_value: '' } }), { sets: 3, per_side: true });
});

test('a suggestion copies nothing and a typed load is lb', () => {
  const suggestion = { kind: 'suggestion', item: { targets: { load_value: 30, load_unit: 'kg', load_max: 35, per_side: true } } };
  assert.deepEqual(swapRequestTargets({ ...suggestion, targets: { load_value: '20' } }), { load_value: 20, load_unit: 'lb' });
  assert.equal(swapLoadUnit(suggestion), 'lb');
});

test('the backup summary shows the saved facts only', () => {
  assert.equal(swapTargetsText(backup.item.targets), '3 sets × 8 reps × 30–35 kg per side');
  assert.equal(swapTargetsText({ load_value: 40, load_unit: 'lb' }), '40 lb');
  assert.equal(swapTargetsText({}), 'No targets set');
});
