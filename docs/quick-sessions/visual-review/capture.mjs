// Paired visual evidence for quick sessions (spec R5 / A11). HEADLESS ONLY.
//
// Serves two clean `git archive` exports of the frontend (baseline and proposed SHAs) in preview
// mode with identical fictional fixtures, then captures the same logical states at 320x640,
// 390x844 and 1440x900 under a fixed clock (2026-10-09T17:00:00Z, America/Denver), dark,
// reduced motion. Shared states are paired; new-only quick-session states are captured for the
// proposed build only and captioned as such (there is no old Quick Session screen to fake).
//
//   BASE_DIR=<export>/frontend HEAD_DIR=<export>/frontend BASE_SHA=... HEAD_SHA=... \
//   BASE_PORT=4710 HEAD_PORT=4720 node docs/quick-sessions/visual-review/capture.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.dirname(fileURLToPath(import.meta.url));
const env = (name) => { if (!process.env[name]) throw new Error(`${name} is required`); return process.env[name]; };
const { chromium } = await import(path.join(env('HEAD_DIR'), 'node_modules/playwright/index.mjs'));
const FIXED = '2026-10-09T17:00:00.000Z';
const VIEWPORTS = [[320, 640], [390, 844], [1440, 900]];
const sources = {
  baseline: { sha: env('BASE_SHA'), dir: env('BASE_DIR'), port: Number(env('BASE_PORT')) },
  proposed: { sha: env('HEAD_SHA'), dir: env('HEAD_DIR'), port: Number(env('HEAD_PORT')) },
};

async function startServer(source) {
  const child = spawn(path.join(source.dir, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(source.port), '--strictPort'], {
    cwd: source.dir, env: { ...process.env, REACT_APP_PREVIEW_MODE: 'true', REACT_APP_BACKEND_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${source.port}/`)).ok) return child; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`vite exited for ${source.sha}: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error(`vite did not start for ${source.sha}: ${output}`);
}

const PENDING = 'cvf_quick_session_pending:v1:preview:coach_marcus:';
const pendingRecord = (requestId) => JSON.stringify({ v: 1, request_id: requestId, client_id: 'client_riley', state: 'pending', created_at: FIXED });

async function openAssign(page, clientId) {
  await page.goto(`/coach/clients/${clientId}?tab=programs`);
  await page.getByTestId('assign-program-button').click();
  await page.getByRole('dialog').waitFor();
}
async function chooseType(page, name) {
  await page.getByTestId('client-assignment-type-select').click();
  await page.getByRole('option', { name }).click();
}
async function quickBuilder(page) {
  await openAssign(page, 'client_riley');
  await chooseType(page, 'Quick session');
  await page.getByTestId('quick-session-builder').waitFor();
}
async function fillQuick(page, title) {
  await page.getByTestId('quick-session-title-input').fill(title);
  await page.getByTestId('quick-session-exercise-name-input').first().fill('Goblet Squat');
  await page.getByTestId('quick-session-sets-input').first().fill('3');
  await page.getByTestId('quick-session-reps-input').first().fill('12');
  await page.getByTestId('quick-session-weight-input').first().fill('35');
}
const dialogTop = (page) => page.getByRole('dialog').evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
const scrollIntoView = (locator) => locator.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));

// [id, versions, role, client, caption, action]
const STATES = [
  ['coach-programs-sarah', ['baseline', 'proposed'], 'coach', 'client_sarah', 'Shared: coach client Programs tab (Sarah baseline fixture). Expected unchanged.', async (page) => {
    await page.goto('/coach/clients/client_sarah?tab=programs'); await page.getByTestId('assigned-workout-card').first().waitFor();
  }],
  ['assign-type-menu', ['baseline', 'proposed'], 'coach', 'client_sarah', 'Shared: Assign training type selector open. Proposed adds the "Quick session" option.', async (page) => {
    await openAssign(page, 'client_sarah'); await page.getByTestId('client-assignment-type-select').click(); await page.getByRole('option').first().waitFor();
  }],
  ['assign-standalone', ['baseline', 'proposed'], 'coach', 'client_sarah', 'Shared: Assign -> Standalone workout (the honest creator baseline: there is no quick-session creator before).', async (page) => {
    await openAssign(page, 'client_sarah'); await chooseType(page, 'Standalone workout'); await page.getByTestId('client-assignment-workout-select').waitFor();
  }],
  ['client-home-sarah', ['baseline', 'proposed'], 'client', 'client_sarah', 'Shared: client Home today plan (Sarah). Expected unchanged.', async (page) => {
    await page.goto('/client'); await page.getByTestId('client-today-plan-title').waitFor();
  }],
  ['coach-history-sarah', ['baseline', 'proposed'], 'coach', 'client_sarah', 'Shared: coach Workout history list (Sarah, no quick logs). Expected unchanged.', async (page) => {
    await page.goto('/coach/clients/client_sarah?tab=programs'); const history = page.getByTestId('coach-client-workout-history'); await history.waitFor(); await scrollIntoView(history.getByRole('heading'));
  }],
  ['quick-builder', ['proposed'], 'coach', 'client_riley', 'New only: Assign -> Quick session builder, Denver-today date default, one exercise filled.', async (page) => {
    await quickBuilder(page); await fillQuick(page, 'Hotel gym'); await dialogTop(page);
  }],
  ['quick-builder-more-validation', ['proposed'], 'coach', 'client_riley', 'New only: More expanded (tracking, rest, tempo, RPE, notes) and the empty-session validation message.', async (page) => {
    await quickBuilder(page); await page.getByTestId('quick-session-more-button').first().click();
    await page.getByTestId('quick-session-assign-button').click(); await page.getByTestId('quick-session-validation').waitFor();
    await scrollIntoView(page.getByTestId('quick-session-more-fields'));
  }],
  ['quick-saved', ['proposed'], 'coach', 'client_riley', 'New only: confirmed create with independent Start now / Save to library actions.', async (page) => {
    await quickBuilder(page); await fillQuick(page, 'Hotel gym'); await page.getByTestId('quick-session-assign-button').click(); await page.getByTestId('quick-session-saved').waitFor();
  }],
  ['coach-riley-cards', ['proposed'], 'coach', 'client_riley', 'New only: coach cards with the Quick session label; the completed quick session is hidden from active cards.', async (page) => {
    await page.goto('/coach/clients/client_riley?tab=programs'); await page.getByTestId('quick-session-badge').first().waitFor();
  }],
  ['recovery-uncertainty', ['proposed'], 'coach', 'client_riley', 'New only: reload recovery — an unrecoverable pending request and a corrupt entry, with Re-enter / Discard.', async (page) => {
    await page.addInitScript(({ entries }) => { for (const [key, value] of entries) localStorage.setItem(key, value); }, {
      entries: [[`${PENDING}7e570000-0000-4000-8000-0000000000aa`, pendingRecord('7e570000-0000-4000-8000-0000000000aa')], [`${PENDING}not-a-request`, '{"broken"']],
    });
    await page.goto('/coach/clients/client_riley?tab=programs'); await page.getByTestId('quick-session-corrupt').waitFor(); await scrollIntoView(page.getByTestId('quick-session-recovery-list'));
  }],
  ['start-conflict', ['proposed'], 'coach', 'client_riley', 'New only: Start now while another workout is active — the session stays assigned; retry only Start.', async (page) => {
    await page.goto('/coach/clients/client_riley?tab=programs');
    await page.evaluate(async () => { const { api } = await import('/src/lib/api.js'); await api.post('/workout-logs/start', { client_id: 'client_riley', workout_assignment_id: 'quick_assign_riley_today' }); });
    await page.getByTestId('assign-program-button').click(); await chooseType(page, 'Quick session'); await fillQuick(page, 'Blocked start');
    await page.getByTestId('quick-session-start-now-button').click(); await page.getByTestId('quick-session-start-failed').waitFor();
  }],
  ['library-failure', ['proposed'], 'coach', 'client_riley', 'New only: "Session assigned — saving to library failed · Try again" (preview Fail next save).', async (page) => {
    await quickBuilder(page); await fillQuick(page, 'Library later'); await page.getByTestId('quick-session-assign-button').click(); await page.getByTestId('quick-session-saved').waitFor();
    await page.evaluate(() => localStorage.setItem('cvf_preview_fail', 'write-once'));
    await page.getByTestId('quick-session-save-library').click(); await page.getByTestId('quick-session-library-failed').waitFor();
  }],
  ['client-home-riley', ['proposed'], 'client', 'client_riley', 'New only: client Home — a quick session considered under the existing due priority, with its label.', async (page) => {
    await page.goto('/client'); await page.getByTestId('client-today-quick-session').waitFor();
  }],
  ['client-programs-riley', ['proposed'], 'client', 'client_riley', 'New only: client Programs (Other) — quick session card label; the completed one is not shown.', async (page) => {
    await page.goto('/client/programs'); await page.getByTestId('client-training-tab-other').click(); await page.getByTestId('quick-session-badge').first().waitFor();
  }],
  ['history-detail-riley', ['proposed'], 'coach', 'client_riley', 'New only: completed quick-session log detail with the Quick session provenance label.', async (page) => {
    await page.goto('/coach/clients/client_riley?tab=programs');
    const href = await page.getByTestId('coach-client-workout-history').getByRole('link').first().getAttribute('href');
    await page.goto(href); await page.getByTestId('log-detail-quick-session').waitFor();
  }],
];

// One dev server at a time: both exports share the same node_modules (and Vite cache).
const captures = [];
let browser;
let server = null;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir(path.join(folder, 'captures'), { recursive: true });
  for (const version of Object.keys(sources)) {
    const source = sources[version];
    server = await startServer(source);
  for (const [width, height] of VIEWPORTS) {
    for (const [id, versions, role, client, caption, action] of STATES) {
      {
        if (!versions.includes(version)) continue;
        const context = await browser.newContext({
          viewport: { width, height }, baseURL: `http://127.0.0.1:${source.port}`, colorScheme: 'dark', locale: 'en-US',
          timezoneId: 'America/Denver', reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
        await page.clock.setFixedTime(new Date(FIXED));
        await page.addInitScript(({ selectedRole, selectedClient }) => {
          localStorage.setItem('cvf_preview_role', selectedRole);
          localStorage.setItem('cvf_preview_client_id', selectedClient);
        }, { selectedRole: role, selectedClient: client });
        await action(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const file = `captures/${id}-${width}-${version}.png`;
        await page.screenshot({ path: path.join(folder, file), animations: 'disabled' });
        const fullFile = `captures/${id}-${width}-${version}-full.png`;
        await page.screenshot({ path: path.join(folder, fullFile), animations: 'disabled', fullPage: true });
        const screen = await page.evaluate(() => ({
          url: location.pathname + location.search, scrollY, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth, now: new Date().toISOString(),
          pendingKeys: Object.keys(localStorage).filter((key) => key.startsWith('cvf_quick_session_pending')),
        }));
        const meaningful = errors.filter((text) => !/Simulated failure|status of 409|status of 404|status of 503/.test(text));
        const hash = async (relative) => createHash('sha256').update(await readFile(path.join(folder, relative))).digest('hex');
        const dimensions = async (relative) => { const buffer = await readFile(path.join(folder, relative)); return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }; };
        captures.push({
          state: id, version, sourceSHA: source.sha, viewport: { width, height }, caption, role, client,
          file, sha256: await hash(file), image: await dimensions(file),
          fullPage: { file: fullFile, sha256: await hash(fullFile), image: await dimensions(fullFile) },
          screen, consoleErrors: errors, unexpectedErrors: meaningful,
        });
        console.log(`${id} ${width} ${version} overflow=${screen.horizontalOverflow} errors=${meaningful.length}`);
        await context.close();
      }
    }
  }
    server.kill();
    server = null;
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
captures.sort((a, b) => a.state.localeCompare(b.state) || a.viewport.width - b.viewport.width || a.version.localeCompare(b.version));

await writeFile(path.join(folder, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  browser: `${chromium.name()} (Playwright headless shell)`,
  sources: Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, { sha: source.sha, url: `http://127.0.0.1:${source.port}`, served: 'git archive export, vite dev, preview mode' }])),
  fixture: 'Identical preview fixtures from each SHA (Sarah baseline; quick-session scenario on fictional client Riley Ortega exists in proposed only). Clock fixed 2026-10-09T17:00:00Z (11:00 America/Denver).',
  theme: 'dark, reduced motion, en-US, America/Denver',
  classification: 'Extension of existing Assign/client-copy patterns plus one semantic type label using existing Badge/primary tokens. No new identity/signature visual direction proposed; no direction is selected here. Paired captures document the actual deltas; cold/owner review is not self-certified.',
  limitations: [
    'Preview mode proves rendered UI behavior only; authorization, idempotency and races are proven by the SQL and mocked-network suites.',
    'Shared pairs use Sarah fixtures (present in both SHAs). Quick-session states are new-only: the baseline has no creator, so the Assign -> Standalone flow is the creator baseline.',
    'The preview toolbar is part of the preview build and overlays the lower right on both sides.',
    'Chromium headless shell only (dark, reduced motion); no iOS Safari or installed PWA proof.',
  ],
  captures,
}, null, 2)}\n`);
console.log(`captures: ${captures.length}`);
