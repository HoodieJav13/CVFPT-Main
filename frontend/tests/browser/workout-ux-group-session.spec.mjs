// Small-group session conductor, real UI in normal mode against the
// synthetic in-process API (tests/browser/fixtures/groupSessionServer.mjs).
// Fictional trainees only. This proves the conductor's own behaviour: per
// trainee ownership of every write, retry/reload without duplicates,
// substitution, equipment amendment and the summary. It does NOT prove server
// privacy; the real Auth/API/DB boundary is covered separately.
import { test, expect } from '@playwright/test';
import { TRAINEES, createGroupServer } from './fixtures/groupSessionServer.mjs';

const TOKEN = 'synthetic-g1-coach-token';
const [ANA, BEN, CAM, DEE, ELI] = TRAINEES;
const STATIONS = [
  { library: 'fict-lib-goblet', sets: '3', reps: '10', load: '35' },
  { library: 'fict-lib-bench', sets: '2', reps: '8', load: '95' },
  { library: 'fict-lib-row', sets: '2', reps: '12', load: '70' },
];

async function setup(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = createGroupServer();
  const unexpected = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if ((request.headers().authorization || '') !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Invalid or expired token"}' });
    if (path.endsWith('/unread-count')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"unread":0}' });
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    try {
      const data = server.request(method, path, body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    } catch (error) {
      if (error.code === 'ERR_NETWORK') return route.abort('connectionreset').catch(() => {});
      if (error.response?.data?.error?.startsWith('Synthetic route missing')) unexpected.push(`${method} ${path}`);
      return route.fulfill({ status: error.response?.status || 500, contentType: 'application/json', body: JSON.stringify(error.response?.data || {}) });
    }
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/login');
  await page.evaluate((token) => localStorage.setItem('cvf_access_token', token), TOKEN);
  await page.goto('/coach/group-session');
  await expect(page.getByTestId('group-setup')).toBeVisible();
  return { server, unexpected };
}

async function plan(page, trainees) {
  for (const trainee of trainees) await page.getByTestId(`group-trainee-option-${trainee.id}`).check();
  for (const [index, station] of STATIONS.entries()) {
    await page.getByTestId(`group-station-${index}-exercise`).selectOption(station.library);
    await page.getByTestId(`group-station-${index}-sets`).fill(station.sets);
    await page.getByTestId(`group-station-${index}-reps`).fill(station.reps);
    await page.getByTestId(`group-station-${index}-load`).fill(station.load);
  }
  await page.getByTestId('group-title').fill('Fictional Tuesday group');
  await page.getByTestId('group-start').click();
  await expect(page.getByTestId('group-header')).toContainText('Round 1 of 3');
}

async function recordSet(page, trainee, number, reps, load, expected = 'saved') {
  const row = page.getByTestId(`group-set-${trainee.id}-${number}`);
  await row.getByTestId(`group-set-${trainee.id}-${number}-reps`).fill(String(reps));
  await row.getByTestId(`group-set-${trainee.id}-${number}-load`).fill(String(load));
  await row.getByTestId(`group-set-${trainee.id}-${number}-save`).click();
  await expect(row).toHaveAttribute('data-state', expected);
}

const logsOf = (server, trainee) => server.db.logs.filter((log) => log.client_id === trainee.id);
const completedSets = (log) => log.exercises[0].sets.filter((set) => set.status === 'completed');

for (const width of [390, 1280]) {
  test(`${width}: four trainees, three stations — rotation, lost reply + reload, equipment change, substitution, summary`, async ({ page }) => {
    test.setTimeout(120_000);
    const { server, unexpected } = await setup(page, width);
    await plan(page, [ANA, BEN, CAM, DEE]);

    // Round 1: Ana and Dee share Station A; Ben at B; Cam at C.
    await expect(page.getByTestId('group-station-A').getByTestId(`group-trainee-${ANA.id}`)).toBeVisible();
    await expect(page.getByTestId('group-station-A').getByTestId(`group-trainee-${DEE.id}`)).toBeVisible();
    await recordSet(page, ANA, 1, 10, 35);
    await recordSet(page, DEE, 1, 8, 25);
    await recordSet(page, ANA, 2, 10, 35);
    await recordSet(page, BEN, 1, 8, 95);
    await recordSet(page, CAM, 1, 12, 70);

    // The reply to Ben's second set is lost after the server stored it.
    server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'drop-reply' });
    await recordSet(page, BEN, 2, 8, 95, 'failed');
    await expect(page.getByTestId(`group-set-${BEN.id}-2-error`)).toContainText('Not saved yet');
    await expect(page.getByTestId('group-sync-status')).toContainText('1 set(s) waiting to save');
    const createsBeforeReload = server.db.requests.filter((r) => r.path === '/programs/quick-sessions').length;
    await page.reload();
    await expect(page.getByTestId(`group-set-${BEN.id}-2`)).toHaveAttribute('data-state', 'saved');
    await expect(page.getByTestId('group-sync-status')).toContainText('All entered sets are saved');
    expect(server.db.requests.filter((r) => r.path === '/programs/quick-sessions').length).toBe(createsBeforeReload);
    expect(completedSets(logsOf(server, BEN)[0]).length).toBe(2);

    // Equipment issue at B mid-round: Ben already started, so he keeps Barbell Bench.
    await page.getByTestId('group-amend-B').click();
    await page.getByTestId('group-amend-exercise').selectOption('fict-lib-dbbench');
    await page.getByTestId('group-amend-sets').fill('2');
    await page.getByTestId('group-amend-reps').fill('10');
    await page.getByTestId('group-amend-load').fill('30');
    await page.getByTestId('group-amend-reason').fill('Rack pin broke');
    await page.getByTestId('group-amend-confirm').click();
    await expect(page.getByTestId('group-station-B-exercise')).toHaveText('DB Bench Press');
    await expect(page.getByTestId('group-station-B-amended')).toContainText('planned Barbell Bench Press');
    await expect(page.getByTestId(`group-trainee-kept-exercise-${BEN.id}`)).toContainText('keeps Barbell Bench Press');

    // Cam leaves after one set; Eli substitutes from now on.
    await page.getByTestId(`group-substitute-${CAM.id}`).click();
    await page.getByTestId('group-substitute-choice').selectOption(ELI.id);
    await page.getByTestId('group-substitute-reason').fill('Felt light-headed');
    await page.getByTestId('group-substitute-confirm').click();
    await expect(page.getByTestId(`group-trainee-${CAM.id}`)).toContainText('Left the session · recorded work kept');
    await expect(page.getByTestId(`group-set-${CAM.id}-1-save`)).toBeDisabled();
    await expect(page.getByTestId(`group-set-${CAM.id}-2`)).toHaveCount(0);
    await recordSet(page, ELI, 1, 12, 60);
    await page.screenshot({ path: test.info().outputPath(`group-round1-${width}.png`), fullPage: true });

    await page.getByTestId('group-rotate').click();
    await expect(page.getByTestId('group-header')).toContainText('Round 2 of 3');

    // Round 2: Ana and Dee at the amended Station B.
    await expect(page.getByTestId('group-station-B').getByTestId(`group-trainee-${ANA.id}`)).toBeVisible();
    await recordSet(page, ANA, 1, 10, 30);
    await page.getByTestId(`group-add-set-${ANA.id}`).click();
    await recordSet(page, ANA, 3, 9, 30);
    await recordSet(page, DEE, 1, 10, 20);
    await recordSet(page, BEN, 1, 12, 70);
    await recordSet(page, ELI, 1, 10, 35);
    await page.getByTestId('group-restore-B').click();
    await expect(page.getByTestId('group-station-B-exercise')).toHaveText('Barbell Bench Press');
    await page.getByTestId('group-rotate').click();
    await expect(page.getByTestId('group-header')).toContainText('Round 3 of 3');

    // Round 3: Eli reaches B after the equipment came back.
    await recordSet(page, ANA, 1, 12, 70);
    await recordSet(page, BEN, 1, 10, 35);
    await recordSet(page, ELI, 1, 6, 85);
    await recordSet(page, DEE, 1, 12, 50);
    await page.getByTestId('group-rotate').click();

    // Summary.
    const summary = page.getByTestId('group-summary');
    await expect(summary).toBeVisible();
    await expect(page.getByTestId('group-summary-rounds')).toContainText('3/3');
    await expect(page.getByTestId('group-summary-substitutions')).toContainText('1');
    await expect(page.getByTestId('group-summary-disruptions')).toContainText('1');
    await expect(page.getByTestId('group-summary-sets')).toContainText('16');
    await expect(page.getByTestId(`group-summary-person-${ANA.id}-totals`)).toContainText('5 of 7 planned sets · volume 2,110 lb');
    await expect(page.getByTestId(`group-summary-person-${CAM.id}`)).toContainText('Left during round 1.');
    await expect(page.getByTestId(`group-summary-person-${ELI.id}`)).toContainText('Joined in round 1 as a substitute.');
    await expect(page.getByTestId(`group-summary-visit-${ANA.id}-1`)).toContainText('instead of Barbell Bench Press');
    await expect(page.getByTestId('group-summary-timeline')).toContainText('Eli Fictional (substitute) replaces Cam Fictional from round 1');
    await page.screenshot({ path: test.info().outputPath(`group-summary-${width}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Server records: every write is the trainee's own, nothing duplicated.
    expect(logsOf(server, ANA).length).toBe(3);
    expect(logsOf(server, BEN).length).toBe(3);
    expect(logsOf(server, CAM).length).toBe(1);
    expect(logsOf(server, DEE).length).toBe(3);
    expect(logsOf(server, ELI).length).toBe(3);
    expect(server.db.assignments.length).toBe(13);
    expect(server.db.logs.every((log) => log.status === 'completed')).toBe(true);
    for (const create of server.db.requests.filter((r) => r.path === '/programs/quick-sessions')) {
      const text = JSON.stringify(create.body);
      for (const other of TRAINEES.filter((row) => row.id !== create.body.client_id)) {
        expect(text.includes(other.id) || text.includes(other.name)).toBe(false);
      }
      expect(text).not.toContain('Rack pin broke');
      expect(text).not.toContain('light-headed');
    }
    const assignmentOf = (log) => server.db.assignments.find((row) => row.id === log.workout_assignment_id);
    expect(assignmentOf(logsOf(server, BEN)[0]).exercises[0].exercise_library_id).toBe('fict-lib-bench');
    expect(assignmentOf(logsOf(server, ANA)[1]).exercises[0].exercise_library_id).toBe('fict-lib-dbbench');
    expect(assignmentOf(logsOf(server, ELI)[2]).exercises[0].exercise_library_id).toBe('fict-lib-bench');
    expect(logsOf(server, ANA)[1].exercises[0].sets.filter((set) => set.set_origin === 'extra').length).toBe(1);
    expect(completedSets(logsOf(server, CAM)[0]).map((set) => set.actual_reps)).toEqual([12]);
    for (const write of server.db.requests.filter((r) => r.method === 'PATCH')) {
      const log = server.db.logs.find((row) => write.path.startsWith(`/workout-logs/${row.id}/`));
      expect(log.exercises[0].sets.some((set) => write.path.endsWith(`/sets/${set.id}`))).toBe(true);
    }
    expect(unexpected).toEqual([]);
  });
}

test('a trainee with another workout in progress is blocked with no writes, then retried', async ({ page }) => {
  const { server } = await setup(page, 1280);
  server.db.activeOther.add(BEN.id);
  await plan(page, [ANA, BEN, CAM, DEE]);
  await recordSet(page, BEN, 1, 8, 95, 'failed');
  await expect(page.getByTestId(`group-visit-error-${BEN.id}`)).toContainText('already has another workout in progress');
  expect(server.db.logs.length).toBe(0);
  expect(server.db.requests.filter((r) => r.method === 'PATCH').length).toBe(0);
  server.db.activeOther.delete(BEN.id);
  await page.getByTestId(`group-visit-error-${BEN.id}`).getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId(`group-set-${BEN.id}-1`)).toHaveAttribute('data-state', 'saved');
  expect(server.db.assignments.length).toBe(1);
  expect(logsOf(server, BEN).length).toBe(1);
});
