import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const PROBE = '/__preview_missing_mock_probe__';

test('an unexpected missing mock fails an ordinary test', async ({ page }) => {
  // No opt-out here. The automatic fixture must fail this test in teardown;
  // test.fail() turns that expected failure into a pass and turns a silent
  // detector into a red suite.
  test.fail(true, 'The missing-mock fixture must fail this test.');
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await callPreviewApi(page, 'get', PROBE);
});

test.describe('with missing mocks allowed', () => {
  test.use({ allowMissingMocks: true });

  test('a missing mock is collected, answered with 404, and shown as a preview gap', async ({ page, missingMocks }) => {
    await usePreviewRole(page, 'coach');
    await page.goto('/coach');
    const result = await callPreviewApi(page, 'get', PROBE);
    expect(result.status).toBe(404);
    expect(result.data).toEqual({ error: `Preview route not mocked: GET ${PROBE}`, code: 'preview_missing_mock' });
    expect(missingMocks).toEqual([`GET ${PROBE}`]);
    await expect(page.getByText('Preview is missing a mock')).toBeVisible();
    await expect(page.getByText(`GET ${PROBE}`)).toBeVisible();
  });
});

test('a deliberately unsupported route says so and does not count as a missing mock', async ({ page, missingMocks }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  const result = await callPreviewApi(page, 'post', '/sessions/series/preview', {});
  expect(result.status).toBe(422);
  expect(result.data.error).toBe('Not available in preview');
  expect(result.data.code).toBe('preview_unsupported');
  expect(result.data.reason).toBe('Recurring sessions are not in preview yet');
  await expect(page.getByText('Not available in preview')).toBeVisible();
  expect(missingMocks).toEqual([]);
});
