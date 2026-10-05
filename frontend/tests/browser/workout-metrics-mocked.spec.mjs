import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

test('typed outbox survives reload and an ambiguous add response, then completes in order', async ({ page }) => {
  const problems = [];
  const unexpected = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const emptySet = (id, number, extra = {}) => ({ id, set_number: number, workout_log_exercise_id: 'ex-1', status: 'pending', set_origin: 'prescribed', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, ...extra });
  const log = { id: 'log-1', client_id: 'client-1', workout_name: 'Synthetic run', status: 'active', started_at: new Date().toISOString(), exercises: [{ id: 'ex-1', exercise_name: 'Run', tracking_type: 'duration_distance', prescribed_sets: 1, prescribed_duration_value: 20, prescribed_duration_unit: 'min', prescribed_distance_value: 3, prescribed_distance_unit: 'km', sets: [emptySet('set-1', 1)] }], coach_responses: [] };
  const writes = [];
  let loseAddResponse = true;
  let addAttempts = 0;
  await page.addInitScript(() => {
    localStorage.setItem('cvf_access_token', 'synthetic-test-token');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => localStorage.getItem('synthetic_offline') !== 'yes' });
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = request.postDataJSON();
    const json = (value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'client@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client', waiver_signed: true } });
    if (path === '/workout-logs/coach-feedback/unread-count') return json({ unread: 0 });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path === '/workout-logs/log-1' && method === 'GET') return json(log);
    if (path === '/workout-logs/mine') return json([log]);
    if (path === '/workout-logs/log-1/exercises/ex-1/sets' && method === 'POST') {
      addAttempts += 1;
      let set = log.exercises[0].sets.find((row) => row.client_operation_id === body.client_operation_id);
      if (!set) { set = emptySet('set-extra', 2, { client_operation_id: body.client_operation_id, set_origin: 'extra' }); log.exercises[0].sets.push(set); writes.push('add'); }
      if (loseAddResponse) { loseAddResponse = false; return route.abort('failed'); }
      return json(set);
    }
    if (/^\/workout-logs\/log-1\/sets\/[^/]+$/.test(path) && method === 'PATCH') {
      const set = log.exercises[0].sets.find((row) => row.id === path.split('/').at(-1));
      if (!set) { unexpected.push(path); return route.fulfill({ status: 404, body: '{}' }); }
      Object.assign(set, body); writes.push(`set:${set.id}`); return json(set);
    }
    if (path === '/workout-logs/log-1/complete') {
      expect(log.exercises[0].sets.every((row) => row.status === 'completed')).toBe(true);
      expect(log.exercises[0].sets[1].actual_distance_value).toBe(2.25);
      writes.push('complete'); Object.assign(log, { status: 'completed', completed_at: new Date().toISOString() }); return json(log);
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unexpected synthetic route"}' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/client/workouts/log-1/track');
  const duration = (number) => page.getByLabel(`Run set ${number} performed duration`, { exact: true });
  const distance = (number) => page.getByLabel(`Run set ${number} performed distance`, { exact: true });
  await expect(duration(1)).toHaveValue('');
  await page.evaluate(() => { localStorage.setItem('synthetic_offline', 'yes'); window.dispatchEvent(new Event('offline')); });
  await duration(1).fill('12.5'); await duration(1).blur();
  await distance(1).fill('1.25'); await distance(1).blur();
  await page.getByRole('button', { name: 'Add set', exact: true }).click();
  await duration(2).fill('22.5'); await duration(2).blur();
  await distance(2).fill('2.25'); await distance(2).blur();
  await page.reload();
  await expect(duration(1)).toHaveValue('12.5');
  await expect(distance(2)).toHaveValue('2.25');
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CVF_METRICS_EVIDENCE_DIR) {
    await mkdir(process.env.CVF_METRICS_EVIDENCE_DIR, { recursive: true });
    await duration(1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(process.env.CVF_METRICS_EVIDENCE_DIR, 'metrics-reloaded-mobile.png') });
    await distance(2).evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.screenshot({ path: join(process.env.CVF_METRICS_EVIDENCE_DIR, 'metrics-extra-set-mobile.png') });
  }
  await page.evaluate(() => { localStorage.removeItem('synthetic_offline'); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cvf_workout_outbox_log-1')), { timeout: 15_000 }).toBe(null);
  expect(addAttempts).toBe(2);
  expect(log.exercises[0].sets).toHaveLength(2);
  expect(log.exercises[0].sets[1]).toMatchObject({ actual_duration_value: 22.5, actual_duration_unit: 'min', actual_distance_value: 2.25, actual_distance_unit: 'km' });
  await page.getByRole('button', { name: 'Complete set 1', exact: true }).click();
  await page.getByRole('button', { name: 'Complete set 2', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: /Confirm completion/i }).click();
  await expect(page.getByTestId('review-set-row').filter({ hasText: '22.5 min' })).toContainText('2.25 km');
  expect(writes.at(-1)).toBe('complete');
  expect(unexpected).toEqual([]);
  expect(problems).toEqual([]);
  if (process.env.CVF_METRICS_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.CVF_METRICS_EVIDENCE_DIR, 'metrics-completed-mobile.png'), fullPage: true });
});
