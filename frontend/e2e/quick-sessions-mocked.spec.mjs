// A4-A6 browser races for quick-session recovery, against an in-test fake backend that survives
// page reloads (preview fixtures intentionally reset on reload, so they cannot prove this).
// Real transactional idempotency and authorization are proven by the SQL suite instead.
import { test, expect } from '@playwright/test';

const COACH = { id: 'coach-1', name: 'Coach Sam', email: 'coach@example.invalid', is_admin: false };
const CLIENT = { id: 'client-1', coach_id: 'coach-1', name: 'Casey Client', email: 'casey@example.invalid', archived: false };
const CLIENT_TWO = { id: 'client-2', coach_id: 'coach-1', name: 'Drew Client', email: 'drew@example.invalid', archived: false };
const PENDING_PREFIX = 'cvf_quick_session_pending:v1:';
const LIBRARY = [{ id: 'lib-1', name: 'Goblet Squat', hidden: false }];

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

/** In-memory stand-in for the quick-session endpoints; lives in the test process. */
class FakeBackend {
  constructor() {
    this.receipts = new Map();    // request_id -> { fingerprint, assignment }
    this.assignments = [];
    this.createAttempts = [];     // every POST body that reached the server
    this.committedCreates = 0;
    this.statusCalls = [];
    this.startCalls = [];
    this.libraryCalls = [];
    this.logs = new Map();        // assignment id -> log
    this.templates = new Map();   // assignment id -> template id
    this.clientAccess = new Set([CLIENT.id, CLIENT_TWO.id]);
    this.hold = null;             // { gate } holds the next create before it commits
    this.dropNextCreateResponse = false;
    this.dropNextStartResponse = false;
    this.dropNextLibraryResponse = false;
    this.failNextLibrary = false;
    this.followupDelay = null;     // { operation, gate, done, failure } holds a committed follow-up reply
    this.statusDelay = null;      // deferred that holds the next status reply
  }

  fingerprint(body) {
    const { request_id: _id, ...rest } = body;
    return JSON.stringify(rest);
  }

  commit(body) {
    const existing = this.receipts.get(body.request_id);
    if (existing) {
      if (!this.clientAccess.has(existing.assignment.client_id)) return { status: 404, body: { state: 'not_found' } };
      return existing.fingerprint === this.fingerprint(body)
        ? { status: 200, body: { state: 'replayed', assignment: existing.assignment } }
        : { status: 409, body: { state: 'request_mismatch' } };
    }
    if (!this.clientAccess.has(body.client_id)) return { status: 404, body: { state: 'not_found' } };
    this.committedCreates += 1;
    const assignment = {
      id: `qa-${this.committedCreates}`, kind: 'quick', client_id: body.client_id, assignment_mode: 'dated', assigned_for: body.assigned_for,
      notes: body.notes, archived: false, library_template_id: null, quick_session_completed: false, exercise_loads: [],
      workout: { id: `qw-${this.committedCreates}`, name: body.name, is_template: false, client_id: body.client_id, exercises: body.exercises.map((exercise, index) => ({ id: `qe-${index}`, position: index, ...exercise })) },
    };
    this.receipts.set(body.request_id, { fingerprint: this.fingerprint(body), assignment });
    this.assignments.push(assignment);
    return { status: 201, body: { state: 'created', assignment } };
  }
}

async function install(page, backend) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('cvf_access_token')) localStorage.setItem('cvf_access_token', 'test-token');
  });
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : {};

    if (path === '/auth/me') return json(route, 200, { role: 'coach', email: COACH.email, profile: COACH });
    const client = path.match(/^\/clients\/([^/]+)$/);
    if (client && method === 'GET') {
      const row = [CLIENT, CLIENT_TWO].find((candidate) => candidate.id === client[1]);
      return row && backend.clientAccess.has(row.id) ? json(route, 200, row) : json(route, 404, { error: 'Client not found' });
    }
    if (/^\/waivers\/client\/[^/]+\/status$/.test(path)) return json(route, 200, { has_version: false, signed_latest: false, history: [] });
    if (path === '/programs/exercise-library') return json(route, 200, LIBRARY);
    if (path === '/programs' || path === '/programs/workouts') return json(route, 200, []);
    const assignments = path.match(/^\/programs\/workout-assignments\/client\/([^/]+)$/);
    if (assignments) return json(route, 200, backend.assignments.filter((row) => row.client_id === assignments[1]));
    if (/^\/programs\/program-assignments\/client\/[^/]+$/.test(path)) return json(route, 200, []);
    if (/^\/workout-logs\/client\/[^/]+$/.test(path)) return json(route, 200, url.searchParams.get('paged') === '1' ? { logs: [], next_cursor: null } : []);

    if (path === '/programs/quick-sessions' && method === 'POST') {
      backend.createAttempts.push(body);
      if (backend.hold) {
        const { gate } = backend.hold;
        backend.hold = null;
        await gate.promise;   // the request is in flight; the server has not committed yet
      }
      const result = backend.commit(body);
      if (backend.dropNextCreateResponse) { backend.dropNextCreateResponse = false; return route.abort('failed').catch(() => {}); }
      return json(route, result.status, result.body);
    }
    const status = path.match(/^\/programs\/quick-sessions\/requests\/([^/]+)$/);
    if (status) {
      backend.statusCalls.push(status[1]);
      if (backend.statusDelay) { const gate = backend.statusDelay; backend.statusDelay = null; await gate.promise; }
      const receipt = backend.receipts.get(status[1]);
      if (!receipt || !backend.clientAccess.has(receipt.assignment.client_id)) return json(route, 404, { state: 'not_found' });
      return json(route, 200, { state: 'committed', assignment: receipt.assignment });
    }
    const library = path.match(/^\/programs\/quick-sessions\/([^/]+)\/save-to-library$/);
    if (library) {
      backend.libraryCalls.push(library[1]);
      const delay = backend.followupDelay?.operation === 'library' ? backend.followupDelay : null;
      if (delay) backend.followupDelay = null;
      if (backend.failNextLibrary) { backend.failNextLibrary = false; return json(route, 500, { error: 'Failed to save to the studio library' }); }
      const replayed = backend.templates.has(library[1]);
      if (!replayed) backend.templates.set(library[1], `tmpl-${backend.templates.size + 1}`);
      const response = { state: replayed ? 'replayed' : 'saved', template_id: backend.templates.get(library[1]) };
      if (backend.dropNextLibraryResponse) { backend.dropNextLibraryResponse = false; return route.abort('failed').catch(() => {}); }
      if (delay) {
        await delay.gate.promise;
        await json(route, delay.failure ? 500 : replayed ? 200 : 201, delay.failure ? { error: 'Old library failure' } : response);
        delay.done.resolve();
        return;
      }
      return json(route, replayed ? 200 : 201, response);
    }
    if (path === '/workout-logs/start' && method === 'POST') {
      backend.startCalls.push(body);
      const delay = backend.followupDelay?.operation === 'start' ? backend.followupDelay : null;
      if (delay) backend.followupDelay = null;
      const existing = backend.logs.get(body.workout_assignment_id);
      const log = existing || { id: `log-${backend.logs.size + 1}`, workout_name: 'Quick', status: 'active', exercises: [], client_id: body.client_id };
      backend.logs.set(body.workout_assignment_id, log);
      if (backend.dropNextStartResponse) { backend.dropNextStartResponse = false; return route.abort('failed').catch(() => {}); }
      if (delay) {
        await delay.gate.promise;
        await json(route, delay.failure ? 409 : 201, delay.failure
          ? { error: 'Old start conflict', active_workout: { id: 'old-log' } }
          : { outcome: 'started', workout_log: log });
        delay.done.resolve();
        return;
      }
      return json(route, existing ? 200 : 201, { outcome: existing ? 'resumed' : 'started', workout_log: log });
    }
    if (/^\/workout-logs\/[^/]+$/.test(path)) return json(route, 200, [...backend.logs.values()][0] || null);
    if (path === '/notifications/unread-count') return json(route, 200, { unread: 0 });
    return json(route, 200, []);
  });
}

async function openBuilder(page, clientId = CLIENT.id) {
  await page.goto(`/coach/clients/${clientId}?tab=programs`);
  await expect(page.getByTestId('assign-program-button')).toBeVisible();
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session' }).click();
  await expect(page.getByTestId('quick-session-builder')).toBeVisible();
}

async function fillAndAssign(page, title, { start = false } = {}) {
  await page.getByTestId('quick-session-exercise-name-input').first().fill('Goblet Squat');
  await page.getByTestId('quick-session-sets-input').first().fill('3');
  await page.getByTestId('quick-session-title-input').fill(title);
  await page.getByTestId(start ? 'quick-session-start-now-button' : 'quick-session-assign-button').click();
}

const pendingEntries = (page) => page.evaluate((prefix) => Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)), PENDING_PREFIX);

test('A4 lost create response + reload recovers the committed session without resubmitting', async ({ page }) => {
  const backend = new FakeBackend();
  backend.dropNextCreateResponse = true;
  await install(page, backend);
  await openBuilder(page);
  await fillAndAssign(page, 'Lost reply');
  await expect(page.getByTestId('quick-session-recovery')).toContainText("We couldn't confirm this save");
  expect(backend.committedCreates).toBe(1);
  const [[key, value]] = await pendingEntries(page);
  expect(key).toContain(':coach-1:');
  expect(Object.keys(JSON.parse(value)).sort()).toEqual(['client_id', 'created_at', 'request_id', 'state', 'v']);
  expect(value).not.toContain('Lost reply');
  expect(value).not.toContain('Goblet');
  await page.reload();
  await expect(page.getByTestId('quick-session-recovered')).toContainText('Lost reply');
  await expect(page.getByTestId('assigned-workout-card').filter({ hasText: 'Lost reply' })).toHaveCount(1);
  expect(await pendingEntries(page)).toEqual([]);
  expect(backend.createAttempts).toHaveLength(1);
});

test('A4 status before a delayed commit stays uncertain under the same UUID; the late commit is recovered', async ({ page }) => {
  const backend = new FakeBackend();
  const gate = deferred();
  backend.hold = { gate };
  await install(page, backend);
  await openBuilder(page);
  await fillAndAssign(page, 'Late arrival');
  await expect.poll(() => backend.createAttempts.length).toBe(1);
  const requestId = backend.createAttempts[0].request_id;
  await page.reload();                       // the original request is still on its way
  const recovery = page.getByTestId('quick-session-recovery');
  await expect(recovery).toContainText("Couldn't recover an earlier save. It may still arrive.");
  expect((await pendingEntries(page))[0][0]).toContain(requestId);
  gate.resolve();                            // the original finally commits
  await expect.poll(() => backend.committedCreates).toBe(1);
  await recovery.getByTestId('quick-session-check-again').click();
  await expect(page.getByTestId('quick-session-recovered')).toContainText('Late arrival');
  expect(await pendingEntries(page)).toEqual([]);
  expect(backend.createAttempts).toHaveLength(1);
});

for (const order of ['original-first', 'reentry-first']) {
  test(`A3/A4 competing original and re-entered bodies (${order}) commit once; status shows the winner`, async ({ page }) => {
    const backend = new FakeBackend();
    const gate = deferred();
    backend.hold = { gate };
    await install(page, backend);
    await openBuilder(page);
    await fillAndAssign(page, 'Original body');
    await expect.poll(() => backend.createAttempts.length).toBe(1);
    await page.reload();
    const recovery = page.getByTestId('quick-session-recovery');
    await expect(recovery).toContainText("Couldn't recover");
    if (order === 'original-first') { gate.resolve(); await expect.poll(() => backend.committedCreates).toBe(1); }
    await recovery.getByTestId('quick-session-reenter').click();
    await expect(page.getByTestId('quick-session-builder')).toBeVisible();
    await fillAndAssign(page, 'Re-entered body');
    const winner = order === 'original-first' ? 'Original body' : 'Re-entered body';
    await expect(page.getByTestId('quick-session-saved')).toContainText(winner);
    if (order === 'reentry-first') { gate.resolve(); await expect.poll(() => backend.createAttempts.length).toBe(2); }
    expect(new Set(backend.createAttempts.map((attempt) => attempt.request_id)).size).toBe(1);
    expect(backend.committedCreates).toBe(1);
    expect(backend.assignments.map((row) => row.workout.name)).toEqual([winner]);
    expect(await pendingEntries(page)).toEqual([]);
  });
}

test('A2/A4 masked access: re-entry is refused without showing old data, and the pending record stays', async ({ page }) => {
  const backend = new FakeBackend();
  backend.hold = { gate: deferred() };       // never commits during this test
  await install(page, backend);
  await openBuilder(page);
  await fillAndAssign(page, 'Never shown');
  await expect.poll(() => backend.createAttempts.length).toBe(1);
  await page.reload();
  const recovery = page.getByTestId('quick-session-recovery');
  await expect(recovery).toContainText("Couldn't recover");
  backend.clientAccess.delete(CLIENT.id);    // the client is reassigned away before re-entry
  await recovery.getByTestId('quick-session-reenter').click();
  await expect(recovery).toContainText('You no longer have access to this client');
  await expect(page.getByText('Never shown')).toHaveCount(0);
  expect(await pendingEntries(page)).toHaveLength(1);
});

test('A5 a stale create reply after a page change neither displays, clears storage, nor chains Start/library', async ({ page }) => {
  const backend = new FakeBackend();
  const gate = deferred();
  backend.hold = { gate };
  await install(page, backend);
  await openBuilder(page);
  await page.getByTestId('quick-session-library-checkbox').click();
  await fillAndAssign(page, 'Stale reply', { start: true });
  await expect.poll(() => backend.createAttempts.length).toBe(1);
  // Leave for another client's page (new page token / client) while the reply is pending.
  await page.evaluate((href) => { window.history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, `/coach/clients/${CLIENT_TWO.id}?tab=programs`);
  await expect(page.getByRole('heading', { name: CLIENT_TWO.name })).toBeVisible();
  gate.resolve();
  await expect.poll(() => backend.committedCreates).toBe(1);
  await page.waitForTimeout(500);
  expect(backend.startCalls).toHaveLength(0);
  expect(backend.libraryCalls).toHaveLength(0);
  await expect(page).toHaveURL(new RegExp(`/coach/clients/${CLIENT_TWO.id}`));
  expect(await pendingEntries(page)).toHaveLength(1);   // only a current, known success may clear it
});

test('A5 two tabs: different UUIDs survive each other; a shared UUID converges by status without resubmitting', async ({ context }) => {
  const backend = new FakeBackend();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await install(tabA, backend);
  await install(tabB, backend);
  const gate = deferred();
  backend.hold = { gate };
  await openBuilder(tabA);
  await fillAndAssign(tabA, 'Tab A');
  await expect.poll(() => backend.createAttempts.length).toBe(1);
  await openBuilder(tabB);
  backend.dropNextCreateResponse = true;
  await fillAndAssign(tabB, 'Tab B');
  await expect.poll(() => backend.committedCreates).toBe(1);   // B committed, its reply was lost
  expect(await pendingEntries(tabB)).toHaveLength(2);
  gate.resolve();                                                // A's create commits and answers
  await expect(tabA.getByTestId('quick-session-saved')).toContainText('Tab A');
  const remaining = await pendingEntries(tabA);
  expect(remaining).toHaveLength(1);
  expect(JSON.parse(remaining[0][1]).request_id).toBe(backend.createAttempts[1].request_id);
  // Tab B learns of A's removal only as a refresh hint; it never rewrites or resubmits.
  await tabB.getByTestId('quick-session-check-again').first().click();
  await expect(tabB.getByTestId('quick-session-saved')).toContainText('Tab B');
  expect(await pendingEntries(tabB)).toEqual([]);
  expect(backend.createAttempts).toHaveLength(2);
});

test('A5 corrupt entries are scoped and blocked storage still saves with recovery reported unavailable', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await page.addInitScript((prefix) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(`${prefix}same-origin:coach-1:not-a-uuid`, '{"workout":"leak?"');
  }, PENDING_PREFIX);
  await openBuilder(page);
  await expect(page.getByTestId('quick-session-corrupt')).toContainText("couldn't be read");
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('quick-session-corrupt-discard').click();
  expect(await pendingEntries(page)).toEqual([]);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (String(key).startsWith('cvf_quick_session_pending')) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await fillAndAssign(page, 'No storage');
  await expect(page.getByTestId('quick-session-saved')).toContainText('No storage');
  expect(backend.committedCreates).toBe(1);
});

test('A6 lost Start and library replies retry only those operations and never resend create', async ({ page }) => {
  const backend = new FakeBackend();
  backend.dropNextStartResponse = true;
  backend.dropNextLibraryResponse = true;
  await install(page, backend);
  await openBuilder(page);
  await page.getByTestId('quick-session-library-checkbox').click();
  await fillAndAssign(page, 'Follow-ups', { start: true });
  await expect(page.getByTestId('quick-session-library-failed')).toContainText('Session assigned — saving to library failed');
  await expect(page.getByTestId('quick-session-start-failed')).toBeVisible();
  await page.getByTestId('quick-session-library-retry').click();
  await expect(page.getByTestId('quick-session-library-saved')).toBeVisible();
  await page.getByTestId('quick-session-start-retry').click();
  await expect(page).toHaveURL(/\/coach\/workouts\/log-1\/track$/);
  expect(backend.createAttempts).toHaveLength(1);
  expect(backend.libraryCalls).toEqual(['qa-1', 'qa-1']);
  expect(backend.startCalls.map((call) => call.workout_assignment_id)).toEqual(['qa-1', 'qa-1']);
  expect(backend.templates.size).toBe(1);
  expect(backend.logs.size).toBe(1);
});


for (const operation of ['start', 'library', 'library-then-start']) {
  for (const failure of [false, true]) {
    test(`F1 delayed ${operation} ${failure ? 'failure' : 'success'} after Done cannot own a newer session`, async ({ page }) => {
      const backend = new FakeBackend();
      const delay = { operation: operation === 'start' ? 'start' : 'library', gate: deferred(), done: deferred(), failure };
      backend.followupDelay = delay;
      await install(page, backend);
      await openBuilder(page);
      if (operation === 'library-then-start') await page.getByTestId('quick-session-library-checkbox').click();
      await fillAndAssign(page, 'Session A', { start: operation === 'library-then-start' });
      await expect(page.getByTestId('quick-session-saved')).toContainText('Session A');
      if (operation !== 'library-then-start') await page.getByTestId(operation === 'start' ? 'quick-session-start-saved' : 'quick-session-save-library').click();
      await expect.poll(() => operation === 'start' ? backend.startCalls.length : backend.libraryCalls.length).toBe(1);
      await page.getByTestId('quick-session-done').click();
      await page.getByTestId('assign-program-button').click();
      await page.getByTestId('client-assignment-type-select').click();
      await page.getByRole('option', { name: 'Quick session' }).click();
      await fillAndAssign(page, 'Session B');
      await expect(page.getByTestId('quick-session-saved')).toContainText('Session B');
      delay.gate.resolve();
      await delay.done.promise;
      await page.waitForTimeout(300); // let the released HTTP reply reach the React controller
      await expect(page).toHaveURL(/\/coach\/clients\/client-1/);
      await expect(page.getByTestId('quick-session-saved')).toContainText('Session B');
      await expect(page.getByTestId('quick-session-library-saved')).toHaveCount(0);
      await expect(page.getByTestId('quick-session-library-failed')).toHaveCount(0);
      await expect(page.getByTestId('quick-session-start-failed')).toHaveCount(0);
      expect(backend.startCalls).toHaveLength(operation === 'start' ? 1 : 0);
      expect(backend.createAttempts).toHaveLength(2);
    });
  }
}
