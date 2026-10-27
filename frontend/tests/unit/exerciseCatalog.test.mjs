import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../../src/lib/trainingLibrary.js';
test('catalog matching ignores outer whitespace and case so inline create does not duplicate names', () => {
  const library = [{ id: 'one', name: 'Hip abduction machine' }];
  assert.equal(catalog.matchCatalogExercise?.(library, '  HIP ABDUCTION MACHINE  ')?.id, 'one');
});

test('catalog matching uses the import name rules for repeated spaces, tabs and newlines', () => {
  const library = [{ id: 'one', name: '  Hip  abduction\tmachine\n' }];
  assert.equal(catalog.matchCatalogExercise(library, ' HIP\tABDUCTION   MACHINE ')?.id, 'one');
  assert.equal(catalog.matchCatalogExercise(library, ' \t\n '), undefined);
  assert.equal(catalog.matchCatalogExercise(library, 'Hip adduction machine'), undefined);
});
