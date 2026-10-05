import { test, expect } from './preview-test.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function capture(page, name) {
  if (!process.env.CVF_METRICS_EVIDENCE_DIR) return;
  await mkdir(process.env.CVF_METRICS_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.CVF_METRICS_EVIDENCE_DIR, name), fullPage: true });
}

test('typed metrics stay blank until performed, survive offline edits, and appear in completed review', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { localStorage.setItem('cvf_preview_role', 'client'); localStorage.setItem('cvf_preview_client_id', 'client_david'); });
  await page.goto('/client/programs');
  await page.getByRole('tab', { name: 'Other', exact: true }).click();
  // A separate fixture keeps Sarah's legacy strength baseline unchanged.
  await expect(page.getByText('Duration & distance practice', { exact: true }).first()).toBeVisible();
  await page.getByTestId('start-standalone-workout').click();
  await expect(page.getByLabel('Timed hold set 1 performed duration', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Run set 1 performed distance', { exact: true })).toHaveValue('');
  await page.getByLabel('Timed hold set 1 performed duration', { exact: true }).fill('45');
  await page.getByLabel('Timed hold set 1 performed duration', { exact: true }).blur();
  await page.getByLabel('Carry set 1 performed distance', { exact: true }).fill('100');
  await page.getByLabel('Carry set 1 performed distance', { exact: true }).blur();
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await page.getByLabel('Run set 1 performed duration', { exact: true }).fill('12.5');
  await page.getByLabel('Run set 1 performed duration', { exact: true }).blur();
  await page.getByLabel('Run set 1 performed distance', { exact: true }).fill('1.25');
  await page.getByLabel('Run set 1 performed distance', { exact: true }).blur();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_workout_outbox_')).some((key) => JSON.parse(localStorage.getItem(key)).some((op) => op.data?.actual_distance_value === 1.25)))).toBe(true);
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_workout_outbox_')).length)).toBe(0);
  // A route remount tests resuming the stored snapshot, without resetting preview fixtures.
  await page.getByRole('link', { name: 'Programs', exact: true }).first().click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page.getByLabel('Run set 1 performed duration', { exact: true })).toHaveValue('12.5');
  await expect(page.getByLabel('Run set 1 performed distance', { exact: true })).toHaveValue('1.25');
  await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
  await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
  await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: /Confirm completion/i }).click();
  await expect(page.getByTestId('review-set-row').filter({ hasText: '12.5 min' })).toContainText('1.25 mi');
  await expect(page.getByTestId('review-set-row').filter({ hasText: '45 s' })).toBeVisible();
});

test('coach explicitly configures duration and distance targets and reopens the saved workout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('cvf_preview_role', 'coach'));
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByText('Duration & distance practice', { exact: true }).first().click();
  const editor = page.getByTestId('workout-editor-pane');
  await editor.getByTestId('workout-exercise-row').filter({ hasText: 'Run' }).locator('button[data-state]').first().click();
  const row = editor.getByTestId('workout-exercise-row').filter({ hasText: 'Run' });
  await expect(row.getByLabel('Exercise tracking type')).toHaveValue('duration_distance');
  await row.getByLabel('Target duration', { exact: true }).fill('20');
  await row.getByLabel('Target distance', { exact: true }).fill('3.2');
  await row.getByLabel('Target distance unit').selectOption('km');
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByText('Workout updated', { exact: true })).toBeVisible();
  await page.getByTestId('training-builder-tab-library').click();
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByText('Duration & distance practice', { exact: true }).first().click();
  await editor.getByTestId('workout-exercise-row').filter({ hasText: 'Run' }).locator('button[data-state]').first().click();
  await expect(row.getByLabel('Target duration', { exact: true })).toHaveValue('20');
  await expect(row.getByLabel('Target distance', { exact: true })).toHaveValue('3.2');
  await expect(row.getByLabel('Target distance unit')).toHaveValue('km');
  await row.getByLabel('Target duration', { exact: true }).evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await capture(page, 'metrics-coach-desktop.png');
});
