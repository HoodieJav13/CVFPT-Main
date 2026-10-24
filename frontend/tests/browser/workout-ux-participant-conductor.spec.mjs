// Participant conductor (coach logs each trainee's own workout), real UI in
// normal mode against a synthetic in-process API shaped like
// pt-session-events/v1. Fictional trainees only. PR120 review:
//  - 4366537636: duration / distance / duration_distance sets use the existing
//    typed metric inputs and payload (no reps), keep their event identity on
//    retry, and show performed metrics when completed.
//  - 4366537640: the unfinished-plan editor labels the exercise's actual load
//    unit and sends that same unit (no conversion).
// Proves UI behaviour and request shape, not server authorization.
import { test, expect } from '@playwright/test';

const TOKEN = 'synthetic-participant-coach-token';
const COACH = { id: 'fict-coach-p', name: 'Fictional Coach', email: 'coach@example.invalid' };
const ANA = { id: 'fict-client-ana', name: 'Ana Fictional' };
const BEN = { id: 'fict-client-ben', name: 'Ben Fictional' };

const set = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', revision: 0, last_actor_role: null,
  actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, ...extra,
});
function anaLog(status = 'active') {
  return {
    id: 'log-ana', client_id: ANA.id, workout_name: 'Fictional mixed day', status, plan_revision: 0, conflicts: [], substitutions: [], coach_responses: [],
    exercises: [
      { id: 'squat', exercise_name: 'Front Squat', tracking_type: 'reps_weight', prescribed_sets: '1', prescribed_reps: '5', prescribed_load_value: 60, prescribed_load_unit: 'kg', plan_revision: 0, sets: [set('squat', 1, { actual_load_value: 60, actual_load_unit: 'kg' })] },
      { id: 'plank', exercise_name: 'Plank Hold', tracking_type: 'duration', prescribed_sets: '1', prescribed_duration_value: 45, prescribed_duration_unit: 's', prescribed_load_value: null, prescribed_load_unit: null, plan_revision: 0, sets: [set('plank', 1)] },
      { id: 'carry', exercise_name: 'Sled Push', tracking_type: 'distance', prescribed_sets: '1', prescribed_distance_value: 20, prescribed_distance_unit: 'm', prescribed_load_value: 40, prescribed_load_unit: 'kg', plan_revision: 0, sets: [set('carry', 1, { actual_load_value: 40, actual_load_unit: 'kg' })] },
      { id: 'row', exercise_name: 'Easy Row', tracking_type: 'duration_distance', prescribed_sets: '1', prescribed_duration_unit: 'min', prescribed_distance_unit: 'km', prescribed_load_value: null, prescribed_load_unit: null, plan_revision: 0, sets: [set('row', 1)] },
      { id: 'press', exercise_name: 'Bench Press', tracking_type: 'reps_weight', prescribed_sets: '1', prescribed_reps: '8', prescribed_load_value: 135, prescribed_load_unit: 'lb', plan_revision: 0, sets: [set('press', 1, { actual_load_value: 135, actual_load_unit: 'lb' })] },
    ],
  };
}

async function setup(page, { width = 390, logStatus = 'active', failFirstPatchOf = null } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const log = anaLog(logStatus);
  const state = { log, setPatches: [], planPatches: [], unexpected: [], errors: [], failed: new Set() };
  page.on('pageerror', (error) => state.errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if ((request.headers().authorization || '') !== `Bearer ${TOKEN}`) return json({ error: 'Invalid or expired token' }, 401);
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (method === 'GET' && path === '/auth/me') return json({ role: 'coach', email: COACH.email, profile: COACH });
    if (method === 'GET' && path === '/clients') return json([ANA, BEN]);
    if (method === 'GET' && path === '/programs/exercise-library') return json([]);
    if (method === 'GET' && path === '/group-sessions/open') return json({ sessions: [{ id: 'group-p', mode: 'participants', status: 'open', revision: 1, participant_ids: [ANA.id, BEN.id] }] });
    if (method === 'GET' && path === '/group-sessions/group-p/overview') {
      const done = log.exercises.flatMap((e) => e.sets).filter((s) => s.status === 'completed').length;
      return json({ participants: [
        { client_id: ANA.id, name: ANA.name, log: { id: log.id, status: log.status, done, total: 5, open_conflicts: 0, pending_swaps: 0, swaps_to_review: 0, last_actor_role: null, last_write_at: null } },
        { client_id: BEN.id, name: BEN.name, log: null },
      ] });
    }
    if (method === 'GET' && path === '/coach-notices') return json({ notices: [] });
    if (method === 'GET' && path === '/workout-logs/log-ana') return json(log);
    const setMatch = path.match(/^\/workout-logs\/log-ana\/sets\/([^/]+)$/);
    if (method === 'PATCH' && setMatch) {
      const body = request.postDataJSON();
      state.setPatches.push({ setId: setMatch[1], ...body });
      if (failFirstPatchOf === setMatch[1] && !state.failed.has(setMatch[1])) { state.failed.add(setMatch[1]); return route.abort('connectionreset'); }
      const row = log.exercises.flatMap((e) => e.sets).find((s) => s.id === setMatch[1]);
      const fields = Object.fromEntries(Object.entries(body).filter(([k]) => !['event_id', 'base_revision'].includes(k)));
      Object.assign(row, fields, { revision: row.revision + 1, last_actor_role: 'coach' });
      return json({ ...row, event: { id: body.event_id, outcome: 'applied' } });
    }
    const planMatch = path.match(/^\/workout-logs\/log-ana\/exercises\/([^/]+)\/plan$/);
    if (method === 'PATCH' && planMatch) {
      const body = request.postDataJSON();
      state.planPatches.push({ exerciseId: planMatch[1], ...body });
      const exercise = log.exercises.find((e) => e.id === planMatch[1]);
      // Mirrors the backend route: an omitted unit keeps the exercise's unit.
      const unit = body.prescribed_load_value == null ? null : (body.prescribed_load_unit || exercise.prescribed_load_unit || 'lb');
      Object.assign(exercise, { prescribed_reps: body.prescribed_reps, prescribed_load_value: body.prescribed_load_value, prescribed_load_unit: unit, plan_revision: exercise.plan_revision + 1 });
      return json(log);
    }
    state.unexpected.push(`${method} ${path}`);
    return json({ error: `Synthetic route missing: ${method} ${path}` }, 404);
  });
  await page.goto('/login');
  await page.evaluate((token) => localStorage.setItem('cvf_access_token', token), TOKEN);
  await page.goto('/coach/group-session');
  await page.getByTestId('group-mode-participants').click();
  await expect(page.getByTestId(`participant-panel-${ANA.id}`)).toBeVisible();
  return state;
}

const row = (page, name, n = 1) => page.getByTestId(`coach-set-${name.replace(/\W+/g, '-')}-${n}`);

for (const width of [390, 1280]) {
  test(`${width}: duration, distance and duration+distance sets use typed metric inputs and send metric values, never reps`, async ({ page }) => {
    const state = await setup(page, { width });
    const panel = page.getByTestId(`participant-panel-${ANA.id}`);
    // Reps/weight keeps its existing controls and labels.
    await expect(panel.getByLabel('Front Squat set 1 reps')).toBeVisible();
    await expect(panel.getByLabel('Front Squat set 1 weight')).toBeVisible();
    // Duration only: no reps field; a duration value + unit.
    await expect(panel.getByLabel('Plank Hold set 1 reps')).toHaveCount(0);
    await panel.getByLabel('Plank Hold set 1 duration', { exact: true }).fill('50');
    await expect(panel.getByLabel('Plank Hold set 1 duration unit')).toHaveValue('s');
    await row(page, 'Plank Hold').getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Plank Hold')).toHaveAttribute('data-state', 'saved');
    // Distance only, with its existing load.
    await expect(panel.getByLabel('Sled Push set 1 reps')).toHaveCount(0);
    await panel.getByLabel('Sled Push set 1 distance', { exact: true }).fill('25');
    await row(page, 'Sled Push').getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Sled Push')).toHaveAttribute('data-state', 'saved');
    // Duration + distance, changing one unit (number kept, no conversion).
    await panel.getByLabel('Easy Row set 1 duration', { exact: true }).fill('12.5');
    await panel.getByLabel('Easy Row set 1 distance', { exact: true }).fill('2');
    await panel.getByLabel('Easy Row set 1 distance unit').selectOption('mi');
    await expect(panel.getByLabel('Easy Row set 1 distance', { exact: true })).toHaveValue('2');
    await row(page, 'Easy Row').getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Easy Row')).toHaveAttribute('data-state', 'saved');

    const sent = (id) => { const { event_id: eventId, base_revision: base, setId, ...fields } = state.setPatches.find((p) => p.setId === id); return { eventId, base, fields }; };
    expect(sent('plank-s1').fields).toEqual({ status: 'completed', actual_reps: null, actual_load_value: null, actual_load_unit: null, actual_duration_value: 50, actual_duration_unit: 's' });
    expect(sent('carry-s1').fields).toEqual({ status: 'completed', actual_reps: null, actual_load_value: 40, actual_load_unit: 'kg', actual_distance_value: 25, actual_distance_unit: 'm' });
    expect(sent('row-s1').fields).toEqual({ status: 'completed', actual_reps: null, actual_load_value: null, actual_load_unit: null, actual_duration_value: 12.5, actual_duration_unit: 'min', actual_distance_value: 2, actual_distance_unit: 'mi' });
    for (const id of ['plank-s1', 'carry-s1', 'row-s1']) { expect(sent(id).eventId).toMatch(/^[0-9a-f-]{36}$/); expect(sent(id).base).toBe(0); }
    expect(state.setPatches.some((p) => 'actual_rpe' in p)).toBe(false);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('reps/weight sets keep their payload; a metric set with no value is refused before sending', async ({ page }) => {
  const state = await setup(page);
  const panel = page.getByTestId(`participant-panel-${ANA.id}`);
  await panel.getByLabel('Front Squat set 1 reps').fill('5');
  await row(page, 'Front Squat').getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Front Squat')).toHaveAttribute('data-state', 'saved');
  const squat = state.setPatches.find((p) => p.setId === 'squat-s1');
  expect({ status: squat.status, actual_reps: squat.actual_reps, actual_load_value: squat.actual_load_value, actual_load_unit: squat.actual_load_unit }).toEqual({ status: 'completed', actual_reps: 5, actual_load_value: 60, actual_load_unit: 'kg' });
  expect(Object.keys(squat).filter((k) => k.startsWith('actual_duration') || k.startsWith('actual_distance'))).toEqual([]);
  // An invalid metric (negative) never leaves the browser.
  await panel.getByLabel('Plank Hold set 1 duration', { exact: true }).fill('-3');
  await row(page, 'Plank Hold').getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Plank Hold')).toHaveAttribute('data-state', 'error');
  expect(state.setPatches.some((p) => p.setId === 'plank-s1')).toBe(false);
  await expect(panel.getByLabel('Plank Hold set 1 duration', { exact: true })).toHaveValue('-3');
});

test('a metric save with no answer keeps the typed values and retries with the same event id', async ({ page }) => {
  const state = await setup(page, { failFirstPatchOf: 'row-s1' });
  const panel = page.getByTestId(`participant-panel-${ANA.id}`);
  await panel.getByLabel('Easy Row set 1 duration', { exact: true }).fill('10');
  await panel.getByLabel('Easy Row set 1 distance', { exact: true }).fill('1.5');
  await row(page, 'Easy Row').getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Easy Row')).toHaveAttribute('data-state', 'failed');
  await expect(panel.getByLabel('Easy Row set 1 duration', { exact: true })).toHaveValue('10');
  await row(page, 'Easy Row').getByRole('button', { name: 'Retry' }).click();
  await expect(row(page, 'Easy Row')).toHaveAttribute('data-state', 'saved');
  const attempts = state.setPatches.filter((p) => p.setId === 'row-s1');
  expect(attempts).toHaveLength(2);
  expect(attempts[1].event_id).toBe(attempts[0].event_id);
  expect(attempts[1].actual_distance_value).toBe(1.5);
});

test('a finished workout shows performed metrics, not reps', async ({ page }) => {
  const state = await setup(page, { logStatus: 'completed' });
  // Fill the completed values on the server copy and reload the panel.
  Object.assign(state.log.exercises[1].sets[0], { status: 'completed', actual_duration_value: 50, actual_duration_unit: 's' });
  Object.assign(state.log.exercises[3].sets[0], { status: 'completed', actual_duration_value: 12.5, actual_duration_unit: 'min', actual_distance_value: 2, actual_distance_unit: 'mi' });
  Object.assign(state.log.exercises[0].sets[0], { status: 'completed', actual_reps: 5 });
  await page.reload();
  await page.getByTestId('group-mode-participants').click();
  await expect(row(page, 'Plank Hold')).toContainText('50 s');
  await expect(row(page, 'Easy Row')).toContainText('12.5 min × 2 mi');
  await expect(row(page, 'Front Squat')).toContainText('5 × 60 kg');
  await expect(row(page, 'Plank Hold')).not.toContainText('—');
});

test('unfinished-plan editor labels the actual load unit and sends it unchanged', async ({ page }) => {
  const state = await setup(page);
  const squat = page.getByTestId('participant-exercise-Front-Squat');
  await squat.getByTestId('plan-edit-open').click();
  const dialog = page.getByTestId('plan-edit-dialog');
  await expect(dialog).toContainText('Load (kg)');
  await expect(dialog).not.toContainText('Load (lb)');
  await expect(dialog.getByTestId('plan-edit-load')).toHaveValue('60');
  await dialog.getByTestId('plan-edit-load').fill('45');
  await dialog.getByTestId('plan-edit-save').click();
  await expect(dialog).toHaveCount(0);
  expect(state.planPatches[0]).toMatchObject({ exerciseId: 'squat', prescribed_load_value: 45, prescribed_load_unit: 'kg' });
  await expect(squat).toContainText('45 kg');
  // An lb prescription stays lb; a bodyweight (no load) exercise defaults to lb, as the server does.
  await page.getByTestId('participant-exercise-Bench-Press').getByTestId('plan-edit-open').click();
  await expect(page.getByTestId('plan-edit-dialog')).toContainText('Load (lb)');
  await page.getByTestId('plan-edit-dialog').getByTestId('plan-edit-save').click();
  await expect(page.getByTestId('plan-edit-dialog')).toHaveCount(0);
  expect(state.planPatches[1]).toMatchObject({ exerciseId: 'press', prescribed_load_value: 135, prescribed_load_unit: 'lb' });
  await page.getByTestId('participant-exercise-Plank-Hold').getByTestId('plan-edit-open').click();
  await expect(page.getByTestId('plan-edit-dialog')).toContainText('Load (lb)');
  await page.getByTestId('plan-edit-dialog').getByTestId('plan-edit-save').click();
  expect(state.planPatches[2]).toMatchObject({ exerciseId: 'plank', prescribed_load_value: null, prescribed_load_unit: null });
  // Completed history is untouched by plan edits.
  expect(state.setPatches).toEqual([]);
  expect(state.unexpected).toEqual([]);
});
