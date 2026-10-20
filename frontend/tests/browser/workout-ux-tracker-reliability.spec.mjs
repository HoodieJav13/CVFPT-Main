// Tracker reliability regressions (normal mode, synthetic API only): an expired
// session must not cost queued offline sets, and a Finish the server refuses
// must not be celebrated as a completed workout.
import { test, expect } from '@playwright/test';

async function setupTracker(page, { sessionDead = false, rejectComplete = false } = {}) {
  const state = { received: [], unexpected: [], problems: [], sessionDead, rejectComplete };
  page.on('pageerror', (error) => state.problems.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const set = { id: 'set-1', workout_log_exercise_id: 'ex-1', set_number: 1, set_origin: 'prescribed', status: 'pending', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null };
  const log = { id: 'log-r', client_id: 'client-1', workout_name: 'Synthetic squat', status: 'active', started_at: new Date().toISOString(), coach_responses: [], exercises: [{ id: 'ex-1', exercise_name: 'Squat', tracking_type: 'reps_weight', prescribed_sets: 1, sets: [set] }] };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    if (path === '/auth/refresh') { state.received.push('refresh'); return json({ error: 'Invalid refresh token' }, 401); }
    if (path === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (/unread-count$/.test(path)) return json({ unread: 0 });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path === '/workout-logs/log-r' && method === 'GET') return json(log);
    if (path === '/workout-logs/mine') return json([log]);
    if (path === '/workout-logs/log-r/exercises/ex-1/history' && method === 'GET') return json({ occurrences: [], next_cursor: null });
    if (path === '/workout-logs/log-r/sets/set-1' && method === 'PATCH') {
      if (state.sessionDead) { state.received.push('set-401'); return json({ error: 'Invalid or expired token' }, 401); }
      Object.assign(set, request.postDataJSON());
      state.received.push('set');
      return json(set);
    }
    if (path === '/workout-logs/log-r/complete' && method === 'POST') {
      if (state.rejectComplete) { state.received.push('complete-400'); return json({ error: 'Synthetic refusal: complete at least one set' }, 400); }
      Object.assign(log, { status: 'completed', completed_at: new Date().toISOString() });
      state.received.push('complete');
      return json(log);
    }
    state.unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic route' }, 404);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  return { state, set, log };
}

const queued = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cvf_workout_outbox_log-r') || '[]'));

test('an expired session keeps queued sets for replay after sign-in instead of discarding them', async ({ page }) => {
  const { state, set } = await setupTracker(page, { sessionDead: true });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cvf_access_token', 'synthetic-expired-token');
    localStorage.setItem('cvf_refresh_token', 'synthetic-revoked-refresh');
    localStorage.setItem('cvf_workout_outbox_log-r', JSON.stringify([{ id: 'op-1', kind: 'set', exerciseId: 'ex-1', setId: 'set-1', method: 'patch', url: '/workout-logs/log-r/sets/set-1', data: { status: 'completed', actual_reps: 5 }, attempts: 0 }]));
  });
  await page.goto('/client/workouts/log-r/track');
  await expect(page).toHaveURL(/\/login/);
  expect(state.received).toContain('set-401');
  expect((await queued(page)).map((operation) => operation.id)).toEqual(['op-1']);
  // Signed in again, the kept set replays once and the queue drains.
  state.sessionDead = false;
  await page.evaluate(() => localStorage.setItem('cvf_access_token', 'synthetic-fresh-token'));
  await page.goto('/client/workouts/log-r/track');
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await expect.poll(() => queued(page)).toEqual([]);
  expect(state.received.filter((kind) => kind === 'set')).toHaveLength(1);
  expect(set).toMatchObject({ status: 'completed', actual_reps: 5 });
});
