import { test, expect } from '@playwright/test';

const COACH = { id: 'coach-1', name: 'Coach Sam', email: 'coach@example.invalid' };
const CLIENT = { id: 'client-1', coach_id: 'coach-1', name: 'Casey Client', email: 'casey@example.invalid' };
const PROGRAM = {
  id: 'prog-1', name: 'Upper/Lower', frequency_days: 2, active_assignments: [],
  days: [{ day_number: 1, workout: { id: 'w1', name: 'Upper' } }, { day_number: 2, workout: { id: 'w2', name: 'Lower' } }],
};
const WORKOUTS = [{ id: 'w1', name: 'Upper' }, { id: 'w2', name: 'Lower' }];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const plusDays = (dateStr, n) => { const d = new Date(`${dateStr}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };

/** In-memory stand-in for the series endpoints. */
class FakeBackend {
  constructor() {
    this.sessions = [];
    this.blocked = new Set();        // "YYYY-MM-DDTHH:mm" slots that are already booked
    this.created = new Map();        // request_id -> { series, receipt }
    this.createPosts = [];           // bodies received by POST /sessions/series
    this.cancelCalls = [];           // { path, body }
    this.checkPlan = [];             // per-check overrides: { delay, forceConflictKey }
    this.dropNextCreateResponse = false;  // the server commits, but the response is lost
    this.dropBeforeProcessing = false;    // the request never reaches the server
    this.failNextCreateWith400 = false;   // a definitive validation error
    this.attempts = [];                   // every create attempt, processed or not
    this.programsDelay = 0;               // ms before GET /programs answers (late program metadata)
    this.programsFail = false;            // GET /programs answers 500
    this.programsEmpty = false;           // GET /programs answers [] (the program was archived/removed)
    this.failNextCreateWith500 = false;   // a retryable server error
    this.checkCalls = [];
  }

  slotConflict(slot, all) {
    if (this.blocked.has(`${slot.date}T${slot.time}`)) {
      return { scope: 'coach', session: { scheduled_at: `${slot.date}T${slot.time}:00Z` }, display: `${slot.date} ${slot.time}` };
    }
    const other = all.find((o) => o.key !== slot.key && o.date === slot.date && o.time === slot.time);
    return other ? { scope: 'batch', with_key: other.key } : null;
  }

  suggestionsFor(slot) {
    const [h, m] = slot.time.split(':').map(Number);
    const next = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return [{ date: slot.date, time: next, scheduled_at: `${slot.date}T${next}:00Z`, display: `${slot.date} ${next}` }];
  }

  rowFor(slot, all) {
    const conflict = this.slotConflict(slot, all);
    return { ...slot, scheduled_at: `${slot.date}T${slot.time}:00Z`, display: `${slot.date} ${slot.time}`, conflict, suggestions: conflict ? this.suggestionsFor(slot) : [] };
  }
}

async function install(page, backend) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('cvf_access_token')) localStorage.setItem('cvf_access_token', 'test-token');
  });
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const path = pathname.replace(/^\/api/, '');
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : {};

    if (path === '/auth/me') return json(route, 200, { role: 'coach', email: COACH.email, profile: COACH });
    if (path === '/notifications/unread-count') return json(route, 200, { unread: 0 });
    if (path === '/sessions' && method === 'GET') return json(route, 200, backend.sessions);
    if (path === '/bookings') return json(route, 200, []);
    if (path === '/clients') return json(route, 200, [CLIENT]);
    if (path === '/programs') {
      if (backend.programsDelay) await new Promise((resolve) => setTimeout(resolve, backend.programsDelay));
      if (backend.programsFail) return json(route, 500, { error: 'Failed to load programs' });
      return json(route, 200, backend.programsEmpty ? [] : [PROGRAM]);
    }
    if (path === '/programs/workouts') return json(route, 200, WORKOUTS);

    if (path === '/sessions/series/preview') {
      const slots = [];
      let cursor = body.start_date;
      for (let guard = 0; slots.length < body.end.count && guard < 400; guard += 1) {
        const weekday = new Date(`${cursor}T12:00:00`).getDay();
        if (body.weekdays.includes(weekday)) slots.push({ key: `g${slots.length + 1}`, date: cursor, time: body.time });
        cursor = plusDays(cursor, 1);
      }
      return json(route, 200, { slots: slots.map((slot) => backend.rowFor(slot, slots)) });
    }

    if (path === '/sessions/series/check') {
      backend.checkCalls.push(body);
      const plan = backend.checkPlan.shift() || {};
      if (plan.delay) await new Promise((resolve) => setTimeout(resolve, plan.delay));
      const rows = body.slots.map((slot) => {
        const row = backend.rowFor(slot, body.slots);
        if (plan.forceConflictKey === slot.key) return { ...row, conflict: { scope: 'coach', display: 'stale' }, suggestions: [] };
        return row;
      });
      return json(route, 200, { seq: body.seq, slots: rows });
    }

    if (path === '/sessions/series' && method === 'POST') {
      backend.attempts.push(body);
      if (backend.dropBeforeProcessing) { backend.dropBeforeProcessing = false; return route.abort('failed'); }
      if (backend.failNextCreateWith500) { backend.failNextCreateWith500 = false; return json(route, 500, { error: 'Failed to create the series' }); }
      if (backend.failNextCreateWith400) { backend.failNextCreateWith400 = false; return json(route, 400, { error: 'Those dates are not valid' }); }
      backend.createPosts.push(body);
      const existing = backend.created.get(body.request_id);
      if (existing) return json(route, 200, { ...existing, replayed: true });
      const conflicts = body.slots
        .map((slot) => ({ slot, conflict: backend.slotConflict(slot, body.slots) }))
        .filter((item) => item.conflict)
        .map((item) => ({ key: item.slot.key, ...item.conflict }));
      if (conflicts.length) return json(route, 409, { error: 'Some dates are no longer available', conflicts });
      const result = {
        series: { id: `series-${backend.created.size + 1}`, created_count: body.slots.length },
        receipt: { slots: body.slots.map((slot, i) => ({ key: slot.key, session_id: `s${i}`, scheduled_at: `${slot.date}T${slot.time}:00Z`, workout_id: slot.workout_id, ordinal: i + 1 })) },
      };
      backend.created.set(body.request_id, result);
      if (backend.dropNextCreateResponse) {
        backend.dropNextCreateResponse = false;
        return route.abort('failed'); // the server committed; the response never arrives
      }
      return json(route, 201, { ...result, replayed: false });
    }

    if (/^\/sessions\/series\/[^/]+\/cancel$/.test(path) || /^\/sessions\/[^/]+\/cancel$/.test(path)) {
      backend.cancelCalls.push({ path, body });
      return json(route, 200, path.includes('/series/') ? { cancelled: [{ id: 's1', scheduled_at: '2031-06-03T23:00:00Z' }] } : { id: 's1', status: 'cancelled' });
    }
    return json(route, 200, []);
  });
}

/** Drive the branded DateTimePicker (copied from live-auth.spec.mjs). */
async function pickDateTime(page, testId, target, slotText = '9:00 AM') {
  await page.getByTestId(testId).click();
  const panel = page.getByTestId(`${testId}-panel`);
  const dayName = new RegExp(`${target.toLocaleDateString('en-US', { month: 'long' })} ${target.getDate()}(st|nd|rd|th)?, ${target.getFullYear()}`);
  for (let hops = 0; hops < 3; hops += 1) {
    if (await panel.getByRole('button', { name: dayName }).count()) break;
    await panel.getByRole('button', { name: /next month/i }).click();
  }
  await panel.getByRole('button', { name: dayName }).first().click();
  await panel.getByTestId('time-slot').filter({ hasText: slotText }).first().click();
  await expect(panel).toBeHidden();
}

// Open the editor, choose the client and a start 10 days out at 9:00 AM, switch on Repeat,
// 3 weekly sessions, optionally choose a program (declining the assignment and picking a starting day),
// and press Preview. Returns the first date (YYYY-MM-DD).
async function startPreview(page, { program = null, assign = true, startingDay = null } = {}) {
  await page.goto('/coach/sessions');
  await page.getByTestId('session-create-button').click();
  await page.getByTestId('session-client-select').click();
  await page.getByRole('option', { name: CLIENT.name }).click();
  const start = daysFromNow(10);
  await pickDateTime(page, 'session-datetime-input', start, '9:00 AM');
  await page.getByTestId('session-repeat-toggle').click();
  await page.getByTestId('series-count-input').fill('3');
  if (program) {
    await page.getByTestId('series-program-select').click();
    await page.getByRole('option', { name: program }).click();
    if (!assign) await page.getByTestId('series-assign-checkbox').click();            // decline "also assign"
    if (startingDay) {
      await page.getByTestId('series-starting-day-select').click();
      await page.getByRole('option', { name: new RegExp(`Day ${startingDay}`) }).click();
    }
  }
  await page.getByTestId('series-preview-button').click();
  await expect(page.getByTestId('series-row-g3')).toBeVisible();
  return iso(start);
}

const pendingKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cvf_series_pending')));

test('a conflicting date is fixed with a suggestion, then the series saves', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  // Pre-block the second weekly date at 09:00. Dates are generated one week apart.
  const first = iso(daysFromNow(10));
  backend.blocked.add(`${plusDays(first, 7)}T09:00`);
  await startPreview(page);

  await expect(page.getByTestId('series-row-g2')).toHaveAttribute('data-conflict', 'coach');
  await expect(page.getByTestId('series-create-button')).toBeDisabled();
  await page.getByTestId('series-suggestion-g2-10:00').click();
  await expect(page.getByTestId('series-row-g2')).toHaveAttribute('data-conflict', 'none');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await expect(page.getByTestId('series-create-button')).toHaveText('Create 3 sessions');

  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(backend.createPosts).toHaveLength(1);
  expect(backend.createPosts[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(backend.createPosts[0].slots.map((s) => s.time)).toEqual(['09:00', '10:00', '09:00']);
  expect(await pendingKeys(page)).toEqual([]); // cleared after a definitive success
});

test('moving a row onto another flags BOTH rows as a batch conflict', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  const first = iso(daysFromNow(10));
  await startPreview(page);
  await pickDateTime(page, 'series-row-datetime-g3', new Date(`${plusDays(first, 7)}T12:00:00`), '9:00 AM');
  await expect(page.getByTestId('series-row-g2')).toHaveAttribute('data-conflict', 'batch');
  await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'batch');
  expect(backend.checkCalls.at(-1).slots).toHaveLength(3); // the whole selection, not just the edited row
  await expect(page.getByTestId('series-create-button')).toBeDisabled();
});

test('a delayed (stale) check response never overwrites newer state', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  // The first check (after unticking g2) is slow and wrongly reports a conflict on g1.
  backend.checkPlan = [{ delay: 1500, forceConflictKey: 'g1' }];
  await page.getByTestId('series-row-select-g2').click();   // -> check #1 (delayed)
  await page.waitForTimeout(500);
  await page.getByTestId('series-row-select-g2').click();   // back to the original selection (no fetch needed)
  await page.waitForTimeout(2200);                          // let the stale response arrive
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
});

test('a save-time conflict returns the rows marked, keeps edits, and can be fixed and saved', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  const first = iso(daysFromNow(10));
  backend.blocked.add(`${plusDays(first, 14)}T09:00`); // becomes unavailable after the preview
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
  expect(await pendingKeys(page)).toEqual([]);                // a definitive failure clears the pending record
  await page.getByTestId('series-suggestion-g3-10:00').click();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(backend.createPosts[1].request_id).toBe(backend.createPosts[0].request_id); // same draft, same id
});

test('LOST RESPONSE: save status unknown survives a reload and Retry recovers the same series', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.dropNextCreateResponse = true;
  await page.getByTestId('series-create-button').click();

  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await expect(page.getByTestId('series-unknown')).toContainText('Save status unknown');
  expect((await pendingKeys(page)).length).toBe(1);
  expect(backend.created.size).toBe(1); // the server did commit

  await page.reload();                                  // close/refresh after the timeout
  await expect(page.getByTestId('series-unknown')).toBeVisible();   // restored, drawer reopened automatically
  await page.getByTestId('series-retry-button').click();
  await expect(page.getByText('Recovered your saved series')).toBeVisible();

  expect(backend.createPosts).toHaveLength(2);
  expect(backend.createPosts[1].request_id).toBe(backend.createPosts[0].request_id);
  expect(backend.createPosts[1]).toEqual(backend.createPosts[0]);   // identical frozen body
  expect(backend.created.size).toBe(1);                              // still exactly one series
  expect(await pendingKeys(page)).toEqual([]);
});

test('STORAGE UNAVAILABLE: warns, still locks and recovers in memory, and degrades safely after a reload', async ({ page }) => {
  const backend = new FakeBackend();
  await page.addInitScript(() => {
    // Only the pending-save key is blocked, so sign-in keeps working: the feature must degrade, not break.
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (String(key).startsWith('cvf_series_pending')) throw new DOMException('blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await install(page, backend);
  await startPreview(page);
  backend.dropNextCreateResponse = true;
  await page.getByTestId('series-create-button').click();

  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await expect(page.getByTestId('series-storage-warning')).toBeVisible();           // honest about the limitation
  expect(await pendingKeys(page)).toEqual([]);                                     // nothing could be persisted
  await expect(page.getByTestId('series-weekday-0')).toHaveCount(0);               // the form is frozen (replaced by the unknown panel)
  await page.getByTestId('series-retry-button').click();                            // in-memory recovery still works
  await expect(page.getByText('Recovered your saved series')).toBeVisible();
  expect(backend.created.size).toBe(1);
  expect(backend.createPosts[1].request_id).toBe(backend.createPosts[0].request_id);

  // After a reload with nothing persisted the app cannot resume, but must not crash or auto-open a broken drawer.
  await page.reload();
  await expect(page.getByTestId('session-create-button')).toBeVisible();
  await expect(page.getByTestId('series-unknown')).toHaveCount(0);
});

async function chooseWorkout(page, key, name) {
  await page.getByTestId(`series-row-workout-${key}`).click();
  await page.getByRole('option', { name }).click();
}

test('ordinary edits (duration, location) keep the reviewed draft and request id; duration re-checks the whole selection', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  const requestId = await page.getByTestId('series-composer').getAttribute('data-request-id');
  await page.getByTestId('series-row-select-g2').click();     // deselect a date
  await chooseWorkout(page, 'g1', 'Lower');                   // pin a workout by hand
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  const checksBefore = backend.checkCalls.length;

  await page.getByTestId('session-duration-select').click();
  await page.getByRole('option', { name: '90 min' }).click();
  await page.getByTestId('session-location-input').fill('Studio B');

  await expect.poll(() => backend.checkCalls.length).toBeGreaterThan(checksBefore);
  const last = backend.checkCalls.at(-1);
  expect(last.duration_minutes).toBe(90);
  expect(last.slots.map((slot) => slot.key)).toEqual(['g1', 'g3']);      // the whole selected selection
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await expect(page.getByTestId('series-row-select-g2')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByTestId('series-row-workout-g1')).toContainText('Lower');
  await expect(page.getByTestId('series-summary')).toContainText('2 of 3 selected');
  expect(await page.getByTestId('series-composer').getAttribute('data-request-id')).toBe(requestId);
});

test('changing the first session after previewing asks to regenerate, but the current dates are kept until then', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  await pickDateTime(page, 'session-datetime-input', daysFromNow(11), '10:00 AM');
  await expect(page.getByTestId('series-start-changed')).toBeVisible();
  await expect(page.getByTestId('series-preview-button')).toHaveText('Regenerate dates');
  await page.getByTestId('series-back-to-dates').click();
  await expect(page.getByTestId('series-row-g3')).toBeVisible();          // the reviewed dates are still there
  await expect(page.getByTestId('series-row-g1')).toHaveAttribute('data-conflict', 'none');
});

test('Create stays disabled from the moment of an edit until that selection has been checked', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.checkPlan = [{ delay: 800 }];
  await page.getByTestId('series-row-select-g2').click();
  await expect(page.getByTestId('series-create-button')).toBeDisabled();  // immediately — before the debounce even fires
  await expect(page.getByTestId('series-create-button')).toBeEnabled();   // once the (slow) check has returned
});

test('LOST BEFORE COMMIT: after a reload the 409 on Retry restores the edited draft (deselection, pin) so it can be fixed and saved', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  await page.getByTestId('series-row-select-g2').click();
  await chooseWorkout(page, 'g1', 'Lower');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  const first = iso(daysFromNow(10));
  backend.blocked.add(`${plusDays(first, 14)}T09:00`);   // g3 will conflict when the request finally reaches the server
  backend.dropBeforeProcessing = true;
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  expect(backend.created.size).toBe(0);                  // it never committed

  await page.reload();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await page.getByTestId('series-retry-button').click();

  await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
  await expect(page.getByTestId('series-row-select-g2')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.getByTestId('series-row-workout-g1')).toContainText('Lower');
  await expect(page.getByTestId('series-summary')).toContainText('2 of 3 selected');
  await page.getByTestId('series-suggestion-g3-10:00').click();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('2 sessions scheduled')).toBeVisible();
  expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);   // one draft, one id, throughout
  expect(backend.created.size).toBe(1);
  expect(backend.createPosts.at(-1).slots.map((slot) => slot.workout_id)).toEqual(['w2', null]);
});

test('DEFINITIVE ERROR after a reload restores the editor with the message, and the draft can still be saved', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.dropBeforeProcessing = true;
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  backend.failNextCreateWith400 = true;
  await page.getByTestId('series-retry-button').click();

  await expect(page.getByTestId('series-error')).toContainText('Those dates are not valid');
  await expect(page.getByTestId('series-row-g1')).toBeVisible();          // the whole draft is back, not an empty review
  await expect(page.getByTestId('series-row-g3')).toBeVisible();
  await expect(page.getByTestId('series-create-button')).toBeEnabled();   // after the restored selection is re-checked
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);
  expect(backend.created.size).toBe(1);
});

for (const mode of ['409', '400']) {
  test(`RECOVERY (${mode} after reload): a declined program assignment, the starting day, pins and deselections survive late program metadata and a definitive failure`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    await startPreview(page, { program: 'Upper/Lower', assign: false, startingDay: 2 });
    await page.getByTestId('series-row-select-g2').click();       // deselect a date
    await chooseWorkout(page, 'g1', 'Upper');                      // pin g1 (the automatic choice for it would be Lower)
    await expect(page.getByTestId('series-create-button')).toBeEnabled();
    const first = iso(daysFromNow(10));
    if (mode === '409') backend.blocked.add(`${plusDays(first, 14)}T09:00`);
    backend.dropBeforeProcessing = true;
    await page.getByTestId('series-create-button').click();
    await expect(page.getByTestId('series-unknown')).toBeVisible();
    expect(backend.attempts.at(-1).assign_program).toBe(false);   // the frozen request declined the assignment

    backend.programsDelay = 1500;                                  // program metadata arrives AFTER the draft is restored
    await page.reload();
    await expect(page.getByTestId('series-unknown')).toBeVisible();
    if (mode === '400') backend.failNextCreateWith400 = true;
    await page.getByTestId('series-retry-button').click();

    if (mode === '409') {
      await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
      await page.getByTestId('series-suggestion-g3-10:00').click();
    } else {
      await expect(page.getByTestId('series-error')).toContainText('Those dates are not valid');
    }
    await expect(page.getByTestId('series-row-select-g2')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('series-row-workout-g1')).toContainText('Upper');
    // Waits for the late program metadata, then proves it did not flip the declined assignment back on.
    await expect(page.getByTestId('series-assign-checkbox')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('series-starting-day-select')).toContainText('Day 2');
    await expect(page.getByTestId('series-create-button')).toBeEnabled();
    await page.getByTestId('series-create-button').click();
    await expect(page.getByText('2 sessions scheduled')).toBeVisible();

    const saved = backend.createPosts.at(-1);
    expect(saved.assign_program).toBe(false);                      // the coach's explicit choice survived
    expect(saved.program_id).toBe('prog-1');
    expect(saved.slots.map((slot) => slot.workout_id)).toEqual(['w1', 'w1']);
    expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);
    expect(backend.created.size).toBe(1);
  });
}

// After a reload the program list is fetched again. Until it has really loaded, a restored draft that
// references a program must not be savable: its automatic workouts and its opted-in assignment both come
// from that list, and an unloaded list would silently turn them into "no workout" / "do not assign".
async function restoreWithProgram(page, backend, { mode, delay = 0, fail = false, empty = false }) {
  await startPreview(page, { program: 'Upper/Lower' });              // assignment defaults ON; workouts are AUTOMATIC (no pins)
  const first = iso(daysFromNow(10));
  if (mode === '409') backend.blocked.add(`${plusDays(first, 14)}T09:00`);
  backend.dropBeforeProcessing = true;
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  expect(backend.attempts.at(-1).assign_program).toBe(true);
  expect(backend.attempts.at(-1).slots.map((slot) => slot.workout_id)).toEqual(['w1', 'w2', 'w1']);
  backend.programsDelay = delay;
  backend.programsFail = fail;
  backend.programsEmpty = empty;
  await page.reload();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  if (mode === '400') backend.failNextCreateWith400 = true;
  // The frozen retry must work while program details are unavailable.
  await page.getByTestId('series-retry-button').click();
  if (mode === '409') {
    await expect(page.getByTestId('series-row-g3')).toHaveAttribute('data-conflict', 'coach');
    await page.getByTestId('series-suggestion-g3-10:00').click();
  } else {
    await expect(page.getByTestId('series-error')).toContainText('Those dates are not valid');
  }
}

for (const mode of ['409', '400']) {
  test(`RACE (${mode} after reload): Create is held until program details load, then saves the automatic workouts and the assignment`, async ({ page }) => {
    const backend = new FakeBackend();
    await install(page, backend);
    await restoreWithProgram(page, backend, { mode, delay: 6000 });

    await expect(page.getByTestId('series-program-loading')).toBeVisible();
    await page.waitForTimeout(1500);                                    // the selection check has long finished by now
    await expect(page.getByTestId('series-create-button')).toBeDisabled();

    await expect(page.getByTestId('series-assign-checkbox')).toHaveAttribute('data-state', 'checked');   // details arrived
    await expect(page.getByTestId('series-create-button')).toBeEnabled();
    await page.getByTestId('series-create-button').click();
    await expect(page.getByText('3 sessions scheduled')).toBeVisible();
    const saved = backend.createPosts.at(-1);
    expect(saved.assign_program).toBe(true);
    expect(saved.program_id).toBe('prog-1');
    expect(saved.slots.map((slot) => slot.workout_id)).toEqual(['w1', 'w2', 'w1']);
    expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);
  });
}

test('a FAILED program fetch after reload keeps Create disabled, offers Retry, and saves correctly once the details load', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await restoreWithProgram(page, backend, { mode: '400', fail: true });

  await expect(page.getByTestId('series-program-failed')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('series-create-button')).toBeDisabled();
  await page.getByTestId('series-program-retry').click();               // still failing
  await expect(page.getByTestId('series-program-failed')).toBeVisible();
  await expect(page.getByTestId('series-create-button')).toBeDisabled();

  backend.programsFail = false;
  await page.getByTestId('series-program-retry').click();
  await expect(page.getByTestId('series-assign-checkbox')).toHaveAttribute('data-state', 'checked');
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  const saved = backend.createPosts.at(-1);
  expect(saved.assign_program).toBe(true);
  expect(saved.slots.map((slot) => slot.workout_id)).toEqual(['w1', 'w2', 'w1']);
});

test('a program that no longer exists blocks Create with an explanation; choosing "No program" is the way forward', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await restoreWithProgram(page, backend, { mode: '400', empty: true });   // the program list now answers without it
  await expect(page.getByTestId('series-program-missing')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('series-create-button')).toBeDisabled();

  await page.getByTestId('series-edit-rule').click();
  await page.getByTestId('series-program-select').click();
  await page.getByRole('option', { name: 'No program' }).click();
  await page.getByTestId('series-back-to-dates').click();
  await expect(page.getByTestId('series-create-button')).toBeEnabled();
  await page.getByTestId('series-create-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  const saved = backend.createPosts.at(-1);
  expect(saved.program_id).toBeNull();                                   // the coach's explicit choice
  expect(saved.assign_program).toBe(false);
  expect(saved.slots.map((slot) => slot.workout_id)).toEqual([null, null, null]);
});

test('a retryable 500 on save keeps the pending request: the form stays frozen and a reload still recovers it', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await startPreview(page);
  backend.failNextCreateWith500 = true;
  await page.getByTestId('series-create-button').click();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  expect((await pendingKeys(page)).length).toBe(1);                     // not cleared by a server error
  await page.reload();
  await expect(page.getByTestId('series-unknown')).toBeVisible();
  await page.getByTestId('series-retry-button').click();
  await expect(page.getByText('3 sessions scheduled')).toBeVisible();
  expect(new Set(backend.attempts.map((attempt) => attempt.request_id)).size).toBe(1);
  expect(backend.created.size).toBe(1);
});

test('cancel this-and-future with Notify off sends the series cancel with notify:false', async ({ page }) => {
  const backend = new FakeBackend();
  backend.sessions = [{
    id: 's1', client_id: CLIENT.id, coach_id: COACH.id, client: { id: CLIENT.id, name: CLIENT.name }, coach: COACH,
    scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString(), duration_minutes: 60, location: 'CVF Studio',
    status: 'scheduled', workout: null, linked_workout_log: null,
    series_id: 'ser-1', series_ordinal: 1, series: { id: 'ser-1', rule: { weekdays: [2, 4], interval_weeks: 1 }, created_count: 3 },
  }];
  await install(page, backend);
  await page.goto('/coach/sessions');
  await expect(page.getByTestId('series-badge')).toContainText('Weekly · Tue/Thu · Session 1 of 3');
  await page.getByTestId('session-actions-button').click();
  await page.getByTestId('session-cancel-action').click();
  await page.getByTestId('session-cancel-scope-future').click();
  await page.getByTestId('session-cancel-notify').click();
  await page.getByTestId('session-cancel-confirm').click();
  await expect.poll(() => backend.cancelCalls.length).toBe(1);
  expect(backend.cancelCalls[0].path).toBe('/sessions/series/ser-1/cancel');
  expect(backend.cancelCalls[0].body).toEqual({ from_session_id: 's1', notify: false });
});
