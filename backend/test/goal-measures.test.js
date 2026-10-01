const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { goalMeasureSummary, MAX_GOAL_MEASURES } = require('../src/lib/progress');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const migration = read('supabase', 'migrations', '20261001200000_metric_goal_measures.sql');
const routes = read('backend', 'src', 'routes', 'progress.js');
const dashboard = read('backend', 'src', 'routes', 'dashboard.js');
const coachDetail = read('frontend', 'src', 'pages', 'coach', 'ClientDetail.jsx');
const coachDashboard = read('frontend', 'src', 'pages', 'coach', 'Dashboard.jsx');
const clientHome = read('frontend', 'src', 'pages', 'client', 'Home.jsx');
const preview = read('frontend', 'src', 'lib', 'previewMode.js');

test('goal measures schema: a defaulted flag on metrics, no backfill', () => {
  assert.match(migration, /alter table public\.metrics\s+add column if not exists is_goal_measure boolean not null default false;/);
  assert.doesNotMatch(migration, /update public\.metrics/);
  assert.doesNotMatch(migration, /drop /i);
});

test('goalMeasureSummary: latest, first and change since the first entry', () => {
  const metric = { id: 'm1', name: 'Body Weight', unit: 'lbs', improvement_direction: 'lower', target_value: 155 };
  const summary = goalMeasureSummary(metric, [
    { value: '168', recorded_on: '2026-09-02' },
    { value: '164.5', recorded_on: '2026-09-16' },
    { value: '162', recorded_on: '2026-09-28' },
  ]);
  assert.deepEqual(summary.first, { value: 168, recorded_on: '2026-09-02' });
  assert.deepEqual(summary.latest, { value: 162, recorded_on: '2026-09-28' });
  assert.equal(summary.change, -6);
  assert.equal(summary.target_value, 155);
  assert.equal(summary.improvement_direction, 'lower');
});

test('goalMeasureSummary: no entries or one entry has no change', () => {
  const metric = { id: 'm2', name: 'Mile Time', unit: 'min', improvement_direction: 'sideways' };
  const empty = goalMeasureSummary(metric, []);
  assert.equal(empty.latest, null);
  assert.equal(empty.change, null);
  assert.equal(empty.target_value, null);
  assert.equal(empty.improvement_direction, 'neutral');
  const single = goalMeasureSummary(metric, [{ value: 8.5, recorded_on: '2026-09-20' }]);
  assert.equal(single.latest.value, 8.5);
  assert.equal(single.change, null);
  // Float noise is rounded away.
  assert.equal(goalMeasureSummary(metric, [{ value: 34.5 }, { value: 33.75 }]).change, -0.75);
});

test('coach routes validate the flag and cap goal measures per client', () => {
  assert.equal(MAX_GOAL_MEASURES, 3);
  assert.match(routes, /typeof is_goal_measure !== 'boolean'/);
  assert.match(routes, /typeof req\.body\.is_goal_measure !== 'boolean'/);
  assert.equal((routes.match(/goalMeasureLimitReached\(/g) || []).length, 3); // definition + create + edit
  assert.match(routes, /\.eq\('archived', false\)\.eq\('is_goal_measure', true\)/);
  // Both writers stay coach-only.
  assert.match(routes, /router\.post\('\/clients\/:clientId\/metrics', requireCoach/);
  assert.match(routes, /router\.patch\('\/metrics\/:metricId', requireCoach/);
});

test('dashboards load goal measures best-effort, scoped to visible clients', () => {
  assert.match(dashboard, /async function goalMeasuresByClient\(clientIds\)/);
  assert.match(dashboard, /logError\('goal measures load error', e\)/);
  // Coach: only the coach's own clients (ids); client: only their own record.
  assert.match(dashboard, /const measures = await goalMeasuresByClient\(ids\);/);
  assert.match(dashboard, /const measures = await goalMeasuresByClient\(\[clientId\]\);/);
  assert.match(dashboard, /goal_clients: goalClients/);
  assert.match(dashboard, /goal: \{ text: req\.user\.client\.goals \|\| null, measures: measures\[clientId\] \|\| \[\] \}/);
});

test('coach picks measures; both dashboards show them; preview mirrors the API', () => {
  assert.match(coachDetail, /data-testid="metric-goal-measure-switch"/);
  assert.match(coachDetail, /data-testid="metric-goal-measure-badge"/);
  assert.match(coachDashboard, /data-testid="coach-goal-clients-card"/);
  assert.match(clientHome, /data-testid="client-goal-card"/);
  // Clients never get a control for it.
  assert.doesNotMatch(clientHome, /metric-goal-measure-switch/);
  assert.match(preview, /goal_clients: clients/);
  assert.match(preview, /is_goal_measure: payload\.is_goal_measure === true/);
  assert.match(preview, /A client can have up to 3 goal measures/);
});

test('metric edits omit the goal flag unless it changes (safe before the migration lands)', () => {
  assert.match(coachDetail, /if \(goalUnchanged\) delete body\.is_goal_measure;/);
  // The API only writes the column when the flag is present, and creating a
  // metric only inserts it when it is on.
  assert.match(routes, /'is_goal_measure' in \(req\.body \|\| \{\}\)/);
  assert.match(routes, /\.\.\.\(is_goal_measure \? \{ is_goal_measure: true \} : \{\}\)/);
});
