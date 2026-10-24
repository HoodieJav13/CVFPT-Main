// Independent frontend review of d39 (PR121 follow-up B), real station UI in
// normal mode against the committed synthetic in-process API (fictional):
//  1. Another coach device finished the session (and closed the visit) while
//     this device held an unsaved set: the kept entry survives a reload, a
//     visible Retry sends exactly that event once, and the existing late-event
//     contract keeps it as a disagreement without changing logged history.
//  3. Edits keep coming across five slow mirror replies: the final copy still
//     reaches the account with no further user action, and "saved" is only
//     shown once it has.
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
  const state = { unexpected: [], mirror: [], errors: [], holdAll: false, held: [] };
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
      state.mirror.push({ base_revision: body?.base_revision, status: reply.status, sets: Object.values(body?.station_state?.visits || {}).reduce((n, v) => n + v.sets.length, 0) });
      // The server has applied the update; only the reply waits for the test.
      if (state.holdAll) await new Promise((resolve) => state.held.push(resolve));
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
  await page.getByTestId('group-title').fill('Fictional recovery group');
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
const localSession = (page) => page.evaluate(() => {
  const raw = Object.entries(localStorage).find(([k]) => k.startsWith('cvf_group_session'))?.[1];
  return raw ? JSON.parse(raw) : null;
});
const anaVisit = (session) => Object.values(session?.visits || {}).find((v) => v.traineeId === 'fict-trainee-ana' && v.round === 0);

test('the other device finished the session: the kept set survives reload, Retry sends that event once and it is kept as a disagreement', async ({ page }) => {
  const { server, state } = await setup(page);
  await enter(page, ANA, 1, 10, 35, 'saved');
  await expect.poll(() => state.mirror.filter((m) => m.status === 200).length).toBeGreaterThan(0);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  // Another coach device closes Ana's visit (her workout is completed) and finishes the session.
  const row = server.db.groups[0];
  const visitKey = anaVisit(row.station_state).key;
  const logId = anaVisit(row.station_state).logId;
  server.request('POST', `/workout-logs/${logId}/complete`, {});
  const remote = JSON.parse(JSON.stringify(row.station_state));
  remote.visits[visitKey].status = 'completed';
  Object.assign(remote, { status: 'finished', finishedAt: new Date().toISOString() });
  Object.assign(row, { station_state: remote, revision: row.revision + 1 });
  const loggedBefore = JSON.parse(JSON.stringify(server.db.logs.find((l) => l.id === logId).exercises[0].sets));

  // This device's next set fails to save; its mirror update meets the other device's finished copy.
  server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'no-reach', times: 1 });
  await enter(page, ANA, 2, 7, 35, 'failed');
  const kept = anaVisit(await localSession(page)).sets.find((s) => s.setNumber === 2);
  expect(kept.eventId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByTestId('group-header')).toContainText('Session summary');
  const keptAfterAdopt = anaVisit(await localSession(page)).sets.find((s) => s.setNumber === 2);
  expect(keptAfterAdopt).toMatchObject({ entry: kept.entry, eventId: kept.eventId, setId: kept.setId });

  // Still there after a reload, with a visible Retry.
  await page.reload();
  await expect(page.getByTestId('group-header')).toContainText('Session summary');
  expect(anaVisit(await localSession(page)).sets.find((s) => s.setNumber === 2)).toMatchObject({ eventId: kept.eventId, entry: kept.entry });
  const retry = page.getByRole('button', { name: /Retry now/ });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('group-sync-status')).toContainText('1 set(s) waiting to save');
  const from = server.db.requests.length;
  await retry.click();
  await expect(page.getByTestId('group-sync-status')).toContainText('kept for review');
  const sent = server.db.requests.slice(from).filter((r) => r.method === 'PATCH' && /\/sets\//.test(r.path));
  expect(sent.map((r) => [r.path, r.body.event_id, r.body.actual_reps])).toEqual([[`/workout-logs/${logId}/sets/${kept.setId}`, kept.eventId, 7]]);
  expect(server.db.conflicts.map((c) => c.eventId)).toEqual([kept.eventId]);
  const log = server.db.logs.find((l) => l.id === logId);
  expect(log.status).toBe('completed');
  expect(log.exercises[0].sets).toEqual(loggedBefore);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('edits across five slow mirror replies: the latest copy reaches the account without another action; "saved" only once it has', async ({ page }) => {
  const { server, state } = await setup(page);
  state.holdAll = true;
  await enter(page, ANA, 1, 10, 35, 'saved');
  await expect.poll(() => state.mirror.length).toBe(1);
  const addSet = page.getByTestId(`group-add-set-${ANA.id}`);
  for (let i = 1; i <= 5; i += 1) {
    await addSet.click();
    await page.waitForTimeout(800); // the 600 ms mirror debounce fires while reply i is outstanding
    if (i === 5) state.holdAll = false; // later replies are immediate
    state.held.shift()();
    if (i < 5) await expect.poll(() => state.mirror.length).toBe(i + 1);
  }
  // No more edits. The account copy must catch up to this device's copy.
  const localSets = () => localSession(page).then((s) => anaVisit(s)?.sets.length);
  expect(await localSets()).toBe(7);
  const remoteSets = () => anaVisit(server.db.groups[0].station_state)?.sets.length;
  await expect.poll(remoteSets, { timeout: 6000 }).toBe(7);
  await expect(page.getByTestId('group-mirror-state')).toHaveAttribute('data-state', 'saved');
  // Bounded: one update per queued copy, no busy loop.
  await page.waitForTimeout(1500);
  expect(state.mirror.length).toBeLessThanOrEqual(7);
  expect(state.errors).toEqual([]);
});
