import { mkdir, writeFile } from 'node:fs/promises';
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
    this.rejectNextCreate = false;
    this.dropNextStartResponse = false;
    this.dropNextLibraryResponse = false;
    this.failNextLibrary = false;
    this.followupDelay = null;     // { operation, gate, done, failure } holds a committed follow-up reply
    this.statusDelay = null;      // deferred that holds the next status reply
    this.exerciseLibraryCalls = 0;
    this.exerciseLibraryFailures = 0;
    this.exerciseLibraryDelay = null;
    this.createHydrationFailures = 0;
    this.statusFailures = 0;
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
    if (path === '/clients' && method === 'GET') return json(route, 200, [CLIENT, CLIENT_TWO]);
    const client = path.match(/^\/clients\/([^/]+)$/);
    if (client && method === 'GET') {
      const row = [CLIENT, CLIENT_TWO].find((candidate) => candidate.id === client[1]);
      return row && backend.clientAccess.has(row.id) ? json(route, 200, row) : json(route, 404, { error: 'Client not found' });
    }
    if (/^\/waivers\/client\/[^/]+\/status$/.test(path)) return json(route, 200, { has_version: false, signed_latest: false, history: [] });
    if (path === '/programs/exercise-library') {
      backend.exerciseLibraryCalls++;
      const fail = backend.exerciseLibraryFailures-- > 0;
      const data = backend.exerciseLibraryDelay ? [{ id: 'stale-lib', name: 'Stale library response', hidden: false }] : LIBRARY;
      if (backend.exerciseLibraryDelay) {
        const gate = backend.exerciseLibraryDelay; backend.exerciseLibraryDelay = null;
        await gate.promise;
      }
      return fail ? json(route, 500, { error: 'Could not load the exercise library' }) : json(route, 200, data);
    }
    if (/^\/workout-logs\/clients\/[^/]+\/week-rhythm$/.test(path)) return json(route, 200, { week_total: 0, week_done: 0, days: [] });
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
      if (backend.rejectNextCreate) {
        backend.rejectNextCreate = false;
        return json(route, 400, { error: 'Fictional definitive validation rejection' });
      }
      const result = backend.commit(body);
      if (backend.createHydrationFailures-- > 0) return json(route, 500, { error: 'Failed to save the quick session' });
      if (backend.dropNextCreateResponse) { backend.dropNextCreateResponse = false; return route.abort('failed').catch(() => {}); }
      return json(route, result.status, result.body);
    }
    const status = path.match(/^\/programs\/quick-sessions\/requests\/([^/]+)$/);
    if (status) {
      backend.statusCalls.push(status[1]);
      if (backend.statusFailures-- > 0) return json(route, 500, { error: 'Failed to recover the quick session' });
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
      const assignment = backend.assignments.find((row) => row.id === library[1]);
      if (assignment) assignment.library_template_id = response.template_id;
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
        await json(route, delay.failure === 'error' ? 500 : delay.failure ? 409 : 201, delay.failure
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

for (const [transition, width] of [['close', 320], ['close', 390], ['close', 1280], ['type', 390]]) {
  test(`confirmed ${transition} discards a definitively rejected Quick request at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    if (process.env.CVF_PR116_EVIDENCE_DIR) await page.clock.setFixedTime(new Date('2026-10-16T18:00:00Z'));
    const backend = new FakeBackend();
    backend.rejectNextCreate = true;
    await install(page, backend);
    await openBuilder(page);
    await fillAndAssign(page, 'Abandoned rejected draft');
    const rejected = page.getByTestId('quick-session-rejected');
    await expect(rejected).toContainText('Fictional definitive validation rejection');
    const original = await pendingEntries(page);
    expect(original).toHaveLength(1);
    const oldId = backend.createAttempts[0].request_id;
    const otherKey = original[0][0].replace(':coach-1:', ':unrelated-coach:');
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [otherKey, original[0][1]]);
    const leave = async () => {
      if (transition === 'close') await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      else {
        await page.getByTestId('client-assignment-type-select').click();
        await page.getByRole('option', { name: 'Standalone workout', exact: true }).click();
      }
    };
    page.once('dialog', (dialog) => dialog.dismiss());
    await leave();
    await expect(rejected).toBeVisible();
    await expect(page.getByTestId('quick-session-title-input')).toHaveValue('Abandoned rejected draft');
    expect(await pendingEntries(page)).toHaveLength(2);
    page.once('dialog', (dialog) => dialog.accept());
    await leave();
    if (transition === 'close') await page.getByTestId('assign-program-button').click();
    else {
      await page.getByTestId('client-assignment-type-select').click();
      await page.getByRole('option', { name: 'Quick session', exact: true }).click();
    }
    await expect(page.getByTestId('quick-session-exercise-name-input').first()).toHaveValue('');
    if (process.env.CVF_PR116_EVIDENCE_DIR && transition === 'close') {
      await mkdir(process.env.CVF_PR116_EVIDENCE_DIR, { recursive: true });
      await page.getByTestId('quick-session-assign-button').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.CVF_PR116_EVIDENCE_DIR}/discard-${width}.png`, animations: 'disabled' });
    }
    expect(await pendingEntries(page)).toEqual([[otherKey, original[0][1]]]);
    await expect(rejected).toHaveCount(0);
    await fillAndAssign(page, 'New request after discard');
    await expect(page.getByTestId('quick-session-saved')).toContainText('New request after discard');
    expect(backend.createAttempts[1].request_id).not.toBe(oldId);
    expect(backend.committedCreates).toBe(1);
    await page.reload();
    await expect(page.getByTestId('assigned-workout-card').filter({ hasText: 'New request after discard' })).toHaveCount(1);
    expect(backend.statusCalls).not.toContain(oldId);
    expect(await pendingEntries(page)).toEqual([[otherKey, original[0][1]]]);
  });
}

test('confirmed route navigation discards a definitively rejected Quick request', async ({ page }) => {
  const backend = new FakeBackend();
  backend.rejectNextCreate = true;
  await install(page, backend);
  await page.goto('/coach/clients');
  await page.getByTestId('client-row').filter({ hasText: CLIENT.name }).click();
  await page.getByTestId('tab-programs').click();
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session', exact: true }).click();
  await fillAndAssign(page, 'Rejected before navigation');
  await expect(page.getByTestId('quick-session-rejected')).toBeVisible();
  const original = await pendingEntries(page);
  expect(original).toHaveLength(1);
  const oldId = backend.createAttempts[0].request_id;
  // Exercise the router guard while the modal is open, as browser navigation does.
  const navigateAway = () => page.locator('a[href="/coach/clients"]').first().evaluate((link) => link.click());
  let acceptDiscard = false;
  let handledPrompts = 0;
  page.on('dialog', async (dialog) => {
    if (acceptDiscard) await dialog.accept(); else await dialog.dismiss();
    handledPrompts++;
  });
  await navigateAway();
  await expect.poll(() => handledPrompts).toBe(1);
  await expect(page.getByTestId('quick-session-rejected')).toBeVisible();
  expect(await pendingEntries(page)).toEqual(original);
  acceptDiscard = true;
  await navigateAway();
  await expect.poll(() => handledPrompts).toBe(2);
  await expect(page).toHaveURL(/\/coach\/clients$/);
  expect(await pendingEntries(page)).toEqual([]);
  await page.getByTestId('client-row').filter({ hasText: CLIENT.name }).click();
  await page.getByTestId('tab-programs').click();
  await expect(page.getByTestId('assign-program-button')).toBeVisible();
  await expect(page.getByTestId('quick-session-recovery')).toHaveCount(0);
  expect(backend.statusCalls).not.toContain(oldId);
});

for (const phase of ['in-flight', 'uncertain']) {
  test(`closing and changing type retain ${phase} Quick recovery and its frozen prescription`, async ({ page }) => {
    const backend = new FakeBackend();
    const gate = deferred();
    if (phase === 'in-flight') backend.hold = { gate };
    else backend.dropNextCreateResponse = true;
    await install(page, backend);
    await openBuilder(page);
    await fillAndAssign(page, 'Retained pending prescription');
    await expect.poll(() => backend.createAttempts.length).toBe(1);
    if (phase === 'uncertain') await expect(page.getByTestId('quick-session-recovery')).toContainText("We couldn't confirm");
    const original = await pendingEntries(page);
    expect(original).toHaveLength(1);
    let prompts = 0;
    page.on('dialog', async (dialog) => { prompts++; await dialog.dismiss(); });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    expect(await pendingEntries(page)).toEqual(original);
    await page.getByTestId('assign-program-button').click();
    await page.getByTestId('client-assignment-type-select').click();
    await page.getByRole('option', { name: 'Standalone workout', exact: true }).click();
    await page.getByTestId('client-assignment-type-select').click();
    await page.getByRole('option', { name: 'Quick session', exact: true }).click();
    await expect(page.getByTestId('quick-session-title-input')).toHaveValue('Retained pending prescription');
    await expect(page.getByTestId('quick-session-title-input')).toBeDisabled();
    expect(await pendingEntries(page)).toEqual(original);
    expect(backend.createAttempts).toHaveLength(1);
    expect(prompts).toBe(0);
    if (phase === 'in-flight') gate.resolve();
    else await page.getByTestId('quick-session-retry-save').click();
    await expect(page.getByTestId('quick-session-saved')).toContainText('Retained pending prescription');
    expect(backend.committedCreates).toBe(1);
    if (phase === 'uncertain') expect(backend.createAttempts[1]).toEqual(backend.createAttempts[0]);
    expect(await pendingEntries(page)).toEqual([]);
  });
}

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

async function cardNotifications(page) {
  return page.evaluate(async () => {
    const { toast } = await import('/src/components/ui/sonner.jsx');
    return toast.getHistory().map(({ type, title }) => ({ type, title }));
  });
}

// R1/R2 integration review regressions: real card/form behavior, fictional transport only.
async function switchClientInPlace(page, clientId) {
  await page.evaluate((href) => {
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/coach/clients/${clientId}?tab=programs`);
  await expect(page.getByTestId('assign-program-button')).toBeVisible();
}
async function releaseCardReply(page, delay) {
  delay.gate.resolve();
  await delay.done.promise;
  // Allow the delivered XHR, React effects and any forbidden navigation/toast to settle.
  await page.waitForTimeout(200);
}
async function savedCard(page, backend, name) {
  await openBuilder(page);
  await fillAndAssign(page, name);
  await expect(page.getByTestId('quick-session-saved')).toBeVisible();
  await page.getByTestId('quick-session-done').click();
  return page.getByTestId('assigned-workout-card').filter({ hasText: name });
}
for (const outcome of ['success', 'conflict', 'error']) {
  test(`R1 delayed Quick card Start ${outcome} cannot affect another client page`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    const card = await savedCard(page, backend, 'Card Session A');
    const delay = { operation: 'start', gate: deferred(), done: deferred(), failure: outcome === 'success' ? false : outcome === 'error' ? 'error' : true };
    backend.followupDelay = delay;
    await card.getByTestId('coach-log-standalone-workout').click();
    await expect.poll(() => backend.startCalls.length).toBe(1);
    await switchClientInPlace(page, CLIENT_TWO.id);
    await expect(page.getByTestId('client-detail-name')).toHaveText(CLIENT_TWO.name);
    await releaseCardReply(page, delay);
    await expect(page).toHaveURL(/\/coach\/clients\/client-2/);
    await expect(page.getByTestId('client-detail-name')).toHaveText(CLIENT_TWO.name);
    expect(await cardNotifications(page)).toEqual([]);
    expect(backend.startCalls).toHaveLength(1);
  });
}
for (const failure of [false, true]) {
  test(`R1 delayed Quick card library ${failure ? 'failure' : 'success'} cannot toast or reload another client`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    const card = await savedCard(page, backend, 'Card Library A');
    const delay = { operation: 'library', gate: deferred(), done: deferred(), failure };
    backend.followupDelay = delay;
    const reads = [];
    page.on('request', (request) => { if (request.url().includes('/workout-assignments/client/client-1')) reads.push(request.url()); });
    await card.getByTestId('quick-session-card-save-library').click();
    await expect.poll(() => backend.libraryCalls.length).toBe(1);
    await switchClientInPlace(page, CLIENT_TWO.id);
    await expect(page.getByTestId('client-detail-name')).toHaveText(CLIENT_TWO.name);
    const readsBeforeReply = reads.length;
    await releaseCardReply(page, delay);
    await expect(page).toHaveURL(/\/coach\/clients\/client-2/);
    expect(await cardNotifications(page)).toEqual([]);
    expect(reads).toHaveLength(readsBeforeReply);
    expect(backend.libraryCalls).toEqual(['qa-1']);
  });
}
test('R1 an older card Start reply cannot clear the newer assignment operation', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await savedCard(page, backend, 'Card A');
  const cardB = await savedCard(page, backend, 'Card B');
  const cardA = page.getByTestId('assigned-workout-card').filter({ hasText: 'Card A' });
  const first = { operation: 'start', gate: deferred(), done: deferred(), failure: false };
  backend.followupDelay = first;
  await cardA.getByTestId('coach-log-standalone-workout').click();
  await expect.poll(() => backend.startCalls.length).toBe(1);
  const second = { operation: 'start', gate: deferred(), done: deferred(), failure: false };
  backend.followupDelay = second;
  await cardB.getByTestId('coach-log-standalone-workout').click();
  await expect.poll(() => backend.startCalls.length).toBe(2);
  await releaseCardReply(page, first);
  await expect(page).toHaveURL(/\/coach\/clients\/client-1/);
  await expect(cardB.getByTestId('coach-log-standalone-workout')).toBeDisabled();
  await releaseCardReply(page, second);
  await expect(page).toHaveURL(/\/coach\/workouts\/log-2\/track$/);
  expect(backend.createAttempts).toHaveLength(2);
});
for (const phase of ['saving', 'uncertain', 'checking', 'unrecovered']) {
  test(`R2 complete typed prescription stays frozen and truthful while ${phase}`, async ({ page }) => {
    const backend = new FakeBackend();
    const gate = deferred();
    if (phase === 'saving') backend.hold = { gate };
    else backend.dropNextCreateResponse = true;
    await install(page, backend);
    await page.clock.setFixedTime(new Date('2026-10-14T17:00:00Z'));
    await openBuilder(page);
    await page.getByTestId('quick-session-exercise-name-input').first().fill('Fictional timed carry');
    await page.getByTestId('quick-session-more-button').first().click();
    await page.getByLabel('Exercise tracking type').selectOption('duration_distance');
    const duration = page.getByRole('spinbutton', { name: 'Target duration', exact: true });
    const distance = page.getByRole('spinbutton', { name: 'Target distance', exact: true });
    await duration.fill('60');
    await distance.fill('20');
    await page.getByTestId('quick-session-assign-button').click();
    await expect.poll(() => backend.createAttempts.length).toBe(1);
    if (phase !== 'saving') {
      await expect(page.getByTestId('quick-session-retry-save')).toBeVisible();
      if (phase === 'checking') {
        backend.statusDelay = gate;
        await page.getByTestId('quick-session-check-again').click();
        await expect.poll(() => backend.statusCalls.length).toBe(1);
      } else if (phase === 'unrecovered') {
        backend.receipts.clear(); // status remains unknown; the dispatched body stays frozen
        await page.getByTestId('quick-session-check-again').click();
        await expect(page.getByTestId('quick-session-reenter')).toBeVisible();
      }
    }
    const visual = [];
    for (const [width, height] of [[320, 640], [390, 844], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.getByLabel('Exercise tracking type').scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`frozen-${phase}-${width}.png`), animations: 'disabled' });
      visual.push(await page.evaluate(({ phase, width, height }) => ({ phase, width, height,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        duration: document.querySelector('[aria-label="Target duration"]').value,
        distance: document.querySelector('[aria-label="Target distance"]').value,
        disabled: [...document.querySelectorAll('[data-testid="quick-session-more-fields"] select, [data-testid="quick-session-more-fields"] input')].every(e => e.matches(':disabled')),
      }), { phase, width, height }));
    }
    await writeFile(test.info().outputPath('frozen-form-evidence.json'), JSON.stringify(visual, null, 2));
    await test.info().attach('frozen-form-evidence', { body: JSON.stringify(visual, null, 2), contentType: 'application/json' });
    try {
      expect(visual.every(row => !row.horizontalOverflow)).toBe(true);
      await expect(page.getByTestId('quick-session-title-input')).toBeDisabled();
      for (const control of [page.getByLabel('Exercise tracking type'), duration, distance,
        page.getByLabel('Target duration unit', { exact: true }), page.getByLabel('Target distance unit', { exact: true })]) await expect(control).toBeDisabled();
      await expect(duration).toHaveValue('60');
      await expect(distance).toHaveValue('20');
      await expect(page.getByLabel('Target duration unit', { exact: true })).toHaveValue('s');
      await expect(page.getByLabel('Target distance unit', { exact: true })).toHaveValue('m');
      expect(backend.createAttempts[0].exercises[0]).toMatchObject({ tracking_type: 'duration_distance', duration_value: '60', duration_unit: 's', distance_value: '20', distance_unit: 'm' });
    } finally { gate.resolve(); }
  });
}

for (const outcome of ['success', 'conflict', 'error']) {
  test(`R1 current Quick card Start still handles ${outcome}`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    const card = await savedCard(page, backend, 'Current card');
    const delay = { operation: 'start', gate: deferred(), done: deferred(), failure: outcome === 'success' ? false : outcome === 'error' ? 'error' : true };
    backend.followupDelay = delay;
    await card.getByTestId('coach-log-standalone-workout').click();
    await expect.poll(() => backend.startCalls.length).toBe(1);
    await releaseCardReply(page, delay);
    if (outcome === 'error') {
      await expect(page).toHaveURL(/\/coach\/clients\/client-1/);
      await expect(card.getByTestId('coach-log-standalone-workout')).toBeEnabled();
      expect(await cardNotifications(page)).toContainEqual({ type: 'error', title: 'Old start conflict' });
    } else await expect(page).toHaveURL(outcome === 'success' ? /\/coach\/workouts\/log-1\/track$/ : /\/coach\/workouts\/old-log\/track$/);
    expect(backend.startCalls).toHaveLength(1);
  });
}
for (const failure of [false, true]) {
  test(`R1 current Quick card library still handles ${failure ? 'failure' : 'success'}`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    const card = await savedCard(page, backend, 'Current library');
    const delay = { operation: 'library', gate: deferred(), done: deferred(), failure };
    backend.followupDelay = delay;
    await card.getByTestId('quick-session-card-save-library').click();
    await expect.poll(() => backend.libraryCalls.length).toBe(1);
    await releaseCardReply(page, delay);
    if (failure) expect(await cardNotifications(page)).toContainEqual({ type: 'error', title: 'Saving to library failed · Old library failure' });
    else {
      await expect(card.getByTestId('quick-session-in-library')).toBeVisible();
      expect(await cardNotifications(page)).toContainEqual({ type: 'success', title: 'Saved to the shared studio library as a hidden template.' });
    }
    expect(backend.libraryCalls).toEqual(['qa-1']);
  });
}

test('exercise-library failure shows an inline retry across dialog reopen and repeated failures', async ({ page }, testInfo) => {
  const backend = new FakeBackend();
  backend.exerciseLibraryFailures = 3;
  await install(page, backend);
  await page.goto(`/coach/clients/${CLIENT.id}?tab=programs`);
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session', exact: true }).click();
  await expect.poll(() => backend.exerciseLibraryCalls).toBe(1);
  // Evidence capture also runs on the exact baseline, where no error state exists.
  if (process.env.CVF_REPAIR_CAPTURE) {
    await page.screenshot({ path: `${process.env.CVF_REPAIR_CAPTURE}/library-${testInfo.project.name}.png` });
  }
  const error = page.getByTestId('quick-session-library-error');
  await expect(error).toContainText('Could not load the exercise library');
  await expect(page.getByTestId('quick-session-library-loading')).toHaveCount(0);
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => backend.exerciseLibraryCalls).toBe(2);
  await expect(error).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('assign-program-button').click();
  await expect.poll(() => backend.exerciseLibraryCalls).toBe(3);
  await expect(error).toBeVisible();
  const gate = deferred();
  backend.exerciseLibraryDelay = gate;
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('quick-session-library-loading')).toBeVisible();
  await expect(error).toHaveCount(0);
  gate.resolve();
  await expect(page.getByTestId('quick-session-builder')).toBeVisible();
  await fillAndAssign(page, 'After library retry');
  await expect(page.getByTestId('quick-session-saved')).toContainText('After library retry');
  expect(backend.committedCreates).toBe(1);
  expect(backend.exerciseLibraryCalls).toBe(4);
});

test('cross-tab removal of an unrecovered key refreshes status and clears the warning without a create', async ({ context }, testInfo) => {
  const backend = new FakeBackend();
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await install(tabA, backend); await install(tabB, backend);
  const gate = deferred(); backend.hold = { gate };
  await openBuilder(tabA); await fillAndAssign(tabA, 'Committed in another tab');
  await expect.poll(() => backend.createAttempts.length).toBe(1);
  await tabB.goto(`/coach/clients/${CLIENT.id}?tab=programs`);
  await expect(tabB.getByTestId('quick-session-recovery')).toContainText("Couldn't recover");
  const statuses = backend.statusCalls.length;
  gate.resolve();
  await expect(tabA.getByTestId('quick-session-saved')).toContainText('Committed in another tab');
  if (process.env.CVF_REPAIR_CAPTURE) {
    if (process.env.CVF_REPAIR_BASELINE) await expect(tabB.getByTestId('quick-session-recovery')).toContainText("Couldn't recover");
    else {
      await expect(tabB.getByTestId('quick-session-recovered')).toContainText('Committed in another tab');
      await expect(tabB.getByTestId('assigned-workout-card')).toHaveCount(1);
    }
    await tabB.screenshot({ path: `${process.env.CVF_REPAIR_CAPTURE}/cross-tab-${testInfo.project.name}.png` });
  }
  await expect.poll(() => backend.statusCalls.length).toBeGreaterThan(statuses);
  await expect(tabB.getByTestId('quick-session-recovery')).toHaveCount(0);
  await expect(tabB.getByTestId('quick-session-recovered')).toContainText('Committed in another tab');
  await expect(tabB.getByTestId('assigned-workout-card').filter({ hasText: 'Committed in another tab' })).toHaveCount(1);
  expect(await pendingEntries(tabB)).toEqual([]);
  expect(backend.createAttempts).toHaveLength(1);
  expect(backend.startCalls).toHaveLength(0); expect(backend.libraryCalls).toHaveLength(0);
});

for (const staleFailure of [false, true]) {
  test(`exercise-library delayed ${staleFailure ? 'failure' : 'success'} after close cannot replace a reopened dialog`, async ({ page }) => {
    const backend = new FakeBackend();
    const gate = deferred();
    backend.exerciseLibraryDelay = gate;
    backend.exerciseLibraryFailures = staleFailure ? 1 : 0;
    await install(page, backend);
    await page.goto(`/coach/clients/${CLIENT.id}?tab=programs`);
    await page.getByTestId('assign-program-button').click();
    await page.getByTestId('client-assignment-type-select').click();
    await page.getByRole('option', { name: 'Quick session', exact: true }).click();
    await expect.poll(() => backend.exerciseLibraryCalls).toBe(1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByTestId('assign-program-button').click();
    await expect.poll(() => backend.exerciseLibraryCalls).toBe(2);
    await expect(page.getByTestId('quick-session-builder')).toBeVisible();
    await page.getByTestId('quick-session-title-input').fill('Keep current editor');
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/api/programs/exercise-library'));
    gate.resolve();
    await oldResponse;
    await expect(page.getByTestId('quick-session-title-input')).toHaveValue('Keep current editor');
    await expect(page.getByTestId('quick-session-library-error')).toHaveCount(0);
    await expect(page.getByTestId('quick-session-library-loading')).toHaveCount(0);
    await expect(page.locator('datalist option[value="Goblet Squat"]')).toHaveCount(1);
    await expect(page.locator('datalist option[value="Stale library response"]')).toHaveCount(0);
    await fillAndAssign(page, 'Current after stale fetch');
    await expect(page.getByTestId('quick-session-saved')).toContainText('Current after stale fetch');
    expect(backend.committedCreates).toBe(1);
    expect(backend.createAttempts[0].exercises[0].exercise_library_id).toBe('lib-1');
  });
}

for (const recovery of ['retry', 'status']) {
  test(`postcommit hydration 500 remains recoverable by ${recovery} under the same request`, async ({ page }) => {
    const backend = new FakeBackend(); backend.createHydrationFailures = 1;
    await install(page, backend); await openBuilder(page);
    await fillAndAssign(page, 'Committed before read failed');
    const warning = page.getByTestId('quick-session-recovery');
    await expect(warning).toContainText("We couldn't confirm");
    expect(backend.committedCreates).toBe(1);
    expect(await pendingEntries(page)).toHaveLength(1);
    if (recovery === 'retry') {
      await page.getByTestId('quick-session-retry-save').click();
    } else {
      backend.statusFailures = 1;
      await page.getByTestId('quick-session-check-again').click();
      await expect(warning).toContainText("We couldn't confirm");
      await page.getByTestId('quick-session-check-again').click();
    }
    await expect(page.getByTestId('quick-session-saved')).toContainText('Committed before read failed');
    if (recovery === 'retry') {
      expect(backend.createAttempts).toHaveLength(2);
      expect(backend.createAttempts[1]).toEqual(backend.createAttempts[0]);
    } else {
      expect(backend.createAttempts).toHaveLength(1);
      expect(backend.statusCalls).toHaveLength(2);
    }
    expect(backend.committedCreates).toBe(1);
    expect(await pendingEntries(page)).toEqual([]);
  });
}

test('typing a custom name key by key past a catalog name keeps its spaces; a typed catalog name still links', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await openBuilder(page);
  const name = page.getByTestId('quick-session-exercise-name-input').first();
  await name.click();
  await name.pressSequentially('Goblet Squat hold');
  await expect(name).toHaveValue('Goblet Squat hold');
  await page.getByTestId('quick-session-add-exercise-button').click();
  const second = page.getByTestId('quick-session-exercise-name-input').nth(1);
  await second.click();
  await second.pressSequentially('goblet squat ');
  await page.getByTestId('quick-session-sets-input').first().click();
  await expect(second).toHaveValue('Goblet Squat');
  await page.getByTestId('quick-session-sets-input').first().fill('3');
  await page.getByTestId('quick-session-sets-input').nth(1).fill('3');
  await page.getByTestId('quick-session-assign-button').click();
  await expect(page.getByTestId('quick-session-saved')).toBeVisible();
  const [first, linked] = backend.createAttempts.at(-1).exercises;
  expect(first.custom_name).toBe('Goblet Squat hold');
  expect(first.exercise_library_id || null).toBeNull();
  expect(linked).toMatchObject({ custom_name: 'Goblet Squat', exercise_library_id: 'lib-1' });
});
