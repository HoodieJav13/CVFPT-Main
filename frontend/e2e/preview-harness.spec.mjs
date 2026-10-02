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

// PREVIEW_UNSUPPORTED is empty now that recurring sessions are mocked, so the
// "Not available in preview" path has no route to exercise. When a route is
// listed again, add a test here that hits it and asserts the 422 body, the
// toast, and an empty missing-mock list.
test('an ordinary page load requests no unmocked route', async ({ page, missingMocks }) => {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  expect(missingMocks).toEqual([]);
});
