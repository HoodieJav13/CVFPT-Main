// PR121 review (discussion r4368525315), real station UI in normal mode
// against the committed synthetic in-process API (fictional):
//  1. A mirror update fails with no answer while a newer edit is queued: the
//     newer plan reaches the account on its own (bounded backoff), and the
//     indicator says "only on this device" until then.
//  2. A mirror update commits but its reply is lost, then another edit: this
//     device keeps its newest plan (never adopts its own older copy), and the
//     account ends with it; no "changed on another device" claim.
import { test, expect } from '@playwright/test';
import { TRAINEES, createGroupServer } from './fixtures/groupSessionServer.mjs';

const TOKEN = 'synthetic-g1-coach-token';
const [ANA, BEN] = TRAINEES;
const STATIONS = [
  { library: 'fict-lib-goblet', sets: '2', reps: '10', load: '35' },
  { library: 'fict-lib-bench', sets: '2', reps: '8', load: '95' },
  { library: 'fict-lib-row', sets: '2', reps: '12', load: '70' },
];

async function setup(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = createGroupServer();
  const state = { mirror: [], errors: [], unexpected: [], next: [] };
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
    const mirrorUpdate = path.startsWith('/group-sessions/') && method === 'PATCH';
    // Planned outcome for this mirror update: 'hold-network' | 'commit-lost'.
    const step = mirrorUpdate ? state.next.shift() : null;
    if (step === 'hold-network') {
      state.mirror.push({ base: body?.base_revision, outcome: 'held, then no answer', at: Date.now() });
      await new Promise((resolve) => { state.releaseHeld = resolve; });
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
    if (mirrorUpdate) state.mirror.push({ base: body?.base_revision, status: reply.status, outcome: step || 'answered', title: body?.station_state?.title, at: Date.now() });
    if (step === 'commit-lost') return route.abort('connectionreset').catch(() => {});
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
  await page.getByTestId('group-title').fill('Fictional transient group');
  await page.getByTestId('group-start').click();
  await expect(page.getByTestId('group-header')).toContainText('Round 1 of');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  return { server, state };
}

async function saveSet(page, trainee, number, reps, load) {
  const row = page.getByTestId(`group-set-${trainee.id}-${number}`);
  await row.getByTestId(`group-set-${trainee.id}-${number}-reps`).fill(String(reps));
  await row.getByTestId(`group-set-${trainee.id}-${number}-load`).fill(String(load));
  await row.getByTestId(`group-set-${trainee.id}-${number}-save`).click();
  await expect(row).toHaveAttribute('data-state', 'saved');
}
const anaVisit = (stationState) => Object.values(stationState?.visits || {}).find((v) => v.traineeId === ANA.id && v.round === 0);
const localSession = (page) => page.evaluate(() => {
  const raw = Object.entries(localStorage).find(([k]) => k.startsWith('cvf_group_session'))?.[1];
  return raw ? JSON.parse(raw) : null;
});

test('no answer while a newer edit is queued: the newer plan reaches the account on its own', async ({ page }) => {
  const { server, state } = await setup(page);
  state.next.push('hold-network');
  await saveSet(page, ANA, 1, 10, 35); // A: its mirror update is held
  await expect.poll(() => state.mirror.length).toBe(1);
  await page.getByTestId(`group-add-set-${ANA.id}`).click(); // B: queued while A is in flight
  await page.waitForTimeout(900);
  state.releaseHeld(); // A gets no answer
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'local');
  // No further edit or reload: bounded backoff retries and the account catches up.
  await expect.poll(() => anaVisit(server.db.groups[0].station_state)?.sets.length, { timeout: 15000 }).toBe(3);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  expect(anaVisit(await localSession(page)).sets.length).toBe(3);
  expect(state.mirror.length).toBeLessThanOrEqual(4);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('a committed update whose reply is lost is never mistaken for another device; the newest plan is kept and mirrored', async ({ page }) => {
  const { server, state } = await setup(page);
  state.next.push('commit-lost');
  await saveSet(page, ANA, 1, 10, 35); // A commits on the server; the reply is lost
  await expect.poll(() => state.mirror.length).toBe(1);
  expect(server.db.groups[0].revision).toBe(1);
  await page.getByTestId(`group-add-set-${ANA.id}`).click(); // E: a plan-structure edit, no entered values
  await expect.poll(() => anaVisit(server.db.groups[0].station_state)?.sets.length, { timeout: 15000 }).toBe(3);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  expect(anaVisit(await localSession(page)).sets.length).toBe(3);
  expect(state.mirror.some((m) => m.status === 409)).toBe(true); // the confirmation of its own lost commit
  expect(server.db.groups[0].revision).toBe(2);
  expect(state.errors).toEqual([]);
});
