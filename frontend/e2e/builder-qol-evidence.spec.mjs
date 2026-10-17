import { test, expect, usePreviewRole } from './preview-test.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

test.skip(!process.env.CVF_QOL_EVIDENCE_DIR, 'Opt-in paired visual documentation');
for (const width of [320, 390, 1440]) {
  test(`workout builder evidence ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await usePreviewRole(page, 'coach');
    await page.goto('/coach/programs');
    await page.getByTestId('training-builder-tab-workouts').click();
    await page.getByTestId(width === 1440 ? 'workout-rail-create' : 'workout-create-button').click();
    const editor = width === 1440 ? page.getByTestId('workout-editor-pane') : page.getByRole('dialog');
    await editor.getByTestId('workout-name-input').fill('Coach workout');
    await editor.getByTestId('workout-exercise-name-input').fill('Hip abduction machine');
    await editor.getByTestId('workout-exercise-sets-input').fill('3');
    await editor.getByLabel('Exercise tracking type').selectOption('duration');
    await editor.getByLabel('Target duration', { exact: true }).fill('30');
    await editor.getByTestId('workout-exercise-rest-input').fill('60');
    await editor.getByTestId('workout-exercise-name-input').scrollIntoViewIfNeeded();
    await expect(editor.getByLabel('Target duration', { exact: true })).toBeVisible();
    await mkdir(process.env.CVF_QOL_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.CVF_QOL_EVIDENCE_DIR, `workout-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test(`quick builder evidence ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await usePreviewRole(page, 'coach');
    await page.goto('/coach/clients/client_riley?tab=programs');
    await page.getByTestId('assign-program-button').click();
    await page.getByTestId('client-assignment-type-select').click();
    await page.getByRole('option', { name: 'Quick session' }).click();
    await page.getByTestId('quick-session-exercise-name-input').fill('Hip abduction machine');
    await page.getByTestId('quick-session-sets-input').fill('3');
    await page.getByTestId('quick-session-exercise-name-input').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('quick-session-exercise-name-input')).toBeVisible();
    await mkdir(process.env.CVF_QOL_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.CVF_QOL_EVIDENCE_DIR, `quick-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
