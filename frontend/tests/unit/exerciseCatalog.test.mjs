import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../../src/lib/trainingLibrary.js';
test('catalog matching ignores outer whitespace and case so inline create does not duplicate names', () => {
  const library = [{ id: 'one', name: 'Hip abduction machine' }];
  assert.equal(catalog.matchCatalogExercise?.(library, '  HIP ABDUCTION MACHINE  ')?.id, 'one');
});
