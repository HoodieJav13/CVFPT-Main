// Independent review P1 (PR121): overlapping mirror requests in ONE station
// session. The coach-account mirror PATCH for change A reaches the server
// (revision 1) but its reply is slow; meanwhile the coach records B — a set
// whose own save failed, so it exists only as this device's write-ahead entry
// with its event id. B's mirror update must not replace local work with A's
// older copy: B's entry and event id stay on this device, Retry re-sends that
// same event once, and the account mirror eventually includes B.
// Real UI in normal mode against the committed synthetic in-process API.
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
  const state = { unexpected: [], mirror: [], errors: [], holdNext: null };
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
      if (error.code === 'ERR_NETWORK') return route.abort('connectionreset').catch(() => {});
      if (error.response?.data?.error?.startsWith('Synthetic route missing')) state.unexpected.push(`${method} ${path}`);
      reply = { status: error.response?.status || 500, data: error.response?.data || {} };
    }
    if (path.startsWith('/group-sessions/') && method === 'PATCH') {
      state.mirror.push({ base_revision: body?.base_revision, status: reply.status, revision: reply.data?.session?.revision ?? null, at: Date.now() });
      // The server has applied this update; only its reply is delayed.
      if (state.holdNext) { const hold = state.holdNext; state.holdNext = null; await hold; }
    }
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
  await page.getByTestId('group-title').fill('Fictional overlap group');
  await page.getByTestId('group-start').click();
  await expect(page.getByTestId('group-header')).toContainText('Round 1 of');
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  return { server, state };
}

async function enter(page, trainee, number, reps, load, expected) {
  const row = page.getByTestId(`group-set-${trainee.id}-${number}`);
  await row.getByTestId(`group-set-${trainee.id}-${number}-reps`).fill(String(reps));
  await row.getByTestId(`group-set-${trainee.id}-${number}-load`).fill(String(load));
  await row.getByTestId(`group-set-${trainee.id}-${number}-save`).click();
  await expect(row).toHaveAttribute('data-state', expected);
}
// The device's write-ahead copy of one trainee's set 1 in this round.
const localSet = (page, traineeId) => page.evaluate((id) => {
  const raw = Object.entries(localStorage).find(([k]) => k.startsWith('cvf_group_session'))?.[1];
  const session = raw ? JSON.parse(raw) : null;
  const visit = session && Object.values(session.visits || {}).find((v) => v.traineeId === id && v.round === 0);
  const set = visit?.sets.find((s) => s.setNumber === 1 && s.origin !== 'extra');
  return set ? { entry: set.entry, eventId: set.eventId || null, state: set.state } : null;
}, traineeId);
const serverHasEntry = (server, traineeId, reps) => {
  const group = server.db.groups[0];
  const visit = Object.values(group?.station_state?.visits || {}).find((v) => v.traineeId === traineeId && v.round === 0);
  return Boolean(visit?.sets.some((s) => s.setNumber === 1 && s.entry?.reps === reps));
};
const setWrites = (server, traineeId) => server.db.requests.filter((r) => r.method === 'PATCH' && /\/sets\//.test(r.path)
  && server.db.logs.some((log) => log.client_id === traineeId && r.path.includes(`/workout-logs/${log.id}/`)));

test('a slow mirror reply never replaces a newer failed entry; it keeps its event id, retries once and is mirrored', async ({ page }) => {
  const { server, state } = await setup(page);
  // A: Ana's saved set; its mirror update reaches the server but the reply waits.
  let releaseA;
  state.holdNext = new Promise((resolve) => { releaseA = resolve; });
  await enter(page, ANA, 1, 10, 35, 'saved');
  await expect.poll(() => state.mirror.length).toBe(1);
  expect(state.mirror[0]).toMatchObject({ base_revision: 0, status: 200, revision: 1 });

  // B: Ben's set is entered while A's reply is outstanding; its own save fails
  // once (the later Retry is the only other attempt).
  server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'no-reach', times: 1 });
  await enter(page, BEN, 1, 9, 95, 'failed');
  const before = await localSet(page, BEN.id);
  expect(before?.entry).toMatchObject({ reps: 9, load: 95 });
  expect(before?.eventId).toMatch(/^[0-9a-f-]{36}$/);
  await page.waitForTimeout(1500); // more than one 600 ms mirror debounce
  releaseA();
  await page.waitForTimeout(1500);

  // B is still this device's work, with the same event identity.
  const after = await localSet(page, BEN.id);
  expect(after, JSON.stringify(state.mirror)).toEqual(before);
  await expect(page.getByTestId(`group-set-${BEN.id}-1`)).toHaveAttribute('data-state', 'failed');
  expect((await localSet(page, ANA.id))?.state).toBe('saved');

  // Retry re-sends exactly that event once; the account mirror then has B.
  const sentBefore = setWrites(server, BEN.id).length;
  await page.getByTestId('group-retry-all').click();
  await expect(page.getByTestId(`group-set-${BEN.id}-1`)).toHaveAttribute('data-state', 'saved');
  const resent = setWrites(server, BEN.id).slice(sentBefore);
  expect(resent.map((r) => r.body.event_id)).toEqual([before.eventId]);
  await expect.poll(() => serverHasEntry(server, BEN.id, 9), { timeout: 8000 }).toBe(true);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('ordinary slow mirror replies: updates go one at a time and the mirror ends with every saved set', async ({ page }) => {
  const { server, state } = await setup(page);
  let releaseA;
  state.holdNext = new Promise((resolve) => { releaseA = resolve; });
  await enter(page, ANA, 1, 10, 35, 'saved');
  await expect.poll(() => state.mirror.length).toBe(1);
  await enter(page, BEN, 1, 8, 95, 'saved');
  await page.waitForTimeout(1500);
  releaseA();
  await expect.poll(() => serverHasEntry(server, BEN.id, 8) && serverHasEntry(server, ANA.id, 10), { timeout: 8000 }).toBe(true);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  // No self-inflicted conflict, and each set was written once.
  expect(state.mirror.filter((m) => m.status === 409), JSON.stringify(state.mirror)).toEqual([]);
  expect(setWrites(server, ANA.id)).toHaveLength(1);
  expect(setWrites(server, BEN.id)).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('a real change from another coach device is still adopted, keeping this device\'s unsaved entry', async ({ page }) => {
  const { server, state } = await setup(page);
  // Another device renames the session on the server (its own revision).
  const row = server.db.groups[0];
  Object.assign(row, { station_state: { ...row.station_state, title: 'Renamed on the other device' }, revision: row.revision + 1 });
  server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'no-reach', times: 2 });
  await enter(page, BEN, 1, 6, 95, 'failed');
  const before = await localSet(page, BEN.id);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'replaced');
  await expect(page.getByTestId('group-header')).toContainText('Renamed on the other device');
  expect(await localSet(page, BEN.id)).toEqual(before);
  // The kept entry is mirrored on top of the adopted copy.
  await expect.poll(() => serverHasEntry(server, BEN.id, 6), { timeout: 8000 }).toBe(true);
  expect(server.db.groups[0].station_state.title).toBe('Renamed on the other device');
  expect(state.mirror.some((m) => m.status === 409)).toBe(true);
  expect(state.errors).toEqual([]);
});
