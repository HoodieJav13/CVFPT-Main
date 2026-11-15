// Look A Focus panel (LOOK-A-VISUAL-STRUCTURE-REVIEW): one focused set with
// same-set Last/Today rows, the coach's prescription large and ONE truthful
// Log action. The action records the values entered in that set (the row's own
// Complete write), else the existing guarded "same as set N" repeat, else it
// logs nothing and only opens the set for entry. Normal mode, stateful
// synthetic API, fictional data only.
import { test, expect } from '@playwright/test';
import { makeServer, installServer, sent, settled, open } from './look-a-server.mjs';

const LOG = 'focus-log';
const row = (n, extra = {}) => ({
  id: `a-s${n}`, workout_log_exercise_id: 'a', set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: 170, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'prefill', prefill_load_value: 170, prefill_load_unit: 'lb', value_origin_nonce: null, archived: false,
  updated_at: '2026-11-14T11:00:00.000Z', ...extra,
});
const fixture = (sets) => ({
  id: LOG, client_id: 'focus-client', workout_name: 'Fictional focus workout', status: 'active', started_at: new Date().toISOString(), not_set_tracked: false,
  exercises: [{ id: 'a', exercise_name: 'Back Squat', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '4-6', prescribed_load_value: 170, prescribed_load_max: 180,
    prescribed_load_unit: 'lb', per_side: false, prescribed_rest_seconds: 90, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false, sets }],
  coach_responses: [], conflicts: [], substitutions: [],
});
const DONE_1 = row(1, { status: 'completed', actual_reps: 4, revision: 2, last_actor_role: 'client', value_origin: 'entered', prefill_load_value: null, prefill_load_unit: null });
async function setup(page, sets) {
  const server = makeServer(fixture(sets));
  const results = await installServer(page, server, { logId: LOG });
  await open(page, LOG);
  return { server, results };
}
const panel = (page) => page.getByTestId('focus-panel');
const setWrites = (server) => sent(server, /\/sets\//);

test('the Focus panel shows same-set Last/Today, the prescription and lands in view', async ({ page }) => {
  const { results } = await setup(page, [DONE_1, row(2), row(3)]);
  await expect(panel(page)).toBeInViewport();
  const rows = page.getByTestId('focus-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('170 lb × 4');
  await expect(rows.nth(1)).toContainText('Now');
  await expect(rows.nth(2)).toContainText('—');
  await expect(page.getByTestId('focus-prescription')).toContainText('4–6');
  await expect(page.getByTestId('focus-prescription')).toContainText('170–180');
  await expect(page.getByTestId('focus-eyebrow')).toHaveText(/Exercise 1 of 1/i);
  expect(results.errors).toEqual([]);
});

test('untouched set after a logged one: Log uses the guarded repeat and writes exactly set 1\'s values once', async ({ page }) => {
  const { server, results } = await setup(page, [DONE_1, row(2), row(3)]);
  const log = page.getByTestId('focus-log');
  await expect(log).toHaveAttribute('data-kind', 'repeat');
  await expect(log).toContainText('Same as set 1');
  const before = setWrites(server).length;
  await log.click();
  await settled(page, LOG);
  const writes = setWrites(server).slice(before);
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toMatch(/\/sets\/a-s2$/);
  expect(writes[0].body).toMatchObject({ status: 'completed', actual_load_value: 170, actual_load_unit: 'lb', actual_reps: 4 });
  expect(server.find('a-s2')).toMatchObject({ status: 'completed', actual_reps: 4 });
  expect(results.errors).toEqual([]);
});

test('entered values: Log records exactly what the set shows, through the set write', async ({ page }) => {
  const { server, results } = await setup(page, [DONE_1, row(2), row(3)]);
  const reps = page.locator('input[aria-label="Back Squat set 2 performed reps"]');
  await reps.fill('6');
  await reps.blur();
  await settled(page, LOG);
  const log = page.getByTestId('focus-log');
  await expect(log).toHaveAttribute('data-kind', 'log');
  await expect(log).toContainText('6');
  const before = setWrites(server).length;
  await log.click();
  await settled(page, LOG);
  const writes = setWrites(server).slice(before);
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ status: 'completed', actual_load_value: 170, actual_reps: 6 });
  expect(results.errors).toEqual([]);
});

test('nothing entered and nothing to repeat: the action logs nothing and opens the set for entry', async ({ page }) => {
  const { server, results } = await setup(page, [row(1), row(2), row(3)]);
  const log = page.getByTestId('focus-log');
  await expect(log).toHaveAttribute('data-kind', 'enter');
  await expect(log).toHaveText(/Enter set 1/i);
  const before = setWrites(server).length;
  await log.click();
  await expect(page.locator('[data-set-id="a-s1"] input').first()).toBeFocused();
  await page.waitForTimeout(300);
  expect(setWrites(server).slice(before)).toEqual([]);
  await expect(page.getByTestId('focus-adjust')).toHaveCount(0);
  expect(results.errors).toEqual([]);
});

test('"I did something different" moves to the set editor without writing', async ({ page }) => {
  const { server, results } = await setup(page, [DONE_1, row(2), row(3)]);
  const before = setWrites(server).length;
  await page.getByTestId('focus-adjust').click();
  await expect(page.locator('[data-set-id="a-s2"] input').first()).toBeFocused();
  expect(setWrites(server).slice(before)).toEqual([]);
  expect(results.errors).toEqual([]);
});
