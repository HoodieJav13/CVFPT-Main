// Look A swap guidance (LOOK-A-FINAL-SWAP-GUIDANCE-REVIEW, 2026-11-15): once a
// swap is in force, Next, Focus and the outline guide the replacement; the
// original keeps its rows and recorded sets exactly. A request waiting for the
// coach or a refused swap leaves the original guided, and Undo of the swap
// makes the original next again. Normal mode, stateful synthetic API shaped
// like the Look A routes (look-a-server.mjs), fictional data only.
import { test, expect } from '@playwright/test';
import { makeServer, installServer, card, settled, open, routeSwap, reps, clone, undoAndSettle } from './look-a-server.mjs';

const LOG = 'sg-log';
const row = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'unknown', value_origin_nonce: null, archived: false, updated_at: '2026-11-14T11:00:00.000Z', ...extra,
});
const BACKUP = { id: 'sg-backup', exercise_library_id: 'lib-step', name: 'Step Up', client_note: null, targets: { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', per_side: true } };
const SUGGESTION = { id: 'lib-lunge', name: 'Reverse Lunge', rationale: ['Same muscle group'] };
const fixture = () => ({
  id: LOG, client_id: 'sg-client', workout_name: 'Lower A', status: 'active', started_at: '2026-11-14T15:00:00.000Z', not_set_tracked: false,
  exercises: [
    { id: 'a', exercise_name: 'Split Squat', exercise_library_id: 'lib-split', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '8', prescribed_load_value: 40, prescribed_load_unit: 'lb',
      prescribed_rest_seconds: null, superset_group: null, plan_revision: 0, backups: [BACKUP], not_set_tracked: false,
      sets: [row('a', 1, { status: 'completed', actual_load_value: 40, actual_reps: 8, revision: 1, last_actor_role: 'client', value_origin: 'entered' }), row('a', 2), row('a', 3)] },
    { id: 'b', exercise_name: 'Cable Row', exercise_library_id: 'lib-row', tracking_type: 'reps_weight', prescribed_sets: '2', prescribed_reps: '10', prescribed_load_value: 40, prescribed_load_unit: 'lb',
      prescribed_rest_seconds: null, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false, sets: [row('b', 1), row('b', 2)] },
  ],
  coach_responses: [], conflicts: [], substitutions: [],
});
const originalRows = (server) => JSON.stringify(server.log.exercises.find((e) => e.id === 'a'));
const nextIs = async (page, name) => {
  await expect(page.getByTestId('workout-outline')).toContainText(`Next: ${name}`);
  await expect(card(page, name).getByTestId('focus-log')).toBeVisible();
};
async function setup(page, swap) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = makeServer(fixture());
  const results = await installServer(page, server, { logId: LOG, profile: 'Fictional swap client' });
  const sent = await routeSwap(page, server, LOG, 'a', swap);
  await open(page, LOG);
  await nextIs(page, 'Split Squat');
  return { server, results, sent };
}
async function chooseSwap(page, testId) {
  await card(page, 'Split Squat').getByTestId('swap-open').click();
  await page.getByTestId(testId).click();
  await page.getByTestId('swap-confirm').click();
}

test('active backup swap: the replacement becomes Next and Focus; the original rows stay exact; Undo makes the original next again', async ({ page }) => {
  const { server, results, sent } = await setup(page, { backups: [BACKUP] });
  const before = originalRows(server);
  await chooseSwap(page, `swap-backup-${BACKUP.name}`);
  await expect.poll(() => sent.length).toBe(1);
  await settled(page, LOG);
  await nextIs(page, 'Step Up');
  await expect(card(page, 'Split Squat').getByTestId('focus-log')).toHaveCount(0);
  await expect(card(page, 'Split Squat').getByTestId('swap-original-kept')).toBeVisible();
  // The original is listed as swapped, never next; its recorded set still counts.
  await page.getByTestId('workout-outline').getByRole('button').first().click();
  await expect(page.getByTestId('workout-outline-item').filter({ hasText: 'Split Squat' })).toHaveAttribute('data-status', 'swapped');
  await expect(page.getByTestId('workout-outline-item').filter({ hasText: 'Step Up' })).toHaveAttribute('data-status', 'next');
  await expect(page.getByTestId('workout-progress-bar')).toHaveAttribute('aria-valuemax', '5');
  expect(originalRows(server)).toBe(before);
  // Undo the swap (the newest change): the original is next again.
  await undoAndSettle(page, LOG);
  await expect.poll(() => server.log.substitutions[0].status).toBe('undone');
  await expect(card(page, 'Step Up')).toHaveCount(0);
  await nextIs(page, 'Split Squat');
  await expect(page.getByTestId('workout-progress-bar')).toHaveAttribute('aria-valuemax', '5');
  expect(originalRows(server)).toBe(before);
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});

test('a suggestion waiting for the coach leaves the original next', async ({ page }) => {
  const { server, results, sent } = await setup(page, { suggestions: [SUGGESTION], mode: 'pending' });
  const before = originalRows(server);
  await card(page, 'Split Squat').getByTestId('swap-open').click();
  await page.getByTestId(`swap-suggestion-${SUGGESTION.name}`).click();
  await page.getByTestId('swap-target-sets').fill('2');
  await page.getByTestId('swap-confirm').click();
  await expect.poll(() => sent.length).toBe(1);
  await settled(page, LOG);
  await expect(card(page, 'Split Squat').getByTestId('swap-waiting')).toBeVisible();
  await nextIs(page, 'Split Squat');
  expect(originalRows(server)).toBe(before);
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});

test('a refused swap leaves the original next and the original rows exact', async ({ page }) => {
  const { server, results, sent } = await setup(page, { backups: [BACKUP], mode: 'refuse' });
  const before = originalRows(server);
  await chooseSwap(page, `swap-backup-${BACKUP.name}`);
  await expect.poll(() => sent.length).toBe(1);
  await expect(card(page, 'Step Up')).toHaveCount(0);
  await nextIs(page, 'Split Squat');
  expect(server.log.substitutions).toEqual([]);
  expect(originalRows(server)).toBe(before);
  expect(results.errors).toEqual([]);
});

test('skipping the rest of an active replacement moves on to the next exercise, not back to the swapped original', async ({ page }) => {
  const { server, results } = await setup(page, { backups: [BACKUP] });
  const before = originalRows(server);
  await chooseSwap(page, `swap-backup-${BACKUP.name}`);
  await settled(page, LOG);
  await nextIs(page, 'Step Up');
  // Skip the rest, answered like the Look A route (sets marked skipped, {result, log, undo}).
  await page.route(new RegExp(`/api/workout-logs/${LOG}/exercises/[^/]+/skip-rest$`), (route) => {
    const body = route.request().postDataJSON();
    for (const { id } of body.sets) { const s = server.find(id); s.status = 'skipped'; s.revision += 1; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      result: { outcome: 'applied', change_id: body.event_id }, log: { ...clone(server.log), server_time: new Date().toISOString() }, undo: null,
    }) });
  });
  const step = card(page, 'Step Up');
  await reps(page, 'Step Up', 1).fill('8');
  await step.getByRole('button', { name: 'Complete set 1', exact: true }).click();
  await settled(page, LOG);
  await step.getByTestId('exercise-skip-rest').click();
  await settled(page, LOG);
  await page.waitForTimeout(400);
  // The reveal goes forward to Cable Row; the swapped original is not revisited.
  await expect(page.locator('[data-set-id="b-s1"]')).toBeInViewport();
  await expect(page.locator('[data-set-id="a-s2"]')).not.toBeInViewport();
  expect(originalRows(server)).toBe(before);
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});
