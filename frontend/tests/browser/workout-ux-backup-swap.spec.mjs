// Coach backup swap keeps the backup's saved facts (LOOK-A-INTEGRATION-REVIEW.md
// case 4, 2026-11-14): a kg backup with a range and per side is sent as kg with
// its range and per side; changing the load sends one number in kg. Normal
// mode, synthetic in-process API; the page's request body is the evidence.
// Server-side recovery for older queued payloads is covered by
// backend/test/look-a-backup-swap.test.js. Fictional data only.
import { test, expect } from '@playwright/test';

const LOG = 'bs-log';
const BACKUP = { id: 'bs-backup', exercise_library_id: 'lib-step', name: 'Fictional Step Up', client_note: null,
  targets: { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true } };
const set = (n) => ({ id: `s${n}`, workout_log_exercise_id: 'a', set_number: n, status: 'pending', set_origin: 'prescribed', actual_load_value: 40, actual_load_unit: 'kg',
  actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'legacy', value_origin_nonce: null, prefill_load_value: null, prefill_load_unit: null });
let touched = 0;
const log = () => ({
  id: LOG, client_id: 'bs-client', workout_name: 'Fictional swap workout', status: 'active', started_at: new Date().toISOString(),
  exercises: [{ id: 'a', exercise_library_id: 'lib-split', exercise_name: 'Split Squat', tracking_type: 'reps_weight', prescribed_sets: '2', prescribed_reps: '8',
    prescribed_load_value: 40, prescribed_load_unit: 'kg', prescribed_rest_seconds: 90, superset_group: null, plan_revision: 0, backups: [BACKUP], sets: [set(1), set(2)].map((row, i) => (i < touched ? { ...row, status: 'completed', actual_reps: 8, revision: 1 } : row)) }],
  coach_responses: [], conflicts: [], substitutions: [], server_time: new Date().toISOString(),
});

async function open(browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const sent = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-bs-token'));
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'bs@example.invalid', profile: { id: 'bs-client', name: 'Fictional swap client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${LOG}` && method === 'GET') return json(log());
    if (path === `/workout-logs/${LOG}/undo` && method === 'GET') return json({ undo: null });
    if (/\/history$/.test(path)) return json({ occurrences: [], next_cursor: null });
    if (/\/substitution-options$/.test(path)) return json({ backups: [BACKUP], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    if (method === 'GET' && /\/cue-retry$/.test(path)) return json({ source_version: null, can_create: false, can_recheck: false, outgoing: [], incoming: [] });
    if (method === 'POST' && /\/substitutions$/.test(path)) {
      sent.push(r.postDataJSON());
      return json({ error: 'Synthetic stop after capture' }, 422);
    }
    if (method === 'POST' && /\/sets$/.test(path)) return json({ error: 'Synthetic stop' }, 422);
    return json({ error: `Unexpected synthetic route ${method} ${path}` }, 404);
  });
  await page.goto(`/client/workouts/${LOG}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return { context, page, sent, errors };
}

// Owner decisions (handoff 2026-11-14): no reason is asked (saved as
// 'other'); a backup gets its own set count minus the old exercise's sets
// already completed or skipped, minimum 1, fixed.
for (const [label, load, done, expected] of [
  ['kept', null, 0, { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true }],
  ['changed load', '32.5', 0, { sets: 3, reps: '8', load_value: 32.5, load_unit: 'kg', per_side: true }],
  ['mid-exercise', null, 1, { sets: 2, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true }],
]) {
  test(`coach backup swap, ${label}: fixed set count, kg, range and per side kept, no reason asked`, async ({ browser }) => {
    touched = done;
    const { context, page, sent } = await open(browser);
    await page.getByTestId('swap-open').first().click();
    await expect(page.getByTestId('swap-reason')).toHaveCount(0);
    await expect(page.locator('[data-testid^="swap-trigger-"]')).toHaveCount(0);
    await page.getByTestId(`swap-backup-${BACKUP.name}`).click();
    await expect(page.getByTestId(`swap-backup-${BACKUP.name}`)).toContainText('30–35 kg per side');
    await expect(page.getByTestId('swap-target-load')).toHaveAttribute('placeholder', 'Load kg');
    await expect(page.getByTestId('swap-target-sets')).toHaveCount(0);
    await expect(page.getByTestId('swap-fixed-sets')).toContainText(`${expected.sets} ${expected.sets === 1 ? 'set' : 'sets'}`);
    if (load) await page.getByTestId('swap-target-load').fill(load);
    await page.getByTestId('swap-confirm').click();
    await expect.poll(() => sent.length).toBe(1);
    // The count is fixed by the server from the backup's own count (Look A
    // v3): the page sends what it showed as expected_sets plus one id per set,
    // never a count inside the targets.
    const { sets: count, ...targets } = expected;
    expect(sent[0].targets).toEqual(targets);
    expect(sent[0].expected_sets).toBe(count);
    expect(sent[0].set_ids).toHaveLength(count);
    expect(new Set(sent[0].set_ids).size).toBe(count);
    expect(sent[0]).toMatchObject({ source: 'coach_backup', backup_id: BACKUP.id, trigger: 'other' });
    expect(sent[0].reason).toBeUndefined();
    await context.close();
  });
}
