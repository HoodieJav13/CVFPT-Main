import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';
const endpoint = '/programs/program_foundation/rescue';
const openClient = async (page) => {
  await usePreviewRole(page, 'client');
  await page.goto('/client/programs');
  await page.getByRole('button', { name: 'Find a demo option' }).click();
  await expect(page.getByTestId('rescue-dialog').getByLabel('Time available (minutes)')).toBeVisible();
};
const switchRole = async (page, role) => page.evaluate(async (role) => { const preview = await import('/src/lib/previewMode.js'); preview.setPreviewRole(role); }, role);
const openCoach = async (page) => {
  await usePreviewRole(page, 'coach'); await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-programs').click();
  await page.getByRole('button', { name: 'Define demo fallbacks' }).click();
  await expect(page.getByTestId('rescue-editor')).toBeVisible();
};
const clean = async (page) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
};
for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
 test(`client ${viewport.name}: explicit diff, conflicts, pain, override and cancel keep source/history intact`, async ({ page }) => {
  await page.setViewportSize(viewport); const errors = await clean(page); await openClient(page);
  const original = await callPreviewApi(page, 'get', '/programs/client/assigned');
  const history = await callPreviewApi(page, 'get', '/workout-logs/mine');
  const dialog = page.getByTestId('rescue-dialog');
  await expect(dialog.getByRole('button', { name: 'Use this demo option' })).toBeDisabled();
  await dialog.getByRole('button', { name: /25-minute gym option/ }).click();
  await expect(dialog.getByTestId('rescue-changes')).toContainText('3 → 2 sets');
  await dialog.getByLabel('Cable station').uncheck();
  await expect(dialog).toContainText('No coach-authored fallback fits this time and equipment combination');
  await expect(dialog.getByRole('button', { name: 'Use this demo option' })).toBeDisabled();
  await dialog.getByLabel('Time available (minutes)').fill('50');
  await dialog.getByRole('button', { name: /Dumbbells only · 40 minutes/ }).click();
  await expect(dialog.getByTestId('rescue-changes')).toContainText('Half-kneeling Pallof Press: Dropped');
  await page.screenshot({ path: `/tmp/workout-rescue-client-${viewport.name}.png` });
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  await dialog.getByRole('button', { name: 'Pain or injury' }).click();
  await expect(dialog).toContainText('no automatic option is offered');
  await expect(dialog.getByTestId('rescue-changes')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Keep original / cancel' }).click();
  expect((await callPreviewApi(page, 'get', '/programs/client/assigned')).data).toEqual(original.data);
  expect((await callPreviewApi(page, 'get', '/workout-logs/mine')).data).toEqual(history.data);
  await page.getByRole('button', { name: 'Find a demo option' }).click();
  await expect(page.getByRole('button', { name: 'Define demo fallbacks' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Use this demo option' })).toBeDisabled();
  expect(errors).toEqual([]);
 });
}
for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
test(`coach ${viewport.name} creates combined fallback; cancel/reset, save, client chooses and existing guided tracker receives snapshot`, async ({ page }) => {
 await page.setViewportSize(viewport);
 const errors = await clean(page); await openCoach(page); const dialog = page.getByTestId('rescue-dialog');
 await dialog.getByLabel('Option name', { exact: true }).fill('Discard me');
 await dialog.getByRole('button', { name: 'Reset unsaved changes' }).click();
 await expect(dialog.getByLabel('Option name', { exact: true })).toHaveValue('25-minute gym option');
 await dialog.getByLabel('Option name', { exact: true }).fill('Cancel me'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
 await page.getByRole('button', { name: 'Define demo fallbacks' }).click();
 await expect(dialog.getByLabel('Option name', { exact: true })).toHaveValue('25-minute gym option');
 await dialog.getByRole('button', { name: 'Add option' }).click();
 await dialog.getByLabel('Option name', { exact: true }).fill('25-minute dumbbell strength');
 await dialog.getByLabel('Intent kept and tradeoff').fill('Keep squat and hinge practice; fewer sets and no cable work today.');
 await dialog.getByLabel('Cable station').uncheck();
 await dialog.getByLabel('Sets for Goblet Squat', { exact: true }).fill('2');
 await dialog.getByLabel('Sets for Romanian Deadlift', { exact: true }).fill('2');
 await dialog.getByLabel('Sets for Half-kneeling Pallof Press', { exact: true }).fill('0');
 expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBeTruthy();
 await page.screenshot({ path: `/tmp/workout-rescue-coach-${viewport.name}.png` });
 await dialog.getByRole('button', { name: 'Save demo options' }).click();
 await expect(dialog).toContainText('Demo options saved');
 await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
 const plan = (await callPreviewApi(page, 'get', endpoint)).data;
 await switchRole(page, 'client');
 // In-app navigation preserves the intentionally memory-only preview authoring.
 await page.evaluate(() => { history.pushState({}, '', '/client/programs'); window.dispatchEvent(new PopStateEvent('popstate')); });
 await page.getByRole('button', { name: 'Find a demo option' }).click();
 await dialog.getByLabel('Cable station').uncheck();
 await dialog.getByRole('button', { name: /25-minute dumbbell strength · 25 minutes/ }).click();
 await expect(dialog.getByTestId('rescue-changes')).toContainText('Dropped');
 const completedBefore = (await callPreviewApi(page, 'get', '/workout-logs/mine')).data;
 await dialog.getByRole('button', { name: 'Use this demo option' }).click();
 expect((await callPreviewApi(page, 'get', '/workout-logs/mine')).data).toEqual(completedBefore);
 await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track/);
 await expect(page.getByText(/25-minute dumbbell strength/).first()).toBeVisible();
 const active = (await callPreviewApi(page, 'get', '/workout-logs/active')).data;
 expect(active.rescue_snapshot.branch_name).toBe('25-minute dumbbell strength');
 expect(active.exercises.map((row) => [row.exercise_name, row.sets.length])).toEqual([['Goblet Squat', 2], ['Romanian Deadlift', 2]]);
 expect(active.exercises[0].prescribed_reps).toBe('8-10');
 expect(active.exercises[0].prescribed_load_value).toBe(35);
 expect((await callPreviewApi(page, 'put', endpoint, plan.plan)).status).toBe(403);
 await page.screenshot({ path: `/tmp/workout-rescue-tracker-${viewport.name}.png` });
 expect(errors).toEqual([]);
});
}
test('fixture API masks unassigned clients and rejects stale originals/options, missing branches, incompatible contexts and active override', async ({ page }) => {
 await openClient(page);
 const { data } = await callPreviewApi(page, 'get', endpoint);
 const assignments = (await callPreviewApi(page, 'get', '/programs/client/assigned')).data;
 const assignment = assignments.programs.find((row) => row.program.id === 'program_foundation');
 const payload = { program_assignment_id: assignment.id, program_day_id: 'day_foundation_1', rescue: { branch_id: data.plan.branches[0].id, revision: data.plan.revision, version: data.plan.version, minutes: 25, equipment: ['dumbbells', 'cable'] } };
 for (const change of [{ revision: 0 }, { version: 'stale' }, { branch_id: 'missing' }, { equipment: ['dumbbells'] }]) {
  expect((await callPreviewApi(page, 'post', '/workout-logs/start', { ...payload, rescue: { ...payload.rescue, ...change } })).status).toBe(409);
  expect((await callPreviewApi(page, 'get', '/workout-logs/active')).data).toBeNull();
 }
 const first = await callPreviewApi(page, 'post', '/workout-logs/start', payload); expect(first.status).toBe(201);
 expect((await callPreviewApi(page, 'post', '/workout-logs/start', payload)).status).toBe(409);
 const active = (await callPreviewApi(page, 'get', '/workout-logs/active')).data;
 expect(active.id).toBe(first.data.workout_log.id);
 await page.evaluate(async () => { const p = await import('/src/lib/previewMode.js'); p.setPreviewClientId('client_riley'); });
 expect((await callPreviewApi(page, 'get', endpoint)).status).toBe(404);
 expect((await callPreviewApi(page, 'post', '/workout-logs/start', payload)).status).toBe(404);
});
test('changed original blocks old approvals and coach can deliberately start fresh; missing fallbacks remain visible', async ({ page }) => {
 await openCoach(page);
 const old = (await callPreviewApi(page, 'get', endpoint)).data;
 // Existing workout editor changes the actual original while retaining its program-day identity.
 const workout = (await callPreviewApi(page, 'get', '/programs/workouts/workout_lower_a')).data;
 const edited = await callPreviewApi(page, 'put', '/programs/workouts/workout_lower_a', { ...workout, goal: 'Updated lower-body intent' });
 expect(edited.status).toBe(200);
 expect((await callPreviewApi(page, 'get', endpoint)).data.stale).toBe(true);
 expect((await callPreviewApi(page, 'put', endpoint, old.plan)).status).toBe(409);
 const dialog = page.getByTestId('rescue-dialog'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
 await page.getByRole('button', { name: 'Define demo fallbacks' }).click();
 await expect(dialog).toContainText('The original program changed');
 await dialog.getByRole('button', { name: 'Start fresh from current original' }).click();
 await dialog.getByRole('button', { name: 'Save demo options' }).click();
 await expect(dialog).toContainText('Demo options saved');
 await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
 await switchRole(page, 'client'); await page.evaluate(() => { history.pushState({}, '', '/client/programs'); window.dispatchEvent(new PopStateEvent('popstate')); });
 await page.getByRole('button', { name: 'Find a demo option' }).click();
 await expect(dialog).toContainText('No coach-authored fallback fits');
});
test('coach failed reopen disables stale draft save and retry recovers', async ({ page }) => {
 await openCoach(page); const dialog = page.getByTestId('rescue-dialog');
 await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
 await page.evaluate(async () => { const p = await import('/src/lib/previewMode.js'); p.setPreviewFailMode('reads'); });
 await page.getByRole('button', { name: 'Define demo fallbacks' }).click();
 await expect(dialog.getByRole('button', { name: 'Retry loading options' })).toBeVisible();
 await expect(dialog.getByRole('button', { name: 'Save demo options' })).toBeDisabled();
 await expect(dialog.getByRole('button', { name: 'Reset unsaved changes' })).toBeDisabled();
 await page.evaluate(async () => { const p = await import('/src/lib/previewMode.js'); p.setPreviewFailMode('off'); });
 await dialog.getByRole('button', { name: 'Retry loading options' }).click();
 await expect(page.getByTestId('rescue-editor')).toBeVisible();
 await expect(dialog.getByRole('button', { name: 'Save demo options' })).toBeEnabled();
});
