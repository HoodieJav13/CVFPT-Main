/* eslint import/no-unresolved: ["error", { "ignore": ["^/src/"] }] -- Browser imports are served by Vite and exercised below. */
import { randomUUID } from 'node:crypto';
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

// Whole-week UI in preview mode. Preview proves UI behavior only; real
// authorization, persistence and races are covered by the backend and SQL suites.
// Denver browser clock so fixture "today" and the Denver week agree.
test.use({ timezoneId: 'America/Denver' });

const LOSE_KEY = 'cvf_preview_whole_week_lose_next_response';
const CAPABILITY_KEY = 'cvf_preview_whole_week_capability';
const setSwitch = (page, key, value) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
const rows = (page) => page.getByTestId('outside-activity-row');
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const weekOf = async (page, path = '/whole-week/mine') => (await callPreviewApi(page, 'get', path)).data;

async function logRun(page, minutes = '') {
  await page.getByTestId('outside-activity-add').click();
  const form = page.getByTestId('outside-activity-form');
  await form.getByRole('radio', { name: 'Run' }).click();
  if (minutes) await form.getByTestId('outside-activity-minutes').fill(minutes);
  await form.getByTestId('outside-activity-save').click();
}

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`client ${viewport.name}: Home entry, default-off week, compact context; Start/Resume and manual check-in unchanged`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await usePreviewRole(page, 'client', 'client_sarah');
    await page.goto('/client');
    const primary = page.getByTestId('client-today-primary-action');
    await expect(primary).toBeVisible();
    const primaryText = await primary.innerText();
    await expect(page.getByTestId('daily-check-in-card')).toBeVisible();
    await page.getByTestId('client-whole-week-entry').click();
    await expect(page).toHaveURL(/\/client\/week\?week=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId('outside-activity-collection')).toHaveText('Outside-activity logging is off unless your coach turns it on.');
    await expect(page.getByTestId('outside-activity-add')).toHaveCount(0);
    await expect(page.getByTestId('outside-activity-total')).toHaveText('No outside activities logged this week.');
    await expect(page.getByTestId('whole-week-visibility')).toContainText('Shared with Marcus Rivera (assigned coach) and CVF admins.');
    await expect(page.getByTestId('whole-week-pt-count')).toContainText(/PT workouts? completed/);
    await expect(page.getByTestId('week-check-ins-summary')).toContainText('of 7 days checked in');
    await expect(page.getByTestId('week-check-in-prompt-hidden')).toBeVisible();
    await expect(page.getByTestId('week-context-goals')).toContainText('Body Weight');
    await expect(page.getByTestId('whole-week-next')).toBeDisabled();
    await expect(page.getByTestId('whole-week-day')).toHaveCount(7);
    await expect(page.getByTestId('whole-week')).not.toContainText(/\brest day\b|\bready\b|readiness|risk|workload/i);
    expect(await noOverflow(page)).toBeTruthy();
    await page.screenshot({ path: `/tmp/whole-week-client-${viewport.name}.png`, fullPage: true });
    await page.getByTestId('whole-week-today-link').click();
    await expect(page.getByTestId('client-today-primary-action')).toHaveText(primaryText);
    await expect(page.getByTestId('client-today-primary-action')).toBeEnabled();
    await expect(page.getByTestId('open-check-in-button')).toBeVisible();
  });
}

test('explicit week selection: previous week is kept in the URL and Next returns', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('outside-activity-total')).toBeVisible();
  const current = new URL(page.url()).searchParams.get('week');
  await page.getByTestId('whole-week-previous').click();
  await expect(page).not.toHaveURL(new RegExp(`week=${current}$`));
  await expect(rows(page).filter({ hasText: 'Extra training' })).toHaveCount(1);
  await page.reload();
  await expect(rows(page).filter({ hasText: 'Extra training' })).toHaveCount(1);
  await page.getByTestId('whole-week-next').click();
  await expect(page).toHaveURL(new RegExp(`week=${current}$`));
});

test('collection on: partial totals name unknown durations; blank minutes stay unknown; attribution is visible', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await expect(page.getByTestId('outside-activity-total')).toHaveText('Logged 1 h 30 min across 3 activities; 1 has unknown duration.');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('outside-activity-attribution').filter({ hasText: 'Logged by Marcus Rivera (coach)' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'Hike' })).toContainText('Duration unknown');
  await logRun(page);
  await expect(page.getByTestId('whole-week-notice')).toHaveText('Activity saved.');
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId('outside-activity-total')).toHaveText('Logged 1 h 30 min across 4 activities; 2 have unknown duration.');
  const created = (await weekOf(page)).activities.find((row) => row.activity_type === 'run' && row.duration_seconds === null);
  expect(created).toMatchObject({ duration_seconds: null, effort_rpe: null, created_by_role: 'client' });
});

test('validation stays in the form: future date and out-of-range effort are refused before sending', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await page.getByTestId('outside-activity-add').click();
  const form = page.getByTestId('outside-activity-form');
  await form.getByRole('radio', { name: 'Game' }).click();
  await form.getByTestId('outside-activity-effort').fill('11');
  await form.getByTestId('outside-activity-save').click();
  await expect(form.getByTestId('outside-activity-form-error')).toContainText('Effort must be 1 to 10');
  await form.getByTestId('outside-activity-effort').fill('');
  const tomorrow = await page.evaluate(async () => {
    const lib = await import('/src/lib/outsideActivities.js');
    return lib.addDays(lib.denverToday(), 1);
  });
  await form.getByTestId('outside-activity-date').fill(tomorrow);
  await form.getByTestId('outside-activity-save').click();
  await expect(form.getByTestId('outside-activity-form-error')).toContainText('cannot be in the future');
  expect((await weekOf(page)).activities).toHaveLength(3);
});

test('lost response after commit: "Saved status unknown", Retry replays the same save once', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await expect(rows(page)).toHaveCount(3);
  await setSwitch(page, LOSE_KEY, '1');
  await logRun(page, '25');
  const pending = page.getByTestId('outside-activity-pending');
  await expect(pending).toContainText('Saved status unknown');
  await expect(page.getByTestId('outside-activity-add')).toBeDisabled();
  await expect(page.getByTestId('outside-activity-edit').first()).toBeDisabled();
  await page.getByTestId('outside-activity-retry').click();
  await expect(page.getByTestId('whole-week-notice')).toHaveText('This save had already finished. Nothing was added twice.');
  await expect(pending).toHaveCount(0);
  await expect(rows(page)).toHaveCount(4);
  expect((await weekOf(page)).activities.filter((row) => row.duration_seconds === 1500)).toHaveLength(1);
});

test('reload loses the private draft and warns; no operation is automatically resent', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await setSwitch(page, LOSE_KEY, '1');
  await logRun(page, '40');
  await expect(page.getByTestId('outside-activity-pending')).toBeVisible();
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('cvf_outside_activity_')));
  expect(stored).toHaveLength(1);
  expect(stored[0][0]).toContain('interrupted:v1:preview:');
  expect(stored[0][1]).toBe('1');
  await page.reload();
  await expect(page.getByTestId('outside-activity-interrupted')).toContainText('private draft stayed in memory');
  await expect(page.getByTestId('outside-activity-pending')).toHaveCount(0);
  await expect(page.getByTestId('outside-activity-add')).toBeDisabled();
  await expect(rows(page)).toHaveCount(3); // memory-only preview fixtures reset, with no resend
  await page.getByTestId('outside-activity-interrupted-checked').click();
  await expect(page.getByTestId('outside-activity-add')).toBeEnabled();
  expect((await weekOf(page)).activities.filter((row) => row.duration_seconds === 2400)).toHaveLength(0);
});

test('older backend: missing capability blocks the save before anything is sent', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await setSwitch(page, CAPABILITY_KEY, 'missing');
  await logRun(page, '30');
  await expect(page.getByTestId('outside-activity-form-error')).toHaveText('This server cannot save outside activities yet. Nothing was sent.');
  await expect(page.getByTestId('outside-activity-pending')).toHaveCount(0);
  await setSwitch(page, CAPABILITY_KEY, 'present');
  expect((await weekOf(page)).activities).toHaveLength(3);
});

test('stale correction: conflict is shown, nothing is overwritten, reload installs the latest version', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  const run = (await weekOf(page)).activities.find((row) => row.activity_type === 'run');
  await rows(page).filter({ hasText: 'Run' }).getByTestId('outside-activity-edit').click();
  // Another device corrects the same row first.
  const other = await callPreviewApi(page, 'patch', `/outside-activities/${run.id}`, {
    request_id: randomUUID(), revision: run.revision, activity_type: 'run', occurred_on: run.occurred_on,
    label: 'Other device', duration_seconds: 2100, effort_rpe: 6, note: null,
  });
  expect(other.status).toBe(200);
  await page.getByTestId('outside-activity-minutes').fill('50');
  await page.getByTestId('outside-activity-save').click();
  await expect(page.getByTestId('outside-activity-conflict')).toContainText('changed elsewhere');
  const unchanged = (await weekOf(page)).activities.find((row) => row.id === run.id);
  expect(unchanged).toMatchObject({ duration_seconds: 2100, label: 'Other device', revision: run.revision + 1 });
  await page.getByTestId('outside-activity-conflict-reload').click();
  await expect(page.getByTestId('outside-activity-minutes')).toHaveValue('35');
  await expect(page.getByTestId('outside-activity-label')).toHaveValue('Other device');
});

test('replay contract: same request id replays once; changed body conflicts', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  const { today } = await weekOf(page);
  const body = { request_id: randomUUID(), revision: 0, activity_type: 'hike', occurred_on: today, duration_seconds: null, effort_rpe: null };
  const first = await callPreviewApi(page, 'post', '/outside-activities/mine', body);
  expect(first.status).toBe(201);
  const replay = await callPreviewApi(page, 'post', '/outside-activities/mine', body);
  expect(replay).toMatchObject({ status: 200, data: { replayed: true, committed_revision: 1 } });
  expect(replay.data.resource.id).toBe(first.data.resource.id);
  const changed = await callPreviewApi(page, 'post', '/outside-activities/mine', { ...body, duration_seconds: 600 });
  expect(changed).toMatchObject({ status: 409, data: { code: 'request_mismatch' } });
  expect((await weekOf(page)).activities.filter((row) => row.id === first.data.resource.id)).toHaveLength(1);
});

test('client check-in reminder opens the existing manual check-in; client opt-out stops new entries', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await page.getByTestId('week-check-in-prompt').click();
  await page.getByTestId('check-in-energy').getByRole('radio', { name: '3 of 5' }).click();
  await page.getByTestId('check-in-save-button').click();
  await expect(page.getByTestId('whole-week-notice')).toHaveText('Check-in saved.');
  await expect(page.getByTestId('week-check-in-prompt')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const toolbarToggle = page.getByTestId('preview-toolbar-toggle');
  if (await toolbarToggle.isVisible() && await toolbarToggle.getAttribute('aria-expanded') === 'true') await toolbarToggle.click();
  await page.getByTestId('whole-week-settings-toggle').scrollIntoViewIfNeeded();
  await page.getByTestId('whole-week-settings-toggle').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.getByTestId('whole-week-settings-toggle').click({ position: { x: 12, y: 22 } });
  await page.getByTestId('pref-activity-share').press('Space');
  await expect(page.getByTestId('whole-week-notice')).toHaveText('Sharing setting saved.');
  await expect(page.getByTestId('outside-activity-collection')).toHaveText('You turned off outside-activity logging. Earlier entries stay visible to your coach.');
  await expect(page.getByTestId('outside-activity-add')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);
  // Coach bits cannot be changed by the client.
  expect((await callPreviewApi(page, 'patch', '/context-preferences/mine', { revision: 2, activity_coach_enabled: true })).status).toBe(403);
});

test('coach: ClientDetail entry, on-behalf logging, default-off client and read failure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await usePreviewRole(page, 'coach');
  await page.goto('/coach/clients/client_david');
  await page.getByTestId('coach-whole-week-entry').click();
  await expect(page).toHaveURL(/\/coach\/clients\/client_david\/week\?week=/);
  await expect(page.getByTestId('whole-week-visibility')).toContainText('Visible to the client, Marcus Rivera (assigned coach) and CVF admins.');
  await logRun(page, '20');
  await expect(page.getByTestId('whole-week-notice')).toHaveText('Activity saved.');
  await expect(page.getByTestId('outside-activity-attribution').filter({ hasText: 'Logged by Marcus Rivera (coach)' })).toHaveCount(2);
  await page.screenshot({ path: '/tmp/whole-week-coach-desktop.png', fullPage: true });

  // Default off (Sarah has no preference row) until the coach turns it on.
  await page.goto('/coach/clients/client_sarah/week');
  await expect(page.getByTestId('outside-activity-collection')).toContainText('off by default');
  const { today } = await weekOf(page, '/whole-week/clients/client_sarah');
  const early = await callPreviewApi(page, 'post', '/outside-activities/clients/client_sarah', { request_id: randomUUID(), revision: 0, activity_type: 'run', occurred_on: today });
  expect(early).toMatchObject({ status: 409, data: { code: 'collection_off' } });
  await page.getByTestId('whole-week-settings-toggle').click({ position: { x: 12, y: 22 } });
  await page.getByTestId('pref-activity-enable').click();
  await expect(page.getByTestId('outside-activity-add')).toBeVisible();
  // Coaches cannot change the client's own choice.
  expect((await callPreviewApi(page, 'patch', '/context-preferences/clients/client_sarah', { revision: 1, activity_client_off: true })).status).toBe(403);

  // A failed read is an error state, never an empty week.
  await page.evaluate(async () => { const preview = await import('/src/lib/previewMode.js'); preview.setPreviewFailMode('reads'); });
  await page.reload();
  await expect(page.getByTestId('whole-week-unavailable')).toContainText('This week couldn’t load.');
  await expect(page.getByTestId('outside-activity-total')).toHaveCount(0);
  await page.evaluate(async () => { const preview = await import('/src/lib/previewMode.js'); preview.setPreviewFailMode('off'); });
  await page.getByTestId('whole-week-retry').click();
  await expect(page.getByTestId('outside-activity-total')).toBeVisible();
});

test('admin: opted-out client keeps shared history visible; nobody can add new entries', async ({ page }) => {
  await usePreviewRole(page, 'admin');
  await page.goto('/coach/clients/client_emily/week');
  await expect(page.getByTestId('whole-week-visibility')).toContainText('Jordan Banks (assigned coach)');
  await expect(page.getByTestId('outside-activity-collection')).toHaveText('The client turned off outside-activity logging. Earlier shared entries stay visible; nobody can add new ones.');
  await expect(page.getByTestId('outside-activity-add')).toHaveCount(0);
  await page.getByTestId('whole-week-previous').click();
  await expect(rows(page).filter({ hasText: 'Volleyball' })).toHaveCount(1);
  const { today } = await weekOf(page, '/whole-week/clients/client_emily');
  const refused = await callPreviewApi(page, 'post', '/outside-activities/clients/client_emily', { request_id: randomUUID(), revision: 0, activity_type: 'run', occurred_on: today });
  expect(refused).toMatchObject({ status: 409, data: { code: 'collection_off' } });
  expect((await callPreviewApi(page, 'patch', '/context-preferences/clients/client_emily', { revision: 2, activity_client_off: false })).status).toBe(403);
});

async function seedManyActivities(page) {
  return page.evaluate(async()=>{
    const {api}=await import('/src/lib/api.js');
    const {data:week}=await api.get('/whole-week/mine');
    for(let i=0;i<205;i++) await api.post('/outside-activities/mine',{request_id:crypto.randomUUID(),revision:0,activity_type:'other',occurred_on:week.today,label:`Paging ${i}`,duration_seconds:null,effort_rpe:null,note:null});
    return week.today;
  });
}

test('more than200 same-date activities page without duplicate IDs and a later row can be corrected',async({page})=>{
 await usePreviewRole(page,'client','client_david');await page.goto('/client/week');await expect(page.getByTestId('outside-activity-add')).toBeVisible();
 await seedManyActivities(page);await page.getByTestId('outside-activity-refresh').click();
 await expect(rows(page)).toHaveCount(100);
 await page.getByTestId('outside-activity-load-more').click({position:{x:12,y:22}});await expect(rows(page)).toHaveCount(200);
 await page.getByTestId('outside-activity-load-more').click({position:{x:12,y:22}});await expect(rows(page)).toHaveCount(208);
 await expect(page.getByTestId('outside-activity-load-more')).toHaveCount(0);
 const all=rows(page);const later=all.nth(201);await later.getByTestId('outside-activity-edit').click();await page.getByTestId('outside-activity-label').fill('Later page corrected');await page.getByTestId('outside-activity-save').click();
 await expect(page.getByTestId('whole-week-notice')).toHaveText('Correction saved.');await expect(rows(page)).toHaveCount(100);
 let response=await weekOf(page);let found=response.activities.some(row=>row.label==='Later page corrected');let ids=response.activities.map(row=>row.id);
 while(response.next_cursor){response=(await callPreviewApi(page,'get','/whole-week/mine?cursor='+encodeURIComponent(JSON.stringify(response.next_cursor)))).data;found ||= response.activities.some(row=>row.label==='Later page corrected');ids.push(...response.activities.map(row=>row.id));}
 expect(found).toBeTruthy();expect(ids).toHaveLength(208);expect(new Set(ids).size).toBe(208);
});

test('a delayed page cannot append to another week, and an authorization failure clears the displayed ledger',async({page})=>{
 await usePreviewRole(page,'client','client_david');await page.goto('/client/week');await expect(page.getByTestId('outside-activity-add')).toBeVisible();await seedManyActivities(page);await page.getByTestId('outside-activity-refresh').click();await expect(rows(page)).toHaveCount(100);
 await page.evaluate(async()=>{const {api}=await import('/src/lib/api.js');const original=api.defaults.adapter;api.defaults.adapter=async(config)=>{const reply=await original(config);if(config.url==='/whole-week/mine'&&config.params?.cursor)await new Promise(resolve=>setTimeout(resolve,800));return reply;};});
 await page.getByTestId('outside-activity-load-more').click({position:{x:12,y:22}});await page.getByTestId('whole-week-previous').click();await expect(rows(page)).toHaveCount(1);await page.waitForTimeout(1000);await expect(rows(page)).toHaveCount(1);await expect(rows(page).first()).toContainText('Extra training');
 await page.getByTestId('whole-week-next').click();await expect(rows(page)).toHaveCount(100);
 await page.evaluate(async()=>{const {api}=await import('/src/lib/api.js');api.interceptors.request.use(config=>{if(config.url==='/whole-week/mine'&&config.params?.cursor)throw Object.assign(new Error('Synthetic current ownership refusal'),{response:{status:404,data:{error:'Client week not found'}}});return config;});});
 await page.getByTestId('outside-activity-load-more').click({position:{x:12,y:22}});await expect(page.getByTestId('whole-week-unavailable')).toContainText('This week isn’t available to you.');await expect(rows(page)).toHaveCount(0);
});

for (const status of [403, 404]) test(`a definitive ${status} save denial purges private week context and controls`, async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('week-context')).toBeVisible();
  await page.evaluate(async (status) => {
    const { api } = await import('/src/lib/api.js');
    api.interceptors.request.use(config => {
      if (config.url === '/outside-activities/mine') throw Object.assign(new Error('Synthetic current ownership refusal'), { response: { status, data: { error: 'Access removed' } } });
      return config;
    });
  }, status);
  await logRun(page, '19');
  await expect(page.getByTestId('whole-week-unavailable')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('week-context')).toHaveCount(0);
  await expect(page.getByTestId('outside-activity-total')).toHaveCount(0);
  await expect(page.getByTestId('outside-activity-add')).toHaveCount(0);
  await expect(page.getByTestId('outside-activity-pending')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('cvf_outside_activity_')))).toHaveLength(0);
});

test('a late ambiguous activity save cannot resurrect private state after concurrent preference access denial', async ({ page }) => {
  await usePreviewRole(page, 'client', 'client_david');
  await page.goto('/client/week');
  await expect(rows(page)).toHaveCount(3);
  await page.evaluate(async () => {
    const { api } = await import('/src/lib/api.js');
    const original = api.defaults.adapter;
    window.denialRace = {};
    api.defaults.adapter = async config => {
      if (config.url === '/context-preferences/mine') {
        window.denialRace.preferenceStarted = true;
        await new Promise(resolve => { window.denialRace.releasePreference = resolve; });
        throw Object.assign(new Error('Access removed'), { response: { status: 403, data: {} } });
      }
      if (config.url === '/outside-activities/mine' && config.method === 'post') {
        window.denialRace.activityStarted = true;
        await new Promise(resolve => { window.denialRace.releaseActivity = resolve; });
        throw new Error('Late lost response');
      }
      return original(config);
    };
  });
  const toolbar = page.getByTestId('preview-toolbar-toggle');
  if (await toolbar.isVisible() && await toolbar.getAttribute('aria-expanded') === 'true') await toolbar.click();
  await page.getByTestId('whole-week-settings-toggle').click({ position: { x: 12, y: 22 } });
  await page.getByTestId('pref-activity-share').press('Space');
  await page.waitForFunction(() => window.denialRace.preferenceStarted);
  await logRun(page, '19');
  await page.waitForFunction(() => window.denialRace.activityStarted);
  await page.evaluate(() => window.denialRace.releasePreference());
  await expect(page.getByTestId('whole-week-unavailable')).toBeVisible();
  await page.evaluate(() => window.denialRace.releaseActivity());
  await page.waitForTimeout(100);
  await expect(page.getByTestId('outside-activity-pending')).toHaveCount(0);
  await expect(page.getByTestId('week-context')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('cvf_outside_activity_')))).toHaveLength(0);
});
