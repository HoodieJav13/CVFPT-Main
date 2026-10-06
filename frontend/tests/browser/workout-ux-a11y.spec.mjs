import { test, expect } from '@playwright/test';
import { exerciseName, setupWorkoutUx } from './workout-ux-fixture.mjs';
async function tracker(page) {
 const data = await setupWorkoutUx(page); await page.goto('/client/workouts/ux-log/track');
 await expect(page.getByTestId('workout-tracker')).toBeVisible(); await page.evaluate(() => document.fonts.ready); return data;
}
async function editor(page) {
 const data = await setupWorkoutUx(page, 'coach'); await page.goto('/coach/programs');
 await page.getByTestId('training-builder-tab-workouts').click(); await page.getByTestId('workout-create-button').click();
 const dialog = page.getByRole('dialog'); await dialog.getByTestId('workout-exercise-name-input').fill(exerciseName); return { ...data, dialog };
}

test('invalid fields retain values with associated inline errors and never enqueue or start rest', async ({ page }) => {
 const { results } = await tracker(page);
 for (const [field, value, message, corrected] of [
  [`${exerciseName} set 1 performed RPE`, '11', 'Use RPE 1–10', ''],
  [`${exerciseName} set 1 performed reps`, '2.5', 'Use a whole number of reps', ''],
  [`${exerciseName} set 1 weight`, '-1', 'Use weight 0 or more', '135.5'],
  ['Synthetic run set 1 performed duration', '1441', '24 hours', ''],
  ['Synthetic run set 1 performed distance', '1001', '1,000 km', ''],
 ]) {
  const input = page.getByLabel(field, { exact: true }); await input.fill(value); await input.blur();
  await expect(input).toHaveAttribute('aria-invalid', 'true'); const id = await input.getAttribute('aria-describedby'); expect(id).toBeTruthy();
  await expect(page.locator(`[id="${id}"]`)).toContainText(message);
  await page.getByRole('button', { name: 'Complete set 1', exact: true }).nth(field.startsWith('Synthetic') ? 2 : 0).click();
  await expect(input).toHaveValue(value); expect(results.writes).toHaveLength(0); await expect(page.getByTestId('rest-timer')).toHaveCount(0);
  await input.fill(corrected); await input.blur(); await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect.poll(() => results.writes.length).toBeGreaterThan(0); results.writes.length = 0;
 }
 expect(results.errors).toEqual([]); expect(results.unexpected).toEqual([]);
});

test('workout and library authoring fields retain associated labels after typing', async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 844 }); const { dialog, results } = await editor(page);
 for (const id of ['workout-name-input', 'workout-goal-input', 'workout-description-input', ...['name','sets','reps','rest','tempo','rpe','default-load','video','client-notes','coach-notes'].map(f => `workout-exercise-${f}-input`)]) {
  expect(await dialog.getByTestId(id).evaluate(e => [...e.labels].filter(l => l.textContent.trim()).length)).toBeGreaterThan(0);
 }
 await page.keyboard.press('Escape'); await page.getByTestId('training-builder-tab-library').click(); await page.getByTestId('exercise-library-create-button').click();
 for (const f of ['name','category','equipment','primary-muscle','secondary-muscles','video','notes']) expect(await page.getByTestId(`exercise-library-${f}-input`).evaluate(e => [...e.labels].filter(l => l.textContent.trim()).length)).toBeGreaterThan(0);
 expect(results.unexpected).toEqual([]);
});

test('offline invalid input never enters the queue; a corrected value still syncs', async ({ page, context }) => {
 const { results } = await tracker(page);
 await context.setOffline(true);
 const input = page.getByLabel(`${exerciseName} set 1 performed RPE`, { exact: true });
 await input.fill('11'); await input.blur();
 await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
 await expect(input).toHaveAttribute('aria-invalid', 'true');
 await expect(input).toHaveValue('11');
 await expect(page.getByTestId('rest-timer')).toHaveCount(0);
 expect(results.writes).toEqual([]);
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cvf_workout_outbox_ux-log') || '[]'))).toEqual([]);
 await input.fill('7.5'); await input.blur();
 await expect(input).not.toHaveAttribute('aria-invalid', 'true');
 expect(results.writes).toEqual([]);
 await context.setOffline(false);
 await expect.poll(() => results.writes.some(write => write.actual_rpe === 7.5)).toBe(true);
 expect(results.errors).toEqual([]); expect(results.unexpected).toEqual([]);
});
