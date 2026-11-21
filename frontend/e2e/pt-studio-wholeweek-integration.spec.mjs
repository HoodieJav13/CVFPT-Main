import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

test.use({ actionTimeout: 10_000 });

// Fictional same-document integration: Studio's normal builder writes and the
// optional WholeWeek ledger must stay independent of existing programs/logs.
test('Studio save/edit and WholeWeek save/edit coexist without changing existing programs or workout logs', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/programs');
  const read = async (path) => {
    const response = await callPreviewApi(page, 'get', path);
    expect(response.status).toBe(200);
    return response.data;
  };
  const before = {
    programs: await read('/programs'),
    workouts: await read('/programs/workouts'),
    logs: await read('/workout-logs/client/client_sarah'),
    davidLogs: await read('/workout-logs/client/client_david'),
  };
  expect(before.logs.length).toBeGreaterThan(0);
  const capturePair = async (name) => {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.screenshot({ path: info.outputPath(`${name}-${viewport.width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-rail-authoring-open').click();
  const studio = page.getByTestId('authoring-dialog');
  await studio.getByTestId('authoring-transcript').fill('Goblet squat 3x10');
  await studio.getByTestId('authoring-build-button').click();
  await studio.getByTestId('authoring-workout-name-input').fill('CVF TEST Integrated Studio');
  await expect(studio.getByTestId('authoring-accept-button')).toBeEnabled();
  await capturePair('studio-review');
  await studio.getByTestId('authoring-accept-button').click();
  const editor = page.getByTestId('workout-editor-pane');
  await expect(editor.getByTestId('workout-name-input')).toHaveValue('CVF TEST Integrated Studio');
  expect(await read('/programs/workouts')).toEqual(before.workouts);
  // The fixture toolbar overlays the bottom-right editor at desktop width.
  // Exercise the actual keyboard-operable Save control without moving it.
  await editor.getByTestId('workout-save-button').press('Enter');
  await expect(page.getByText('Workout created')).toBeVisible();
  const created = (await read('/programs/workouts')).find((row) => row.name === 'CVF TEST Integrated Studio');
  expect(created).toBeTruthy();

  await page.getByTestId('sidebar-nav-clients').click();
  await page.getByTestId('client-row').filter({ hasText: 'David Chen' }).click();
  await page.getByTestId('coach-whole-week-entry').click();
  await expect(page.getByTestId('whole-week')).toBeVisible();
  const weekBefore = await read('/whole-week/clients/client_david');
  await capturePair('whole-week-before');
  await page.getByTestId('outside-activity-add').click();
  await page.getByTestId('outside-activity-form').getByRole('radio', { name: 'Run', exact: true }).click();
  await page.getByTestId('outside-activity-label').fill('CVF TEST Integrated Run');
  await page.getByTestId('outside-activity-minutes').fill('20');
  await page.getByTestId('outside-activity-save').click();
  await expect(page.getByTestId('whole-week-notice')).toHaveText('Activity saved.');
  const activity = page.getByTestId('outside-activity-row').filter({ hasText: 'CVF TEST Integrated Run' });
  await activity.getByTestId('outside-activity-edit').click();
  await page.getByTestId('outside-activity-minutes').fill('25');
  await page.getByTestId('outside-activity-save').click();
  await expect(page.getByTestId('whole-week-notice')).toHaveText('Correction saved.');
  const weekAfter = await read('/whole-week/clients/client_david');
  expect(weekAfter.activities).toHaveLength(weekBefore.activities.length + 1);
  expect(weekAfter.activities.find((row) => row.label === 'CVF TEST Integrated Run')).toMatchObject({ duration_seconds: 1500, revision: 2 });
  for (const row of weekBefore.activities) expect(weekAfter.activities.find((current) => current.id === row.id)).toEqual(row);
  await capturePair('whole-week-after');

  await page.getByTestId('sidebar-nav-programs').click();
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-rail-row').filter({ hasText: 'CVF TEST Integrated Studio' }).click();
  await editor.getByTestId('workout-name-input').fill('CVF TEST Integrated Studio Edited');
  await editor.getByTestId('workout-exercise-sets-input').fill('4');
  await page.screenshot({ path: info.outputPath('builder-edit-1440.png'), fullPage: true });
  await editor.getByTestId('workout-save-button').press('Enter');
  await expect(page.getByText('Workout updated')).toBeVisible();
  const after = await read('/programs/workouts');
  expect(after).toHaveLength(before.workouts.length + 1);
  expect(after.find((row) => row.id === created.id)).toMatchObject({ name: 'CVF TEST Integrated Studio Edited' });
  expect(after.find((row) => row.id === created.id).exercises[0].sets).toBe('4');
  for (const row of before.workouts) expect(after.find((current) => current.id === row.id)).toEqual(row);
  expect(await read('/programs')).toEqual(before.programs);
  expect(await read('/workout-logs/client/client_sarah')).toEqual(before.logs);
  expect(await read('/workout-logs/client/client_david')).toEqual(before.davidLogs);
  await info.attach('preservation-receipt', { body: JSON.stringify({ existingPrograms: before.programs.length, existingWorkouts: before.workouts.length, existingLogs: before.logs.length, addedWorkouts: 1, addedActivities: 1, activityRevision: 2, programLogSnapshotsUnchanged: true }, null, 2), contentType: 'application/json' });
});
