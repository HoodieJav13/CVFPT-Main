const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeImprovementDirection,
  personalBestResult,
  metricProgressSummary,
} = require('../src/lib/progress');

const entries = [
  { id: 'one', value: 100, archived: false },
  { id: 'two', value: 110, archived: false },
];

test('normalizes unsupported improvement directions to neutral', () => {
  assert.equal(normalizeImprovementDirection('higher'), 'higher');
  assert.equal(normalizeImprovementDirection('sideways'), 'neutral');
});

test('requires a prior value before declaring a personal best', () => {
  assert.equal(personalBestResult([], 'higher', 100).isPersonalBest, false);
});

test('detects higher-is-better personal records', () => {
  assert.deepEqual(personalBestResult(entries, 'higher', 115), {
    isPersonalBest: true,
    previousBestValue: 110,
    improvementAmount: 5,
  });
  assert.equal(personalBestResult(entries, 'higher', 110).isPersonalBest, false);
});

test('detects lower-is-better personal records', () => {
  const result = personalBestResult(entries, 'lower', 95);
  assert.equal(result.isPersonalBest, true);
  assert.equal(result.previousBestValue, 100);
  assert.equal(result.improvementAmount, 5);
});

test('neutral metrics never produce personal records', () => {
  assert.equal(personalBestResult(entries, 'neutral', 999).isPersonalBest, false);
});

test('metric summary marks the latest value only when it beats every prior value', () => {
  const summary = metricProgressSummary(
    { id: 'metric', improvement_direction: 'higher' },
    [...entries, { id: 'three', value: 120, archived: false }],
  );
  assert.equal(summary.best_value, 120);
  assert.equal(summary.latest_is_personal_best, true);
});
