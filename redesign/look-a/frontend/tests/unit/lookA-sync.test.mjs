// The seal after a queued Finish (Look A, LOOK-A-PENDING-FINISH-REVIEW):
// nothing is written behind a Finish except the Undo of that very Finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWriteBlocked } from '../../src/lib/workoutSync.js';

const finish = { id: 'f', kind: 'complete', url: '/workout-logs/l/finish', data: { event_id: 'ef' } };
test('only the Undo of the queued Finish passes the seal', () => {
  assert.equal(isWriteBlocked([finish], { kind: 'set', setId: 's1', data: {} }), true);
  assert.equal(isWriteBlocked([finish], { kind: 'material', optimistic: 'done', data: { event_id: 'x' } }), true);
  assert.equal(isWriteBlocked([finish], { kind: 'material', undoOf: { kind: 'finish', change_id: 'other' }, data: {} }), true);
  assert.equal(isWriteBlocked([finish], { kind: 'material', undoOf: { kind: 'set', change_id: 'ef' }, data: {} }), true);
  assert.equal(isWriteBlocked([finish], { kind: 'material', undoOf: { kind: 'finish', change_id: 'ef' }, data: {} }), false);
  assert.equal(isWriteBlocked([], { kind: 'set', data: {} }), false);
});
