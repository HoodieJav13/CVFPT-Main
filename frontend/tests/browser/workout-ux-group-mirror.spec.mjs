// PR120 review 4366537628: the coach-account mirror of a station session
// belongs to that session's id. Closing a session and starting another on the
// same page must create the new record (POST), never PATCH it with the old
// revision; a late reply for the old session must not touch the new mirror.
// Real UI in normal mode against the committed synthetic in-process API.
import { test, expect } from '@playwright/test';
import { TRAINEES, createGroupServer } from './fixtures/groupSessionServer.mjs';

const TOKEN = 'synthetic-g1-coach-token';
const [ANA, BEN] = TRAINEES;
// The setup form has three station rows; all three are filled (as in
// workout-ux-group-session.spec.mjs).
const STATIONS = [
  { library: 'fict-lib-goblet', sets: '2', reps: '10', load: '35' },
  { library: 'fict-lib-bench', sets: '2', reps: '8', load: '95' },
  { library: 'fict-lib-row', sets: '2', reps: '12', load: '70' },
];

async function setup(page) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = createGroupServer();
  const state = { unexpected: [], mirror: [], holds: new Map(), errors: [] };
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
    let reply;
    try {
      reply = { status: 200, data: server.request(method, path, body) };
    } catch (error) {
      if (error.response?.data?.error?.startsWith('Synthetic route missing')) state.unexpected.push(`${method} ${path}`);
      reply = { status: error.response?.status || 500, data: error.response?.data || {} };
    }
    if (path.startsWith('/group-sessions') && method !== 'GET') {
      const id = method === 'POST' ? body?.id : path.split('/').at(-1);
      state.mirror.push({ method, id, base_revision: body?.base_revision ?? null, status: reply.status, revision: reply.data?.session?.revision ?? null });
      // A held reply is applied on the server now but delivered later.
      const hold = state.holds.get(`${method} ${id}`);
      if (hold) await hold;
    }
    return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.data) });
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/login');
  await page.evaluate((token) => localStorage.setItem('cvf_access_token', token), TOKEN);
  await page.goto('/coach/group-session');
  await page.getByTestId('group-mode-stations').click();
  await expect(page.getByTestId('group-setup')).toBeVisible();
  return { server, state };
}

async function plan(page, title) {
  for (const trainee of [ANA, BEN]) await page.getByTestId(`group-trainee-option-${trainee.id}`).check();
  for (const [index, station] of STATIONS.entries()) {
    await page.getByTestId(`group-station-${index}-exercise`).selectOption(station.library);
    await page.getByTestId(`group-station-${index}-sets`).fill(station.sets);
    await page.getByTestId(`group-station-${index}-reps`).fill(station.reps);
    await page.getByTestId(`group-station-${index}-load`).fill(station.load);
  }
  await page.getByTestId('group-title').fill(title);
  await page.getByTestId('group-start').click();
  await expect(page.getByTestId('group-header')).toContainText('Round 1 of');
  return page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('cvf_group_session')).map(([, v]) => JSON.parse(v).id)[0]);
}

async function recordSet(page, trainee, number, reps, load) {
  const row = page.getByTestId(`group-set-${trainee.id}-${number}`);
  await row.getByTestId(`group-set-${trainee.id}-${number}-reps`).fill(String(reps));
  await row.getByTestId(`group-set-${trainee.id}-${number}-load`).fill(String(load));
  await row.getByTestId(`group-set-${trainee.id}-${number}-save`).click();
  await expect(row).toHaveAttribute('data-state', 'saved');
}

test('a second session started on the same page is created on the account, then updated with its own revision', async ({ page }) => {
  const { server, state } = await setup(page);
  const first = await plan(page, 'Fictional first group');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  await recordSet(page, ANA, 1, 10, 35);
  await expect.poll(() => state.mirror.filter((m) => m.method === 'PATCH' && m.id === first && m.status === 200).length).toBeGreaterThan(0);

  await page.getByTestId('group-discard').click();
  await expect(page.getByTestId('group-setup')).toBeVisible();
  const second = await plan(page, 'Fictional second group');
  expect(second).not.toBe(first);
  await expect.poll(() => state.mirror.filter((m) => m.id === second).map((m) => `${m.method} ${m.status}`)[0]).toBe('POST 200');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  // Ana's first-session workout is still open on the server (closing a
  // session on this device does not finish it), so log for Ben here.
  await recordSet(page, BEN, 1, 9, 35);
  await expect.poll(() => state.mirror.filter((m) => m.id === second && m.method === 'PATCH').map((m) => m.status)).toContain(200);
  const secondRows = state.mirror.filter((m) => m.id === second);
  expect(secondRows.every((m) => m.status === 200), JSON.stringify(secondRows)).toBe(true);
  expect(server.db.groups.map((g) => g.id)).toEqual([first, second]);
  expect(server.db.groups.find((g) => g.id === second).station_state.id).toBe(second);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("a late reply for the old session never sets the new session's mirror revision", async ({ page }) => {
  const { server, state } = await setup(page);
  const first = await plan(page, 'Fictional held group');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  // The old session's next update reaches the server (revision 1) but its
  // reply is held until a new session exists on this page.
  let release;
  state.holds.set(`PATCH ${first}`, new Promise((resolve) => { release = resolve; }));
  await recordSet(page, ANA, 1, 10, 35);
  await expect.poll(() => state.mirror.filter((m) => m.method === 'PATCH' && m.id === first).length).toBe(1);
  await page.getByTestId('group-discard').click();
  await expect(page.getByTestId('group-setup')).toBeVisible();
  const second = await plan(page, 'Fictional fresh group');
  await expect.poll(() => state.mirror.filter((m) => m.id === second).map((m) => `${m.method} ${m.status}`)[0]).toBe('POST 200');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  release();
  await page.waitForTimeout(300);
  // The new session's next update is based on its own revision, not the old reply's.
  await recordSet(page, BEN, 1, 8, 35);
  await expect.poll(() => state.mirror.filter((m) => m.id === second && m.method === 'PATCH').length).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  const secondRows = state.mirror.filter((m) => m.id === second);
  expect(secondRows.every((m) => m.status === 200), JSON.stringify(state.mirror)).toBe(true);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  const own = server.db.groups.find((g) => g.id === second);
  expect(own.station_state.id).toBe(second);
  expect(JSON.stringify(own.station_state)).toContain('"reps":8');
  expect(state.errors).toEqual([]);
});
