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

test('an unsupported save passes through unchanged and does not consume fail next save', async ({ page }) => {
  await openCoach(page);
  await setFail(page, 'write-once');
  const result = await callPreviewApi(page, 'post', '/sessions/series', {});
  expect(result.status).toBe(422);
  expect(result.data.code).toBe('preview_unsupported');
  expect(await getFail(page)).toBe('write-once');
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
