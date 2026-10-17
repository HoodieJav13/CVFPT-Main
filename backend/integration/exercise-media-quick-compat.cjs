#!/usr/bin/env node
// Exercise media x Quick Sessions compatibility, on real local services. It is
// meaningful only in a tree that contains BOTH features (the disposable PR114
// composition clone); elsewhere it reports "not applicable" and exits 0.
// Proves: Quick create/replay/recovery/start/frozen-edit/save-to-library keep
// working with media enabled; media publication changes the CURRENT guide on a
// started Quick log without touching its receipt, request hash, prescription,
// sets or provenance; ordinary assigned workouts keep their behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { MediaHarness, IDENTITIES, ROOT, LOCAL_DIR, waitFor } = require('./exercise-media-harness.cjs');

if (!fs.existsSync(path.join(ROOT, 'backend/src/lib/quickSessions.js'))) {
  console.log('Quick Sessions are not present in this tree: compatibility test not applicable (run it in the PR114 composition clone).');
  process.exit(0);
}

const FIXTURES = path.join(LOCAL_DIR, 'fixtures');
const results = { schema_version: 1, cases: [], started_at: new Date().toISOString() };
let h; let API; const T = {};
const M = '/api/exercise-media';
const FULL = { x: 0, y: 0, width: 1, height: 1 };

async function check(name, fn) {
  const started = Date.now();
  try { await fn(); } catch (error) { results.cases.push({ name, status: 'FAIL', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
  results.cases.push({ name, status: 'PASS', ms: Date.now() - started });
  console.log(`PASS ${name}`);
}
async function api(method, url, { token, json, form } = {}) {
  const response = await fetch(API + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}) }, body: form || (json ? JSON.stringify(json) : undefined) });
  const body = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  return { status: response.status, body };
}
const sql = (text) => h.psql(text).trim();
const denverToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function publishMedia(exerciseId, { base = null, file, role, recipe }) {
  let revision = (await api('POST', `${M}/exercises/${exerciseId}/drafts`, { token: T['coach-a'], json: { request_id: randomUUID(), confirm_exercise_id: exerciseId, ...(base ? { base_revision_id: base } : {}) } })).body.revision;
  const form = new FormData();
  for (const [k, v] of Object.entries({ request_id: randomUUID(), expected_version: revision.version, rights_basis: 'owned', rights_confirmed: 'true' })) form.append(k, String(v));
  form.append('file', new Blob([fs.readFileSync(path.join(FIXTURES, file))]), file);
  revision = (await api('POST', `${M}/revisions/${revision.id}/sources?role=${role}`, { token: T['coach-a'], form })).body.revision;
  revision = (await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token: T['coach-a'], json: { expected_version: revision.version, ...recipe } })).body;
  revision = (await api('POST', `${M}/revisions/${revision.id}/process`, { token: T['coach-a'], json: { expected_version: revision.version } })).body;
  revision = await waitFor(async () => { const r = (await api('GET', `${M}/revisions/${revision.id}`, { token: T['coach-a'] })).body; return r.status === 'ready' ? r : null; }, { timeoutMs: 180_000, intervalMs: 500, what: 'processing' });
  revision = (await api('POST', `${M}/revisions/${revision.id}/review`, { token: T['coach-a'], json: { expected_version: revision.version, variant_confirmed: true, rights_confirmed: true, content_confirmed: true } })).body;
  const current = Number(sql(`select coalesce((select version from public.exercise_media_current where exercise_library_id = '${exerciseId}'), 0)`));
  const published = await api('POST', `${M}/exercises/${exerciseId}/publish`, { token: T['coach-a'], json: { revision_id: revision.id, expected_current_version: current } });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  return revision;
}

async function main() {
  const head = spawnSync('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n');
  results.tested_source = { head: head[0], tree: head[1] };
  if (!fs.existsSync(path.join(FIXTURES, 'fixtures-manifest.json'))) {
    assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'backend/scripts/generate-exercise-media-fixtures.cjs'), FIXTURES], { stdio: 'inherit' }).status, 0);
  }
  h = new MediaHarness({ mediaRoot: path.join(LOCAL_DIR, `media-compat-${Date.now()}`) });
  await h.startDatabase({ reset: true });
  await h.startPostgrest();
  await h.startGateway();
  h.seed();
  API = (await h.startApi({ env: { EXERCISE_MEDIA_UPLOADS_PER_WINDOW: '100' } })).url;
  await h.startWorker({ leaseSeconds: 15 });
  for (const key of Object.keys(IDENTITIES)) T[key] = await h.login(key, API);

  const goblet = (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell' } })).body.id;
  const row = (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Band Row', category: 'Synthetic', equipment: 'Band' } })).body.id;
  let photo;
  await check('media publishes in the combined tree (photo-only)', async () => {
    photo = await publishMedia(goblet, { file: 'goblet-squat-photo.jpg', role: 'source_image', recipe: { alt_text: 'Synthetic test photo', poster_crop: FULL } });
  });

  const requestId = randomUUID();
  const quickBody = { request_id: requestId, client_id: IDENTITIES['client-1'].profile, assigned_for: denverToday(), name: 'Synthetic quick session', notes: 'Synthetic', exercises: [
    { exercise_library_id: goblet, sets: '2', reps: '8' }, { exercise_library_id: row, sets: '2', reps: '10' }, { custom_name: 'Synthetic custom move', sets: '1', reps: '5' },
  ] };
  let quick; let receiptBefore;
  await check('Quick create, replay and recovery are unchanged by media', async () => {
    const created = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: quickBody });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    quick = created.body.assignment;
    assert.equal(quick.kind, 'quick');
    const replay = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: quickBody });
    assert.equal(replay.status, 200); assert.equal(replay.body.state, 'replayed'); assert.equal(replay.body.assignment.id, quick.id);
    const mismatch = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: { ...quickBody, name: 'Changed' } });
    assert.equal(mismatch.status, 409);
    const recovered = await api('GET', `/api/programs/quick-sessions/requests/${requestId}`, { token: T['coach-a'] });
    assert.equal(recovered.status, 200); assert.equal(recovered.body.assignment.id, quick.id);
    receiptBefore = sql(`select to_jsonb(w) - 'updated_at' from public.workout_assignments w where id = '${quick.id}'`);
    assert.match(receiptBefore, /"create_request_hash": "v[0-9]+:[0-9a-f]{64}"/);
  });

  let quickLog; let snapshotBefore;
  await check('client starts the Quick session: provenance and current media coexist', async () => {
    const started = await api('POST', '/api/workout-logs/start', { token: T['client-1'], json: { workout_assignment_id: quick.id } });
    assert.ok([200, 201].includes(started.status), JSON.stringify(started.body));
    quickLog = started.body.workout_log;
    const detail = (await api('GET', `/api/workout-logs/${quickLog.id}`, { token: T['client-1'] })).body;
    assert.equal(detail.workout_assignment_kind, 'quick');
    const gobletRow = detail.exercises.find((e) => e.exercise_library_id === goblet);
    assert.equal(gobletRow.media.kind, 'photo'); assert.equal(gobletRow.media.revision_id, photo.id);
    assert.equal(detail.exercises.find((e) => e.exercise_library_id === row).media, null);
    const set = gobletRow.sets[0];
    assert.equal((await api('PATCH', `/api/workout-logs/${quickLog.id}/sets/${set.id}`, { token: T['client-1'], json: { status: 'completed', actual_reps: 8, actual_load_value: 16, actual_load_unit: 'kg' } })).status, 200);
    snapshotBefore = sql(`select jsonb_agg(to_jsonb(e) - 'updated_at' order by e.position) from public.workout_log_exercises e where workout_log_id = '${quickLog.id}'`);
    const assigned = (await api('GET', '/api/programs/client/assigned', { token: T['client-1'] })).body;
    const listed = assigned.workouts.find((w) => w.id === quick.id);
    assert.equal(listed.kind, 'quick'); assert.equal(typeof listed.quick_session_completed, 'boolean');
    assert.equal(listed.workout.exercises.find((e) => e.exercise_library_id === goblet).media.kind, 'photo');
  });

  await check('started Quick prescription stays frozen while media stays live', async () => {
    const workout = (await api('GET', `/api/programs/workouts/${quick.workout_id}`, { token: T['coach-a'] })).body;
    const edit = await api('PUT', `/api/programs/workouts/${quick.workout_id}`, { token: T['coach-a'], json: { name: workout.name, exercises: workout.exercises.map((e) => ({ ...e, reps: '12' })) } });
    assert.equal(edit.status, 409, JSON.stringify(edit.body)); assert.equal(edit.body.code, 'quick_session_started');
    const video = await publishMedia(goblet, { base: photo.id, file: 'goblet-squat-replacement.mp4', role: 'source_video', recipe: { preview_start_ms: 0, preview_end_ms: 2000, preview_crop: FULL } });
    const detail = (await api('GET', `/api/workout-logs/${quickLog.id}`, { token: T['client-1'] })).body;
    const gobletRow = detail.exercises.find((e) => e.exercise_library_id === goblet);
    assert.equal(gobletRow.media.kind, 'video'); assert.equal(gobletRow.media.revision_id, video.id);
    assert.equal(sql(`select to_jsonb(w) - 'updated_at' from public.workout_assignments w where id = '${quick.id}'`), receiptBefore, 'receipt and request hash byte-stable');
    assert.equal(sql(`select jsonb_agg(to_jsonb(e) - 'updated_at' order by e.position) from public.workout_log_exercises e where workout_log_id = '${quickLog.id}'`), snapshotBefore, 'log snapshot unchanged');
    assert.equal(sql(`select count(*) from public.workout_exercises where workout_id = '${quick.workout_id}' and reps = '12'`), '0', 'prescription unchanged');
    const replay = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: quickBody });
    assert.equal(replay.body.state, 'replayed'); assert.equal(replay.body.assignment.id, quick.id);
  });

  await check('save-to-library and ordinary assignments keep working; media follows the canonical exercise', async () => {
    const saved = await api('POST', `/api/programs/quick-sessions/${quick.id}/save-to-library`, { token: T['coach-a'] });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal((await api('POST', `/api/programs/quick-sessions/${quick.id}/save-to-library`, { token: T['coach-a'] })).body.state, 'replayed');
    const resolved = await api('POST', `${M}/resolve`, { token: T['coach-a'], json: { context: { type: 'workout', id: saved.body.template_id } } });
    assert.equal(resolved.status, 200); assert.equal(resolved.body.media.length, 1);
    assert.equal((await api('POST', `/api/workout-logs/${quickLog.id}/complete`, { token: T['client-1'], json: { notes: '', feedback: '', completed_at_local: new Date().toISOString() } })).status, 200);
    const completed = (await api('GET', `/api/workout-logs/${quickLog.id}`, { token: T['client-1'] })).body;
    assert.equal(completed.status, 'completed'); assert.equal(completed.workout_assignment_kind, 'quick');
    assert.equal(completed.exercises.find((e) => e.exercise_library_id === goblet).media.kind, 'video', 'history shows the current guide');
    const ordinary = (await api('POST', '/api/programs/workouts', { token: T['coach-a'], json: { name: 'Synthetic ordinary', exercises: [{ exercise_library_id: goblet, sets: 1, reps: '5' }] } })).body;
    const assignment = (await api('POST', '/api/programs/workout-assignments', { token: T['coach-a'], json: { client_id: IDENTITIES['client-1'].profile, workout_id: ordinary.id } })).body;
    const log = (await api('POST', '/api/workout-logs/start', { token: T['client-1'], json: { workout_assignment_id: assignment.id } })).body.workout_log;
    const detail = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body;
    assert.equal(detail.workout_assignment_kind, 'assigned');
    assert.equal(detail.exercises[0].media.kind, 'video');
  });
  results.passed = results.cases.length;
}

main()
  .then(() => console.log(`EXERCISE MEDIA x QUICK COMPATIBILITY: ${results.passed} cases PASS`))
  .catch((error) => { console.error('EXERCISE MEDIA x QUICK COMPATIBILITY FAILED:', error.message, error.output || ''); process.exitCode = 1; results.error = error.message; })
  .finally(async () => {
    fs.mkdirSync(path.join(LOCAL_DIR, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, 'evidence', 'quick-compat-results.json'), `${JSON.stringify(results, null, 2)}\n`);
    if (h) { try { await h.down(); } catch (error) { console.error('teardown failed', error.message); process.exitCode = 1; } }
  });
