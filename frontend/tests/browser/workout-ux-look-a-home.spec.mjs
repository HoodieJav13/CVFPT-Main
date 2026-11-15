// Home Mark done / Undo (LOOK-A-HOME-UNDO-REVIEW, 2026-11-14). Normal mode,
// synthetic in-process API, fictional data only. The server mirrors the
// quick_complete_workout_v3 / undo contract as the page sees it: an event id
// replays its first answer, a reply carries the log as it is NOW, and Undo
// applies once per change. This proves the page, not the database rules
// (supabase/tests/look_a covers those).
import { test, expect } from '@playwright/test';

const POINTER = 'cvf_look_a_home_undo:v1';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
const clone = (value) => JSON.parse(JSON.stringify(value));
const untouchedSets = (logId) => [1, 2, 3].map((n) => ({ id: `${logId}-s${n}`, set_number: n, status: 'pending', actual_reps: null, actual_load_value: null }));

function makeServer() {
  const assignments = [
    { id: 'wa-1', assignment_mode: 'dated', assigned_for: today(), workout: { name: 'Fictional Tuesday' } },
    { id: 'wa-2', assignment_mode: 'dated', assigned_for: today(), workout: { name: 'Fictional Wednesday' } },
  ];
  return {
    assignments, logs: new Map(), events: new Map(), undos: new Map(), requests: [], unexpected: [],
    holds: new Map(), drop: new Set(), down: false,
  };
}
const held = (server, key) => { let release; server.holds.set(key, new Promise((resolve) => { release = () => { server.holds.delete(key); resolve(); }; })); return () => release(); };

function replyFor(server, log, eventId) {
  return { ...clone(log), change: { id: eventId, kind: 'finish', undoable: log.status === 'completed' && log.current_change === eventId } };
}

async function setup(page) {
  const server = makeServer();
  const results = { errors: [] };
  page.on('pageerror', (error) => results.errors.push(error.message));
  await page.context().addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-home-token'));
  await page.context().route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'home@example.invalid', profile: { id: 'home-client', name: 'Fictional Home Client', waiver_signed: true } });
    if (path === '/telemetry/events') { server.requests.push({ method, path, body: r.postDataJSON?.() ?? null }); return route.fulfill({ status: 204 }); }
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === '/dashboard/client') return json({ waiver: { has_version: false, signed_latest: true }, today_check_in: null, unread_messages: 0, program_count: 1, next_session: null, recent_messages: [], recent_progress: [] });
    if (path === '/programs/client/assigned') return json({ programs: [], workouts: server.assignments });
    if (path === '/workout-logs/active') return json(null);
    if (path === '/workout-logs/mine') return json([...server.logs.values()].map((log) => ({ id: log.id, status: log.status, workout_name: log.workout_name, dated_workout_assignment_id: log.dated_workout_assignment_id, completed_at: log.completed_at })));
    if (path === '/workout-logs/week-rhythm') return json({ week_streak: 0, yesterday_missed: [] });
    if (path === '/announcements/mine') return json([]);
    if (method === 'POST' && path === '/workout-logs/quick-complete') {
      const body = r.postDataJSON();
      server.requests.push({ method, path, body });
      if (server.holds.has('mark')) await server.holds.get('mark');
      if (server.down) return json({ error: 'Synthetic outage' }, 503);
      const known = server.events.get(body.event_id);
      let log;
      let status = 200;
      if (known) {
        log = server.logs.get(known);
      } else {
        const assignment = server.assignments.find((a) => a.id === body.workout_assignment_id);
        const id = `hl-${server.logs.size + 1}`;
        log = { id, status: 'completed', workout_name: assignment.workout.name, dated_workout_assignment_id: assignment.id, completed_at: new Date().toISOString(), not_set_tracked: true, sets: untouchedSets(id), current_change: body.event_id };
        server.logs.set(id, log);
        server.events.set(body.event_id, id);
        status = 201;
      }
      if (server.drop.has('mark')) return route.abort('connectionreset');
      return json(replyFor(server, log, body.event_id), status);
    }
    const undoMatch = path.match(/^\/workout-logs\/([^/]+)\/undo$/);
    if (undoMatch) {
      const log = server.logs.get(undoMatch[1]);
      if (method === 'GET') {
        server.requests.push({ method, path });
        if (server.holds.has('undo-get')) await server.holds.get('undo-get');
        if (!log) return json({ error: 'Not found' }, 404);
        return json({ undo: log.status === 'completed' && log.current_change ? { change_id: log.current_change, kind: 'finish' } : null });
      }
      const body = r.postDataJSON();
      server.requests.push({ method, path, body });
      if (server.holds.has('undo')) await server.holds.get('undo');
      if (server.down) return json({ error: 'Synthetic outage' }, 503);
      if (server.undos.has(body.event_id)) return json({ result: { outcome: 'replayed', original_outcome: server.undos.get(body.event_id) }, log: clone(log), undo: null });
      let outcome = 'refused';
      if (log && log.status === 'completed' && log.current_change === body.change_id) {
        log.status = 'active';
        log.current_change = null;
        outcome = 'applied';
      }
      server.undos.set(body.event_id, outcome);
      return json({ result: { outcome, ...(outcome === 'refused' ? { reason: 'That is no longer the latest change.' } : {}) }, log: clone(log), undo: null });
    }
    server.unexpected.push(`${method} ${path}`);
    return json({ error: `Unexpected synthetic route ${method} ${path}` }, 404);
  });
  await page.goto('/client');
  await expect(page.getByTestId('client-today-plan')).toBeVisible();
  return { server, results };
}

const pointer = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), POINTER);
const marks = (server) => server.requests.filter((r) => r.method === 'POST' && r.path === '/workout-logs/quick-complete');
const undoPosts = (server) => server.requests.filter((r) => r.method === 'POST' && /\/undo$/.test(r.path));
const celebrated = (page) => page.getByText('your coach has been notified');
// Telemetry is only sent when collection is configured; when it is, a
// historical replay must not count as a new quick completion.
const quickEvents = (server) => server.requests.filter((r) => r.path === '/telemetry/events' && JSON.stringify(r.body || {}).includes('workout_quick_completed'));

test('a lost Mark done reply, then a reload while offline: the pending Undo stays and undoes that very tap once', async ({ page }) => {
  const { server, results } = await setup(page);
  server.drop.add('mark');
  await page.getByTestId('client-today-quick-complete').click();
  await expect(page.getByTestId('home-undo')).toContainText('not confirmed yet');
  const first = await pointer(page);
  expect(first).toMatchObject({ state: 'pending', source: { workout_assignment_id: 'wa-1' } });
  const eventId = first.event_id;
  // The server has it, the phone does not know. Reload with the server unreachable.
  server.drop.delete('mark');
  server.down = true;
  await page.reload();
  await expect(page.getByTestId('home-undo')).toContainText('not confirmed yet');
  expect(await pointer(page)).toMatchObject({ state: 'pending', event_id: eventId });
  // Back online: Undo learns what that tap did (same id) and undoes exactly it.
  server.down = false;
  await page.getByTestId('home-undo-button').click();
  await expect(page.getByTestId('home-undo')).toHaveCount(0);
  expect(new Set(marks(server).map((r) => r.body.event_id))).toEqual(new Set([eventId]));
  expect(server.logs.size).toBe(1);
  const log = server.logs.get('hl-1');
  expect(log.status).toBe('active');
  expect(log.sets).toEqual(untouchedSets('hl-1'));
  expect(undoPosts(server).map((r) => r.body.change_id)).toEqual([eventId]);
  expect([...server.undos.values()]).toEqual(['applied']);
  expect(await pointer(page)).toBe(null);
  expect(server.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('a reload while the first Mark done request is still in flight keeps one event and offers its Undo', async ({ page }) => {
  const { server, results } = await setup(page);
  const release = held(server, 'mark');
  await page.getByTestId('client-today-quick-complete').click();
  // Written before the request: survives the reload.
  await expect.poll(() => pointer(page)).toMatchObject({ state: 'pending', source: { workout_assignment_id: 'wa-1' } });
  const { event_id: eventId } = await pointer(page);
  await page.reload();
  await expect(page.getByTestId('home-undo')).toBeVisible();
  release();
  // The reloaded page replays the same id; one log, one change, its Undo offered.
  await expect(page.getByTestId('home-undo')).toContainText('marked done');
  await expect.poll(() => pointer(page)).toMatchObject({ state: 'saved', logId: 'hl-1', change_id: eventId });
  expect(new Set(marks(server).map((r) => r.body.event_id))).toEqual(new Set([eventId]));
  expect(server.logs.size).toBe(1);
  await page.getByTestId('home-undo-button').click();
  await expect(page.getByTestId('home-undo')).toHaveCount(0);
  expect(server.logs.get('hl-1').status).toBe('active');
  expect([...server.undos.values()]).toEqual(['applied']);
  expect(server.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('a replay of a Mark done that another device already undid is history: no celebration, no check-in', async ({ page }) => {
  const { server, results } = await setup(page);
  server.drop.add('mark');
  await page.getByTestId('client-today-quick-complete').click();
  await expect(page.getByTestId('home-undo')).toContainText('not confirmed yet');
  // Another device undoes that completion meanwhile.
  const log = server.logs.get('hl-1');
  log.status = 'active';
  log.current_change = null;
  server.drop.delete('mark');
  await page.reload();
  await expect(page.getByText('That mark done was already undone')).toBeVisible();
  await expect(page.getByTestId('home-undo')).toHaveCount(0);
  await expect(celebrated(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(quickEvents(server)).toEqual([]);
  expect(await pointer(page)).toBe(null);
  expect(undoPosts(server)).toEqual([]);
  expect(server.logs.get('hl-1').status).toBe('active');
  expect(server.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('a held Undo keeps every Home control locked; repeated taps send one Undo', async ({ page }) => {
  const { server, results } = await setup(page);
  await page.getByTestId('client-today-quick-complete').click();
  await expect(page.getByTestId('home-undo')).toContainText('marked done');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const release = held(server, 'undo');
  await page.getByTestId('home-undo-button').click();
  await expect(page.getByTestId('home-undo-button')).toBeDisabled();
  // A forced second tap while the Undo is in flight does nothing.
  await page.getByTestId('home-undo-button').dispatchEvent('click');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('home-undo-button')).toBeDisabled();
  await expect(page.getByTestId('client-today-quick-complete')).toBeDisabled();
  expect(undoPosts(server)).toHaveLength(1);
  release();
  await expect(page.getByTestId('home-undo')).toHaveCount(0);
  expect(undoPosts(server)).toHaveLength(1);
  expect(server.logs.get('hl-1').status).toBe('active');
  expect(server.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('Undo of an unconfirmed tap stays locked through the replay and the held inverse; one Undo is sent', async ({ page }) => {
  const { server, results } = await setup(page);
  server.drop.add('mark');
  await page.getByTestId('client-today-quick-complete').click();
  await expect(page.getByTestId('home-undo')).toContainText('not confirmed yet');
  const { event_id: eventId } = await pointer(page);
  server.drop.delete('mark');
  const releaseUndo = held(server, 'undo');
  await page.getByTestId('home-undo-button').click();
  // The replay answers, then the inverse is held: still one locked operation.
  await expect.poll(() => undoPosts(server).length).toBe(1);
  await expect(page.getByTestId('home-undo-button')).toBeDisabled();
  await expect(page.getByTestId('client-today-quick-complete')).toBeDisabled();
  await page.getByTestId('home-undo-button').dispatchEvent('click');
  await page.waitForTimeout(300);
  expect(undoPosts(server)).toHaveLength(1);
  // The pointer moved from the pending tap to its saved change, with the Undo id written before sending.
  expect(await pointer(page)).toMatchObject({ state: 'saved', logId: 'hl-1', change_id: eventId, undo_event_id: undoPosts(server)[0].body.event_id });
  releaseUndo();
  await expect(page.getByTestId('home-undo')).toHaveCount(0);
  expect(undoPosts(server)).toHaveLength(1);
  expect(new Set(marks(server).map((r) => r.body.event_id))).toEqual(new Set([eventId]));
  expect(server.logs.get('hl-1').status).toBe('active');
  expect(server.logs.get('hl-1').sets).toEqual(untouchedSets('hl-1'));
  expect(await pointer(page)).toBe(null);
  expect(server.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('a late check of an older Undo never erases a newer Mark done\'s Undo saved by another tab', async ({ page }) => {
  const { server, results } = await setup(page);
  await page.getByTestId('client-today-quick-complete').click();
  await expect(page.getByTestId('home-undo')).toContainText('Fictional Tuesday marked done');
  await page.keyboard.press('Escape');
  const older = await pointer(page);
  // This tab's check of the older Undo is held across a reload; another device
  // changes that log meanwhile, so the check will answer "no longer current".
  const release = held(server, 'undo-get');
  await page.reload();
  await expect(page.getByTestId('home-undo')).toContainText('Fictional Tuesday marked done');
  server.logs.get('hl-1').current_change = null;
  // A second tab marks the next workout done: the shared pointer moves on.
  const tabB = await page.context().newPage();
  tabB.on('pageerror', (error) => results.errors.push(error.message));
  await tabB.goto('/client');
  await expect(tabB.getByTestId('client-today-plan-title')).toHaveText('Fictional Wednesday');
  await tabB.getByTestId('client-today-quick-complete').click();
  await expect(tabB.getByTestId('home-undo')).toContainText('Fictional Wednesday marked done');
  const newer = await pointer(tabB);
  expect(newer).toMatchObject({ state: 'saved', logId: 'hl-2' });
  expect(newer.change_id).not.toBe(older.change_id);
  // The older check now answers; it may only clear the pointer it asked about.
  release();
  await expect.poll(() => server.requests.filter((r) => r.method === 'GET' && r.path === '/workout-logs/hl-1/undo').length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await pointer(page)).toEqual(newer);
  await tabB.reload();
  await expect(tabB.getByTestId('home-undo')).toContainText('Fictional Wednesday marked done');
  expect(server.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});
