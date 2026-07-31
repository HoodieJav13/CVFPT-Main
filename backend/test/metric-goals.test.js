const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeTargetValue } = require('../src/lib/progress');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260731184500_metric_goals.sql'),
  'utf8',
);
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'progress.js'), 'utf8');

test('metric goals schema: nullable numeric target on metrics', () => {
  assert.match(migration, /alter table public\.metrics\s*add column if not exists target_value numeric;/);
  // No default and no backfill: existing metrics simply have no goal.
  assert.doesNotMatch(migration, /update public\.metrics/);
});

test('normalizeTargetValue: blank clears, numbers pass, junk rejects', () => {
  assert.deepEqual(normalizeTargetValue(undefined), { ok: true, value: null });
  assert.deepEqual(normalizeTargetValue(null), { ok: true, value: null });
  assert.deepEqual(normalizeTargetValue(''), { ok: true, value: null });
  assert.deepEqual(normalizeTargetValue('155'), { ok: true, value: 155 });
  assert.deepEqual(normalizeTargetValue(7.5), { ok: true, value: 7.5 });
  assert.deepEqual(normalizeTargetValue(0), { ok: true, value: 0 });
  assert.equal(normalizeTargetValue('goal').ok, false);
  assert.equal(normalizeTargetValue(Infinity).ok, false);
});

test('coach routes accept and validate target_value on create and edit', () => {
  // Both writers run the shared validator and 400 on junk.
  assert.match(routes, /const target = normalizeTargetValue\(target_value\);/);
  assert.match(routes, /'target_value' in \(req\.body \|\| \{\}\)/);
  const rejections = routes.match(/Goal must be a number, or blank for no goal/g) || [];
  assert.equal(rejections.length, 2);
  // Goal edits stay coach-only: both handlers sit on requireCoach routes.
  assert.match(routes, /router\.post\('\/clients\/:clientId\/metrics', requireCoach/);
  assert.match(routes, /router\.patch\('\/metrics\/:metricId', requireCoach/);
});
