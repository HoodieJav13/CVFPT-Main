// "Same as last time" source preview (normal mode, synthetic API only). The
// active exercise shows the dated sets the existing fill would copy; a fill
// leaves a local note; the button's description names the source date. Fill
// rules, outbox, status and sealed behaviour are the existing ones.
// Evidence class: MOCKED (fictional fixture, no hosted auth/SQL claim).
import { test, expect } from '@playwright/test';

const SEP14 = '2026-09-14T18:00:00.000Z';
const SEP07 = '2026-09-07T18:00:00.000Z';
const deferred = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
const pendingSet = (exerciseId, n, extra = {}) => ({ id: `${exerciseId}-s${n}`, workout_log_exercise_id: exerciseId, set_number: n, set_origin: 'prescribed', status: 'pending', actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, ...extra });

function fixture() {
  const log = {
    id: 'lt-log', client_id: 'lt-client', workout_name: 'Synthetic Lower Day', status: 'active', started_at: new Date().toISOString(), coach_responses: [],
    exercises: [
      { id: 'ex-goblet', exercise_name: 'Goblet Squat', exercise_library_id: 'lib-goblet', tracking_type: 'reps_weight', prescribed_sets: 3, prescribed_reps: '10', prescribed_rpe: '7', prescribed_load_value: 35, prescribed_load_unit: 'lb', prescribed_rest_seconds: 60, sort_order: 0, sets: [1, 2, 3].map((n) => pendingSet('ex-goblet', n)) },
      { id: 'ex-deadbug', exercise_name: 'Dead Bug', exercise_library_id: 'lib-deadbug', tracking_type: 'reps_weight', prescribed_sets: 3, prescribed_reps: '12', prescribed_rest_seconds: 45, sort_order: 1, sets: [1, 2, 3].map((n) => pendingSet('ex-deadbug', n, { actual_load_unit: null })) },
    ],
  };
  const history = {
    'ex-goblet': [
      { occurrence_id: 'o-14', workout_log_id: 'old-14', completed_at: SEP14, exercise_name: 'Goblet Squat', tracking_type: 'reps_weight', sets: [
        { set_number: 1, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 10, actual_rpe: 7 },
        { set_number: 2, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 10, actual_rpe: 7 },
        { set_number: 3, actual_load_value: 40, actual_load_unit: 'lb', actual_reps: 8, actual_rpe: 8 },
      ] },
      { occurrence_id: 'o-07', workout_log_id: 'old-07', completed_at: SEP07, exercise_name: 'Goblet Squat', tracking_type: 'reps_weight', sets: [
        { set_number: 1, actual_load_value: 30, actual_load_unit: 'lb', actual_reps: 10, actual_rpe: 6 },
      ] },
    ],
    'ex-deadbug': [],
  };
  return { log, history };
}

async function setup(page, { role = 'client', online = true, historyHold = null, historyFailures = {}, queuedComplete = false } = {}) {
  const { log, history } = fixture();
  const state = { log, reads: { 'ex-goblet': 0, 'ex-deadbug': 0 }, patches: [], unexpected: [], errors: [], historyHold, historyFailures };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ startOnline, seedComplete, token }) => {
    localStorage.setItem('cvf_access_token', token);
    if (window.__cvfOnline === undefined) window.__cvfOnline = startOnline;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__cvfOnline });
    window.__setOnline = (value) => { window.__cvfOnline = value; window.dispatchEvent(new Event(value ? 'online' : 'offline')); };
    if (seedComplete && !sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('cvf_workout_outbox_lt-log', JSON.stringify([{ id: 'op-complete', kind: 'complete', method: 'post', url: '/workout-logs/lt-log/complete', data: { notes: '', feedback: '', completed_at_local: new Date().toISOString() }, attempts: 0 }]));
    }
  }, { startOnline: online, seedComplete: queuedComplete, token: `synthetic-last-time-${role}` });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    if (path === '/auth/me') return json(role === 'coach'
      ? { role, email: 'coach@example.invalid', profile: { id: 'lt-coach', name: 'Synthetic Coach', is_admin: false } }
      : { role, email: 'sample-client@example.invalid', profile: { id: 'lt-client', name: 'Sample Client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === '/workout-logs/lt-log' && method === 'GET') return json(state.log);
    if (path === '/workout-logs/mine' || path === '/workout-logs/active') return json(path.endsWith('mine') ? [] : null);
    if (path === '/programs/client/assigned') return json({ programs: [], workouts: [] });
    const historyMatch = path.match(/^\/workout-logs\/lt-log\/exercises\/([^/]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const exerciseId = historyMatch[1];
      state.reads[exerciseId] += 1;
      if (state.historyHold) { const hold = state.historyHold; state.historyHold = null; await hold.promise; }
      if (state.historyFailures[exerciseId] > 0) { state.historyFailures[exerciseId] -= 1; return json({ error: 'Exercise history is temporarily unavailable' }, 503); }
      return json({ occurrences: history[exerciseId], next_cursor: null });
    }
    const setMatch = path.match(/^\/workout-logs\/lt-log\/sets\/([^/]+)$/);
    if (setMatch && method === 'PATCH') {
      const set = state.log.exercises.flatMap((exercise) => exercise.sets).find((row) => row.id === setMatch[1]);
      const body = request.postDataJSON();
      state.patches.push({ setId: setMatch[1], body });
      Object.assign(set, body);
      return json(set);
    }
    if (path === '/workout-logs/lt-log/complete' && method === 'POST') {
      Object.assign(state.log, { status: 'completed', completed_at: new Date().toISOString() });
      return json(state.log);
    }
    state.unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic route' }, 404);
  });
  return state;
}

const trackerPath = (role) => (role === 'coach' ? '/coach/workouts/lt-log/track' : '/client/workouts/lt-log/track');
const cards = (page) => page.getByTestId('tracker-exercise-card');
const goblet = (page) => cards(page).nth(0);
const deadbug = (page) => cards(page).nth(1);
const LINE = 'Last time · Sep 14, 2026 · 35 lb × 10 · 35 lb × 10 · 40 lb × 8';

async function open(page, role = 'client') {
  await page.goto(trackerPath(role));
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
}

test('the active exercise shows its dated prior sets before any tap; the inactive one makes no request', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(goblet(page).getByTestId('last-time-line')).toHaveText(LINE);
  await expect(goblet(page).getByTestId('same-as-last-time')).toHaveAccessibleName(/Same as last time/);
  await expect(goblet(page).getByTestId('same-as-last-time')).toHaveAccessibleDescription('Copies blank fields from Sep 14, 2026.');
  await expect(deadbug(page).getByTestId('last-time-line')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(state.reads).toEqual({ 'ex-goblet': 1, 'ex-deadbug': 0 });
  expect(state.unexpected).toEqual([]);
});

test('typed partial values survive the fill; only blanks fill, the note stays after the toast, no extra request', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(goblet(page).getByTestId('last-time-line')).toHaveText(LINE);
  await page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true }).fill('40');
  await goblet(page).getByTestId('same-as-last-time').click();
  const note = goblet(page).getByTestId('last-time-note');
  await expect(note).toHaveText('Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
  await expect(note).toHaveAttribute('role', 'status');
  await expect.poll(() => state.log.exercises[0].sets.map((set) => [set.actual_load_value, set.actual_reps, set.actual_rpe, set.status]))
    .toEqual([[40, 10, 7, 'pending'], [35, 10, 7, 'pending'], [40, 8, 8, 'pending']]);
  await expect(page.getByText('Filled 3 sets from').first()).toBeVisible();
  await expect(page.getByText('Filled 3 sets from')).toHaveCount(0, { timeout: 10_000 });
  await expect(note).toHaveText('Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
  expect(state.reads['ex-goblet']).toBe(1);
  expect(state.unexpected).toEqual([]);
});

test('typing while history is delayed is kept; a tap after a failed preview retries once and keeps typed values', async ({ page }) => {
  const hold = deferred();
  const state = await setup(page, { historyHold: hold, historyFailures: { 'ex-goblet': 1 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const line = goblet(page).getByTestId('last-time-line');
  await expect(line).toHaveText('Loading last time…');
  await expect(goblet(page).getByTestId('same-as-last-time')).toBeDisabled();
  // Reduced motion: the existing spinner does not animate.
  expect(await line.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true }).fill('40');
  await page.getByRole('spinbutton', { name: 'Goblet Squat set 2 performed reps', exact: true }).fill('9');
  hold.release();
  await expect(line).toHaveText('Last time unavailable.');
  // The tap retries (the failed read was not cached) while its reply is held.
  const tapHold = deferred();
  state.historyHold = tapHold;
  await goblet(page).getByTestId('same-as-last-time').click();
  await expect.poll(() => state.reads['ex-goblet']).toBe(2);
  await page.getByRole('spinbutton', { name: 'Goblet Squat set 3 performed RPE', exact: true }).fill('9');
  tapHold.release();
  await expect(goblet(page).getByTestId('last-time-note')).toHaveText('Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
  await expect(line).toHaveText(LINE);
  await expect.poll(() => state.log.exercises[0].sets.map((set) => [set.actual_load_value, set.actual_reps, set.actual_rpe]))
    .toEqual([[40, 10, 7], [35, 9, 7], [40, 8, 9]]);
  expect(state.reads).toEqual({ 'ex-goblet': 2, 'ex-deadbug': 0 });
});

test('no history: the next active exercise says so, a tap keeps the existing toast, nothing is written', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  for (const n of [1, 2, 3]) await goblet(page).getByRole('button', { name: `Complete set ${n}`, exact: true }).click();
  await expect(deadbug(page).getByTestId('last-time-line')).toHaveText('No completed history yet.');
  const before = state.patches.length;
  await deadbug(page).getByTestId('same-as-last-time').click();
  await expect(page.getByText('No history yet.').first()).toBeVisible();
  await expect(deadbug(page).getByTestId('last-time-note')).toHaveText('');
  await expect(deadbug(page).getByTestId('same-as-last-time')).not.toHaveAttribute('aria-describedby', /.+/);
  await page.waitForTimeout(300);
  expect(state.patches.length).toBe(before);
  expect(state.reads).toEqual({ 'ex-goblet': 1, 'ex-deadbug': 1 });
});

test('offline before load: no request, an offline line and the existing toast; reconnecting loads once', async ({ page }) => {
  const state = await setup(page, { online: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(goblet(page).getByTestId('last-time-line')).toHaveText('Last time unavailable offline.');
  await goblet(page).getByTestId('same-as-last-time').click();
  await expect(page.getByText('You are offline. Reconnect to copy last time.').first()).toBeVisible();
  expect(state.reads['ex-goblet']).toBe(0);
  await page.evaluate(() => window.__setOnline(true));
  await expect(goblet(page).getByTestId('last-time-line')).toHaveText(LINE);
  await page.waitForTimeout(300);
  expect(state.reads).toEqual({ 'ex-goblet': 1, 'ex-deadbug': 0 });
});

test('the note survives set completion, active-exercise change and sync; it clears on leaving, reload and finish', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(goblet(page).getByTestId('last-time-line')).toHaveText(LINE);
  await goblet(page).getByTestId('same-as-last-time').click();
  const note = goblet(page).getByTestId('last-time-note');
  await expect(note).toHaveText('Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
  for (const n of [1, 2, 3]) await goblet(page).getByRole('button', { name: `Complete set ${n}`, exact: true }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  await expect(deadbug(page).getByTestId('last-time-line')).toHaveText('No completed history yet.');
  await goblet(page).getByRole('button', { name: /Exercise history/ }).click();
  await expect(note).toHaveText('Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
  // Reload: local UI state only.
  await page.reload();
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
  await expect(goblet(page).getByTestId('last-time-note')).toHaveText('');
  // A completed log stays completed in the fixture; finishing navigates away.
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: /Confirm completion/i }).click();
  await expect(page).not.toHaveURL(/\/track$/);
  await expect(page.getByTestId('last-time-note')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('sealed (a queued finish): the button stays disabled, no preview request, no fill', async ({ page }) => {
  const state = await setup(page, { online: false, queuedComplete: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(goblet(page).getByTestId('same-as-last-time')).toBeDisabled();
  await page.waitForTimeout(400);
  expect(state.reads).toEqual({ 'ex-goblet': 0, 'ex-deadbug': 0 });
  expect(state.patches).toEqual([]);
});

for (const width of [320, 390]) {
  test(`${width}px: line and note wrap inside the card, stay clear of the dock, and the fill works by keyboard`, async ({ page }) => {
    const state = await setup(page);
    await page.setViewportSize({ width, height: 740 });
    await open(page);
    const line = goblet(page).getByTestId('last-time-line');
    await expect(line).toHaveText(LINE);
    const button = goblet(page).getByTestId('same-as-last-time');
    await button.focus();
    await page.keyboard.press('Enter');
    const note = goblet(page).getByTestId('last-time-note');
    await expect(note).toHaveText('Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
    await expect(button).toBeFocused();
    for (const element of [line, note]) {
      await element.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const box = await element.boundingBox();
      const card = await goblet(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(await element.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const dock = await page.getByTestId('workout-control-dock').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // Reduced motion: neither new element animates or transitions.
    for (const element of [line, note]) {
      expect(await element.evaluate((el) => { const s = getComputedStyle(el); return [s.animationName, s.transitionDuration]; })).toEqual(['none', '0s']);
    }
    await page.screenshot({ path: test.info().outputPath(`last-time-${width}.png`) });
    await test.info().attach(`last-time-${width}`, { path: test.info().outputPath(`last-time-${width}.png`), contentType: 'image/png' });
    expect(state.reads).toEqual({ 'ex-goblet': 1, 'ex-deadbug': 0 });
    expect(state.unexpected).toEqual([]);
  });
}

test('the coach tracker shows the same source line and description under the same route', async ({ page }) => {
  const state = await setup(page, { role: 'coach' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'coach');
  await expect(goblet(page).getByTestId('last-time-line')).toHaveText(LINE);
  await expect(goblet(page).getByTestId('same-as-last-time')).toHaveAccessibleDescription('Copies blank fields from Sep 14, 2026.');
  expect(state.reads).toEqual({ 'ex-goblet': 1, 'ex-deadbug': 0 });
});
