// Extra Look A states for the final capture set (LOOK-A-FINAL-CAPTURE-CHECKLIST,
// 2026-11-15): all sets logged (gold), the normal Finish result and its Undo,
// a coach-backup swap and its replacement, and the rest timer's +15, overrun
// and dismiss. One compact phone viewport (390x844) per state. Records
// screenshots to CAPTURE_DIR and checks each state rendered as described.
// Run: LOOK_A_SPECS='look-a-states-capture.spec.mjs' CAPTURE_DIR=<abs dir> npx playwright test --config playwright.look-a.config.mjs
// Normal mode, synthetic in-process API, fictional data only, headless.
import { test, expect } from '@playwright/test';
import { makeServer, installServer, card, settled, undoButton, open, clone, routeSwap } from './look-a-server.mjs';

const OUT = process.env.CAPTURE_DIR;
const LOG = 'states-log';
const row = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'unknown', value_origin_nonce: null, archived: false,
  updated_at: '2026-11-14T11:00:00.000Z', ...extra,
});
const done = (exercise, n, load, reps) => row(exercise, n, { status: 'completed', actual_load_value: load, actual_reps: reps, revision: 1, last_actor_role: 'client', value_origin: 'entered' });
const exercise = (id, name, sets, extra = {}) => ({
  id, exercise_name: name, tracking_type: 'reps_weight', prescribed_sets: String(sets.length), prescribed_reps: '8',
  prescribed_rest_seconds: null, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false, sets, ...extra,
});
const baseLog = (exercises) => ({
  id: LOG, client_id: 'states-client', workout_name: 'Lower A', status: 'active', started_at: '2026-11-14T15:00:00.000Z', not_set_tracked: false,
  exercises, coach_responses: [], conflicts: [], substitutions: [],
});
const shot = async (page, name) => {
  test.skip(!OUT, 'CAPTURE_DIR not set');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};
async function start(page, log) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = makeServer(log);
  const results = await installServer(page, server, { logId: LOG, profile: 'Rae M.' });
  // The Finish result page compares with the person's other workouts (an array, as GET /workout-logs/mine returns).
  await page.route(/\/api\/workout-logs\/mine$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([clone(server.log)]) }));
  return { server, results };
}
const statuses = (server) => server.log.exercises.flatMap((e) => e.sets.map((s) => `${s.id}:${s.status}:${s.actual_load_value}:${s.actual_reps}`));

test('all sets logged from actual entries: gold progress and Finish, the Finish result, and Undo finish back to tracking', async ({ page }) => {
  // The last set's values are real entries (prefilled from set 1), not a Done flag.
  const { server, results } = await start(page, baseLog([
    exercise('a', 'Back Squat', [done('a', 1, 170, 5), done('a', 2, 170, 5), row('a', 3, { actual_load_value: 170, value_origin: 'prefill', prefill_load_value: 170, prefill_load_unit: 'lb' })],
      { prescribed_reps: '5', prescribed_load_value: 170, prescribed_load_unit: 'lb' }),
    exercise('b', 'Cable Row', [done('b', 1, 40, 10), done('b', 2, 40, 10)], { prescribed_reps: '10', prescribed_load_value: 40, prescribed_load_unit: 'lb' }),
  ]));
  await open(page, LOG);
  await expect(page.getByTestId('focus-log')).toBeVisible();
  await page.getByTestId('focus-log').click();
  await settled(page, LOG);
  await expect.poll(() => server.log.exercises[0].sets[2].status).toBe('completed');
  expect(server.log.exercises.every((e) => !e.not_set_tracked)).toBe(true);
  await expect(page.getByTestId('workout-progress-bar').locator('div').first()).toHaveClass(/bg-gold/);
  await expect(page.getByRole('button', { name: 'Finish workout', exact: true })).toHaveClass(/bg-gold/);
  await shot(page, 'state-01-all-logged-gold-390x844');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm completion', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}$`));
  await expect(page.getByTestId('detail-undo-finish-button')).toBeVisible();
  await shot(page, 'state-02-finish-result-390x844');
  await page.getByTestId('detail-undo-finish-button').click();
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
  await expect.poll(() => server.log.status).toBe('active');
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  // Undo finish reopens the workout only: every logged set is still logged.
  expect(server.log.exercises.flatMap((e) => e.sets).every((s) => s.status === 'completed')).toBe(true);
  await shot(page, 'state-03-after-undo-finish-390x844');
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});

const BACKUP = { id: 'states-backup', exercise_library_id: 'lib-step', name: 'Step Up', client_note: null,
  targets: { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true } };

test('coach backup swap: fixed remaining count, no reason asked, then the replacement with its prescription and provenance', async ({ page }) => {
  const { server, results } = await start(page, baseLog([
    exercise('a', 'Split Squat', [done('a', 1, 40, 8), row('a', 2), row('a', 3)], { prescribed_load_value: 40, prescribed_load_unit: 'lb', backups: [BACKUP] }),
    exercise('b', 'Cable Row', [row('b', 1), row('b', 2)], { prescribed_reps: '10', prescribed_load_value: 40, prescribed_load_unit: 'lb' }),
  ]));
  const swaps = await routeSwap(page, server, LOG, 'a', { backups: [BACKUP] });
  await open(page, LOG);
  const before = statuses(server);
  await card(page, 'Split Squat').getByTestId('swap-open').click();
  await expect(page.getByTestId('swap-reason')).toHaveCount(0);
  await page.getByTestId(`swap-backup-${BACKUP.name}`).click();
  // One of Split Squat's sets is already logged: the backup's three become two, fixed.
  await expect(page.getByTestId('swap-fixed-sets')).toContainText('2 sets');
  await expect(page.getByTestId('swap-target-sets')).toHaveCount(0);
  await shot(page, 'state-04-swap-dialog-390x844');
  await page.getByTestId('swap-confirm').click();
  await expect.poll(() => swaps.length).toBe(1);
  expect(swaps[0].expected_sets).toBe(2);
  expect(swaps[0].trigger).toBe('other');
  await settled(page, LOG);
  const replacement = card(page, BACKUP.name);
  await expect(replacement.getByTestId('swap-substitute-label')).toContainText('Substitute for Split Squat');
  await expect(card(page, 'Split Squat').getByTestId('swap-original-kept')).toContainText(`Swapped for ${BACKUP.name}`);
  // The original exercise's logged and pending sets are untouched by the swap.
  expect(statuses(server).filter((s) => s.startsWith('a-') || s.startsWith('b-'))).toEqual(before);
  await expect(undoButton(page)).toHaveAccessibleName(/Undo swap/);
  // Guidance follows the swap: the replacement is next and holds the Focus panel.
  await expect(page.getByTestId('workout-outline')).toContainText(`Next: ${BACKUP.name}`);
  await expect(replacement.getByTestId('focus-log')).toBeVisible();
  await expect(card(page, 'Split Squat').getByTestId('focus-log')).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
  await replacement.evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shot(page, 'state-05-swap-replacement-390x844');
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});

test('rest timer: +15 while running, then overrun, then dismissed; set rows unchanged by rest controls', async ({ page }) => {
  const { server, results } = await start(page, baseLog([
    exercise('a', 'Back Squat', [row('a', 1, { actual_load_value: 170, actual_reps: 5, value_origin: 'entered' }), row('a', 2), row('a', 3)],
      { prescribed_reps: '5', prescribed_load_value: 170, prescribed_load_unit: 'lb', prescribed_rest_seconds: 20 }),
  ]));
  await open(page, LOG);
  await page.getByTestId('focus-log').click();
  await settled(page, LOG);
  const timer = page.getByTestId('rest-timer');
  await expect(timer).toHaveAttribute('data-rest-state', 'running');
  const rows = statuses(server);
  await page.getByTestId('rest-plus').click();
  await expect(timer).toHaveAccessibleName(/Rest timer 0:3\d, tap to stop/);
  await shot(page, 'state-06-rest-plus15-390x844');
  // Back down past the original deadline so the overrun shows without a long wait.
  await page.getByTestId('rest-minus').click();
  await page.getByTestId('rest-minus').click();
  await expect(timer).toHaveAttribute('data-rest-state', 'complete', { timeout: 10_000 });
  await expect(page.getByTestId('rest-overrun')).toBeVisible({ timeout: 5_000 });
  await shot(page, 'state-07-rest-overrun-390x844');
  await timer.click();
  await expect(page.getByTestId('rest-timer')).toHaveCount(0);
  await shot(page, 'state-08-rest-dismissed-390x844');
  expect(statuses(server)).toEqual(rows);
  expect(results.errors).toEqual([]);
  expect(results.unexpected).toEqual([]);
});
