// Port proof for the Look A client flow behind the redesign gate.
// Fictional data only; a stateful synthetic server stands in for the API (the
// same one Look A's own browser specs use). This proves what the page shows
// and sends with the gate on and off. It does not prove database rules
// (redesign/look-a/supabase/tests/look_a covers those locally).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { makeServer, installServer, sent, undoButton } from './look-a-server.mjs';
import { OFF_URL, ON_URL } from '../../playwright.redesign-gate.config.mjs';

const LOG = 'port-proof-log';
const OUTBOX = `cvf_workout_outbox_${LOG}`;
const SHOTS = process.env.PORT_PROOF_SHOTS || '';
const row = (n, extra = {}) => ({
  id: `a-s${n}`, workout_log_exercise_id: 'a', set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null, value_origin_nonce: null, archived: false,
  updated_at: '2026-11-14T11:00:00.000Z', ...extra,
});
const fixture = () => ({
  id: LOG, client_id: 'port-proof-client', workout_name: 'Fictional port proof workout', status: 'active', started_at: new Date().toISOString(), not_set_tracked: false,
  exercises: [{ id: 'a', exercise_name: 'Back Squat', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '4-6', prescribed_load_value: 170, prescribed_load_max: 180,
    prescribed_load_unit: 'lb', per_side: false, prescribed_rest_seconds: 0, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false, sets: [row(1), row(2), row(3)] }],
  coach_responses: [], conflicts: [], substitutions: [],
});
// Typing is saved as you go (the set stays "pending"); only the Log tap marks it done.
const doneChanges = (server) => server.order.filter((id) => { const change = server.changes.get(id); return change.kind === 'set' && change.request.status === 'completed'; });
const completions = (server) => sent(server, /\/sets\//).filter((write) => write.body.status === 'completed');
const outboxEmpty = (page) => page.evaluate((key) => !localStorage.getItem(key), OUTBOX);
const panel = (page) => page.getByTestId('focus-panel');
const weight = (page, n) => panel(page).getByTestId('focus-editor').locator(`input[aria-label="Back Squat set ${n} weight"]`);
const repsIn = (page, n) => panel(page).getByTestId('focus-editor').locator(`input[aria-label="Back Squat set ${n} performed reps"]`);
async function shot(page, name) {
  if (!SHOTS) return;
  const size = page.viewportSize();
  const dir = path.join(SHOTS, `${size.width}x${size.height}`);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}
async function start(page, baseURL, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = makeServer(fixture());
  const results = await installServer(page, server, { logId: LOG, profile: 'Fictional port proof client' });
  await page.goto(`${baseURL}/client/workouts/${LOG}/track`);
  return { server, results };
}

test.describe('gate on (REACT_APP_PT_REDESIGN=look-a)', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    test(`${viewport.width}: create, edit, preview, save, reopen and Undo one set`, async ({ page }) => {
      const { server, results } = await start(page, ON_URL, viewport);
      await expect(page.getByTestId('workout-outline')).toBeVisible();
      await expect(panel(page)).toBeVisible();
      const action = panel(page).getByTestId('focus-log');
      await shot(page, '01-opened');

      // Create: nothing is entered yet, so the one action only opens set 1 for entry and saves nothing.
      await expect(action).toHaveAttribute('data-kind', 'enter');
      await action.click();
      await weight(page, 1).fill('175');
      await repsIn(page, 1).fill('5');

      // Preview: the Log button names exactly what would be saved, before anything is saved.
      await expect(action).toHaveAttribute('data-kind', 'log');
      await expect(action).toContainText('175 lb');
      await expect(action).toContainText('5');
      expect(completions(server)).toHaveLength(0);
      expect(server.find('a-s1')).toMatchObject({ status: 'pending', actual_reps: null });

      // Edit: change the entry; the preview follows and still nothing is saved as done.
      await repsIn(page, 1).fill('6');
      await expect(action).toContainText('6');
      expect(completions(server)).toHaveLength(0);
      await shot(page, '02-entered-preview');

      // Save: one tap, one completed write with exactly the previewed values.
      await repsIn(page, 1).blur();
      await expect.poll(() => server.find('a-s1').actual_reps).toBe(6);
      await expect.poll(() => outboxEmpty(page)).toBe(true);
      const beforeLog = { ...server.find('a-s1') };
      expect(beforeLog).toMatchObject({ status: 'pending', actual_load_value: 175, actual_reps: 6 });
      await action.click();
      await expect.poll(() => server.find('a-s1').status).toBe('completed');
      await expect.poll(() => outboxEmpty(page)).toBe(true);
      expect(completions(server)).toHaveLength(1);
      expect(completions(server)[0].body).toMatchObject({ status: 'completed', actual_load_value: 175, actual_load_unit: 'lb', actual_reps: 6 });
      expect(server.find('a-s1')).toMatchObject({ status: 'completed', actual_load_value: 175, actual_load_unit: 'lb', actual_reps: 6 });
      await expect(undoButton(page)).toBeEnabled();
      await shot(page, '03-saved-undo-offered');

      // Reopen: a fresh load shows the saved set, sends no new write, and still offers its Undo.
      const writesBefore = sent(server, /./).length;
      await page.reload();
      await expect(panel(page)).toBeVisible();
      await expect(page.getByTestId('focus-row').first()).toContainText('175 lb × 6');
      await expect(undoButton(page)).toBeEnabled();
      expect(sent(server, /./).length).toBe(writesBefore);
      await shot(page, '04-reopened');

      // Undo: one tap takes back the Log tap and nothing else. The typed entry stays, not marked done.
      await undoButton(page).click();
      await expect.poll(() => server.find('a-s1').status).toBe('pending');
      await expect.poll(() => outboxEmpty(page)).toBe(true);
      for (const field of ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe']) expect(server.find('a-s1')[field]).toBe(beforeLog[field]);
      expect(server.find('a-s2')).toMatchObject({ status: 'pending', actual_reps: null });
      expect(sent(server, /\/undo$/)).toHaveLength(1);
      await page.reload();
      await expect(panel(page)).toBeVisible();
      await expect(panel(page).getByTestId('focus-log')).toHaveAttribute('data-kind', 'log');
      await expect(panel(page).getByTestId('focus-log')).toContainText('175 lb');
      expect(server.find('a-s1').status).toBe('pending');
      expect(doneChanges(server)).toHaveLength(1);
      await shot(page, '05-undone-reopened');
      expect(results.unexpected).toEqual([]);
      expect(results.errors).toEqual([]);
    });
  }

  test('interrupted save, reply lost: the server stored it, the phone reloads offline, then it settles once and Undo still works', async ({ page }) => {
    const { server, results } = await start(page, ON_URL);
    const action = panel(page).getByTestId('focus-log');
    await action.click();
    await weight(page, 1).fill('170');
    await repsIn(page, 1).fill('5');
    await expect(action).toHaveAttribute('data-kind', 'log');
    await repsIn(page, 1).blur();
    await expect.poll(() => server.find('a-s1').actual_reps).toBe(5);
    await expect.poll(() => outboxEmpty(page)).toBe(true);
    // The server applies the save but its reply never arrives.
    server.drop.add('sets/a-s1');
    await action.click();
    await expect.poll(() => server.find('a-s1').status).toBe('completed');
    // The page is closed and reopened with no connection: the entry is still there, marked as not yet confirmed.
    server.down = true;
    await page.reload();
    await expect(page.getByTestId('workout-outline')).toBeVisible();
    expect(await outboxEmpty(page)).toBe(false);
    await expect(page.getByTestId('focus-row').first()).toContainText('170 lb × 5');
    await shot(page, '06-interrupted-reopened-offline');
    // Connection back: the same save is sent again under the same id and the server answers "already have it".
    server.drop.clear();
    server.down = false;
    await page.reload();
    await expect(page.getByTestId('workout-outline')).toBeVisible();
    await expect.poll(() => outboxEmpty(page)).toBe(true);
    const sends = completions(server);
    expect(sends.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sends.map((write) => write.body.event_id)).size).toBe(1);
    expect(doneChanges(server)).toHaveLength(1);
    expect(server.find('a-s1')).toMatchObject({ status: 'completed', actual_load_value: 170, actual_reps: 5 });
    await expect(page.getByTestId('focus-row').first()).toContainText('170 lb × 5');
    await shot(page, '07-interrupted-recovered');
    // The recovered save is still the newest change, so its one Undo is offered and works.
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();
    await expect.poll(() => server.find('a-s1').status).toBe('pending');
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });

  test('interrupted save, never sent: saved with no connection, reopened, then it lands exactly once', async ({ page }) => {
    const { server, results } = await start(page, ON_URL);
    const action = panel(page).getByTestId('focus-log');
    await action.click();
    await weight(page, 1).fill('172.5');
    await repsIn(page, 1).fill('4');
    await repsIn(page, 1).blur();
    await expect.poll(() => server.find('a-s1').actual_reps).toBe(4);
    await expect.poll(() => outboxEmpty(page)).toBe(true);
    server.down = true;
    await action.click();
    await expect.poll(() => outboxEmpty(page)).toBe(false);
    expect(server.find('a-s1').status).toBe('pending');
    await page.reload();
    await expect(page.getByTestId('workout-outline')).toBeVisible();
    await expect(page.getByTestId('focus-row').first()).toContainText('172.5 lb × 4');
    expect(server.find('a-s1').status).toBe('pending');
    server.down = false;
    await page.reload();
    await expect.poll(() => server.find('a-s1').status).toBe('completed');
    await expect.poll(() => outboxEmpty(page)).toBe(true);
    expect(doneChanges(server)).toHaveLength(1);
    expect(server.find('a-s1')).toMatchObject({ status: 'completed', actual_load_value: 172.5, actual_reps: 4 });
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });
});

test.describe('gate off (the default)', () => {
  test('the same workout opens in today\'s tracker: no Look A panel, no Look A Undo, no Look A requests', async ({ page }) => {
    const undoReads = [];
    page.on('request', (request) => { if (/\/api\/workout-logs\/[^/]+\/undo$/.test(new URL(request.url()).pathname)) undoReads.push(request.method()); });
    const { server } = await start(page, OFF_URL);
    await expect(page.getByTestId('workout-outline')).toBeVisible();
    await expect(page.getByText('Back Squat').first()).toBeVisible();
    await expect(page.getByTestId('focus-panel')).toHaveCount(0);
    await expect(page.getByTestId('workout-undo-button')).toHaveCount(0);
    await expect(page.getByTestId('workout-options')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(undoReads).toEqual([]);
    expect(sent(server, /\/(undo|finish|done)$/)).toEqual([]);
    await shot(page, '08-gate-off-todays-tracker');
  });
});
