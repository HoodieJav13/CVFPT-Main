import { test, expect, usePreviewRole } from './preview-test.mjs';

const collectionRequests = new Map();
test.beforeEach(async ({ page }) => {
  const hits = [];
  collectionRequests.set(page, hits);
  page.on('request', (request) => { if (/posthog|sentry/i.test(request.url())) hits.push(request.url()); });
  await page.route(/https?:\/\/(?!127\.0\.0\.1:42732\/)/, (route) => route.abort());
  await usePreviewRole(page, 'coach');
  await page.addInitScript(() => {
    window.__coachEvents = [];
    window.addEventListener('cvfpt:analytics', (event) => window.__coachEvents.push(event.detail));
  });
});
test.afterEach(async ({ page }) => {
  expect(collectionRequests.get(page)).toEqual([]);
  collectionRequests.delete(page);
});
const events = (page) => page.evaluate(() => window.__coachEvents);
const saves = async (page) => (await events(page)).filter((event) => event.event === 'cvfpt_coach_session_save').map((event) => event.properties);
async function spaGo(page, path) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
async function newSession(page, { repeat = false, attach = false } = {}) {
  await page.goto('/coach/sessions');
  await page.getByTestId('session-create-button').click();
  await page.getByTestId('session-client-select').click();
  await page.getByRole('option', { name: /David/ }).click();
  await page.getByTestId('session-datetime-input').click();
  const date = await page.evaluate(() => {
    const date = new Date(); date.setDate(date.getDate() + 7);
    return { key: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`, next: date.getMonth() !== new Date().getMonth() };
  });
  const calendar = page.getByTestId('session-datetime-input-panel');
  if (date.next) await calendar.getByRole('button', { name: /next/i }).click();
  await calendar.locator(`[data-day="${date.key}"]`).getByRole('button').click();
  await page.getByTestId('time-slot').filter({ hasText: /^10:00 AM$/ }).click();
  await page.getByTestId('session-location-input').fill('PRIVATE health note private@example.invalid secret');
  if (repeat) {
    await page.getByTestId('session-repeat-toggle').click();
    await page.getByTestId('series-count-input').fill('3');
    await page.getByTestId('series-notify-checkbox').click();
    await page.getByTestId('series-preview-button').click();
    await expect(page.getByTestId('series-create-button')).toBeEnabled();
  } else if (attach) {
    await page.getByTestId('session-workout-select').click();
    await page.getByRole('option', { name: 'Lower Strength A', exact: true }).click();
  }
}
async function faultNextSessionSave(page, status) {
  await page.evaluate(async (status) => {
    const { api } = await import('/src/lib/api.js');
    const original = api.defaults.adapter;
    api.defaults.adapter = (config) => {
      if (config.method === 'post' && config.url === '/sessions') {
        api.defaults.adapter = original;
        return Promise.reject({ config, message: 'PRIVATE health secret', response: {
          status, data: status === 409 ? { conflict: { scope: 'coach', session: {} } } : { error: 'Synthetic API failure' },
        } });
      }
      return original(config);
    };
  }, status);
}

test('coarse coach navigation is deduplicated and client/error payloads contain no identity', async ({ page }) => {
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  await page.getByTestId('sidebar-nav-clients').click();
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await spaGo(page, '/coach/clients/client_sarah?private=SECRET#private');
  await expect(page.getByTestId('client-detail-tabs')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE client_sarah private@example.invalid health notes', error: new Error('PRIVATE') })));
  await expect.poll(async () => (await events(page)).filter((event) => event.event === '$exception').length).toBe(1);
  const output = await events(page);
  expect(output.filter((event) => event.event === 'cvfpt_coach_screen_viewed').map((event) => event.properties.screen)).toEqual(['home', 'clients', 'client_detail']);
  expect(JSON.stringify(output)).not.toMatch(/PRIVATE|client_sarah|SECRET|example|health|notes|\/coach/);
  await page.getByTestId('preview-role-select').selectOption('client');
  await expect(page).toHaveURL(/\/client$/);
  const count = (await events(page)).length;
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE client' })));
  expect((await events(page)).length).toBe(count);
});

test('single create attaches a workout and edit removes it only after successful saves', async ({ page }) => {
  await newSession(page, { attach: true });
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toHaveCount(0);
  expect(await saves(page)).toMatchObject([{ operation: 'create', outcome: 'success', workout_change: 'attached', failure_kind: 'none' }]);
  const id = await page.evaluate(async () => {
    const { api } = await import('/src/lib/api.js');
    const { data } = await api.get('/sessions');
    return data.find((session) => session.location === 'PRIVATE health note private@example.invalid secret').id;
  });
  await spaGo(page, `/coach/sessions/${id}`);
  await expect(page.getByTestId('session-detail-workout')).toBeVisible();
  await page.getByTestId('session-detail-edit').click();
  await page.getByTestId('session-workout-select').click();
  await page.getByRole('option', { name: 'No workout attached', exact: true }).click();
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toHaveCount(0);
  await expect(page.getByTestId('session-detail-no-workout')).toBeVisible();
  expect(await saves(page)).toMatchObject([
    { operation: 'create', outcome: 'success', workout_change: 'attached' },
    { operation: 'update', outcome: 'success', workout_change: 'removed' },
  ]);
  expect(JSON.stringify(await events(page))).not.toMatch(/PRIVATE|example|health|secret|client_sarah|client_david|workout_lower|session_\w{8}/i);
});

test('admin coach-tree visits stay uncollected and returning to coach restores error listeners', async ({ page }) => {
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  await page.getByTestId('preview-role-select').selectOption('admin');
  await expect(page).toHaveURL(/\/admin$/);
  const count = (await events(page)).length;
  await spaGo(page, '/coach/sessions');
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE admin' })));
  expect((await events(page)).length).toBe(count);
  await page.getByTestId('preview-role-select').selectOption('coach');
  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE coach' })));
  await expect.poll(async () => (await events(page)).filter(event => event.event === '$exception').length).toBe(1);
  expect(JSON.stringify(await events(page))).not.toContain('PRIVATE');
});

test('conflicts are coarse failures; server faults are unconfirmed and retries still work', async ({ page }) => {
  await newSession(page, { attach: true });
  await faultNextSessionSave(page, 409);
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-conflict-panel')).toBeVisible();
  expect((await events(page)).filter((event) => event.event === '$exception')).toHaveLength(0);
  await faultNextSessionSave(page, 503);
  await page.getByTestId('session-save-button').click();
  await expect(page.getByText('Synthetic API failure')).toBeVisible();
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toHaveCount(0);
  expect(await saves(page)).toMatchObject([
    { outcome: 'failure', failure_kind: 'conflict', workout_change: 'attached' },
    { outcome: 'unconfirmed', failure_kind: 'server', workout_change: 'attached' },
    { outcome: 'success', failure_kind: 'none', workout_change: 'attached' },
  ]);
  const exception = (await events(page)).find((event) => event.event === '$exception');
  expect(exception.properties.$exception_fingerprint).toBe('cvfpt-v1-create-action-server');
  expect(JSON.stringify(exception)).not.toMatch(/PRIVATE|secret|health|example/);
});

test('recurring create emits one summary after synthetic failure and safe same-request retry', async ({ page }) => {
  await newSession(page, { repeat: true });
  await page.evaluate(() => localStorage.setItem('cvf_preview_fail', 'write-once'));
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await page.getByTestId('series-retry-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toHaveCount(0);
  expect(await saves(page)).toMatchObject([
    { operation: 'series_create', outcome: 'unconfirmed', failure_kind: 'server', workout_change: 'none' },
    { operation: 'series_create', outcome: 'success', failure_kind: 'none', workout_change: 'none' },
  ]);
});

test('a broken local analytics transport cannot stop scheduling or change the success UI', async ({ page }) => {
  await newSession(page);
  await page.evaluate(() => {
    const original = window.dispatchEvent.bind(window);
    window.dispatchEvent = (event) => { if (event.type === 'cvfpt:analytics') throw Error('Synthetic analytics outage'); return original(event); };
  });
  await page.getByTestId('session-save-button').click();
  await expect(page.getByTestId('session-editor-drawer')).toHaveCount(0);
  await expect(page.getByText('Session scheduled', { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { api } = await import('/src/lib/api.js');
    return (await api.get('/sessions')).data.some((session) => session.location === 'PRIVATE health note private@example.invalid secret');
  });
  expect(saved).toBe(true);
});
