import { test, expect, usePreviewRole } from './preview-test.mjs';

async function newWorkout(page) {
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-create-button').click();
  return page.getByRole('dialog');
}

test('new catalog exercise is created inline without losing prescription and reused next time', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-name-input').fill('Coach QOL');
  await editor.getByTestId('workout-exercise-name-input').fill('QOL timed hold');
  await editor.getByTestId('workout-exercise-sets-input').fill('3');
  await editor.getByLabel('Exercise tracking type').selectOption('duration');
  await editor.getByLabel('Target duration', { exact: true }).fill('30');
  await editor.getByRole('button', { name: 'Create “QOL timed hold” in catalog', exact: true }).click();
  await expect(editor.getByText('In exercise catalog', { exact: true })).toBeVisible();
  await expect(editor.getByTestId('workout-exercise-sets-input')).toHaveValue('3');
  await expect(editor.getByLabel('Target duration', { exact: true })).toHaveValue('30');
  await expect(editor.getByTestId('workout-exercise-reps-input')).toHaveCount(0);
  await editor.getByTestId('workout-save-button').click();
  await expect(editor).not.toBeVisible();
  await page.getByTestId('workout-create-button').click();
  await editor.getByTestId('workout-exercise-name-input').fill('  qol timed hold  ');
  await expect(editor.getByText('In exercise catalog', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: /in catalog/ })).toHaveCount(0);
});

test('closing or changing tabs protects unsaved edits, saving clears the warning', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-name-input').fill('Keep my edits');
  let prompts = 0;
  const reject = async (dialog) => { prompts++; await dialog.dismiss(); };
  page.on('dialog', reject);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  expect(prompts).toBe(1);
  await expect(editor.getByTestId('workout-name-input')).toHaveValue('Keep my edits');
  await editor.getByTestId('workout-exercise-name-input').fill('Push-up');
  await editor.getByTestId('workout-save-button').click();
  await expect(editor).not.toBeVisible();
  await page.getByTestId('training-builder-tab-library').click();
  expect(prompts).toBe(1);
});

test('quick builder exposes time without opening More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_riley?tab=programs');
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session' }).click();
  const editor = page.getByTestId('quick-session-builder');
  await expect(editor.getByLabel('Exercise tracking type')).toBeVisible();
  await editor.getByLabel('Exercise tracking type').selectOption('duration');
  await expect(editor.getByLabel('Target duration', { exact: true })).toBeVisible();
  await expect(editor.getByTestId('quick-session-reps-input')).toHaveCount(0);
});
