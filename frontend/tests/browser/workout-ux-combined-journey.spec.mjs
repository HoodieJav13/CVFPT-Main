// Combined fictional coach-to-client journey (normal mode, synthetic API in
// this test process). A coach checks an OFFLINE MOCK draft proposal (the
// companion's real export, see fixtures/offline-proposal/PROVENANCE.md) against
// the catalog: wrong-catalog and tampered files are refused, the coach edits
// and explicitly confirms, an edited bound row and a failed server save are
// both refused honestly, then the program template is saved (not assigned),
// edited and assigned. The client starts a program day, sees dated prior values,
// fills blanks without losing typed values (one PATCH per set), queues a set
// offline, reopens, loses the session with a set queued, signs in again, and
// finishes; both roles see the history.
//
// Evidence class: MOCKED. The fake backend keeps state across reloads and role
// switches and mirrors the import name match, but it is not the real server,
// database or auth. Media conflicts are proven by the guides/media lanes.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const fixture = (name) => readFileSync(new URL(`./fixtures/offline-proposal/${name}`, import.meta.url));
const LIBRARY = JSON.parse(fixture('library.json'));
const PROPOSAL_SHA = 'd288b6ba258bec838739e334c38ece7b979c9515bde0a15cead92de5cbf9163b';
const COACH = { id: 'fict-coach-c04', name: 'Fictional Coach C04', email: 'coach-c04@example.invalid', is_admin: false };
const CLIENT = { id: 'fict-sample-c', coach_id: COACH.id, name: 'Sample Client C (fictional)', email: 'sample-c@example.invalid', archived: false, auth_user_id: 'user-sample-c', waiver_signed: true };
const TOKENS = { coach: 'synthetic-c04-coach-token', client: 'synthetic-c04-client-token', clientAgain: 'synthetic-c04-client-token-2' };
const SEP14 = '2026-09-14T18:00:00.000Z';
const now = () => new Date().toISOString();
const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

class FakeBackend {
  constructor() {
    Object.assign(this, { workouts: [], programs: [], assignments: [], logs: [], writes: [], unexpected: [], forbidden: [], seq: 0 });
    this.failNextCommit = false;
    this.clientSessionDead = false;
  }
  id(prefix) { this.seq += 1; return `${prefix}-${this.seq}`; }
  // Mirrors commit_program_import: one workout per day; each row reuses the
  // oldest non-archived catalog row with the same normalized name.
  commitImport(draft) {
    const reused = [];
    const days = draft.days.map((day) => {
      const exercises = day.exercises.map((row, position) => {
        const match = LIBRARY.find((entry) => !entry.archived && normalize(entry.name) === normalize(row.name));
        if (!match) throw new Error(`synthetic backend: no catalog row for ${row.name}`);
        reused.push({ id: match.id, name: match.name });
        return {
          id: this.id('wex'), position, custom_name: row.name, exercise_library_id: match.id, library_exercise: { id: match.id, name: match.name },
          sets: row.sets, reps: row.reps, rest: row.rest, tempo: row.tempo || '', tracking_type: row.tracking_type,
          duration_value: row.duration_value, duration_unit: row.duration_unit, distance_value: row.distance_value, distance_unit: row.distance_unit,
          video_link_mode: 'inherit', video_url: null, default_load_value: null, default_load_unit: 'lb', client_notes: row.client_notes || '', coach_notes: row.coach_notes || '',
        };
      });
      const workout = { id: this.id('workout'), name: day.name, description: day.notes || '', coach_id: COACH.id, created_by: COACH.id, author: { id: COACH.id, name: COACH.name }, hidden: false, archived: false, is_template: true, exercises, exercise_count: exercises.length, updated_at: now() };
      this.workouts.push(workout);
      return { id: this.id('pday'), day_number: day.day_number, workout_id: workout.id, notes: day.notes || '' };
    });
    const program = { id: this.id('program'), coach_id: COACH.id, created_by: COACH.id, author: { id: COACH.id, name: COACH.name }, name: draft.program.name, description: draft.program.description || '', frequency_days: draft.program.frequency_days, hidden: false, archived: false, days };
    this.programs.push(program);
    return { program: this.programDetail(program), created_exercises: [], reused_exercises: reused };
  }
  programDetail(program) {
    const days = program.days.map((day) => ({ ...day, workout: this.workouts.find((w) => w.id === day.workout_id) }));
    return { ...program, days, day_count: days.length, exercise_count: days.reduce((n, day) => n + (day.workout?.exercise_count || 0), 0), assignments: [], active_assignments: [] };
  }
  startProgramDay(assignment, dayId) {
    const program = this.programs.find((p) => p.id === assignment.program_id);
    const day = program?.days.find((d) => d.id === dayId);
    if (!day) return null;
    const workout = this.workouts.find((w) => w.id === day.workout_id);
    const log = {
      id: this.id('log'), client_id: CLIENT.id, workout_name: workout.name, status: 'active', started_at: now(), completed_at: null,
      workout_assignment_id: null, program_assignment_id: assignment.id, program_day_id: day.id, notes: null, feedback: null, coach_responses: [],
      exercises: workout.exercises.map((row, index) => {
        const exerciseId = this.id('lex');
        return {
          id: exerciseId, exercise_name: row.custom_name, exercise_library_id: row.exercise_library_id, source_workout_exercise_id: row.id,
          tracking_type: row.tracking_type, prescribed_sets: Number(row.sets), prescribed_reps: row.reps, prescribed_rpe: null,
          prescribed_rest: row.rest, prescribed_rest_seconds: Number.parseInt(row.rest, 10) || null, prescribed_load_value: null, prescribed_load_unit: 'lb',
          sort_order: index, superset_group: null, client_notes: null, demo: null, video_url: null,
          sets: Array.from({ length: Number(row.sets) }, (_, n) => ({
            id: `${exerciseId}-set-${n + 1}`, workout_log_exercise_id: exerciseId, set_number: n + 1, set_origin: 'prescribed', status: 'pending',
            actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
            actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
          })),
        };
      }),
    };
    this.logs.push(log);
    return log;
  }
  // A fictional earlier Goblet Squat occurrence, so the tracker has prior values.
  history(exercise) {
    if (exercise.exercise_library_id !== 'lib-goblet') return [];
    return [{ occurrence_id: 'occ-sep14', workout_log_id: 'fict-old-log', completed_at: SEP14, exercise_name: 'Goblet Squat', tracking_type: 'reps_weight', sets: [
      { set_number: 1, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 10, actual_rpe: 7 },
      { set_number: 2, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 9, actual_rpe: 8 },
    ] }];
  }
}

async function install(page, backend) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (window.__cvfOnline === undefined) window.__cvfOnline = true;
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
    let role = token === TOKENS.coach ? 'coach' : [TOKENS.client, TOKENS.clientAgain].includes(token) ? 'client' : null;
    if (role === 'client' && token === TOKENS.client && backend.clientSessionDead) role = null;
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    if (method !== 'GET') backend.writes.push({ role, method, path, body, token });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path === '/auth/refresh') return json({ error: 'Invalid refresh token' }, 401);
    if (!role) return json({ error: 'Invalid or expired token' }, 401);
    if (path === '/auth/me') return json(role === 'coach' ? { role, email: COACH.email, profile: COACH } : { role, email: CLIENT.email, profile: CLIENT });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    const forbid = () => { backend.forbidden.push(`${role} ${method} ${path}`); return json({ error: 'Not found' }, 404); };

    if (role === 'coach') {
      if (path === '/exercise-media/library-status') return json({ enabled: false, items: [], summary: null });
      if (path === '/programs/exercise-library' && method === 'GET') return json(LIBRARY.filter((row) => !row.archived && (url.searchParams.get('include_hidden') === 'true' || !row.hidden)));
      if (path === '/programs/workouts' && method === 'GET') return json(backend.workouts);
      if (path === '/programs' && method === 'GET') return json(backend.programs.filter((p) => !p.archived).map((p) => backend.programDetail(p)));
      if (path === '/clients' && method === 'GET') return json([CLIENT]);
      if (path === '/programs/import/commit' && method === 'POST') {
        if (backend.failNextCommit) { backend.failNextCommit = false; return json({ error: 'Synthetic outage: the program was not saved' }, 500); }
        return json(backend.commitImport(body.draft), 201);
      }
      const program = path.match(/^\/programs\/([^/]+)$/);
      if (program && method === 'PUT') {
        const row = backend.programs.find((p) => p.id === program[1]);
        if (!row) return json({ error: 'Program not found' }, 404);
        Object.assign(row, { name: body.name, description: body.description || '', frequency_days: Number(body.frequency_days), days: body.days.map((day, i) => ({ id: row.days[i]?.id || backend.id('pday'), day_number: day.day_number, workout_id: day.workout_id, notes: day.notes || '' })) });
        return json(backend.programDetail(row));
      }
      const assign = path.match(/^\/programs\/([^/]+)\/assign$/);
      if (assign && method === 'POST') {
        if (body.client_id !== CLIENT.id || !backend.programs.some((p) => p.id === assign[1])) return json({ error: 'Not found' }, 404);
        const row = { id: backend.id('passign'), program_id: assign[1], client_id: body.client_id, notes: body.notes || null, archived: false, created_at: now(), exercise_loads: [] };
        backend.assignments.push(row);
        return json(row, 201);
      }
      if (path === `/clients/${CLIENT.id}` && method === 'GET') return json(CLIENT);
      if (path === `/waivers/client/${CLIENT.id}/status`) return json({ has_version: false, signed_latest: false, history: [] });
      if (path === `/workout-logs/clients/${CLIENT.id}/week-rhythm`) return json({ week_total: 0, week_done: 0, days: [] });
      if (path === `/programs/program-assignments/client/${CLIENT.id}`) return json(backend.assignments.map((a) => ({ ...a, program: backend.programDetail(backend.programs.find((p) => p.id === a.program_id)) })));
      if (path === `/programs/workout-assignments/client/${CLIENT.id}`) return json([]);
      if (path === `/workout-logs/client/${CLIENT.id}`) {
        const done = backend.logs.filter((log) => log.status === 'completed');
        return json(url.searchParams.get('paged') === '1' ? { logs: done, next_cursor: null } : done);
      }
      if (path === '/sessions' && url.searchParams.get('client_id') === CLIENT.id) return json([]);
    }

    if (role === 'client') {
      if (path.startsWith('/programs/import') || path === '/programs' || /^\/programs\/[^/]+\/assign$/.test(path)) return forbid();
      if (path === '/programs/client/assigned') {
        return json({ programs: backend.assignments.filter((a) => !a.archived && a.client_id === CLIENT.id).map((a) => ({ ...a, program: backend.programDetail(backend.programs.find((p) => p.id === a.program_id)) })), workouts: [] });
      }
      if (path === '/workout-logs/active') return json(backend.logs.find((log) => log.status === 'active') || null);
      if (path === '/workout-logs/mine') {
        const done = backend.logs.filter((log) => log.status === 'completed');
        return json(url.searchParams.get('paged') === '1' ? { logs: done, next_cursor: null } : done);
      }
      if (path === '/workout-logs/start' && method === 'POST') {
        const assignment = backend.assignments.find((a) => a.id === body.program_assignment_id && a.client_id === CLIENT.id);
        const log = assignment && backend.startProgramDay(assignment, body.program_day_id);
        return log ? json({ workout_log: log, outcome: 'started' }, 201) : json({ error: 'Assigned workout not found' }, 404);
      }
    }

    const logMatch = path.match(/^\/workout-logs\/([^/]+)(\/.*)?$/);
    const log = logMatch && backend.logs.find((row) => row.id === logMatch[1]);
    if (log) {
      const rest = logMatch[2] || '';
      if (rest === '' && method === 'GET') return json(log);
      const historyMatch = rest.match(/^\/exercises\/([^/]+)\/history$/);
      if (historyMatch && method === 'GET') {
        const exercise = log.exercises.find((row) => row.id === historyMatch[1]);
        return json({ occurrences: exercise ? backend.history(exercise) : [], next_cursor: null });
      }
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

async function signIn(page, token) {
  await page.evaluate((value) => { localStorage.setItem('cvf_access_token', value); localStorage.removeItem('cvf_refresh_token'); }, token);
}

const tampered = (mutate) => {
  const envelope = JSON.parse(fixture('proposal.json'));
  mutate(envelope);
  return { name: 'proposal-tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) };
};

async function checkFile(dialog, file) {
  await dialog.getByTestId('program-import-proposal-file-input').setInputFiles(file);
  await dialog.getByTestId('program-import-proposal-check-button').click();
}

const shot = async (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });

for (const [label, viewport] of [['phone-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
  test(`${label}: offline MOCK proposal → coach-reviewed program → assign → client tracks with prior values, offline, expired session → finish`, async ({ page }) => {
    test.setTimeout(120_000);
    const backend = new FakeBackend();
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.setViewportSize(viewport);
    await install(page, backend);
    const prompts = [];
    let step = 'import';
    page.on('dialog', (dialog) => { prompts.push(`${step}:${dialog.type()}`); dialog.accept(); });
    const commits = () => backend.writes.filter((w) => w.path === '/programs/import/commit');

    // ---- 1. Coach opens the optional offline-proposal import ----
    await page.goto('/login');
    await signIn(page, TOKENS.coach);
    await page.goto('/coach/programs');
    await page.getByTestId('training-builder-tab-programs').click();
    await page.getByTestId('program-import-open-button').click();
    const dialog = page.getByTestId('program-import-dialog');
    await dialog.getByTestId('program-import-source-select').click();
    await page.getByRole('option', { name: 'Offline draft proposal (MOCK)' }).click();
    await expect(dialog.getByTestId('program-import-proposal-mock-banner')).toContainText('MOCK offline draft. Not a prescription, not assigned.');

    // ---- 2. Refusals: other catalog revision, tampered binding, non-MOCK provider ----
    const refusal = dialog.getByTestId('program-import-proposal-refusal');
    await checkFile(dialog, { name: 'proposal-ambiguous-catalog.json', mimeType: 'application/json', buffer: fixture('proposal-ambiguous-catalog.json') });
    await expect(refusal).toHaveAttribute('data-code', 'catalog_revision_mismatch');
    await expect(refusal).toContainText('The exercise catalog changed since this proposal was drafted.');
    await expect(dialog.getByTestId('program-import-review')).toHaveCount(0);
    await checkFile(dialog, tampered((p) => { p.exercise_bindings.rows[3].exercise_id = 'lib-unknown'; }));
    await expect(refusal).toHaveAttribute('data-code', 'exercise_binding_mismatch');
    await expect(refusal).toContainText('exercise_bindings.rows.3: Exercise lib-unknown is not in the current catalog');
    await checkFile(dialog, tampered((p) => { p.exercise_bindings.accepted_sha256 = '0'.repeat(64); }));
    await expect(refusal).toHaveAttribute('data-code', 'binding_invalid');
    await checkFile(dialog, tampered((p) => { p.provider = 'ENABLED / live model'; }));
    await expect(refusal).toHaveAttribute('data-code', 'invalid_proposal_file');
    await expect(refusal).toContainText('provider: Only MOCK offline proposals are accepted');
    await shot(page, `${label}-01-refused-non-mock`);

    // ---- 3. The real export verifies: identity, bindings, explicit coach review ----
    await checkFile(dialog, { name: 'proposal.json', mimeType: 'application/json', buffer: fixture('proposal.json') });
    await expect(refusal).toHaveCount(0);
    const panel = dialog.getByTestId('program-import-proposal-panel');
    await expect(panel.getByTestId('program-import-proposal-sha')).toHaveText(PROPOSAL_SHA);
    await expect(panel.getByTestId('program-import-proposal-catalog')).toHaveText(JSON.parse(fixture('proposal.json')).provenance.catalog_revision);
    await expect(panel.getByTestId('program-import-proposal-binding-row')).toHaveCount(6);
    await expect(panel.getByTestId('program-import-proposal-binding-row').nth(3)).toContainText('lib-row');
    const save = dialog.getByTestId('program-import-save-button');
    const confirm = dialog.getByTestId('program-import-proposal-confirm');
    await expect(save).toBeDisabled();
    await shot(page, `${label}-02-proposal-review`);

    // Coach edits a prescription (Goblet Squat: 2 sets); an edit clears the confirmation.
    await confirm.check();
    await expect(save).toBeEnabled();
    await dialog.getByTestId('program-import-exercise-sets-input').first().fill('2');
    await expect(confirm).not.toBeChecked();
    await expect(save).toBeDisabled();

    // Swapping a bound exercise is shown and refused at save, with nothing sent.
    const day2 = dialog.getByTestId('program-import-day-card').nth(1);
    await day2.getByRole('button').first().click();
    const rowName = day2.getByTestId('program-import-exercise-name-input').nth(1);
    await rowName.fill('Plank');
    await expect(panel.getByTestId('program-import-proposal-binding-row').nth(3)).toContainText('edited: Plank');
    await confirm.check();
    await save.click();
    await expect(refusal).toHaveAttribute('data-code', 'exercise_binding_mismatch');
    await expect(refusal).toContainText('Nothing was saved.');
    await expect(refusal).toBeInViewport();
    expect(commits()).toHaveLength(0);
    await rowName.fill('Cable Row');
    await expect(panel.getByTestId('program-import-proposal-binding-row').nth(3)).not.toContainText('edited');

    // ---- 4. A failed server save is reported honestly; the reviewed draft stays ----
    backend.failNextCommit = true;
    await confirm.check();
    await save.click();
    const failed = dialog.getByTestId('program-import-save-failed');
    await expect(failed).toContainText('Not saved');
    await expect(failed).toBeInViewport();
    await expect(failed).toContainText('Synthetic outage: the program was not saved. No program was created');
    await expect(page.getByText('Program saved to vault')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(backend.programs).toHaveLength(0);
    await expect(dialog.getByTestId('program-import-exercise-sets-input').first()).toHaveValue('2');
    await shot(page, `${label}-03-failed-save`);

    // ---- 5. Saved as a program template only (re-checked against a fresh catalog read) ----
    // Two synchronous taps still write once.
    await save.evaluate((button) => { button.click(); button.click(); });
    await expect(page.getByText('Program saved to vault (not assigned)').first()).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(commits()).toHaveLength(2);
    const committed = commits()[1].body.draft;
    expect(committed.program.name).toBe('Sample C Foundations (offline draft)');
    expect(committed.days.map((day) => day.exercises.map((row) => row.name))).toEqual([['Goblet Squat', 'Dead Bug'], ['Push-up', 'Cable Row'], ['Plank', 'Goblet Squat']]);
    expect(committed.days[0].exercises[0].sets).toBe('2');
    expect(backend.workouts.flatMap((w) => w.exercises.map((row) => row.exercise_library_id))).toEqual(['lib-goblet', 'lib-deadbug', 'lib-pushup', 'lib-row', 'lib-plank', 'lib-goblet']);
    expect(backend.assignments).toHaveLength(0);
    expect(backend.writes.filter((w) => /assign/.test(w.path))).toHaveLength(0);

    // ---- 6. Reload, reopen and edit the saved program ----
    step = 'edit';
    await page.reload();
    await page.getByTestId('training-builder-tab-programs').click();
    const card = page.getByTestId('program-card').filter({ hasText: 'Sample C Foundations (offline draft)' });
    await expect(card).toBeVisible();
    await card.getByTestId('program-edit-button').click();
    await page.getByTestId('program-description-input').fill('Coach-reviewed from the offline MOCK draft (fictional).');
    await page.getByTestId('program-save-button').click();
    await expect(page.getByText('Program updated').first()).toBeVisible();
    const put = backend.writes.find((w) => w.method === 'PUT' && w.path === `/programs/${backend.programs[0].id}`);
    expect(put.body.days.map((day) => day.workout_id)).toEqual(backend.workouts.map((w) => w.id));

    // ---- 7. Assign it to the fictional client: a separate, explicit step ----
    step = 'assign';
    await page.getByTestId('training-builder-tab-assignments').click();
    await page.getByTestId('assignment-client-select').click();
    await page.getByRole('option', { name: CLIENT.name }).click();
    await page.getByTestId('assignment-program-select').click();
    await page.getByRole('option', { name: 'Sample C Foundations (offline draft)' }).click();
    await page.getByTestId('assignment-submit-button').click();
    await expect(page.getByText('Program assigned').first()).toBeVisible();
    expect(backend.assignments).toHaveLength(1);

    // ---- 8. Client starts Day 1 and sees dated prior values for Goblet Squat ----
    step = 'track';
    await signIn(page, TOKENS.client);
    await page.goto('/client/programs');
    await page.getByTestId('client-program-card').getByTestId('start-program-workout').first().click();
    await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);
    const logId = backend.logs[0].id;
    const [goblet, deadbug] = backend.logs[0].exercises;
    expect(goblet.sets).toHaveLength(2);
    const cards = page.getByTestId('tracker-exercise-card');
    await expect(cards.nth(0).getByTestId('last-time-line')).toHaveText('Last time · Sep 14, 2026 · 35 lb × 10 · 35 lb × 9');

    // Typed value first, then fill: blanks fill, the typed weight stays, one PATCH per set.
    // The typed weight saves on blur first, so the baseline below counts only the fill's writes.
    const weight1 = page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true });
    await weight1.fill('40');
    await weight1.blur();
    await expect.poll(() => goblet.sets[0].actual_load_value).toBe(40);
    await page.waitForTimeout(300);
    const baseline = backend.writes.length;
    await cards.nth(0).getByTestId('same-as-last-time').click();
    await expect(cards.nth(0).getByTestId('last-time-note')).toHaveText('Filled sets 1, 2 from Sep 14, 2026. Typed values kept.');
    await expect.poll(() => goblet.sets.map((s) => [s.actual_load_value, s.actual_reps, s.status])).toEqual([[40, 10, 'pending'], [35, 9, 'pending']]);
    await page.waitForTimeout(400);
    const fillPatches = backend.writes.slice(baseline).filter((w) => w.method === 'PATCH');
    test.info().annotations.push({ type: 'fill-patches', description: JSON.stringify(fillPatches.map((w) => [w.path, w.body])) });
    expect(fillPatches.map((w) => w.path).sort()).toEqual(goblet.sets.map((s) => `/workout-logs/${logId}/sets/${s.id}`).sort());
    await expect(page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true })).toHaveValue('40');
    await shot(page, `${label}-04-prior-values-filled`);

    // Set 1 online.
    await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
    await expect.poll(() => goblet.sets[0].status).toBe('completed');

    // ---- 9. Offline: set 2 stays on the device; reopen online syncs it exactly once ----
    await page.evaluate(() => window.__setOnline(false));
    await expect(page.getByTestId('workout-save-state')).toContainText('Not saved yet');
    await page.getByRole('button', { name: 'Complete set 2', exact: true }).first().click();
    expect(goblet.sets[1].status).toBe('pending');
    const queuedSet2 = await page.evaluate((id) => JSON.parse(localStorage.getItem(`cvf_workout_outbox_${id}`) || '[]'), logId);
    expect(queuedSet2.length).toBeGreaterThan(0);
    const writesBeforeReopen = backend.writes.length;
    step = 'reopen';
    await page.evaluate(() => { window.__cvfOnline = true; });
    await page.reload();
    await expect(page.getByTestId('workout-save-state')).toContainText('Saved', { timeout: 10_000 });
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`cvf_workout_outbox_${id}`), logId)).toBeNull();
    expect([goblet.sets[1].status, goblet.sets[1].actual_load_value, goblet.sets[1].actual_reps]).toEqual(['completed', 35, 9]);
    // Only the queued set was written after reopening, and only once.
    const afterReopen = backend.writes.slice(writesBeforeReopen).filter((w) => w.method === 'PATCH');
    expect(afterReopen.map((w) => w.path)).toEqual([`/workout-logs/${logId}/sets/${goblet.sets[1].id}`]);

    // ---- 10. Session expires with a Dead Bug set queued: kept, replayed once after sign-in ----
    step = 'expired-session';
    await page.evaluate(() => window.__setOnline(false));
    await page.getByRole('spinbutton', { name: 'Dead Bug set 1 performed reps', exact: true }).fill('10');
    await cards.nth(1).getByRole('button', { name: 'Complete set 1', exact: true }).click();
    // The access token has expired and its refresh token is revoked.
    backend.clientSessionDead = true;
    await page.evaluate(() => localStorage.setItem('cvf_refresh_token', 'synthetic-c04-revoked-refresh'));
    await page.evaluate(() => window.__setOnline(true));
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    expect(backend.writes.some((w) => w.path === '/auth/refresh')).toBe(true);
    const kept = await page.evaluate((id) => JSON.parse(localStorage.getItem(`cvf_workout_outbox_${id}`) || '[]'), logId);
    expect(kept.some((op) => op.setId === deadbug.sets[0].id)).toBe(true);
    expect(deadbug.sets[0].status).toBe('pending');
    await signIn(page, TOKENS.clientAgain);
    await page.goto(`/client/workouts/${logId}/track`);
    await expect(page.getByTestId('workout-save-state')).toContainText('Saved', { timeout: 10_000 });
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`cvf_workout_outbox_${id}`), logId)).toBeNull();
    expect([deadbug.sets[0].status, deadbug.sets[0].actual_reps]).toEqual(['completed', 10]);
    const replays = backend.writes.filter((w) => w.method === 'PATCH' && w.token === TOKENS.clientAgain && w.path.endsWith(`/sets/${deadbug.sets[0].id}`));
    // Each kept operation (typed reps, then completion) replays exactly once, in order.
    const keptForSet = kept.filter((op) => op.setId === deadbug.sets[0].id);
    expect(replays.map((w) => w.body)).toEqual(keptForSet.map((op) => op.data));
    expect(replays.at(-1).body.status).toBe('completed');
    await expect(page.getByRole('spinbutton', { name: 'Goblet Squat set 1 weight', exact: true })).toHaveValue('40');

    // ---- 11. Finish once; both roles see the history ----
    step = 'finish';
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    await page.getByRole('button', { name: /Confirm completion/i }).click();
    await expect(page).toHaveURL(new RegExp(`/client/workouts/${logId}$`));
    expect(backend.logs[0].status).toBe('completed');
    expect(backend.writes.filter((w) => w.path === `/workout-logs/${logId}/complete`)).toHaveLength(1);
    await page.goto('/client/programs?view=history');
    await expect(page.getByTestId('workout-history-row').filter({ hasText: 'Lower + core' })).toBeVisible();
    await shot(page, `${label}-05-client-history`);
    await signIn(page, TOKENS.coach);
    await page.goto(`/coach/clients/${CLIENT.id}?tab=programs`);
    await page.getByTestId('coach-client-workout-history').getByRole('link', { name: /Lower \+ core/ }).click();
    await expect(page).toHaveURL(new RegExp(`/coach/workouts/${logId}$`));
    await expect(page.getByText('Goblet Squat').first()).toBeVisible();

    expect(backend.forbidden).toEqual([]);
    expect(backend.unexpected).toEqual([]);
    expect(problems).toEqual([]);
    expect(prompts).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
