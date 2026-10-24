// End-to-end fictional journey (normal mode, synthetic API in this test
// process): a coach creates a workout from the catalog with its library guide,
// reopens and edits it, assigns it to a client; the client tracks it, logs a set
// while offline, reloads (device-local queue survives and syncs exactly once),
// finishes and sees history; the coach then sees the completed log.
//
// Evidence class: MOCKED. The fake backend keeps state across reloads and role
// switches and snapshots workouts into logs the way the API does, but it is not
// the real server, database or auth. Real authorization/SQL are proven elsewhere.
import { test, expect } from '@playwright/test';
import { resolveExerciseDemo } from '../../src/lib/exerciseDemo.js';

const COACH = { id: 'coach-j', name: 'Synthetic Journey Coach', email: 'journey-coach@example.invalid', is_admin: false };
const CLIENT = { id: 'client-j', coach_id: 'coach-j', name: 'Synthetic Journey Client', email: 'journey-client@example.invalid', archived: false, auth_user_id: 'user-client-j', waiver_signed: true };
const TOKENS = { coach: 'synthetic-journey-coach-token', client: 'synthetic-journey-client-token' };
const GUIDE = 'https://www.youtube.com/watch?v=SYNTHjrny01';
const LIBRARY = [
  { id: 'lib-goblet', name: 'Goblet Squat', category: 'Strength', equipment: 'Dumbbell', primary_muscle: 'Quads', video_url: GUIDE, hidden: false, archived: false },
  { id: 'lib-row', name: 'Cable Row', category: 'Strength', equipment: 'Cable', primary_muscle: 'Back', video_url: null, hidden: false, archived: false },
];
const now = () => new Date().toISOString();

class FakeBackend {
  constructor() {
    this.workouts = [];
    this.assignments = [];
    this.logs = [];
    this.writes = [];
    this.unexpected = [];
    this.forbidden = [];
    this.seq = 0;
  }
  id(prefix) { this.seq += 1; return `${prefix}-${this.seq}`; }
  saveWorkout(body, existing) {
    const exercises = (body.exercises || []).map((row, position) => ({
      id: row.id || this.id('wex'), position, custom_name: row.custom_name, exercise_library_id: row.exercise_library_id || null,
      sets: row.sets, reps: row.reps, rest: row.rest || '', tempo: row.tempo || '', target_rpe: row.target_rpe || '',
      tracking_type: row.tracking_type || 'reps_weight', video_link_mode: row.video_link_mode ?? null, video_url: row.video_url || null,
      default_load_value: row.default_load_value === '' || row.default_load_value == null ? null : Number(row.default_load_value), default_load_unit: row.default_load_unit || 'lb',
      client_notes: row.client_notes || '', coach_notes: row.coach_notes || '', superset_group: row.superset_group || null,
    }));
    const workout = {
      ...(existing || {}), id: existing?.id || this.id('workout'), name: body.name, description: body.description || '', goal: body.goal || '',
      coach_id: COACH.id, created_by: COACH.id, author: { id: COACH.id, name: COACH.name }, hidden: false, archived: false, is_template: true,
      exercises, exercise_count: exercises.length, updated_at: now(),
    };
    this.workouts = existing ? this.workouts.map((w) => (w.id === workout.id ? workout : w)) : [...this.workouts, workout];
    return workout;
  }
  startLog(assignment) {
    const workout = assignment.workout;
    const library = new Map(LIBRARY.map((row) => [row.id, row]));
    const log = {
      id: this.id('log'), client_id: CLIENT.id, workout_name: workout.name, status: 'active', started_at: now(), completed_at: null,
      workout_assignment_id: assignment.id, program_assignment_id: null, notes: null, feedback: null, coach_responses: [],
      exercises: workout.exercises.map((row, index) => {
        const exerciseId = this.id('lex');
        const demo = resolveExerciseDemo({ workoutExercise: row, libraryExercise: library.get(row.exercise_library_id) || null });
        return {
          id: exerciseId, exercise_name: row.custom_name, exercise_library_id: row.exercise_library_id, source_workout_exercise_id: row.id,
          tracking_type: row.tracking_type, prescribed_sets: Number(row.sets), prescribed_reps: row.reps, prescribed_rpe: row.target_rpe || null,
          prescribed_rest: row.rest, prescribed_rest_seconds: Number.parseInt(row.rest, 10) || null, prescribed_load_value: row.default_load_value, prescribed_load_unit: row.default_load_unit,
          sort_order: index, superset_group: null, client_notes: null, demo, video_url: demo?.url || null,
          sets: Array.from({ length: Number(row.sets) }, (_, n) => ({
            id: `${exerciseId}-set-${n + 1}`, workout_log_exercise_id: exerciseId, set_number: n + 1, set_origin: 'prescribed', status: 'pending',
            actual_load_value: row.default_load_value, actual_load_unit: row.default_load_unit, actual_reps: null, actual_rpe: null,
            actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
          })),
        };
      }),
    };
    this.logs.push(log);
    return log;
  }
}

async function install(page, backend) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.__cvfOnline = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__cvfOnline });
    window.__setOnline = (value) => { window.__cvfOnline = value; window.dispatchEvent(new Event(value ? 'online' : 'offline')); };
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    const token = (request.headers().authorization || '').replace(/^Bearer /, '');
    const role = token === TOKENS.coach ? 'coach' : token === TOKENS.client ? 'client' : null;
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    if (method !== 'GET') backend.writes.push({ role, method, path, body });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (!role) return json({ error: 'Invalid or expired token' }, 401);
    if (path === '/auth/me') return json(role === 'coach' ? { role, email: COACH.email, profile: COACH } : { role, email: CLIENT.email, profile: CLIENT });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    const forbid = () => { backend.forbidden.push(`${role} ${method} ${path}`); return json({ error: 'Not found' }, 404); };

    // ---- Coach surfaces -------------------------------------------------
    if (role === 'coach') {
      if (path === '/exercise-media/library-status') return json({ enabled: false, items: [], summary: null });
      if (path === '/programs/exercise-library' && method === 'GET') return json(LIBRARY);
      if (path === '/programs/workouts' && method === 'GET') return json(backend.workouts);
      if (path === '/programs/workouts' && method === 'POST') return json(backend.saveWorkout(body), 201);
      const workout = path.match(/^\/programs\/workouts\/([^/]+)$/);
      if (workout && method === 'GET') { const row = backend.workouts.find((w) => w.id === workout[1]); return row ? json(row) : json({ error: 'Workout not found' }, 404); }
      if (workout && method === 'PUT') {
        const existing = backend.workouts.find((w) => w.id === workout[1]);
        if (!existing) return json({ error: 'Workout not found' }, 404);
        return json(backend.saveWorkout(body, existing));
      }
      if (path === '/programs' && method === 'GET') return json([]);
      if (path === '/clients' && method === 'GET') return json([CLIENT]);
      if (path === `/clients/${CLIENT.id}` && method === 'GET') return json(CLIENT);
      if (path === `/waivers/client/${CLIENT.id}/status`) return json({ has_version: false, signed_latest: false, history: [] });
      if (path === `/workout-logs/clients/${CLIENT.id}/week-rhythm`) return json({ week_total: 0, week_done: 0, days: [] });
      if (path === `/programs/program-assignments/client/${CLIENT.id}`) return json([]);
      if (path === `/programs/workout-assignments/client/${CLIENT.id}`) return json(backend.assignments.filter((a) => !a.archived));
      if (path === '/programs/workout-assignments' && method === 'POST') {
        const source = backend.workouts.find((w) => w.id === body.workout_id);
        if (!source || body.client_id !== CLIENT.id) return json({ error: 'Not found' }, 404);
        const assignment = { id: backend.id('assignment'), kind: 'standard', client_id: body.client_id, assignment_mode: body.assignment_mode, assigned_for: body.assigned_for, notes: body.notes || null, archived: false, quick_session_completed: false, exercise_loads: body.exercise_loads || [], workout: structuredClone(source) };
        backend.assignments.push(assignment);
        return json(assignment, 201);
      }
      if (path === `/workout-logs/client/${CLIENT.id}`) {
        const done = backend.logs.filter((log) => log.status === 'completed');
        return json(url.searchParams.get('paged') === '1' ? { logs: done, next_cursor: null } : done);
      }
      if (path === `/sessions` && url.searchParams.get('client_id') === CLIENT.id) return json([]);
    }

    // ---- Client surfaces ------------------------------------------------
    if (role === 'client') {
      if (path.startsWith('/programs/workouts') || path === '/programs/workout-assignments') return forbid();
      if (path === '/programs/client/assigned') return json({ programs: [], workouts: backend.assignments.filter((a) => !a.archived && a.client_id === CLIENT.id) });
      if (path === '/workout-logs/active') return json(backend.logs.find((log) => log.status === 'active') || null);
      if (path === '/workout-logs/mine') {
        const done = backend.logs.filter((log) => log.status === 'completed');
        return json(url.searchParams.get('paged') === '1' ? { logs: done, next_cursor: null } : done);
      }
      if (path === '/workout-logs/start' && method === 'POST') {
        const assignment = backend.assignments.find((a) => a.id === body.workout_assignment_id && a.client_id === CLIENT.id);
        if (!assignment) return json({ error: 'Assignment not found' }, 404);
        return json({ workout_log: backend.startLog(assignment) }, 201);
      }
    }

    // ---- Logs, readable by the owning client and by the coach -----------
    const logMatch = path.match(/^\/workout-logs\/([^/]+)(\/.*)?$/);
    const log = logMatch && backend.logs.find((row) => row.id === logMatch[1]);
    if (log) {
      const rest = logMatch[2] || '';
      if (rest === '' && method === 'GET') return json(log);
      if (/^\/exercises\/[^/]+\/history$/.test(rest)) return json({ occurrences: [], next_cursor: null });
      if (role !== 'client') return forbid();
      const set = rest.match(/^\/sets\/([^/]+)$/);
      if (set && method === 'PATCH') {
        if (log.status !== 'active') return json({ error: 'This workout is no longer active' }, 409);
        const row = log.exercises.flatMap((exercise) => exercise.sets).find((candidate) => candidate.id === set[1]);
        if (!row) return json({ error: 'Set not found' }, 404);
        Object.assign(row, body);
        return json(row);
      }
      if (rest === '/complete' && method === 'POST') {
        if (log.status !== 'active') return json({ error: 'This workout is no longer active' }, 409);
        if (!log.exercises.some((exercise) => exercise.sets.some((s) => s.status === 'completed'))) return json({ error: 'Complete at least one set' }, 400);
        Object.assign(log, { status: 'completed', completed_at: now(), notes: body?.notes || null, feedback: body?.feedback || null });
        return json(log);
      }
    }
    backend.unexpected.push(`${role} ${method} ${path}`);
    return json({ error: 'Unexpected synthetic route' }, 404);
  });
}

async function signIn(page, role) {
  await page.evaluate((token) => { localStorage.setItem('cvf_access_token', token); localStorage.removeItem('cvf_refresh_token'); }, TOKENS[role]);
}

for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  test(`${label}: coach create/edit/assign → client track offline, reopen, sync once, finish → both see history`, async ({ page }) => {
    test.setTimeout(90_000);
    const backend = new FakeBackend();
    await page.setViewportSize(viewport);
    await install(page, backend);
    const desktop = label === 'desktop';
    const prompts = [];
    let step = 'create';
    page.on('dialog', (dialog) => { prompts.push(`${step}:${dialog.type()}`); dialog.accept(); });

    // ---- 1. Coach creates a workout from the catalog (typed key by key) ----
    await page.goto('/login');
    await signIn(page, 'coach');
    await page.goto('/coach/programs');
    await page.getByTestId('training-builder-tab-workouts').click();
    await page.getByTestId(desktop ? 'workout-rail-create' : 'workout-create-button').click();
    const editor = desktop ? page.getByTestId('workout-editor-pane') : page.getByRole('dialog');
    await editor.getByTestId('workout-name-input').fill('Synthetic Journey Lower');
    const name = editor.getByTestId('workout-exercise-name-input').first();
    await name.click();
    await name.pressSequentially('Goblet Squat');
    await editor.getByTestId('workout-exercise-sets-input').first().fill('2');
    await editor.getByTestId('workout-exercise-reps-input').first().fill('8');
    await expect(editor.getByTestId('workout-exercise-demo-library')).toBeChecked();
    // Keyboard submission.
    await editor.getByTestId('workout-save-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Workout created').first()).toBeVisible();
    expect(backend.workouts).toHaveLength(1);
    const created = backend.writes.find((w) => w.method === 'POST' && w.path === '/programs/workouts');
    expect(created.body.exercises).toHaveLength(1);
    expect(created.body.exercises[0]).toMatchObject({ custom_name: 'Goblet Squat', exercise_library_id: 'lib-goblet', video_link_mode: 'inherit', sets: '2', reps: '8' });
    expect(created.body.exercises[0].video_url || '').toBe('');

    // ---- 2. Reload (fresh page state), reopen and edit: add a second exercise ----
    step = 'edit';
    await page.reload();
    await page.getByTestId('training-builder-tab-workouts').click();
    if (desktop) await page.getByTestId('workout-rail').getByRole('button', { name: /Synthetic Journey Lower/ }).click();
    else await page.getByTestId('workout-card').filter({ hasText: 'Synthetic Journey Lower' }).getByTestId('workout-edit-button').click();
    await expect(editor.getByTestId('workout-name-input')).toHaveValue('Synthetic Journey Lower');
    await expect(editor.getByTestId('workout-exercise-name-input').first()).toHaveValue('Goblet Squat');
    await editor.getByTestId('workout-exercise-add-button').click();
    const row2 = editor.getByTestId('workout-exercise-row').nth(1);
    const trigger = row2.locator('h3 button');
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    const second = row2.getByTestId('workout-exercise-name-input');
    await second.click();
    await second.pressSequentially('Cable Row');
    await row2.getByTestId('workout-exercise-sets-input').fill('1');
    await row2.getByTestId('workout-exercise-reps-input').fill('10');
    await editor.getByTestId('workout-save-button').click();
    await expect(page.getByText('Workout updated').first()).toBeVisible();
    expect(backend.writes.filter((w) => w.method === 'PUT')).toHaveLength(1);
    const edited = backend.writes.find((w) => w.method === 'PUT');
    expect(edited.path).toBe(`/programs/workouts/${backend.workouts[0].id}`);
    // The original row keeps its stable id and guide reference; the new row links the catalog.
    const firstRowId = backend.workouts[0].exercises[0].id;
    expect(edited.body.exercises[0]).toMatchObject({ id: firstRowId, custom_name: 'Goblet Squat', exercise_library_id: 'lib-goblet', video_link_mode: 'inherit', sets: '2', reps: '8' });
    expect(edited.body.exercises[1]).toMatchObject({ custom_name: 'Cable Row', exercise_library_id: 'lib-row', video_link_mode: 'inherit', sets: '1', reps: '10' });
    expect(edited.body.exercises[1].id || '').toBe('');
    expect(backend.workouts[0].exercises[0].id).toBe(firstRowId);
    expect(backend.workouts[0].exercises.map((row) => row.custom_name)).toEqual(['Goblet Squat', 'Cable Row']);

    // ---- 3. Assign it to the client as an active standalone workout ----
    step = 'assign';
    await page.goto(`/coach/clients/${CLIENT.id}?tab=programs`);
    await page.getByTestId('assign-program-button').click();
    await page.getByTestId('client-assignment-type-select').click();
    await page.getByRole('option', { name: 'Standalone workout' }).click();
    await page.getByTestId('client-assignment-workout-select').click();
    await page.getByRole('option', { name: /Synthetic Journey Lower/ }).click();
    await page.getByTestId('assign-confirm-button').click();
    await expect(page.getByTestId('assigned-workout-card').filter({ hasText: 'Synthetic Journey Lower' })).toBeVisible();
    const assigned = backend.writes.find((w) => w.path === '/programs/workout-assignments');
    expect(assigned.body).toMatchObject({ client_id: CLIENT.id, workout_id: backend.workouts[0].id, assignment_mode: 'active', assigned_for: null });

    // ---- 4. Client starts it; the guide inherited from the catalog reaches the tracker ----
    step = 'track';
    await signIn(page, 'client');
    await page.goto('/client/programs?view=other');
    const card = page.getByTestId('client-workout-assignment-card').filter({ hasText: 'Synthetic Journey Lower' });
    await card.getByTestId('start-standalone-workout').click();
    await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);
    const logId = backend.logs[0].id;
    const cards = page.getByTestId('tracker-exercise-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByTestId('tracker-exercise-demo')).toHaveText(/View demo/);
    await cards.nth(0).getByTestId('tracker-exercise-demo').click();
    await expect(page.getByTestId('exercise-demo-external')).toHaveAttribute('href', GUIDE);
    await page.keyboard.press('Escape');
    await expect(page.locator('iframe')).toHaveCount(0);
    // Cable Row has no library guide: no demo action.
    await expect(cards.nth(1).getByTestId('tracker-exercise-demo')).toHaveCount(0);

    // Set 1 online.
    await page.getByRole('spinbutton', { name: 'Goblet Squat set 1 performed reps', exact: true }).fill('8');
    await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
    await expect.poll(() => backend.logs[0].exercises[0].sets[0].status).toBe('completed');

    // ---- 5. Offline: set 2 is kept on the device only ----
    await page.evaluate(() => window.__setOnline(false));
    await expect(page.getByTestId('workout-save-state')).toContainText('Not saved yet');
    await page.getByRole('spinbutton', { name: 'Goblet Squat set 2 performed reps', exact: true }).fill('7');
    await page.getByRole('button', { name: 'Complete set 2', exact: true }).first().click();
    const queued = await page.evaluate((id) => JSON.parse(localStorage.getItem(`cvf_workout_outbox_${id}`) || '[]'), logId);
    expect(queued.length).toBeGreaterThan(0);
    expect(backend.logs[0].exercises[0].sets[1].status).toBe('pending');
    const patchesBeforeReload = backend.writes.filter((w) => w.method === 'PATCH').length;

    // ---- 6. Reopen (reload) back online: the queue survives and syncs exactly once ----
    step = 'reopen-with-queued-set';
    await page.reload();
    step = 'after-reopen';
    await expect(page.getByTestId('workout-tracker')).toBeVisible();
    await expect(page.getByTestId('workout-save-state')).toContainText('Saved', { timeout: 10_000 });
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`cvf_workout_outbox_${id}`), logId)).toBeNull();
    const set2 = backend.logs[0].exercises[0].sets[1];
    expect([set2.status, set2.actual_reps]).toEqual(['completed', 7]);
    const set2Writes = backend.writes.filter((w) => w.method === 'PATCH' && w.path.endsWith(`/sets/${set2.id}`));
    expect(set2Writes.length).toBeGreaterThanOrEqual(1);
    expect(backend.writes.filter((w) => w.method === 'PATCH').length - patchesBeforeReload).toBe(set2Writes.length);
    await expect(page.getByRole('spinbutton', { name: 'Goblet Squat set 2 performed reps', exact: true })).toHaveValue('7');

    // ---- 7. Finish; history visible to the client ----
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    await page.getByRole('button', { name: /Confirm completion/i }).click();
    await expect(page).toHaveURL(new RegExp(`/client/workouts/${logId}$`));
    await expect(page.getByTestId('workout-completion-summary')).toHaveAttribute('data-completion-motion', 'active');
    expect(backend.logs[0].status).toBe('completed');
    expect(backend.writes.filter((w) => w.path === `/workout-logs/${logId}/complete`)).toHaveLength(1);
    await page.goto('/client/programs?view=history');
    await expect(page.getByTestId('workout-history-row').filter({ hasText: 'Synthetic Journey Lower' })).toBeVisible();

    // ---- 8. Coach sees the completed log with the client's actual values ----
    await signIn(page, 'coach');
    await page.goto(`/coach/clients/${CLIENT.id}?tab=programs`);
    const history = page.getByTestId('coach-client-workout-history');
    await history.getByRole('link', { name: /Synthetic Journey Lower/ }).click();
    await expect(page).toHaveURL(new RegExp(`/coach/workouts/${logId}$`));
    await expect(page.getByText('Goblet Squat').first()).toBeVisible();

    expect(backend.forbidden).toEqual([]);
    expect(backend.unexpected).toEqual([]);
    // No unsaved-changes prompt anywhere: every save settled before navigating.
    expect(prompts).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}

test('the client cannot read or write coach builder routes, and an unauthenticated call is refused', async ({ page }) => {
  const backend = new FakeBackend();
  await install(page, backend);
  await page.goto('/login');
  await signIn(page, 'client');
  const results = await page.evaluate(async () => {
    const { api } = await import('/src/lib/api.js');
    const call = (fn) => fn().then((r) => r.status, (e) => e.response?.status ?? 'network');
    return [await call(() => api.get('/programs/workouts')), await call(() => api.post('/programs/workout-assignments', { client_id: 'client-j', workout_id: 'x' }))];
  });
  expect(results).toEqual([404, 404]);
  expect(backend.forbidden).toEqual(['client GET /programs/workouts', 'client POST /programs/workout-assignments']);
});
