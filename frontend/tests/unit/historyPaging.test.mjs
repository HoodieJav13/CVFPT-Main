import test from 'node:test';
import assert from 'node:assert/strict';
import { appendHistoryPage } from '../../src/lib/historyPaging.js';

test('appending a history page keeps order and skips logs already listed', () => {
  const existing = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(appendHistoryPage(existing, [{ id: 'b' }, { id: 'c' }]).map((log) => log.id), ['a', 'b', 'c']);
  assert.deepEqual(appendHistoryPage([], []), []);
});
