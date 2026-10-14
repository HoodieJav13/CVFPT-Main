// A11: quick sessions in preview mode (fictional fixtures; UI behavior only).
// Real authorization, idempotency and races are covered by backend/SQL suites and by
// quick-sessions-mocked.spec.mjs, never inferred from preview.
import { test, expect, usePreviewRole, callPreviewApi } from './preview-test.mjs';

const RILEY = 'client_riley';
const SEEDED_REQUEST = '5a1e0000-0000-4000-8000-000000000001';
const PENDING = (requestId) => `cvf_quick_session_pending:v1:preview:coach_marcus:${requestId}`;
const record = (requestId, clientId = RILEY) => JSON.stringify({ v: 1, request_id: requestId, client_id: clientId, state: 'pending', created_at: new Date().toISOString() });

async function openRileyPrograms(page) {
  await usePreviewRole(page, 'coach');
  await page.goto(`/coach/clients/${RILEY}?tab=programs`);
  await expect(page.getByTestId('assign-program-button')).toBeVisible();
}

async function openQuickBuilder(page) {
  await page.getByTestId('assign-program-button').click();
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name: 'Quick session' }).click();
  await expect(page.getByTestId('quick-session-builder')).toBeVisible();
}

async function fillOneExercise(page, name = 'Push-up') {
  await page.getByTestId('quick-session-exercise-name-input').first().fill(name);
  await page.getByTestId('quick-session-sets-input').first().fill('3');
  await page.getByTestId('quick-session-reps-input').first().fill('10');
}

const quickBody = (requestId, overrides = {}) => ({
  request_id: requestId, client_id: RILEY, assigned_for: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }),
  name: 'API quick', notes: null, exercises: [{ custom_name: 'Lunge', sets: '2', reps: '8' }], ...overrides,
});

test('coach sees the quick label, completed sessions leave active cards, history and detail keep the label', async ({ page }) => {
  await openRileyPrograms(page);
  const cards = page.getByTestId('assigned-workout-card');
  await expect(cards.filter({ hasText: 'Hotel gym circuit' }).getByTestId('quick-session-badge')).toBeVisible();
  await expect(cards.filter({ hasText: 'Mobility reset' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Quick session ·' })).toHaveCount(0);   // completed quick session is hidden
  await expect(cards.filter({ hasText: 'Hotel gym circuit' }).getByTestId('quick-session-card-save-library')).toBeVisible();
  await expect(cards.filter({ hasText: 'Hotel gym circuit' }).getByTestId('save-workout-template-button')).toHaveCount(0);
  const history = page.getByTestId('coach-client-workout-history');
  await expect(history.getByTestId('coach-history-quick-session-label')).toHaveCount(1);
  // The preview toolbar can cover the row; follow the row's own link.
  const href = await history.getByRole('link').filter({ hasText: 'Quick session ·' }).getAttribute('href');
  await page.goto(href);
  await expect(page.getByTestId('log-detail-quick-session')).toBeVisible();
});

test('builder validates, assigns a private quick session, and leaves the shared library unchanged', async ({ page }) => {
  await openRileyPrograms(page);
  const before = await callPreviewApi(page, 'get', '/programs/workouts');
  await openQuickBuilder(page);
  await expect(page.getByTestId('quick-session-date-input')).toHaveValue(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }));
  await page.getByTestId('quick-session-assign-button').click();
  await expect(page.getByTestId('quick-session-validation')).toHaveText('Add at least one exercise.');
  await fillOneExercise(page, 'Goblet Squat');
  await page.getByTestId('quick-session-more-button').first().click();
  await expect(page.getByTestId('quick-session-more-fields')).toBeVisible();
  await page.getByTestId('quick-session-rest-input').fill('60');
  await page.getByTestId('quick-session-tempo-input').fill('3-1-1');
  await page.getByTestId('quick-session-title-input').fill('Travel day');
  await page.getByTestId('quick-session-assign-button').click();
  await expect(page.getByTestId('quick-session-saved')).toContainText('Travel day');
  await page.getByTestId('quick-session-done').click();
  const card = page.getByTestId('assigned-workout-card').filter({ hasText: 'Travel day' });
  await expect(card.getByTestId('quick-session-badge')).toBeVisible();
  await expect(card).toContainText('Goblet Squat');
  // The shared library is the template list (the real API never lists client copies).
  const templates = (rows) => rows.filter((row) => row.is_template !== false).map((row) => row.id).sort();
  const after = await callPreviewApi(page, 'get', '/programs/workouts');
  expect(templates(after.data)).toEqual(templates(before.data));
  // No workout body ever reaches browser storage; the record is gone after success.
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('cvf_quick_session_pending')));
  expect(stored).toEqual([]);
});

test('preview mirrors the create, status and library envelopes', async ({ page }) => {
  await openRileyPrograms(page);
  const id = '7e570000-0000-4000-8000-000000000001';
  const created = await callPreviewApi(page, 'post', '/programs/quick-sessions', quickBody(id));
  expect(created.status).toBe(201);
  expect(created.data.state).toBe('created');
  expect(created.data.assignment.kind).toBe('quick');
  expect(created.data.assignment).not.toHaveProperty('create_request_hash');
  const replayed = await callPreviewApi(page, 'post', '/programs/quick-sessions', quickBody(id));
  expect([replayed.status, replayed.data.state, replayed.data.assignment.id]).toEqual([200, 'replayed', created.data.assignment.id]);
  const mismatch = await callPreviewApi(page, 'post', '/programs/quick-sessions', quickBody(id, { name: 'Changed' }));
  expect([mismatch.status, mismatch.data]).toEqual([409, { state: 'request_mismatch' }]);
  const status = await callPreviewApi(page, 'get', `/programs/quick-sessions/requests/${id}`);
  expect([status.status, status.data.state, status.data.assignment.id]).toEqual([200, 'committed', created.data.assignment.id]);
  const unknown = await callPreviewApi(page, 'get', '/programs/quick-sessions/requests/7e570000-0000-4000-8000-0000000000ff');
  expect([unknown.status, unknown.data]).toEqual([404, { state: 'not_found' }]);
  const emily = await callPreviewApi(page, 'post', '/programs/quick-sessions', quickBody('7e570000-0000-4000-8000-000000000002', { client_id: 'client_emily' }));
  expect([emily.status, emily.data]).toEqual([404, { state: 'not_found' }]);
  const saved = await callPreviewApi(page, 'post', `/programs/quick-sessions/${created.data.assignment.id}/save-to-library`);
  const again = await callPreviewApi(page, 'post', `/programs/quick-sessions/${created.data.assignment.id}/save-to-library`);
  expect([saved.status, saved.data.state, again.status, again.data.state, again.data.template_id]).toEqual([201, 'saved', 200, 'replayed', saved.data.template_id]);
  const templates = await callPreviewApi(page, 'get', '/programs/workouts');
  expect(templates.data.find((row) => row.id === saved.data.template_id)).toMatchObject({ is_template: true, hidden: true });
});

test('a failed create stays uncertain under the same request and Retry saves exactly once', async ({ page }) => {
  await openRileyPrograms(page);
  await openQuickBuilder(page);
  await fillOneExercise(page, 'Step-up');
  await page.getByTestId('quick-session-title-input').fill('Retry me');
  await page.evaluate(() => localStorage.setItem('cvf_preview_fail', 'write-once'));
  await page.getByTestId('quick-session-assign-button').click();
  const recovery = page.getByTestId('quick-session-recovery');
  await expect(recovery).toContainText("We couldn't confirm this save");
  await expect(page.getByTestId('quick-session-title-input')).toBeDisabled();
  const pending = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('cvf_quick_session_pending')));
  expect(pending).toHaveLength(1);
  expect(JSON.parse(pending[0][1])).toEqual(expect.objectContaining({ v: 1, client_id: 'client_riley', state: 'pending' }));
  expect(pending[0][1]).not.toContain('Retry me');
  await page.getByTestId('quick-session-retry-save').click();
  await expect(page.getByTestId('quick-session-saved')).toContainText('Retry me');
  await page.getByTestId('quick-session-done').click();
  await expect(page.getByTestId('assigned-workout-card').filter({ hasText: 'Retry me' })).toHaveCount(1);
});

test('library failure keeps the session assigned and retries only the library save', async ({ page }) => {
  await openRileyPrograms(page);
  await openQuickBuilder(page);
  await fillOneExercise(page, 'Row');
  await page.getByTestId('quick-session-title-input').fill('Library later');
  await page.getByTestId('quick-session-assign-button').click();
  await expect(page.getByTestId('quick-session-saved')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('cvf_preview_fail', 'write-once'));
  await page.getByTestId('quick-session-save-library').click();
  await expect(page.getByTestId('quick-session-library-failed')).toContainText('Session assigned — saving to library failed');
  await page.getByTestId('quick-session-library-retry').click();
  await expect(page.getByTestId('quick-session-library-saved')).toBeVisible();
  await page.getByTestId('quick-session-done').click();
  await expect(page.getByTestId('assigned-workout-card').filter({ hasText: 'Library later' }).getByTestId('quick-session-in-library')).toBeVisible();
});

test('Start now opens the coach tracker; a conflicting active workout leaves the session saved', async ({ page }) => {
  await openRileyPrograms(page);
  // Another workout already in progress for Riley.
  const busy = await callPreviewApi(page, 'post', '/workout-logs/start', { client_id: RILEY, workout_assignment_id: 'quick_assign_riley_today' });
  expect(busy.status).toBe(201);
  await openQuickBuilder(page);
  await fillOneExercise(page, 'Dead bug');
  await page.getByTestId('quick-session-title-input').fill('Blocked start');
  await page.getByTestId('quick-session-start-now-button').click();
  await expect(page.getByTestId('quick-session-start-failed')).toContainText('Finish or abandon your active workout first');
  await expect(page.getByTestId('quick-session-saved')).toContainText('Blocked start');
  await page.getByTestId('quick-session-open-active').click();
  await expect(page).toHaveURL(new RegExp(`/coach/workouts/${busy.data.workout_log.id}/track`));
});

test('Start now with no active workout starts the saved session in the coach tracker', async ({ page }) => {
  await openRileyPrograms(page);
  await openQuickBuilder(page);
  await fillOneExercise(page, 'Bear crawl');
  await page.getByTestId('quick-session-title-input').fill('Start right away');
  await page.getByTestId('quick-session-start-now-button').click();
  await expect(page).toHaveURL(/\/coach\/workouts\/[^/]+\/track$/);
});

test('a begun quick session refuses prescription edits with the started message', async ({ page }) => {
  await openRileyPrograms(page);
  await page.getByTestId('assigned-workout-card').filter({ hasText: 'Mobility reset' }).getByTestId('edit-client-workout-button').click();
  await page.getByTestId('workout-save-button').click();
  await expect(page.getByText('This quick session has already been started').first()).toBeVisible();
  const api = await callPreviewApi(page, 'put', '/programs/workout-assignments/quick_assign_riley_started/loads', { exercise_loads: [] });
  expect([api.status, api.data.code]).toEqual([409, 'quick_session_started']);
});

test('client Home considers quick sessions under existing priority; Programs labels them; completed ones only in history', async ({ page }) => {
  await usePreviewRole(page, 'client', RILEY);
  await page.goto('/client');
  // Existing priority: the earliest due dated assignment wins, so the overdue (begun,
  // abandoned) quick session leads; it carries the same label.
  await expect(page.getByTestId('client-today-plan-title')).toHaveText('Mobility reset');
  await expect(page.getByTestId('client-today-quick-session')).toBeVisible();
  await page.goto('/client/programs');
  await page.getByTestId('client-training-tab-other').click();
  const cards = page.getByTestId('client-workout-assignment-card');
  await expect(cards.filter({ hasText: 'Hotel gym circuit' }).getByTestId('quick-session-badge')).toBeVisible();
  await expect(cards.filter({ hasText: 'Quick session ·' })).toHaveCount(0);
  await page.getByTestId('client-training-tab-history').click();
  await expect(page.getByTestId('history-quick-session-label')).toHaveCount(1);
  const assigned = await callPreviewApi(page, 'get', '/programs/client/assigned');
  const quick = assigned.data.workouts.find((row) => row.id === 'quick_assign_riley_today');
  expect(quick).toMatchObject({ kind: 'quick', quick_session_completed: false });
  for (const hidden of ['created_by_coach_id', 'create_request_id', 'create_request_hash', 'library_template_id']) expect(quick).not.toHaveProperty(hidden);
});

test('reload recovery: committed, unrecovered and corrupt records, with scoped discard and reset', async ({ page }) => {
  const unknown = '7e570000-0000-4000-8000-0000000000aa';
  await page.addInitScript(({ entries }) => {
    if (sessionStorage.getItem('quick-seeded')) return;
    sessionStorage.setItem('quick-seeded', '1');
    for (const [key, value] of entries) localStorage.setItem(key, value);
  }, { entries: [
    [PENDING(SEEDED_REQUEST), record(SEEDED_REQUEST)],
    [PENDING(unknown), record(unknown)],
    ['cvf_quick_session_pending:v1:preview:coach_marcus:not-a-request', '{"broken":true'],
  ] });
  await openRileyPrograms(page);
  await expect(page.getByTestId('quick-session-recovered')).toContainText('Hotel gym circuit');
  const unrecovered = page.getByTestId('quick-session-recovery');
  await expect(unrecovered).toContainText("Couldn't recover an earlier save. It may still arrive. Check assignments or re-enter under this request.");
  await expect(page.getByTestId('quick-session-corrupt')).toContainText("An earlier quick-session save couldn't be read — check this client's assignments");
  expect(await page.evaluate((key) => localStorage.getItem(key), PENDING(SEEDED_REQUEST))).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), PENDING(unknown))).not.toBeNull();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('quick-session-corrupt-discard').click();
  await expect(page.getByTestId('quick-session-corrupt')).toHaveCount(0);
  // Re-entry needs the access check and reopens the builder under the same request id.
  await unrecovered.getByTestId('quick-session-reenter').click();
  await expect(page.getByTestId('quick-session-builder')).toBeVisible();
  await fillOneExercise(page, 'Re-entered row');
  await page.getByTestId('quick-session-title-input').fill('Re-entered');
  await page.getByTestId('quick-session-assign-button').click();
  await expect(page.getByTestId('quick-session-saved')).toContainText('Re-entered');
  const status = await callPreviewApi(page, 'get', `/programs/quick-sessions/requests/${unknown}`);
  expect(status.data.state).toBe('committed');
  expect(await page.evaluate((key) => localStorage.getItem(key), PENDING(unknown))).toBeNull();
});

async function cardNotifications(page) {
  return page.evaluate(async () => {
    const { toast } = await import('/src/components/ui/sonner.jsx');
    return toast.getHistory().map(({ type, title }) => ({ type, title }));
  });
}

// R1: use the actual AuthProvider epoch updates; no production test hooks or auth mocks.
for (const operation of ['start', 'library']) {
  for (const failure of [false, true]) {
    for (const change of ['new session epoch', 'account switch']) {
      test(`R1 card ${operation} ${failure ? 'failure' : 'success'} is ignored after ${change}`, async ({ page }) => {
        await openRileyPrograms(page);
        await page.evaluate((operation) => {
          return import('/src/lib/api.js').then(({ api }) => {
            const original = api.defaults.adapter;
            window.__cardHeld = { calls: 0, done: false };
            api.defaults.adapter = async (config) => {
              const match = operation === 'start' ? config.url === '/workout-logs/start' : /\/quick-sessions\/[^/]+\/save-to-library$/.test(config.url);
              if (!match) return original(config);
              window.__cardHeld.calls += 1;
              return new Promise((resolve, reject) => {
                window.__cardHeld.release = (failure) => {
                  if (failure) reject({ config, response: { status: operation === 'start' ? 409 : 500, data: { error: 'Stale card failure', active_workout: { id: 'stale-log', workout_name: 'Stale session' } } } });
                  else resolve({ config, status: 200, data: { workout_log: { id: 'stale-log' }, template_id: 'stale-template' } });
                  window.__cardHeld.done = true;
                };
              });
            };
          });
        }, operation);
        const card = page.getByTestId('assigned-workout-card').filter({ hasText: 'Mobility reset' });
        await card.getByTestId(operation === 'start' ? 'coach-log-standalone-workout' : 'quick-session-card-save-library').click();
        await expect.poll(() => page.evaluate(() => window.__cardHeld.calls)).toBe(1);
        if (change === 'account switch') {
          await page.getByTestId('preview-role-select').selectOption('client');
          await expect(page).toHaveURL(/\/client$/);
          await page.getByTestId('preview-role-select').selectOption('coach');
          await page.evaluate(() => {
            history.pushState({}, '', '/coach/clients/client_riley?tab=programs');
            dispatchEvent(new PopStateEvent('popstate'));
          });
          await expect(page.getByTestId('assign-program-button')).toBeVisible();
        } else {
          // Selecting the same role emits a real auth reload/new session epoch in Preview.
          await page.evaluate(async () => { const preview = await import('/src/lib/previewMode.js'); preview.setPreviewRole('coach'); });
          await expect(card.getByTestId('coach-log-standalone-workout')).toBeEnabled();
        }
        await page.evaluate((failure) => window.__cardHeld.release(failure), failure);
        await page.waitForTimeout(200);
        await expect(page).toHaveURL(/\/coach\/clients\/client_riley/);
        expect(await cardNotifications(page)).toEqual([]);
        expect(await page.evaluate(() => window.__cardHeld.calls)).toBe(1);
      });
    }
  }
}

test('R1 a card library reload failure cannot affect a newer auth epoch', async ({ page }) => {
  await openRileyPrograms(page);
  await page.evaluate(async () => {
    const { api } = await import('/src/lib/api.js');
    const original = api.defaults.adapter;
    window.__libraryReload = { acknowledged: false, held: false };
    api.defaults.adapter = async (config) => {
      if (/\/quick-sessions\/[^/]+\/save-to-library$/.test(config.url)) {
        const response = await original(config);
        window.__libraryReload.acknowledged = true;
        return response;
      }
      if (window.__libraryReload.acknowledged && !window.__libraryReload.held && config.url === '/programs/workout-assignments/client/client_riley') {
        window.__libraryReload.held = true;
        return new Promise((_resolve, reject) => {
          window.__libraryReload.release = () => reject({ config, response: { status: 500, data: { error: 'Stale library reload failure' } } });
        });
      }
      return original(config);
    };
  });
  await page.getByTestId('assigned-workout-card').filter({ hasText: 'Mobility reset' }).getByTestId('quick-session-card-save-library').click();
  await expect.poll(() => page.evaluate(() => window.__libraryReload.held)).toBe(true);
  const before = await cardNotifications(page);
  expect(before).toHaveLength(1);
  await page.evaluate(async () => { const preview = await import('/src/lib/previewMode.js'); preview.setPreviewRole('coach'); });
  await page.evaluate(() => window.__libraryReload.release());
  await page.waitForTimeout(200);
  expect(await cardNotifications(page)).toEqual(before);
  await expect(page).toHaveURL(/\/coach\/clients\/client_riley/);
});
