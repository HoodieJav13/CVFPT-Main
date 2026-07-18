const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const app = read('backend', 'src', 'app.js');
const dashboard = read('backend', 'src', 'routes', 'dashboard.js');
const sessions = read('backend', 'src', 'routes', 'sessions.js');
const workoutRoutes = read('backend', 'src', 'routes', 'workoutLogs.js');
const workoutMigration = read(
  'supabase',
  'migrations',
  '20260717043317_workout_tracking_notifications.sql',
);

test('retired package and payment routers are not mounted', () => {
  assert.doesNotMatch(app, /app\.use\('\/api\/packages'/);
  assert.doesNotMatch(app, /app\.use\('\/api\/payments'/);
  assert.equal(fs.existsSync(path.join(root, 'backend', 'src', 'routes', 'packages.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'backend', 'src', 'routes', 'payments.js')), true);
});

test('active dashboard and session paths do not read or describe credits', () => {
  assert.doesNotMatch(dashboard, /getBalance|client_credits|\bcredits\b/);
  assert.doesNotMatch(sessions, /decrements one credit|client_credits|credit_transactions/);
  assert.match(sessions, /\.rpc\('complete_session'/);
});

test('workout tracking remains credit-independent', () => {
  assert.doesNotMatch(workoutRoutes, /client_credits|credit_transactions/);
  assert.doesNotMatch(workoutMigration, /client_credits|credit_transactions/);
});
