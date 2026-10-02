import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const PROBE = '/__preview_missing_mock_probe__';

function sessionBody(daysAhead = 6, hour = 14) {
  const at = new Date();
  at.setDate(at.getDate() + daysAhead);
  at.setHours(hour, 0, 0, 0);
  return { client_id: 'client_david', scheduled_at: at.toISOString(), duration_minutes: 60, location: 'CVF Studio' };
}

const setFail = (page, mode) => page.evaluate((value) => {
  if (value) localStorage.setItem('cvf_preview_fail', value);
  else localStorage.removeItem('cvf_preview_fail');
}, mode);
const getFail = (page) => page.evaluate(() => localStorage.getItem('cvf_preview_fail'));

async function openCoach(page) {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
}

// On desktop the speed, failure and reset controls are folded behind "Test states".
async function openTestStates(page) {
  if (!(await page.getByTestId('preview-speed-select').isVisible())) {
    await page.getByTestId('preview-test-states-toggle').click();
  }
  await expect(page.getByTestId('preview-speed-select')).toBeVisible();
}

test('fail next save rejects one save before it changes anything, and then clears itself', async ({ page }) => {
  await openCoach(page);
  const before = await callPreviewApi(page, 'get', '/sessions');
  await setFail(page, 'write-once');

  // Reads are untouched by "fail next save".
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(200);
  expect(await getFail(page)).toBe('write-once');

  const failed = await callPreviewApi(page, 'post', '/sessions', sessionBody());
  expect(failed.status).toBe(503);
  expect(failed.data).toEqual({ error: 'Simulated failure (preview)' });
  expect(await getFail(page)).toBeNull();
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before.data.length);

  const retry = await callPreviewApi(page, 'post', '/sessions', sessionBody());
  expect(retry.status).toBe(201);
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before.data.length + 1);
});

test('concurrent saves: exactly one fails and the others are kept', async ({ page }) => {
  await openCoach(page);
  const before = await callPreviewApi(page, 'get', '/sessions');
  await setFail(page, 'write-once');
  // Three different days so the saves cannot conflict with each other.
  const results = await Promise.all([6, 7, 8].map((day) => callPreviewApi(page, 'post', '/sessions', sessionBody(day))));
  expect(results.map((result) => result.status).sort()).toEqual([201, 201, 503]);
  expect(await getFail(page)).toBeNull();
  expect((await callPreviewApi(page, 'get', '/sessions')).data).toHaveLength(before.data.length + 2);
});

test('requests that change no fixture data do not consume fail next save', async ({ page }) => {
  await openCoach(page);
  await setFail(page, 'write-once');
  const parsed = await callPreviewApi(page, 'post', '/programs/import/parse-paste', { text: 'Goblet Squat 3x8' });
  expect(parsed.status).not.toBe(503);
  // The background telemetry ping every page sends.
  const telemetry = await callPreviewApi(page, 'post', '/telemetry/events', {});
  expect(telemetry.status).toBe(202);
  expect(await getFail(page)).toBe('write-once');
});

test('fail loads rejects every read until it is turned off, and saves still work', async ({ page }) => {
  await openCoach(page);
  await setFail(page, 'reads');
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(503);
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(503);
  expect(await getFail(page)).toBe('reads');
  expect((await callPreviewApi(page, 'post', '/sessions', sessionBody(7))).status).toBe(201);
  await setFail(page, null);
  expect((await callPreviewApi(page, 'get', '/sessions')).status).toBe(200);
});

test.describe('faults and missing mocks', () => {
  test.use({ allowMissingMocks: true });

  test('a simulated failure never hides a missing mock and is not consumed by one', async ({ page, missingMocks }) => {
    await openCoach(page);
    await setFail(page, 'reads');
    expect((await callPreviewApi(page, 'get', PROBE)).status).toBe(404);
    await setFail(page, 'write-once');
    const write = await callPreviewApi(page, 'post', PROBE, {});
    expect(write.status).toBe(404);
    expect(write.data.code).toBe('preview_missing_mock');
    expect(await getFail(page)).toBe('write-once');
    expect(missingMocks).toEqual([`GET ${PROBE}`, `POST ${PROBE}`]);
  });
});

test('toolbar switches write their storage keys and show the modified marker', async ({ page }) => {
  await openCoach(page);
  await openTestStates(page);
  await expect(page.getByTestId('preview-modified-marker')).toHaveCount(0);

  await page.getByTestId('preview-speed-select').selectOption('slow');
  expect(await page.evaluate(() => localStorage.getItem('cvf_preview_latency'))).toBe('[{"path":".*","ms":1500}]');
  await expect(page.getByTestId('preview-modified-marker').first()).toBeAttached();

  await page.getByTestId('preview-speed-select').selectOption('normal');
  expect(await page.evaluate(() => localStorage.getItem('cvf_preview_latency'))).toBeNull();
  await expect(page.getByTestId('preview-modified-marker')).toHaveCount(0);

  await page.getByTestId('preview-fail-select').selectOption('write-once');
  expect(await getFail(page)).toBe('write-once');
  await expect(page.getByTestId('preview-modified-marker').first()).toBeAttached();
});

test('fail next save shows the screen error once, returns the switch to off, and the retry succeeds', async ({ page }) => {
  await openCoach(page);
  await openTestStates(page);
  await page.getByTestId('preview-fail-select').selectOption('write-once');
  await page.getByTestId('booking-approve-button').first().click();
  await expect(page.getByText('Simulated failure (preview)')).toBeVisible();
  await expect(page.getByTestId('preview-fail-select')).toHaveValue('off');
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(1);

  await page.getByTestId('booking-approve-button').first().click();
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(0);
});

test('fail loads shows the retry state, and turning it off lets Retry recover', async ({ page }) => {
  await openCoach(page);
  await openTestStates(page);
  await page.getByTestId('preview-fail-select').selectOption('reads');
  await page.goto('/coach/clients');
  await expect(page.getByTestId('load-error-state')).toBeVisible();
  await expect(page.getByTestId('preview-fail-select')).toBeVisible(); // shown automatically while a switch is on
  await page.getByTestId('preview-fail-select').selectOption('off');
  await page.getByTestId('load-error-retry-button').click();
  await expect(page.getByTestId('load-error-state')).toHaveCount(0);
  await expect(page.getByText('David Chen').first()).toBeVisible();
});

test('slow speed keeps the loading skeleton on screen before content', async ({ page }) => {
  await openCoach(page);
  await openTestStates(page);
  await page.getByTestId('preview-speed-select').selectOption('slow');
  await page.getByTestId('preview-quick-link').filter({ hasText: 'Clients' }).first().click();
  await expect(page.getByTestId('loading-skeleton').first()).toBeVisible();
  await expect(page.getByText('David Chen').first()).toBeVisible();
});

test('Reset restores fixtures and switches and leaves everything else alone', async ({ page }) => {
  await openCoach(page);
  await page.getByTestId('booking-approve-button').first().click();
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(0);
  await openTestStates(page);
  await page.getByTestId('preview-speed-select').selectOption('slow');
  await page.getByTestId('preview-fail-select').selectOption('reads');
  await page.evaluate(() => {
    localStorage.setItem('cvf_access_token', 'keep-me');
    localStorage.setItem('cvf_rest_alerts', 'on');
    localStorage.setItem('unrelated_key', 'keep-me-too');
    localStorage.setItem('cvf_workout_outbox_3f2b8c1e-1111-4222-8333-444455556666', '[]');
    localStorage.setItem('cvf_series_pending:coach_marcus:client_david', '{}');
    localStorage.setItem('cvf_workout_outbox_log_abc12345', '[]');
    localStorage.setItem('cvf_rest_timer_log_abc12345', '1');
  });

  await page.getByTestId('preview-reset-button').click();
  await expect(page.getByTestId('coach-action-booking')).toHaveCount(1);
  await expect(page.getByTestId('preview-speed-select')).toHaveValue('normal');
  await expect(page.getByTestId('preview-fail-select')).toHaveValue('off');

  const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(stored.cvf_preview_role).toBe('coach');
  expect(stored.cvf_preview_client_id).toBe('client_sarah');
  expect(stored.cvf_access_token).toBe('keep-me');
  expect(stored.cvf_rest_alerts).toBe('on');
  expect(stored.unrelated_key).toBe('keep-me-too');
  expect(stored['cvf_workout_outbox_3f2b8c1e-1111-4222-8333-444455556666']).toBe('[]');
  for (const removed of ['cvf_preview_latency', 'cvf_preview_fail', 'cvf_series_pending:coach_marcus:client_david', 'cvf_workout_outbox_log_abc12345', 'cvf_rest_timer_log_abc12345']) {
    expect(stored[removed], removed).toBeUndefined();
  }
});

test('on desktop the test-state controls stay folded until opened, so the toolbar keeps its footprint', async ({ page }) => {
  await openCoach(page);
  await expect(page.getByTestId('preview-speed-select')).toBeHidden();
  const folded = await page.getByTestId('preview-toolbar').boundingBox();
  await page.getByTestId('preview-test-states-toggle').click();
  await expect(page.getByTestId('preview-reset-button')).toBeVisible();
  const open = await page.getByTestId('preview-toolbar').boundingBox();
  expect(open.height).toBeGreaterThan(folded.height);
});

test('on a phone the opened panel shows the test-state controls directly and fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCoach(page);
  await page.getByTestId('preview-toolbar-toggle').click();
  for (const id of ['preview-speed-select', 'preview-fail-select', 'preview-reset-button']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('preview-test-states-toggle')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByTestId('preview-fail-select').selectOption('reads');
  await page.getByTestId('preview-toolbar-toggle').click();
  await expect(page.getByTestId('preview-modified-marker').first()).toBeVisible();
});
