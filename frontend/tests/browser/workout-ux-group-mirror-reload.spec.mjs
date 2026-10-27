// Station-session mirror across a REAL page reload (follow-up to the PR121
// transient-recovery repair), real UI in normal mode against the committed
// synthetic in-process API (fictional; synthetic token; controlled aborts):
//  1. An equipment amendment made while the account update gets no answer
//     survives a reload and reaches the account (never treated as another
//     device's change).
//  2. A stored session without mirror bookkeeping (as written by an earlier
//     version) that differs from the account copy: both are kept across
//     reloads and nothing is sent until the coach chooses.
//  3. In-app navigation away and back (a real unmount and a new page
//     instance): a late reply for the old instance never overwrites the newer
//     instance's stored amendment.
import { test, expect } from '@playwright/test';
import { TRAINEES, createGroupServer } from './fixtures/groupSessionServer.mjs';

const TOKEN = 'synthetic-g1-coach-token';
const [ANA, BEN] = TRAINEES;
const KEY = 'cvf_group_session:v1:same-origin:fict-coach-g1';
const STATIONS = [
  { library: 'fict-lib-goblet', sets: '2', reps: '10', load: '35' },
  { library: 'fict-lib-bench', sets: '2', reps: '8', load: '95' },
  { library: 'fict-lib-row', sets: '2', reps: '12', load: '70' },
];

async function setup(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = createGroupServer();
  const state = { mirror: [], errors: [], unexpected: [], offline: false, holdNext: false, held: [] };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if ((request.headers().authorization || '') !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Invalid or expired token"}' });
    if (path.endsWith('/unread-count')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"unread":0}' });
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    const mirrorWrite = path.startsWith('/group-sessions') && method !== 'GET';
    if (mirrorWrite && state.holdNext) {
      state.holdNext = false;
      state.mirror.push({ method, outcome: 'held' });
      await new Promise((resolve) => state.held.push(resolve)); // then answered normally
    } else if (mirrorWrite && state.offline) {
      state.mirror.push({ method, outcome: 'no answer' });
      return route.abort('connectionreset').catch(() => {});
    }
    let reply;
    try {
      reply = { status: 200, data: server.request(method, path, body) };
    } catch (error) {
      if (error.code === 'ERR_NETWORK') return route.abort('connectionreset').catch(() => {});
      if (error.response?.data?.error?.startsWith('Synthetic route missing')) state.unexpected.push(`${method} ${path}`);
      reply = { status: error.response?.status || 500, data: error.response?.data || {} };
    }
    if (mirrorWrite) state.mirror.push({ method, status: reply.status, hasBookkeeping: Boolean(body?.station_state && '_mirror' in body.station_state) });
    return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.data) });
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/login');
  await page.evaluate((token) => localStorage.setItem('cvf_access_token', token), TOKEN);
  await page.goto('/coach/group-session');
  await page.getByTestId('group-mode-stations').click();
  await expect(page.getByTestId('group-setup')).toBeVisible();
  for (const trainee of [ANA, BEN]) await page.getByTestId(`group-trainee-option-${trainee.id}`).check();
  for (const [index, station] of STATIONS.entries()) {
    await page.getByTestId(`group-station-${index}-exercise`).selectOption(station.library);
    await page.getByTestId(`group-station-${index}-sets`).fill(station.sets);
    await page.getByTestId(`group-station-${index}-reps`).fill(station.reps);
    await page.getByTestId(`group-station-${index}-load`).fill(station.load);
  }
  await page.getByTestId('group-title').fill('Fictional reload group');
  await page.getByTestId('group-start').click();
  await expect(page.getByTestId('group-header')).toContainText('Round 1 of');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  return { server, state };
}

async function amendStationB(page) {
  await page.getByTestId('group-amend-B').click();
  await page.getByTestId('group-amend-exercise').selectOption('fict-lib-dbbench');
  await page.getByTestId('group-amend-sets').fill('2');
  await page.getByTestId('group-amend-reps').fill('10');
  await page.getByTestId('group-amend-load').fill('30');
  await page.getByTestId('group-amend-reason').fill('Rack pin broke');
  await page.getByTestId('group-amend-confirm').click();
  await expect(page.getByTestId('group-station-B-amended')).toBeVisible();
}
async function amendStationA(page) {
  await page.getByTestId('group-amend-A').click();
  await page.getByTestId('group-amend-exercise').selectOption('fict-lib-pushup');
  await page.getByTestId('group-amend-sets').fill('2');
  await page.getByTestId('group-amend-reps').fill('12');
  await page.getByTestId('group-amend-reason').fill('Bench taken');
  await page.getByTestId('group-amend-confirm').click();
  await expect(page.getByTestId('group-station-A-amended')).toBeVisible();
}
// In-app navigation (no reload), as the app's own links do.
const navigate = (page, path) => page.evaluate((target) => { window.history.pushState({}, '', target); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
const accountAmendments = (server) => server.db.groups[0]?.station_state?.amendments?.length ?? null;
const storedAmendments = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null')?.amendments?.length ?? null, KEY);

test('an amendment made while the account update gets no answer survives a real reload and reaches the account', async ({ page }) => {
  const { server, state } = await setup(page);
  state.offline = true;
  await amendStationB(page);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'local');
  expect(accountAmendments(server)).toBe(0);
  expect(await storedAmendments(page)).toBe(1);
  state.offline = false;
  await page.reload();
  await expect(page.getByTestId('group-station-B-amended')).toBeVisible();
  await expect.poll(() => accountAmendments(server), { timeout: 15000 }).toBe(1);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  expect(await storedAmendments(page)).toBe(1);
  expect(state.mirror.some((m) => m.hasBookkeeping)).toBe(false); // bookkeeping never sent
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('a stored session without bookkeeping that differs from the account: both kept across reloads until the coach chooses', async ({ page }) => {
  const { server, state } = await setup(page);
  state.offline = true;
  await amendStationB(page);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'local');
  // As written by an earlier version: the same entry without bookkeeping.
  await page.evaluate((key) => { const entry = JSON.parse(localStorage.getItem(key)); delete entry._mirror; localStorage.setItem(key, JSON.stringify(entry)); }, KEY);
  state.offline = false;
  const writesBefore = state.mirror.filter((m) => m.method === 'PATCH').length;
  for (let i = 0; i < 2; i += 1) {
    await page.reload();
    await expect(page.getByTestId('group-mirror-diverged')).toBeVisible();
    await expect(page.getByTestId('group-station-B-amended')).toBeVisible();
    expect(accountAmendments(server)).toBe(0);
    expect(await storedAmendments(page)).toBe(1);
  }
  expect(state.mirror.filter((m) => m.method === 'PATCH').length).toBe(writesBefore);
  await page.getByTestId('group-mirror-keep-local').click();
  await expect.poll(() => accountAmendments(server), { timeout: 10000 }).toBe(1);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  await expect(page.getByTestId('group-mirror-diverged')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('navigating away and back: a late reply for the unmounted page never overwrites the newer stored amendment', async ({ page }) => {
  const { server, state } = await setup(page);
  state.holdNext = true;
  await amendStationB(page); // X: its account update is held
  await expect.poll(() => state.held.length).toBe(1);
  await navigate(page, '/coach/resources'); // the station page unmounts
  await expect(page.getByTestId('group-header')).toHaveCount(0);
  state.offline = true; // the new page instance gets no answers
  await navigate(page, '/coach/group-session'); // a new instance mounts and loads X
  await expect(page.getByTestId('group-station-B-amended')).toBeVisible();
  await amendStationA(page); // newer work in the new instance
  expect(await storedAmendments(page)).toBe(2);
  state.held.shift()(); // the old instance's reply finally arrives
  await page.waitForTimeout(2000);
  expect(await storedAmendments(page)).toBe(2);
  state.offline = false;
  await page.reload();
  await expect(page.getByTestId('group-station-A-amended')).toBeVisible();
  await expect(page.getByTestId('group-station-B-amended')).toBeVisible();
  await expect.poll(() => accountAmendments(server), { timeout: 15000 }).toBe(2);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  expect(state.errors).toEqual([]);
});
