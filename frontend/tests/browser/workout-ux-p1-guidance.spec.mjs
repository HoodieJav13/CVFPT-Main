// P1 active-workout guidance (normal mode, synthetic in-process API shaped
// like the pt-session-events/v1 log contract; fictional data only).
// Covers: one round-aware active row and its reveal, Resume landing, the
// compact outline, the explicit repeat-previous-performed-set action, compact
// details, and that repeat writes keep event ids/offline queue/conflicts.
// This proves UI behaviour, not server authorization or database rules.
import { test, expect } from '@playwright/test';

const set = (exercise, n, load, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: load, actual_load_unit: load == null ? null : 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, ...extra,
});
function fixture({ resumed = false, conflictOn = null, savedRpe = false, notes = null } = {}) {
  const exercises = [
    { id: 'a1', exercise_name: 'Incline Press', tracking_type: 'reps_weight', prescribed_sets: '2', prescribed_reps: '8', prescribed_load_value: 50, prescribed_load_unit: 'lb', prescribed_rest_seconds: 90, superset_group: 'A', plan_revision: 0, backups: [], sets: [set('a1', 1, 50), set('a1', 2, 50)] },
    { id: 'a2', exercise_name: 'Chest-supported Row', tracking_type: 'reps_weight', prescribed_sets: '2', prescribed_reps: '10', prescribed_load_value: 40, prescribed_load_unit: 'lb', prescribed_rest_seconds: 90, superset_group: 'A', plan_revision: 0, backups: [], sets: [set('a2', 1, 40), set('a2', 2, 40)] },
    { id: 'b', exercise_name: 'Goblet Squat', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '8', prescribed_load_value: 35, prescribed_load_unit: 'lb', prescribed_rest_seconds: 60, superset_group: null, plan_revision: 0, backups: [], sets: [set('b', 1, 35), set('b', 2, 35), set('b', 3, 35)] },
    { id: 'c', exercise_name: 'Easy Run', tracking_type: 'duration_distance', prescribed_sets: '2', prescribed_duration_unit: 'min', prescribed_distance_unit: 'km', prescribed_load_value: null, prescribed_load_unit: null, prescribed_rest_seconds: 0, superset_group: null, plan_revision: 0, backups: [], sets: [set('c', 1, null), set('c', 2, null)] },
  ];
  if (resumed) {
    Object.assign(exercises[0].sets[0], { status: 'completed', actual_reps: 8, revision: 1, last_actor_role: 'client' });
    Object.assign(exercises[1].sets[0], { status: 'completed', actual_reps: 10, revision: 1, last_actor_role: 'client' });
  }
  if (savedRpe) exercises[0].sets[0].actual_rpe = 8;
  if (notes) exercises[2].client_notes = notes;
  const conflicts = conflictOn ? [{ id: 'conflict-1', workout_log_set_id: conflictOn, status: 'open', kept_actor_role: 'coach', incoming_actor_role: 'client', kept_value: { status: 'completed', actual_reps: 9, actual_load_value: 35, actual_load_unit: 'lb' }, incoming_value: { status: 'completed', actual_reps: 7, actual_load_value: 35, actual_load_unit: 'lb' }, incoming_offline: false }] : [];
  return { id: 'p1-log', client_id: 'p1-client', workout_name: 'Fictional P1 workout', status: 'active', started_at: new Date().toISOString(), exercises, coach_responses: [], conflicts, substitutions: [] };
}

async function setup(page, width, height, options = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const log = fixture(options);
  const results = { errors: [], unexpected: [], writes: [] };
  page.on('pageerror', (error) => results.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-p1-token'));
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'p1@example.invalid', profile: { id: 'p1-client', name: 'Fictional P1 client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === '/workout-logs/p1-log' && method === 'GET') return json({ ...log, server_time: new Date().toISOString() });
    if (/^\/workout-logs\/p1-log\/exercises\/[^/]+\/history$/.test(path)) return json({ occurrences: [], next_cursor: null });
    if (/^\/workout-logs\/p1-log\/exercises\/[^/]+\/substitution-options$/.test(path)) return json({ backups: [], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    const patch = path.match(/^\/workout-logs\/p1-log\/sets\/([^/]+)$/);
    if (patch && method === 'PATCH') {
      const body = r.postDataJSON();
      results.writes.push({ setId: patch[1], ...body });
      const row = log.exercises.flatMap((e) => e.sets).find((s) => s.id === patch[1]);
      const fields = Object.fromEntries(Object.entries(body).filter(([k]) => !['event_id', 'base_revision', 'local_seq', 'offline', 'plan_revision_seen'].includes(k)));
      Object.assign(row, fields, { revision: row.revision + 1, last_actor_role: 'client' });
      return json({ ...row, event: { id: body.event_id, outcome: 'applied' } });
    }
    results.unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic route' }, 404);
  });
  await page.goto('/client/workouts/p1-log/track');
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return { log, results };
}

const card = (page, name) => page.getByTestId('tracker-exercise-card').filter({ has: page.getByText(name, { exact: true }) }).first();
const activeId = (page) => page.locator('[data-active="true"]').getAttribute('data-set-id');
async function inView(page, setId) {
  const row = page.locator(`[data-set-id="${setId}"]`);
  const box = await row.boundingBox();
  const region = await page.getByTestId('workout-scroll-region').boundingBox();
  const vh = page.viewportSize().height;
  return Boolean(box) && box.y >= Math.max(0, region?.y ?? 0) - 1 && box.y + Math.min(box.height, 48) <= Math.min(vh, (region?.y ?? 0) + (region?.height ?? vh)) + 1;
}

// Bounds of the primary controls (weight, reps, Complete) against what is
// actually visible: viewport ∩ scrolling region ∩ below a sticky outline ∩
// above the control dock. Returns each control's rect and whether it is whole.
async function primaryControls(page, name, n) {
  return page.evaluate(({ name, n }) => {
    const q = (sel) => document.querySelector(sel);
    const weightEl = q(`input[aria-label="${name} set ${n} weight"]`);
    const repsEl = q(`input[aria-label="${name} set ${n} performed reps"]`);
    const row = weightEl?.closest('.grid');
    const completeEl = row ? [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === `Complete set ${n}`) : null;
    const region = q('[data-testid="workout-scroll-region"]');
    const dock = q('[data-testid="workout-control-dock"]');
    const outline = q('[data-testid="workout-outline-row"]');
    const scrolls = region && getComputedStyle(region).overflowY !== 'visible';
    const r = scrolls ? region.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const top = Math.max(r.top, 0, outline && getComputedStyle(outline).position === 'sticky' ? outline.getBoundingClientRect().bottom : 0);
    const dockTop = dock ? dock.getBoundingClientRect().top : innerHeight;
    const bottom = Math.min(r.bottom, innerHeight, dockTop > top ? dockTop : innerHeight);
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), whole: b.top >= top - 1 && b.bottom <= bottom + 1 && b.left >= -1 && b.right <= innerWidth + 1 }; };
    const controls = { weight: rect(weightEl), reps: rect(repsEl), complete: rect(completeEl) };
    return { visibleTop: Math.round(top), visibleBottom: Math.round(bottom), regionScrolls: Boolean(scrolls), controls, allWhole: Object.values(controls).every((c) => c && c.whole) };
  }, { name, n });
}

for (const [width, height] of [[390, 844], [320, 700], [1280, 900], [390, 500]]) {
  test(`${width}×${height}: superset rounds highlight and reveal A1 → A2 → A1 with no extra action`, async ({ page }) => {
    const { results } = await setup(page, width, height);
    expect(await page.locator('[data-active="true"]').count()).toBe(1);
    expect(await activeId(page)).toBe('a1-s1');
    const a1 = card(page, 'Incline Press');
    await a1.getByLabel('Incline Press set 1 performed reps').fill('8');
    await a1.getByRole('button', { name: 'Complete set 1' }).click();
    await expect.poll(() => activeId(page)).toBe('a2-s1');
    await expect.poll(() => inView(page, 'a2-s1')).toBe(true);
    await expect.poll(async () => (await primaryControls(page, 'Chest-supported Row', 1)).allWhole).toBe(true);
    await expect(page.getByTestId('next-set-announcement')).toHaveText('Next: Chest-supported Row, set 1');
    const a2 = card(page, 'Chest-supported Row');
    await a2.getByLabel('Chest-supported Row set 1 performed reps').fill('10');
    await a2.getByRole('button', { name: 'Complete set 1' }).click();
    await expect.poll(() => activeId(page)).toBe('a1-s2');
    await expect.poll(() => inView(page, 'a1-s2')).toBe(true);
    await expect.poll(async () => (await primaryControls(page, 'Incline Press', 2)).allWhole).toBe(true);
    expect(await page.locator('[data-active="true"]').count()).toBe(1);
    // The collapsed outline names the exercise only (no set numbers or reps).
    await expect(page.getByTestId('workout-outline-summary')).toHaveText('Next: A1 · Incline Press');
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });

  test(`${width}×${height}: three identical performed sets take 5 actions with the explicit repeat; actuals only, prescription kept`, async ({ page }) => {
    const { results } = await setup(page, width, height);
    const b = card(page, 'Goblet Squat');
    let actions = 0;
    await b.getByLabel('Goblet Squat set 1 weight', { exact: true }).fill('30'); actions += 1;
    await b.getByLabel('Goblet Squat set 1 performed reps').fill('8'); actions += 1;
    await b.getByRole('button', { name: 'Complete set 1' }).click(); actions += 1;
    const repeat = b.getByTestId('repeat-previous-set');
    await expect(repeat).toHaveText(/Done · Same as set 1: 30 lb × 8 reps/);
    await expect(b.locator('[data-set-id="b-s2"]').getByLabel('Goblet Squat set 2 weight', { exact: true })).toHaveValue('35');
    await repeat.click(); actions += 1;
    await expect(b.getByTestId('repeat-previous-set')).toHaveText(/Same as set 2: 30 lb × 8 reps/);
    await b.getByTestId('repeat-previous-set').click(); actions += 1;
    await expect.poll(() => results.writes.filter((w) => w.status === 'completed' && w.setId.startsWith('b-')).length).toBe(3);
    expect(actions).toBe(5);
    const done = results.writes.filter((w) => w.status === 'completed' && w.setId.startsWith('b-'));
    expect(done.map((w) => [w.setId, w.actual_load_value, w.actual_load_unit, w.actual_reps, w.actual_rpe])).toEqual([
      ['b-s1', 30, 'lb', 8, null], ['b-s2', 30, 'lb', 8, null], ['b-s3', 30, 'lb', 8, null],
    ]);
    expect(new Set(done.map((w) => w.event_id)).size).toBe(3);
    expect(done.every((w) => Number.isInteger(w.base_revision))).toBe(true);
    await expect(b.getByText('Load 35 lb')).toBeVisible();
    await expect(b.getByTestId('repeat-previous-set')).toHaveCount(0);
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });
}

for (const [width, height] of [[390, 844], [320, 700], [1280, 900]]) {
  test(`${width}×${height}: a fresh workout opens with the first set's weight, reps and Complete whole; no focus move, no writes`, async ({ page }) => {
    const { results } = await setup(page, width, height);
    await page.waitForTimeout(300);
    const view = await primaryControls(page, 'Incline Press', 1);
    expect(view.allWhole, JSON.stringify(view)).toBe(true);
    // Save status: visible at 390 and desktop. At 320 there is no room for the
    // title, status, prescription and a whole set together (the baseline showed
    // no set controls there); the set wins and the status stays announced
    // (aria-live) one scroll up.
    const save = page.getByTestId('workout-save-state');
    await expect(save).toHaveAttribute('aria-live', 'polite');
    if (width >= 390) await expect(save).toBeInViewport();
    await expect(page.getByTestId('tracker-exercise-card').first().getByText('Load 50 lb')).toBeInViewport();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await expect(page.getByTestId('next-set-announcement')).toHaveText('');
    expect(results.writes).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`initial-${width}x${height}.png`) });
  });
}

test('repeat never overwrites typed input and is unavailable on an open conflict', async ({ page }) => {
  const { results } = await setup(page, 390, 844, { conflictOn: 'b-s3' });
  const b = card(page, 'Goblet Squat');
  await b.getByLabel('Goblet Squat set 1 performed reps').fill('8');
  await b.getByRole('button', { name: 'Complete set 1' }).click();
  await expect(b.getByTestId('repeat-previous-set')).toBeVisible();
  // Typing into the set hides the repeat action; the typed value stays.
  await b.getByLabel('Goblet Squat set 2 performed reps').fill('6');
  await expect(b.getByTestId('repeat-previous-set')).toHaveCount(0);
  await expect(b.getByLabel('Goblet Squat set 2 performed reps')).toHaveValue('6');
  await b.getByRole('button', { name: 'Complete set 2' }).click();
  await expect.poll(() => results.writes.filter((w) => w.setId === 'b-s2' && w.status === 'completed').map((w) => w.actual_reps)).toEqual([6]);
  // Set 3 has an open disagreement: no repeat, with the reason shown.
  await expect(b.getByTestId('repeat-unavailable')).toContainText('disagreement');
  await expect(b.getByTestId('repeat-previous-set')).toHaveCount(0);
  expect(results.writes.some((w) => w.setId === 'b-s3')).toBe(false);
});

test('repeat while offline queues one event, survives reload, and replays it once on reconnect', async ({ page, context }) => {
  const { results } = await setup(page, 390, 844);
  const b = card(page, 'Goblet Squat');
  await b.getByLabel('Goblet Squat set 1 performed reps').fill('8');
  await b.getByRole('button', { name: 'Complete set 1' }).click();
  // The reps blur saves first, then the completion: wait for the completion.
  await expect.poll(() => results.writes.filter((w) => w.status === 'completed').length).toBe(1);
  await context.setOffline(true);
  await b.getByTestId('repeat-previous-set').click();
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('cvf_workout_outbox_p1-log') || '[]'));
  expect(queued.map((op) => [op.kind, op.setId, op.data.status, op.data.actual_reps, op.data.offline])).toEqual([['set', 'b-s2', 'completed', 8, true]]);
  const eventId = queued[0].data.event_id;
  expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
  await context.setOffline(false);
  await page.reload();
  await expect.poll(() => results.writes.filter((w) => w.setId === 'b-s2').map((w) => w.event_id)).toEqual([eventId]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cvf_workout_outbox_p1-log'))).toBeNull();
});

test('Resume lands on the next unfinished set without moving focus', async ({ page }) => {
  await setup(page, 390, 844, { resumed: true });
  await expect.poll(() => activeId(page)).toBe('a1-s2');
  await expect.poll(() => inView(page, 'a1-s2')).toBe(true);
  await expect.poll(async () => (await primaryControls(page, 'Incline Press', 2)).allWhole).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});

test('outline: compact names and group labels only; a jump reveals without changing anything; collapse returns the space', async ({ page }) => {
  const { results } = await setup(page, 390, 844);
  const outline = page.getByTestId('workout-outline');
  const collapsed = await outline.boundingBox();
  expect(collapsed.height).toBeLessThan(64);
  const region = await page.getByTestId('workout-scroll-region').boundingBox();
  expect(collapsed.y + collapsed.height).toBeLessThanOrEqual(region.y + 1);
  await page.getByTestId('workout-outline-toggle').click();
  const list = page.getByTestId('workout-outline-list');
  await expect(list).toContainText('Superset A');
  await expect(list).not.toContainText(/reps|lb|×/);
  expect(await page.getByTestId('workout-outline-item').allTextContents()).toEqual(['A1Incline Pressnext', 'A2Chest-supported Row', 'BGoblet Squat', 'CEasy Run']);
  const dock = await page.getByTestId('workout-control-dock').boundingBox();
  const open = await outline.boundingBox();
  expect(open.y + open.height).toBeLessThanOrEqual(dock.y);
  await page.getByTestId('workout-outline-item').filter({ hasText: 'Easy Run' }).click();
  await expect(page.getByTestId('workout-outline-list')).toHaveCount(0);
  await expect(page.locator('[data-exercise-heading="c"]')).toBeFocused();
  const heading = await page.locator('[data-exercise-heading="c"]').boundingBox();
  const after = await page.getByTestId('workout-scroll-region').boundingBox();
  expect(heading.y).toBeGreaterThanOrEqual(after.y - 1);
  expect(heading.y).toBeLessThan(after.y + after.height);
  expect(results.writes).toEqual([]);
  expect(await activeId(page)).toBe('a1-s1');
});

test('RPE opens on demand, keeps typed values shown and saved, and cannot be hidden while it holds a value', async ({ page }) => {
  const { results } = await setup(page, 390, 844);
  const b = card(page, 'Goblet Squat');
  await expect(b.getByLabel('Goblet Squat set 1 performed RPE')).toHaveCount(0);
  const toggle = b.getByTestId('rpe-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveText('Add RPE');
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(page.getByTestId('next-set-announcement')).toHaveText('RPE fields shown for Goblet Squat');
  const rpe = b.getByLabel('Goblet Squat set 1 performed RPE');
  await expect(rpe).toBeVisible();
  await rpe.fill('7.5');
  await expect(b.getByTestId('rpe-toggle')).toHaveCount(0);
  await b.getByLabel('Goblet Squat set 1 performed reps').fill('8');
  await b.getByRole('button', { name: 'Complete set 1' }).click();
  await expect.poll(() => results.writes.filter((w) => w.setId === 'b-s1' && w.status === 'completed').map((w) => w.actual_rpe)).toEqual([7.5]);
  await expect(rpe).toHaveValue('7.5');
  // Other exercises stay compact.
  await expect(card(page, 'Incline Press').getByLabel('Incline Press set 1 performed RPE')).toHaveCount(0);
});

test('a saved RPE keeps its column visible on load', async ({ page }) => {
  await setup(page, 390, 844, { resumed: true, savedRpe: true });
  const a1 = card(page, 'Incline Press');
  await expect(a1.getByLabel('Incline Press set 1 performed RPE')).toHaveValue('8');
  await expect(a1.getByTestId('rpe-toggle')).toHaveCount(0);
});

test('history and notes open on demand; written notes stay visible', async ({ page }) => {
  await setup(page, 390, 844);
  const b = card(page, 'Goblet Squat');
  await expect(b.getByTestId('exercise-details')).toHaveCount(0);
  const toggle = b.getByTestId('exercise-details-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(b.getByTestId('exercise-details').getByRole('button', { name: /Exercise history/ })).toBeVisible();
  await expect(b.getByLabel('Exercise notes')).toBeVisible();
});

test('notes that already hold text stay open and readable', async ({ page }) => {
  await setup(page, 390, 844, { notes: 'Left knee felt fine today.' });
  const b = card(page, 'Goblet Squat');
  await expect(b.getByTestId('exercise-details-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(b.getByLabel('Exercise notes')).toHaveValue('Left knee felt fine today.');
});

test('short keyboard-like viewport: the sticky outline never hides the focused field', async ({ page }) => {
  await setup(page, 390, 420);
  const b = card(page, 'Goblet Squat');
  const field = b.getByLabel('Goblet Squat set 2 performed reps');
  await field.focus();
  await page.waitForTimeout(100);
  const box = await field.boundingBox();
  const outline = await page.getByTestId('workout-outline').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(outline.y + outline.height - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
});
