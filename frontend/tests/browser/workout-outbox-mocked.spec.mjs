import { test, expect } from '@playwright/test';

// Outbox flush after a reconnect with nothing queued (workoutOutbox.js). An
// empty run used to finish synchronously and leave its resolved promise as
// the "in-flight" run, so every later flush() returned true without sending.
async function setupTracker(page) {
  const state = { failWrites: false, received: [], unexpected: [], problems: [] };
  page.on('pageerror', (error) => state.problems.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('cvf_access_token', 'synthetic-test-token');
    window.__cvfOnline = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__cvfOnline });
    window.__setOnline = (value) => { window.__cvfOnline = value; window.dispatchEvent(new Event(value ? 'online' : 'offline')); };
  });
  const set = { id: 'set-1', workout_log_exercise_id: 'ex-1', set_number: 1, set_origin: 'prescribed', status: 'pending', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null };
  const log = { id: 'log-r', client_id: 'client-1', workout_name: 'Synthetic squat', status: 'active', started_at: new Date().toISOString(), coach_responses: [], exercises: [{ id: 'ex-1', exercise_name: 'Squat', tracking_type: 'reps_weight', prescribed_sets: 1, sets: [set] }] };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    const json = (value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (/unread-count$/.test(path)) return json({ unread: 0 });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path === '/workout-logs/log-r' && method === 'GET') return json(log);
    if (path === '/workout-logs/mine') return json([log]);
    // The tracker may read the active exercise's last occurrence on its own.
    if (path === '/workout-logs/log-r/exercises/ex-1/history' && method === 'GET') return json({ occurrences: [], next_cursor: null });
    if (path === '/workout-logs/log-r/sets/set-1' && method === 'PATCH') {
      if (state.failWrites) return route.abort('failed');
      Object.assign(set, request.postDataJSON());
      state.received.push('set');
      return json(set);
    }
    if (path === '/workout-logs/log-r/complete' && method === 'POST') {
      if (state.failWrites) return route.abort('failed');
      Object.assign(log, { status: 'completed', completed_at: new Date().toISOString() });
      state.received.push('complete');
      return json(log);
    }
    state.unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unexpected synthetic route"}' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/client/workouts/log-r/track');
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  // The phone drops and regains its connection between edits.
  await page.evaluate(() => window.__setOnline(false));
  await expect(page.getByTestId('workout-save-state')).toContainText('Not saved yet');
  await page.evaluate(() => window.__setOnline(true));
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  return { state, set, log, reps: page.getByRole('spinbutton', { name: 'Squat set 1 performed reps', exact: true }) };
}

const queuedKinds = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cvf_workout_outbox_log-r') || '[]').map((operation) => operation.kind));

test('a reconnect with nothing queued still lets later edits sync', async ({ page }) => {
  const { state, set, reps } = await setupTracker(page);
  await reps.fill('5'); await reps.blur();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved', { timeout: 8000 });
  expect(state.received).toEqual(['set']);
  expect(set.actual_reps).toBe(5);
  expect(await queuedKinds(page)).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.problems).toEqual([]);
});

test('Finish after a reconnect does not report a synced completion while edits are unsent', async ({ page }) => {
  const { state, set, log, reps } = await setupTracker(page);
  // Writes now fail in transit while the phone still reports online.
  state.failWrites = true;
  await reps.fill('5'); await reps.blur();
  await page.getByRole('button', { name: 'Complete set 1', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: /Confirm completion/i }).click();
  await expect(page).toHaveURL(/\/client\/workouts\/log-r$/);
  await expect(page.getByTestId('waiting-to-sync-banner')).toBeVisible();
  await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'none');
  await expect(page.getByRole('status').filter({ hasText: 'Workout complete' })).toHaveCount(0);
  expect(state.received).toEqual([]);
  expect((await queuedKinds(page)).at(-1)).toBe('complete');
  // The connection returns: the queued edits land first, then the completion.
  state.failWrites = false;
  await page.evaluate(() => window.__setOnline(true));
  await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'active', { timeout: 15_000 });
  await expect(page.getByTestId('waiting-to-sync-banner')).toHaveCount(0);
  expect(state.received.at(-1)).toBe('complete');
  expect(state.received.filter((kind) => kind === 'complete')).toHaveLength(1);
  expect(state.received.slice(0, -1).every((kind) => kind === 'set')).toBe(true);
  expect(set).toMatchObject({ actual_reps: 5, status: 'completed' });
  expect(log.status).toBe('completed');
  expect(await queuedKinds(page)).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.problems).toEqual([]);
});
