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

// Look A visual round 1: "Change this set" keeps the adjustment inline. The
// focused set's own editor opens inside the Focus panel, between Last/Today and
// Log, and leaves the list (one editor per set); Log then records exactly the
// entered values once, and the editor closes as the next set takes focus.
test('"I did something different" opens the set editor inline with Last/Today and Log; Log writes the entered values once', async ({ page }) => {
  const { server, results } = await setup(page, [DONE_1, row(2), row(3)]);
  await page.getByTestId('focus-adjust').click();
  const editor = panel(page).getByTestId('focus-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-set-id="a-s2"]')).toHaveCount(1);
  await expect(page.locator('[data-set-id="a-s2"]')).toHaveCount(1);
  await expect(panel(page).getByTestId('focus-rows')).toBeVisible();
  await expect(panel(page).getByTestId('focus-adjust')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Complete set 2', exact: true })).toHaveCount(0);
  const reps = editor.locator('input[aria-label="Back Squat set 2 performed reps"]');
  await expect(editor.locator('input').first()).toBeFocused();
  // Editor open with only the prefilled load: Log names exactly that (reps
  // blank, said so) and never falls back to repeating set 1.
  await expect(panel(page).getByTestId('focus-log')).toHaveAttribute('data-kind', 'log');
  await expect(panel(page).getByTestId('focus-log')).toContainText(/reps not recorded/i);
  await expect(panel(page).getByTestId('focus-log')).not.toContainText('Same as set 1');
  await reps.fill('5');
  const log = panel(page).getByTestId('focus-log');
  await expect(log).toHaveAttribute('data-kind', 'log');
  const before = setWrites(server).length;
  await log.click();
  await settled(page, LOG);
  const writes = setWrites(server).slice(before);
  expect(writes.filter((write) => write.body.status === 'completed')).toHaveLength(1);
  expect(writes.at(-1).path).toMatch(/\/sets\/a-s2$/);
  expect(writes.at(-1).body).toMatchObject({ status: 'completed', actual_load_value: 170, actual_reps: 5 });
  await expect(panel(page)).toHaveAttribute('data-focus-set', 'a-s3');
  await expect(page.getByTestId('focus-editor')).toHaveCount(0);
  expect(results.errors).toEqual([]);
});

test('Enter set opens the same inline editor and writes nothing by itself', async ({ page }) => {
  const { server, results } = await setup(page, [row(1), row(2), row(3)]);
  const before = setWrites(server).length;
  await page.getByTestId('focus-log').click();
  await expect(panel(page).getByTestId('focus-editor').locator('input').first()).toBeFocused();
  await page.waitForTimeout(300);
  expect(setWrites(server).slice(before)).toEqual([]);
  expect(results.errors).toEqual([]);
});

// Inline-editor review: a partial entry keeps its explicit, guarded Log. With
// no set to repeat, enter only a load (reps blank): Log records exactly that
// through the set write, reps stay null (nothing filled in from the coach's
// numbers), and the one Undo takes back just that completion.
test('load-only entry in the inline editor: explicit Log keeps reps null, then one Undo reverts the completion', async ({ page }) => {
  const { server, results } = await setup(page, [row(1), row(2), row(3)]);
  await page.getByTestId('focus-log').click();
  const editor = panel(page).getByTestId('focus-editor');
  const weight = editor.locator('input[aria-label="Back Squat set 1 weight"]');
  await expect(weight).toBeFocused();
  await weight.fill('175');
  const log = panel(page).getByTestId('focus-log');
  await expect(log).toHaveAttribute('data-kind', 'log');
  await expect(log).toContainText('175 lb');
  await expect(log).toContainText(/reps not recorded/i);
  const before = setWrites(server).length;
  await log.click();
  await settled(page, LOG);
  const completions = setWrites(server).slice(before).filter((write) => write.body.status === 'completed');
  expect(completions).toHaveLength(1);
  expect(completions[0].path).toMatch(/\/sets\/a-s1$/);
  expect(completions[0].body).toMatchObject({ status: 'completed', actual_load_value: 175, actual_load_unit: 'lb', actual_reps: null });
  expect(server.find('a-s1')).toMatchObject({ status: 'completed', actual_load_value: 175, actual_reps: null, actual_rpe: null });
  const undo = page.getByTestId('workout-undo-button');
  await expect(undo).toBeEnabled();
  await undo.click();
  await settled(page, LOG);
  expect(server.find('a-s1')).toMatchObject({ status: 'pending', actual_reps: null });
  await expect(panel(page)).toHaveAttribute('data-focus-set', 'a-s1');
  await expect(page.locator('[data-testid="workout-undo-button"]:not([disabled])')).toHaveCount(0);
  expect(results.errors).toEqual([]);
});

// Inline-editor review follow-up: RPE alone (load and reps blank) is a valid
// partial log. Log names it, records only it (no load or reps invented), and
// the one Undo takes the completion back.
test('RPE-only entry in the inline editor: explicit Log records RPE with load and reps null, then one Undo reverts it', async ({ page }) => {
  const blank = (n) => row(n, { actual_load_value: null, value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null });
  const { server, results } = await setup(page, [blank(1), blank(2), blank(3)]);
  await page.getByTestId('rpe-toggle').click();
  await page.getByTestId('focus-log').click();
  const editor = panel(page).getByTestId('focus-editor');
  await expect(editor.locator('input').first()).toBeFocused();
  const log = panel(page).getByTestId('focus-log');
  await expect(log).toHaveAttribute('data-kind', 'enter');
  await editor.locator('input[aria-label="Back Squat set 1 performed RPE"]').fill('8');
  await expect(log).toHaveAttribute('data-kind', 'log');
  await expect(log).toContainText('RPE 8');
  await expect(log).toContainText(/weight and reps not recorded/i);
  const before = setWrites(server).length;
  await log.click();
  await settled(page, LOG);
  const completions = setWrites(server).slice(before).filter((write) => write.body.status === 'completed');
  expect(completions).toHaveLength(1);
  expect(completions[0].body).toMatchObject({ status: 'completed', actual_load_value: null, actual_reps: null, actual_rpe: 8 });
  expect(server.find('a-s1')).toMatchObject({ status: 'completed', actual_load_value: null, actual_reps: null, actual_rpe: 8 });
  await page.getByTestId('workout-undo-button').click();
  await settled(page, LOG);
  expect(server.find('a-s1')).toMatchObject({ status: 'pending', actual_load_value: null, actual_reps: null });
  await expect(panel(page)).toHaveAttribute('data-focus-set', 'a-s1');
  expect(results.errors).toEqual([]);
});

// Same partial rule on a timed exercise: weight alone (duration blank) is a
// valid log. The label lists the weight it sends and names the blank duration;
// nothing is invented, and the one Undo reverts it.
test('weight-only entry on a duration exercise: Log names the weight, keeps duration null, then one Undo reverts it', async ({ page }) => {
  const timedRow = (n) => row(n, { actual_load_value: null, value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null, actual_duration_unit: null });
  const log = fixture([timedRow(1), timedRow(2)]);
  Object.assign(log.exercises[0], { exercise_name: 'Carry', tracking_type: 'duration', prescribed_reps: null, prescribed_load_value: null, prescribed_load_max: null, prescribed_duration_value: 40, prescribed_duration_unit: 's', prescribed_sets: '2' });
  const server = makeServer(log);
  const results = await installServer(page, server, { logId: LOG });
  await open(page, LOG);
  const action = panel(page).getByTestId('focus-log');
  await expect(action).toHaveAttribute('data-kind', 'enter');
  await action.click();
  const editor = panel(page).getByTestId('focus-editor');
  await editor.locator('input[aria-label="Carry set 1 weight"]').fill('24');
  await expect(action).toHaveAttribute('data-kind', 'log');
  await expect(action).toContainText('24 lb');
  await expect(action).toContainText(/duration not recorded/i);
  const before = setWrites(server).length;
  await action.click();
  await settled(page, LOG);
  const completions = setWrites(server).slice(before).filter((write) => write.body.status === 'completed');
  expect(completions).toHaveLength(1);
  expect(completions[0].body).toMatchObject({ status: 'completed', actual_load_value: 24, actual_duration_value: null });
  expect(server.find('a-s1')).toMatchObject({ status: 'completed', actual_load_value: 24, actual_duration_value: null, actual_reps: null });
  await page.getByTestId('workout-undo-button').click();
  await settled(page, LOG);
  expect(server.find('a-s1')).toMatchObject({ status: 'pending', actual_duration_value: null });
  expect(results.errors).toEqual([]);
});
