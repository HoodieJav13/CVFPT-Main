import { test, expect, callPreviewApi } from './preview-test.mjs';
const SOURCE = '/coach/workouts/cue_log_source';
const ENDPOINT = '/workout-logs/cue_log_source/exercises/cue_attempt_source/cue-retry';
const CLIENT = 'client_cue_demo';
async function setup(page, role = 'coach', client = CLIENT) {
  await page.addInitScript(({ role, client }) => {
    if (!localStorage.getItem('cvf_preview_role')) localStorage.setItem('cvf_preview_role', role);
    if (!localStorage.getItem('cvf_preview_client_id')) localStorage.setItem('cvf_preview_client_id', client);
    localStorage.setItem('cvf_preview_cue_retry', '1');
  }, { role, client });
  await page.goto(role === 'client' ? '/client/workouts/cue_log_source' : SOURCE);
  await expect(page.getByTestId('cue-retry-panel')).toBeVisible();
}
async function switchRole(page, role, client = CLIENT) {
  await page.evaluate(async ({ role, client }) => {
    const preview = await import('/src/lib/previewMode.js');
    preview.setPreviewClientId(client); preview.setPreviewRole(role);
  }, { role, client });
}
async function create(page, text = 'Press the floor away.') {
  await page.getByRole('button', { name: 'Add cue for next attempt' }).click();
  await page.getByLabel('One actionable cue').fill(text);
  await page.getByRole('button', { name: 'Save cue', exact: true }).click();
  await expect(page.getByTestId('outgoing-cue')).toContainText(text);
  await expect(page.getByTestId('cue-retry-panel')).toContainText('Saved in this browser.');
}
async function start(page) {
  return callPreviewApi(page, 'post', '/workout-logs/start', { client_id: CLIENT, program_assignment_id: 'cue_assignment', program_day_id: 'cue_day' });
}

for (const width of [1440, 390, 320]) test(`cue → ordinary workout → coach recheck → reopen at ${width}px`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  await setup(page);
  const before = (await callPreviewApi(page, 'get', '/workout-logs/cue_log_source')).data;
  await create(page);
  await page.reload();
  await expect(page.getByTestId('outgoing-cue')).toContainText('Press the floor away.');
  await switchRole(page, 'client');
  await page.goto('/client/programs');
  // Uses the existing assigned-program/Start path rather than a cue-only tracker.
  await page.getByText('Cue retry · local demo', { exact: true }).click();
  await page.getByRole('button', { name: /Start workout/ }).click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track/);
  const logId = new URL(page.url()).pathname.split('/')[3];
  await expect(page.getByTestId('incoming-cue')).toContainText('Press the floor away.');
  await expect(page.getByRole('button', { name: 'Save recheck' })).toHaveCount(0);
  await expect(page.getByText('Slow lower, tall chest.', { exact: true })).toBeVisible();
  const active = (await callPreviewApi(page, 'get', `/workout-logs/${logId}`)).data;
  const setId = active.exercises[0].sets[0].id;
  expect((await callPreviewApi(page, 'patch', `/workout-logs/${logId}/sets/${setId}`, { status: 'completed', actual_reps: 8 })).status).toBe(200);
  expect((await callPreviewApi(page, 'post', `/workout-logs/${logId}/complete`, {})).status).toBe(200);
  await switchRole(page, 'coach');
  await page.goto(`/coach/workouts/${logId}`);
  await page.getByLabel('Did this cue help?').selectOption('fixed');
  await page.getByRole('button', { name: 'Save recheck' }).click();
  await expect(page.getByTestId('incoming-cue')).toContainText('Coach recheck: Fixed');
  await page.reload();
  await expect(page.getByTestId('incoming-cue')).toContainText('Coach recheck: Fixed');
  // Closing the document and opening a new tab must retain attempts and verdict.
  const reopened = await context.newPage(); await reopened.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.close();
  await reopened.goto(SOURCE);
  await expect(reopened.getByTestId('outgoing-cue')).toContainText('Linked to retry · Fixed');
  const after = (await callPreviewApi(reopened, 'get', '/workout-logs/cue_log_source')).data;
  expect(after.exercises).toEqual(before.exercises);
  expect(after.status).toBe('completed'); expect(after.completed_at).toBe(before.completed_at);
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await reopened.screenshot({ path: testInfo.outputPath(`cue-lifecycle-${width}.png`), fullPage: true });
});

test('draft discard, edit, cancellation and failed save keep explicit semantics', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Add cue for next attempt' }).click();
  await page.getByLabel('One actionable cue').fill('Discard this');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  expect((await callPreviewApi(page, 'get', ENDPOINT)).data.outgoing).toHaveLength(0);
  await page.getByRole('button', { name: 'Add cue for next attempt' }).click();
  await page.getByLabel('One actionable cue').fill('Initial cue');
  await page.evaluate(async () => (await import('/src/lib/previewMode.js')).setPreviewFailMode('write-once'));
  await page.getByRole('button', { name: 'Save cue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Simulated failure');
  expect((await callPreviewApi(page, 'get', ENDPOINT)).data.outgoing).toHaveLength(0);
  await page.getByRole('button', { name: 'Save cue', exact: true }).click();
  await expect(page.getByTestId('outgoing-cue')).toContainText('Initial cue');
  await page.getByRole('button', { name: 'Edit cue', exact: true }).click();
  await page.getByLabel('One actionable cue').fill('Changed cue');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByTestId('outgoing-cue')).toContainText('Initial cue');
  await page.getByRole('button', { name: 'Edit cue', exact: true }).click();
  await page.getByLabel('One actionable cue').fill('Changed cue');
  await page.getByRole('button', { name: 'Save cue', exact: true }).click();
  await expect(page.getByTestId('outgoing-cue')).toContainText('Changed cue');
  await page.getByRole('button', { name: 'Cancel cue', exact: true }).click();
  await expect(page.getByTestId('cancelled-cue')).toContainText('Changed cue');
  await page.reload(); await expect(page.getByTestId('cancelled-cue')).toContainText('Changed cue');
  await switchRole(page, 'client');
  const retry = await start(page); expect(retry.status).toBe(201);
  const ex = retry.data.workout_log.exercises[0];
  expect((await callPreviewApi(page, 'get', `/workout-logs/${retry.data.workout_log.id}/exercises/${ex.id}/cue-retry`)).data.incoming).toHaveLength(0);
});

test('API masks unauthorized and missing attempts, fences repeats and linked edits', async ({ page }) => {
  await setup(page); const ctx = (await callPreviewApi(page, 'get', ENDPOINT)).data;
  const body = { action: 'create', text: 'Controlled lower.', source_version: ctx.source_version, request_id: 'test-repeat' };
  const first = await callPreviewApi(page, 'post', ENDPOINT, body);
  expect(first.status).toBe(200);
  expect((await callPreviewApi(page, 'post', ENDPOINT, body)).data).toEqual(first.data);
  expect((await callPreviewApi(page, 'post', ENDPOINT, { ...body, text: 'Different' })).status).toBe(409);
  expect((await callPreviewApi(page, 'get', ENDPOINT.replace('cue_attempt_source', 'missing'))).status).toBe(404);
  await switchRole(page, 'client');
  expect((await callPreviewApi(page, 'get', ENDPOINT)).status).toBe(200);
  expect((await callPreviewApi(page, 'post', ENDPOINT, { ...body, request_id: 'forbidden' })).status).toBe(403);
  await switchRole(page, 'client', 'client_sarah');
  expect((await callPreviewApi(page, 'get', ENDPOINT)).status).toBe(404);
  await switchRole(page, 'coach');
  const retry = await start(page);
  expect(retry.status).toBe(201);
  const row = (await callPreviewApi(page, 'get', ENDPOINT)).data.outgoing[0];
  expect((await callPreviewApi(page, 'post', ENDPOINT, { action: 'edit', cue_id: row.id, revision: row.revision, text: 'Too late', source_version: ctx.source_version, request_id: 'late' })).status).toBe(409);
  const retryEndpoint = `/workout-logs/${row.retry_log_id}/exercises/${row.retry_exercise_id}/cue-retry`;
  expect((await callPreviewApi(page, 'post', retryEndpoint, { action: 'verdict', cue_id: row.id, revision: row.revision, verdict: 'fixed', request_id: 'early' })).status).toBe(409);
  expect((await callPreviewApi(page, 'patch', '/workout-logs/cue_log_source/sets/cue_set_source', { status: 'pending' })).status).toBe(404);
  expect((await callPreviewApi(page, 'patch', '/workout-logs/cue_log_source/exercises/cue_attempt_source/notes', { client_notes: 'Overwrite' })).status).toBe(404);
});

test('source edits invalidate a saved cue and stale editor submissions', async ({ page }) => {
  await setup(page); await create(page);
  const original = (await callPreviewApi(page, 'get', '/workout-logs/cue_log_source')).data;
  const ctx = (await callPreviewApi(page, 'get', ENDPOINT)).data;
  const workouts = (await callPreviewApi(page, 'get', '/programs/workouts/cue_workout')).data;
  expect(workouts.exercises.length).toBe(1);
  const update = await callPreviewApi(page, 'put', '/programs/workouts/cue_workout', { ...workouts, goal: 'Changed local intent', exercises: workouts.exercises });
  expect(update.status).toBe(200);
  expect((await callPreviewApi(page, 'post', ENDPOINT, { action: 'edit', cue_id: ctx.outgoing[0].id, revision: ctx.outgoing[0].revision, text: 'Stale', source_version: ctx.source_version, request_id: 'stale-edit' })).status).toBe(409);
  await page.reload();
  await expect(page.getByTestId('outgoing-cue')).toContainText('Program or assignment changed');
  const next = await start(page); expect(next.status).toBe(201);
  const log = next.data.workout_log;
  expect((await callPreviewApi(page, 'get', `/workout-logs/${log.id}/exercises/${log.exercises[0].id}/cue-retry`)).data.incoming).toHaveLength(0);
  expect((await callPreviewApi(page, 'get', '/workout-logs/cue_log_source')).data.exercises).toEqual(original.exercises);
});

test('IndexedDB commit failure rolls back cue and attempt writes, no false saved state', async ({ page }) => {
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await setup(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; window.__cueOriginalPut = put; IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic quota full', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Add cue for next attempt' }).click();
  await page.getByLabel('One actionable cue').fill('Must not save');
  await page.getByRole('button', { name: 'Save cue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save local training');
  expect((await callPreviewApi(page, 'get', ENDPOINT)).data.outgoing).toHaveLength(0);
  expect((await start(page)).status).toBe(503);
  expect((await callPreviewApi(page, 'get', '/workout-logs/active')).data).toBeNull();
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__cueOriginalPut; });
  await page.getByRole('button', { name: 'Save cue', exact: true }).click();
  await expect(page.getByTestId('outgoing-cue')).toContainText('Must not save');
  expect(pageErrors).toEqual([]);
});

test('two local tabs serialize durable revisions and reject a stale same-cue edit', async ({ page, context }) => {
  await setup(page); await create(page);
  const old = (await callPreviewApi(page, 'get', ENDPOINT)).data;
  const second = await context.newPage(); await second.goto(SOURCE); await expect(second.getByTestId('outgoing-cue')).toBeVisible();
  const row = old.outgoing[0];
  const edit = (request_id, text) => ({ action: 'edit', cue_id: row.id, revision: row.revision, source_version: old.source_version, text, request_id });
  const responses = await Promise.all([callPreviewApi(page, 'post', ENDPOINT, edit('tab-a', 'First tab')), callPreviewApi(second, 'post', ENDPOINT, edit('tab-b', 'Second tab'))]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  await page.reload();
  const saved = (await callPreviewApi(page, 'get', ENDPOINT)).data.outgoing[0];
  expect(['First tab', 'Second tab']).toContain(saved.text);
  expect(saved.revision).toBe(row.revision + 1);
});

test('unavailable IndexedDB blocks local saves and recovers after reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('cue_storage_recovered')) indexedDB.open = () => { throw new Error('Synthetic unavailable storage'); };
  });
  await setup(page);
  await expect(page.getByRole('alert')).toContainText('Local cue storage is unavailable');
  expect((await start(page)).status).toBe(503);
  expect((await callPreviewApi(page, 'get', '/workout-logs/active')).data).toBeNull();
  await page.evaluate(() => localStorage.setItem('cue_storage_recovered', '1'));
  await page.reload(); await create(page, 'Storage recovered cue');
  await page.reload(); await expect(page.getByTestId('outgoing-cue')).toContainText('Storage recovered cue');
});

test('durable cue and completed retry survive an actual browser process restart', async ({ playwright }, testInfo) => {
  test.setTimeout(60000);
  const profile = testInfo.outputPath('owned-fictional-browser-profile');
  const options = { headless: true, serviceWorkers: 'block', baseURL: testInfo.project.use.baseURL };
  let browserContext = await playwright.chromium.launchPersistentContext(profile, options);
  try {
    const page = await browserContext.newPage();
    await setup(page); await create(page, 'Durable process restart cue');
    const retry = await start(page); expect(retry.status).toBe(201);
    const log = retry.data.workout_log;
    await switchRole(page, 'client');
    expect((await callPreviewApi(page, 'patch', `/workout-logs/${log.id}/sets/${log.exercises[0].sets[0].id}`, { status: 'completed', actual_reps: 8 })).status).toBe(200);
    expect((await callPreviewApi(page, 'post', `/workout-logs/${log.id}/complete`, {})).status).toBe(200);
    await switchRole(page, 'coach');
    await page.goto(`/coach/workouts/${log.id}`);
    await page.getByLabel('Did this cue help?').selectOption('partial');
    await page.getByRole('button', { name: 'Save recheck' }).click();
    await expect(page.getByTestId('incoming-cue')).toContainText('Coach recheck: Partly helped');
    await browserContext.close();
    browserContext = await playwright.chromium.launchPersistentContext(profile, options);
    const reopened = await browserContext.newPage();
    await reopened.goto(SOURCE);
    await expect(reopened.getByTestId('outgoing-cue')).toContainText('Linked to retry · Partly helped');
    expect((await callPreviewApi(reopened, 'get', `/workout-logs/${log.id}`)).data.status).toBe('completed');
  } finally { await browserContext.close(); }
});

const endpoint = '/workout-logs/cue_log_source/exercises/cue_attempt_source/cue-retry';
test('opening an editor uses the latest saved cue rather than overwriting another tab with old text', async ({ page, context }) => {
 await page.addInitScript(() => { localStorage.setItem('cvf_preview_role','coach'); localStorage.setItem('cvf_preview_client_id','client_cue_demo'); localStorage.setItem('cvf_preview_cue_retry','1'); });
 await page.goto('/coach/workouts/cue_log_source');
 await page.getByRole('button',{name:'Add cue for next attempt'}).click();
 await page.getByLabel('One actionable cue').fill('Original text'); await page.getByRole('button',{name:'Save cue',exact:true}).click();
 await expect(page.getByTestId('outgoing-cue')).toContainText('Original text');
 const other = await context.newPage(); await other.goto('/coach/workouts/cue_log_source');
 await expect(other.getByTestId('outgoing-cue')).toBeVisible();
 const ctx = (await callPreviewApi(other,'get',endpoint)).data;
 const row = ctx.outgoing[0];
 expect((await callPreviewApi(other,'post',endpoint,{action:'edit',cue_id:row.id,revision:row.revision,source_version:ctx.source_version,text:'Changed in another tab',request_id:'external-edit'})).status).toBe(200);
 await page.getByRole('button',{name:'Edit cue',exact:true}).click();
 await expect(page.getByLabel('One actionable cue')).toHaveValue('Changed in another tab');
});
