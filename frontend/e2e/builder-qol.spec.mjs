import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

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

test('mobile summaries include time and rest, removing a row can be undone without losing later edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-exercise-name-input').fill('Timed plank');
  await editor.getByTestId('workout-exercise-sets-input').fill('3');
  await editor.getByLabel('Exercise tracking type').selectOption('duration');
  await editor.getByLabel('Target duration', { exact: true }).fill('30');
  await editor.getByTestId('workout-exercise-rest-input').fill('60');
  await expect(editor.getByTestId('workout-exercise-summary')).toContainText('3 × 30 s');
  await expect(editor.getByTestId('workout-exercise-summary')).toContainText('60 sec rest');
  await editor.getByTestId('workout-exercise-remove-button').click();
  await editor.getByTestId('workout-name-input').fill('Changed after removal');
  await editor.getByRole('button', { name: 'Undo removal', exact: true }).click();
  await expect(editor.getByTestId('workout-name-input')).toHaveValue('Changed after removal');
  await expect(editor.getByTestId('workout-exercise-name-input')).toHaveValue('Timed plank');
  await expect(editor.getByLabel('Target duration', { exact: true })).toHaveValue('30');
});

test('target unit conversion is explicit and preserves physical duration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newWorkout(page);
  await editor.getByLabel('Exercise tracking type').selectOption('duration');
  await editor.getByLabel('Target duration', { exact: true }).fill('30');
  await editor.getByLabel('Target duration unit').selectOption('min');
  await expect(editor.getByLabel('Target duration', { exact: true })).toHaveValue('30');
  await editor.getByRole('button', { name: 'Convert 30 s to 0.5 min', exact: true }).click();
  await expect(editor.getByLabel('Target duration', { exact: true })).toHaveValue('0.5');
});

test('quick builder duplicates and reorders complete prescriptions and supports undo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_riley?tab=programs');
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session' }).click();
  const editor = page.getByTestId('quick-session-builder');
  await editor.getByTestId('quick-session-exercise-name-input').fill('Timed plank');
  await editor.getByLabel('Exercise tracking type').selectOption('duration');
  await editor.getByLabel('Target duration', { exact: true }).fill('45');
  await editor.getByRole('button', { name: 'Duplicate exercise 1', exact: true }).click();
  await expect(editor.getByTestId('quick-session-exercise-row')).toHaveCount(2);
  await expect(editor.getByLabel('Target duration', { exact: true }).nth(1)).toHaveValue('45');
  await editor.getByTestId('quick-session-exercise-name-input').nth(1).fill('Second exercise');
  await editor.getByRole('button', { name: 'Move exercise 2 up', exact: true }).click();
  await expect(editor.getByTestId('quick-session-exercise-name-input').first()).toHaveValue('Second exercise');
  await editor.getByRole('button', { name: 'Remove exercise 1', exact: true }).click();
  await editor.getByRole('button', { name: 'Undo removal', exact: true }).click();
  await expect(editor.getByTestId('quick-session-exercise-name-input').first()).toHaveValue('Second exercise');
});

test('desktop switches, tabs, navigation and browser back can retain unsaved work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach');
  await page.getByRole('link', { name: 'Programs', exact: true }).first().click();
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-rail-create').click();
  const editor = page.getByTestId('workout-editor-pane');
  await editor.getByTestId('workout-name-input').fill('Keep this draft');
  let prompts = 0;
  page.on('dialog', async (dialog) => { prompts++; await dialog.dismiss(); });
  await page.getByTestId('workout-rail').getByRole('button', { name: /Duration & distance practice/ }).click();
  await expect(editor.getByTestId('workout-name-input')).toHaveValue('Keep this draft');
  await page.getByTestId('training-builder-tab-library').click();
  await expect(editor.getByTestId('workout-name-input')).toHaveValue('Keep this draft');
  await page.getByRole('link', { name: 'Clients', exact: true }).first().click();
  await expect(page).toHaveURL(/\/coach\/programs$/);
  await page.goBack();
  await expect(editor.getByTestId('workout-name-input')).toHaveValue('Keep this draft');
  expect(prompts).toBe(4);
});

test('failed catalog creation retains entries and can be retried', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-exercise-name-input').fill('Retry movement');
  await editor.getByTestId('workout-exercise-reps-input').fill('8–12');
  await page.evaluate(() => localStorage.setItem('cvf_preview_fail', 'write-once'));
  await editor.getByRole('button', { name: 'Create “Retry movement” in catalog', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.getByTestId('workout-exercise-reps-input')).toHaveValue('8–12');
  await editor.getByRole('button', { name: 'Create “Retry movement” in catalog', exact: true }).click();
  await expect(editor.getByText('In exercise catalog', { exact: true })).toBeVisible();
});

test('quick discard clears the abandoned draft before reopening', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_riley?tab=programs');
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session' }).click();
  await page.getByTestId('quick-session-exercise-name-input').fill('Discard this');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('assign-program-button').click();
  await expect(page.getByTestId('quick-session-exercise-name-input')).toHaveValue('');
});


test('same-name inline creates across duplicate rows share a catalog identity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-name-input').fill('Shared identity workout');
  await editor.getByTestId('workout-exercise-name-input').fill('Shared inline movement');
  await editor.getByTestId('workout-exercise-duplicate-button').click();
  await editor.getByTestId('workout-exercise-duplicate-button').first().click();
  const rows = editor.getByTestId('workout-exercise-row');
  await rows.nth(1).locator('h3 button').click();
  await rows.nth(2).locator('h3 button').click();
  await page.evaluate(() => localStorage.setItem('cvf_preview_latency', JSON.stringify([{ path: '^/programs/exercise-library$', ms: 700 }])));
  const buttons = editor.getByRole('button', { name: 'Create “Shared inline movement” in catalog', exact: true });
  await buttons.nth(0).click();
  await buttons.nth(0).click();
  await expect(editor.getByText('In exercise catalog', { exact: true })).toHaveCount(3);
  const catalog = await callPreviewApi(page, 'get', '/programs/exercise-library');
  const matches = catalog.data.filter((item) => item.name === 'Shared inline movement');
  expect(matches).toHaveLength(1);
  await editor.getByTestId('workout-save-button').click();
  await expect(editor).not.toBeVisible();
  const workouts = await callPreviewApi(page, 'get', '/programs/workouts');
  const saved = workouts.data.find((item) => item.name === 'Shared identity workout');
  expect(saved.exercises.map((item) => item.exercise_library_id)).toEqual([matches[0].id, matches[0].id, matches[0].id]);
});


test('changing program import source can retain pasted edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-programs').click();
  await page.getByTestId('program-import-open-button').click();
  await page.getByTestId('program-import-source-select').click();
  await page.getByRole('option', { name: 'Paste program', exact: true }).click();
  await page.getByTestId('program-import-paste-textarea').fill('Keep this program text');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('program-import-source-select').click();
  await page.getByRole('option', { name: 'CSV template', exact: true }).click();
  await expect(page.getByTestId('program-import-paste-textarea')).toHaveValue('Keep this program text');
});
