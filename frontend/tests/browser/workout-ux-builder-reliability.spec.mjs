// Builder reliability regressions (normal mode, synthetic API only). Each test
// types or clicks the way a coach does (key by key, double taps, slow replies)
// rather than setting whole values, which is how these defects escaped .fill().
import { test, expect } from '@playwright/test';

const LIBRARY = [
  { id: 'lib-squat', name: 'Squat', category: 'Strength', hidden: false, archived: false, video_url: null },
  { id: 'lib-plank', name: 'Plank', category: 'Core', hidden: false, archived: false, video_url: null },
];
const workout = (overrides = {}) => ({
  id: 'w-1', name: 'Synthetic lower day', description: '', goal: '', hidden: false, coach_id: 'coach-1', created_by: 'coach-1',
  author: { id: 'coach-1', name: 'Synthetic Coach' }, exercise_count: 1,
  exercises: [{ id: 'we-1', custom_name: 'Squat', exercise_library_id: 'lib-squat', sets: '3', reps: '8', rest: '60s', tracking_type: 'reps_weight', position: 0 }],
  ...overrides,
});

async function setup(page, { workouts = [workout()], delays = {} } = {}) {
  const calls = { writes: [], unexpected: [], prompts: [] };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-builder-token'));
  page.on('dialog', (dialog) => { calls.prompts.push(dialog.message()); dialog.accept(); });
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    if (delays[path]) await new Promise((resolve) => setTimeout(resolve, delays[path]));
    if (path === '/auth/me') return json({ role: 'coach', email: 'coach@example.invalid', profile: { id: 'coach-1', name: 'Synthetic Coach', is_admin: false } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === '/exercise-media/library-status') return json({ enabled: false, items: [], summary: null });
    if (path === '/programs/exercise-library' && method === 'GET') return json(LIBRARY);
    if (path === '/programs/workouts' && method === 'GET') return json(workouts);
    if (path === '/programs' || path === '/clients') return json([]);
    if (method !== 'GET') {
      calls.writes.push({ method, path, body: r.postDataJSON?.() ?? null });
      if (path === '/programs/workouts' && method === 'POST') return json({ ...workout({ id: 'w-new' }), ...r.postDataJSON() }, 201);
      if (/^\/programs\/workouts\/[^/]+\/save-as-template$/.test(path)) return json(workout({ id: `w-copy-${calls.writes.length}`, hidden: true }), 201);
      if (/^\/programs\/workouts\/[^/]+$/.test(path) && method === 'PUT') return json({ ...workout(), ...r.postDataJSON() });
      if (path === '/programs/import/parse-paste') return json({ draft: { name: 'Late parsed program', frequency: 1, days: [{ day_number: 1, name: 'Day 1', exercises: [{ name: 'Squat', sets: '3', reps: '5' }] }] }, errors: [], message: 'Text parsed. Review before saving.' });
    }
    calls.unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic route' }, 404);
  });
  return calls;
}

async function newWorkout(page) {
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-create-button').click();
  return page.getByRole('dialog');
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

test('typing a custom name that extends a catalog name keeps every space (workout builder)', async ({ page }) => {
  const calls = await setup(page);
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-name-input').fill('Synthetic jump day');
  const name = editor.getByTestId('workout-exercise-name-input');
  await name.click();
  await name.pressSequentially('Squat jump');
  await expect(name).toHaveValue('Squat jump');
  await editor.getByTestId('workout-exercise-sets-input').fill('3');
  await editor.getByTestId('workout-save-button').click();
  await expect(editor).not.toBeVisible();
  const saved = calls.writes.find((write) => write.method === 'POST' && write.path === '/programs/workouts');
  expect(saved.body.exercises[0].custom_name).toBe('Squat jump');
  expect(saved.body.exercises[0].exercise_library_id || null).toBeNull();
  expect(calls.unexpected).toEqual([]);
});

test('a typed catalog name still links to the catalog and settles on its canonical name', async ({ page }) => {
  const calls = await setup(page);
  const editor = await newWorkout(page);
  await editor.getByTestId('workout-name-input').fill('Synthetic squat day');
  const name = editor.getByTestId('workout-exercise-name-input');
  await name.click();
  await name.pressSequentially('squat ');
  await editor.getByTestId('workout-exercise-sets-input').click();
  await expect(name).toHaveValue('Squat');
  await editor.getByTestId('workout-exercise-sets-input').fill('3');
  await editor.getByTestId('workout-save-button').click();
  await expect(editor).not.toBeVisible();
  const saved = calls.writes.find((write) => write.method === 'POST' && write.path === '/programs/workouts');
  expect(saved.body.exercises[0]).toMatchObject({ custom_name: 'Squat', exercise_library_id: 'lib-squat' });
});


test('a double tap on Save a variation creates exactly one hidden copy', async ({ page }) => {
  const calls = await setup(page, { delays: { '/programs/workouts/w-1/save-as-template': 400 } });
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-duplicate-button').first().dblclick();
  await expect(page.getByText(/Saved a hidden variation/).first()).toBeVisible();
  await page.waitForTimeout(600);
  expect(calls.writes.filter((write) => write.path.endsWith('/save-as-template'))).toHaveLength(1);
});

