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

// Owner decision c (handoff 2026-11-14): fixed backup set count.
import { backupSetCount } from '../../src/lib/swapTargets.js';
test('backup set count: own count minus completed or skipped, at least 1', () => {
  const old = (statuses) => ({ sets: statuses.map((status, i) => ({ id: `o${i}`, status })) });
  assert.equal(backupSetCount({ sets: 3 }, old(['pending', 'pending'])), 3);
  assert.equal(backupSetCount({ sets: 3 }, old(['completed', 'skipped', 'pending'])), 1);
  assert.equal(backupSetCount({ sets: 4 }, old(['completed', 'pending'])), 3);
  assert.equal(backupSetCount({ sets: 2 }, old(['completed', 'completed', 'completed'])), 1);
  assert.equal(backupSetCount({ sets: null }, old([])), 1);
  assert.equal(backupSetCount({ sets: 3 }, { sets: [{ status: 'completed', archived: true }] }), 3, 'archived sets do not count');
  const backup = { kind: 'backup', item: { targets: { sets: 3, reps: '8' } }, targets: { sets: '9', reps: '8' } };
  assert.equal(swapRequestTargets(backup, old(['completed'])).sets, 2, 'typed sets are ignored for a backup');
});
