#!/usr/bin/env node
// LOCAL exercise media demo launcher (owned, loopback-only). Starts the
// disposable database + PostgREST, the fictional auth gateway, the real API and
// worker, seeds SYNTHETIC demo data through the real coach APIs, and serves the
// real frontend (non-preview build) with a "Synthetic local demo" account
// selector at /__media-demo.
//
//   npm --prefix backend run dev:media-local                 start (Ctrl+C stops everything it started)
//   npm --prefix backend run dev:media-local -- --port 42771 --keep-db
//   npm --prefix backend run dev:media-local:down            stop a launcher left running (ownership-checked)
//   node backend/integration/exercise-media-dev.cjs --status
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { MediaHarness, IDENTITIES, ROOT, LOCAL_DIR, RUN_DIR, MARKER, stack, commandLine, waitFor } = require('./exercise-media-harness.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const RUNTIME = path.join(RUN_DIR, 'runtime.json');
const FIXTURES = path.join(LOCAL_DIR, 'fixtures');

function readRuntime() { try { return JSON.parse(fs.readFileSync(RUNTIME, 'utf8')); } catch { return null; } }

async function down() {
  const runtime = readRuntime();
  if (runtime?.launcher?.pid) {
    // Ownership: the recorded pid must still be this launcher script.
    const line = commandLine(runtime.launcher.pid);
    if (line.includes('backend/integration/exercise-media-dev.cjs') && !line.includes('--down')) {
      process.kill(runtime.launcher.pid, 'SIGTERM');
      await waitFor(() => !commandLine(runtime.launcher.pid), { timeoutMs: 90_000, what: 'launcher exit' }).catch(() => {});
    }
  }
  for (const child of Object.values(runtime?.children || {})) {
    const line = commandLine(child.pid);
    if (line && line.includes(`--cvf-media-run=${runtime.run_id}`)) process.kill(child.pid, 'SIGTERM');
  }
  if (runtime?.frontend?.pid) {
    const line = commandLine(runtime.frontend.pid);
    if (line.includes('vite.media-local.config.mjs') && line.includes(`--port ${runtime.frontend.port}`)) process.kill(runtime.frontend.pid, 'SIGTERM');
  }
  stack(['down']);
  fs.rmSync(RUNTIME, { force: true });
  console.log('exercise media local demo stopped (owned resources only)');
}

async function api(base, method, url, { token, json, form } = {}) {
  const response = await fetch(base + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}) }, body: form || (json ? JSON.stringify(json) : undefined) });
  const body = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status} ${body?.code || ''}`);
  return body;
}

// Synthetic library, one assigned workout and (optionally) published sample
// guides produced by the REAL pipeline. Nothing here is coaching content.
async function seed(apiUrl, token, { media }) {
  const ids = {};
  for (const [key, name, equipment, video] of [['goblet', 'Synthetic Goblet Squat', 'Kettlebell', null], ['split', 'Synthetic Split Squat', 'Dumbbells', null],
    ['row', 'Synthetic Band Row', 'Band', 'https://example.com/synthetic-library-band-row'], ['plank', 'Synthetic Plank', 'Bodyweight', null],
    ['shuttle', 'Synthetic Shuttle Walk', 'None', null], ['wall', 'Synthetic Wall Sit (no media)', 'Bodyweight', null]]) {
    ids[key] = (await api(apiUrl, 'POST', '/api/programs/exercise-library', { token, json: { name, category: 'Synthetic', equipment, video_url: video } })).id;
  }
  const row = (key, extra = {}) => ({ exercise_library_id: ids[key], custom_name: '', sets: 2, reps: '8', rest: '60s', ...extra });
  const workout = await api(apiUrl, 'POST', '/api/programs/workouts', { token, json: { name: 'Synthetic media session', exercises: [
    row('goblet'), row('split'), row('row', { video_url: 'https://example.com/synthetic-coach-override' }), row('plank'), row('shuttle'), row('wall'),
    { exercise_library_id: null, custom_name: 'Synthetic custom move (no library id)', sets: 1, reps: '5' },
  ] } });
  await api(apiUrl, 'POST', '/api/programs/workout-assignments', { token, json: { client_id: IDENTITIES['client-1'].profile, workout_id: workout.id } });
  if (media) {
    const M = '/api/exercise-media';
    const full = { x: 0, y: 0, width: 1, height: 1 };
    const publish = async (exerciseId, steps) => {
      let revision = (await api(apiUrl, 'POST', `${M}/exercises/${exerciseId}/drafts`, { token, json: { request_id: randomUUID(), confirm_exercise_id: exerciseId } })).revision;
      for (const [role, file] of steps.uploads) {
        const form = new FormData();
        for (const [k, v] of Object.entries({ request_id: randomUUID(), expected_version: revision.version, rights_basis: 'owned', rights_confirmed: 'true' })) form.append(k, String(v));
        form.append('file', new Blob([fs.readFileSync(path.join(FIXTURES, file))]), file);
        revision = (await api(apiUrl, 'POST', `${M}/revisions/${revision.id}/sources?role=${role}`, { token, form })).revision;
      }
      revision = await api(apiUrl, 'PATCH', `${M}/revisions/${revision.id}/recipe`, { token, json: { expected_version: revision.version, ...steps.recipe } });
      revision = await api(apiUrl, 'POST', `${M}/revisions/${revision.id}/process`, { token, json: { expected_version: revision.version } });
      revision = await waitFor(async () => { const r = await api(apiUrl, 'GET', `${M}/revisions/${revision.id}`, { token }); return r.status === 'ready' ? r : null; }, { timeoutMs: 180_000, intervalMs: 500, what: 'seed processing' });
      revision = await api(apiUrl, 'POST', `${M}/revisions/${revision.id}/review`, { token, json: { expected_version: revision.version, variant_confirmed: true, rights_confirmed: true, content_confirmed: true } });
      await api(apiUrl, 'POST', `${M}/exercises/${exerciseId}/publish`, { token, json: { revision_id: revision.id, expected_current_version: 0 } });
    };
    await publish(ids.split, { uploads: [['source_image', 'split-squat-portrait.jpg']], recipe: { alt_text: 'Synthetic test photo for the split squat identity (portrait source)', cues: ['Synthetic cue'], poster_crop: { x: 0, y: 0.1, width: 1, height: (1080 * 9 / 16) / 1350 } } });
    await publish(ids.row, { uploads: [['source_video', 'band-row.mp4'], ['source_image', 'band-row-thumbnail.png']], recipe: {
      alt_text: 'Synthetic test thumbnail for the band row identity', cues: ['Synthetic cue'], poster_mode: 'uploaded_image', poster_crop: full,
      preview_start_ms: 1000, preview_end_ms: 3000, preview_crop: full, include_instruction: true, caption_language: 'en',
      caption_cues: [{ start_ms: 0, end_ms: 2500, text: 'Synthetic caption one' }, { start_ms: 2500, end_ms: 5500, text: 'Synthetic caption two' }],
      transcript: 'Synthetic transcript for a synthetic clip. Not exercise instruction.',
    } });
    await publish(ids.plank, { uploads: [['source_video', 'plank.webm']], recipe: { alt_text: 'Synthetic start still', end_frame_alt_text: 'Synthetic end still', poster_mode: 'video_frame', poster_frame_ms: 300, poster_crop: full, end_frame_ms: 4900, end_frame_crop: full } });
  }
  return { ids, workout_id: workout.id };
}

async function start() {
  const port = Number(option('--port', '42771'));
  const harness = new MediaHarness({ mediaRoot: path.join(LOCAL_DIR, 'media-dev') });
  let vite;
  const shutdown = async (code = 0) => {
    try {
      if (vite && vite.exitCode === null) { vite.kill('SIGTERM'); await Promise.race([once(vite, 'exit'), new Promise((r) => setTimeout(r, 10_000))]); }
      await harness.down({ keepDatabase: flag('--keep-db') });
      fs.rmSync(RUNTIME, { force: true });
    } catch (error) { console.error('teardown failed:', error.message); code = 1; }
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  try {
    if (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).status === 0) throw new Error(`port ${port} already has a listener; choose another with --port`);
    if (!fs.existsSync(path.join(FIXTURES, 'fixtures-manifest.json'))) {
      const generated = spawnSync(process.execPath, [path.join(ROOT, 'backend/scripts/generate-exercise-media-fixtures.cjs'), FIXTURES], { stdio: 'inherit' });
      if (generated.status !== 0) throw new Error('fixture generation failed');
    }
    await harness.startDatabase({ reset: true });
    await harness.startPostgrest();
    await harness.startGateway();
    harness.seed();
    const frontendOrigin = `http://127.0.0.1:${port}`;
    const apiChild = await harness.startApi({ env: { CORS_ORIGINS: frontendOrigin } });
    await harness.startWorker({ leaseSeconds: 30 });
    const token = await harness.login('coach-a', apiChild.url);
    const seeded = await seed(apiChild.url, token, { media: flag('--seed-media') });
    const out = fs.openSync(path.join(RUN_DIR, `vite-${harness.runId}.log`), 'a', 0o600);
    vite = spawn(process.execPath, [path.join(ROOT, 'frontend/node_modules/vite/bin/vite.js'), '--config', 'vite.media-local.config.mjs', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', out, out],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CVF_MEDIA_LOCAL: MARKER, CVF_MEDIA_DEMO_PASSWORD: harness.password, REACT_APP_BACKEND_URL: apiChild.url, REACT_APP_PREVIEW_MODE: 'false' },
    });
    await waitFor(async () => (await fetch(`${frontendOrigin}/__media-demo`)).ok, { timeoutMs: 120_000, what: 'frontend' });
    harness.writeRuntime({
      launcher: { pid: process.pid, script: 'backend/integration/exercise-media-dev.cjs' },
      frontend: { url: frontendOrigin, pid: vite.pid, port, demo_selector: `${frontendOrigin}/__media-demo` },
      api: { url: apiChild.url }, fixtures: path.relative(ROOT, FIXTURES), seeded,
      note: 'Synthetic local demo. Fictional loopback accounts; no real credentials or hosted services.',
    });
    console.log(`\nSynthetic local demo ready\n  Open ${frontendOrigin}/__media-demo and choose a fictional account.\n  API ${apiChild.url} · runtime ${path.relative(ROOT, RUNTIME)}\n  Stop with Ctrl+C or: npm --prefix backend run dev:media-local:down\n`);
  } catch (error) {
    console.error('exercise media local demo failed to start:', error.message, error.output || '');
    await shutdown(1);
  }
}

if (flag('--down')) down().catch((error) => { console.error(error.message); process.exitCode = 1; });
else if (flag('--status')) { const runtime = readRuntime(); console.log(runtime ? JSON.stringify({ run_id: runtime.run_id, frontend: runtime.frontend?.url, api: runtime.api?.url, started_at: runtime.started_at }, null, 2) : 'not running'); }
else start();
