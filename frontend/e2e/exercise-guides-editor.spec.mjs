// Coach workout editor demo references (docs/exercise-guides/design.md), normal
// build with every /api call intercepted. The saved request body is checked
// against the REAL backend rules (backend/src/lib/externalVideo.js and
// exerciseDemo.js, loaded here in Node as test tooling only; nothing crosses
// the deploy boundary at runtime).
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { normalizeDemoModes } = require('../../backend/src/lib/externalVideo.js');
const { resolveExerciseDemo } = require('../../backend/src/lib/exerciseDemo.js');

test.setTimeout(60_000);

const LEGACY_URL = 'https://youtu.be/SYNTHdemo02';
const LIBRARY = [
  { id: 'lib-goblet', name: 'Synthetic Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', primary_muscle: 'Synthetic', video_url: 'https://youtu.be/SYNTHdemo01', hidden: false, archived: false },
  { id: 'lib-wall', name: 'Synthetic Wall Sit', category: 'Synthetic', equipment: 'None', primary_muscle: 'Synthetic', video_url: null, hidden: false, archived: false },
];
const row = (id, libraryId, extra) => ({
  id, exercise_library_id: libraryId, custom_name: null, library_exercise: LIBRARY.find((e) => e.id === libraryId) || null,
  sets: 3, reps: '8', rest: '60s', tempo: '', target_rpe: '', default_load_value: null, default_load_unit: 'lb', client_notes: '', coach_notes: '', tracking_type: 'reps_weight', superset_group: null, ...extra,
});
// Pre-existing data: the old editor copied the library link into every picked
// row, so unclassified (NULL) rows with a link are common.
const STORED = [
  row('we-legacy', 'lib-wall', { video_link_mode: null, video_url: LEGACY_URL, sort_order: 0 }),
  row('we-legacy-empty', 'lib-goblet', { video_link_mode: null, video_url: null, sort_order: 1 }),
];
const WORKOUT = { id: 'wk-1', name: 'Synthetic legacy session', description: null, goal: 'Synthetic', hidden: false, archived: false, author: { name: 'Synthetic Coach' }, exercise_count: STORED.length, exercises: STORED };

async function openEditor(page) {
  const saved = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-coach-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (p === '/auth/me') return json({ role: 'coach', email: 'coach@example.invalid', profile: { id: 'coach-a', name: 'Synthetic Coach', is_admin: false } });
    if (p === '/telemetry/events') return route.fulfill({ status: 204 });
    if (p.endsWith('/unread-count')) return json({ unread: 0 });
    if (p === '/programs/exercise-library') return json(LIBRARY);
    if (p === '/programs/workouts' && request.method() === 'GET') return json([WORKOUT]);
    if (p === '/programs' || p === '/clients') return json([]);
    if (p === '/exercise-media/library-status') return json({ enabled: false });
    if (p === '/programs/workouts/wk-1' && request.method() === 'PUT') {
      const body = request.postDataJSON();
      saved.push(body);
      return json({ ...WORKOUT, ...body });
    }
    return json({ error: `unexpected ${request.method()} ${p}` }, 404);
  });
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-card').getByTestId('workout-edit-button').click();
  await expect(page.getByTestId('workout-exercise-row')).toHaveCount(2);
  return saved;
}

test('duplicating legacy rows keeps each copy\'s effective demo and the workout still saves', async ({ page }) => {
  const saved = await openEditor(page);
  const rows = page.getByTestId('workout-exercise-row');
  const duplicate = async (index) => {
    const trigger = rows.nth(index).locator('h3 button');
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await rows.nth(index).getByTestId('workout-exercise-duplicate-button').click();
  };
  // Duplicate the empty legacy row first (index 1), then the linked one (index 0).
  await duplicate(1);
  await duplicate(0);
  await expect(rows).toHaveCount(4);
  await page.getByTestId('workout-save-button').click();
  await expect.poll(() => saved.length).toBe(1);
  const sent = saved[0].exercises;
  // The server rules accept every row (no 400 for the copies).
  const previous = new Map(STORED.map((stored) => [stored.id, stored]));
  const normalized = normalizeDemoModes(sent, previous);
  const library = new Map(LIBRARY.map((entry) => [entry.id, entry]));
  const demo = (r) => resolveExerciseDemo({ workoutExercise: r, libraryExercise: library.get(r.exercise_library_id) || null });
  // Each copy resolves to exactly the demo its source resolved to.
  expect(sent.map((r) => r.id || 'copy')).toEqual(['we-legacy', 'copy', 'we-legacy-empty', 'copy']);
  expect(demo(normalized[1])).toEqual({ ...demo(normalized[0]), source: demo(normalized[1]).source });
  expect(demo(normalized[1]).url).toBe('https://www.youtube.com/watch?v=SYNTHdemo02');
  expect(demo(normalized[3])).toEqual(demo(normalized[2]));
  // Originals are untouched: still unclassified legacy, byte-identical links.
  expect([normalized[0].video_link_mode, normalized[0].video_url]).toEqual([null, LEGACY_URL]);
  expect(normalized[2].video_link_mode ?? null).toBeNull();
});
