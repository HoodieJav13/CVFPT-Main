#!/usr/bin/env node
// Exercise guides (photo + YouTube) on real local services: HTTP -> Express ->
// PostgREST -> SQL (disposable owned stack) with the fictional loopback auth
// gateway. LOCAL ONLY; synthetic identities and links; the API child runs with
// the loopback network guard, so no provider is ever contacted.
//   node integration/exercise-guides-local.cjs            # run, then tear the owned stack down
//   node integration/exercise-guides-local.cjs --keep-db  # leave the database for inspection
// Proves (docs/exercise-guides/design.md):
//  - photos mode (the default) needs NO FFmpeg worker: durable intent before a
//    grant, direct staging PUT, authoritative finalize (sniff + full decode +
//    digest), forged bytes refused, inline leased processing, review/publish,
//    live re-authorization of every GET/HEAD/Range, replacement keeping the old
//    current guide until publication, withdrawal and resume after a dead request;
//  - inheriting references follow a library link replacement through workout,
//    client assignment and live log reads; overrides and NULL legacy rows stay;
//    no prescription, snapshot or workout row is rewritten;
//  - coach edit round trips, template saves, client clones, Quick library saves
//    and imports preserve the intended mode without copying library links;
//  - Quick create keeps the exact v1 wire/hash contract: derived modes on fresh
//    rows only, committed same-request replay after a library replacement returns
//    the same receipt with no writes, a different video_url mismatches, and a mode
//    key is rejected.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { MediaHarness, IDENTITIES, ROOT, LOCAL_DIR } = require('./exercise-media-harness.cjs');
const { createHash } = require('node:crypto');
const { normalizeQuickSessionCreate, quickSessionHash } = require('../src/lib/quickSessions');

const KEEP = process.argv.includes('--keep-db');
// --baseline: run ONLY the Quick v1 replay contract with mode-agnostic assertions,
// from a clean export of the pre-change tree (RED/compat "before" evidence).
const BASELINE = process.argv.includes('--baseline');
const RESULTS = path.join(LOCAL_DIR, 'exercise-guides-results.json');
const results = { schema_version: 1, suite: 'exercise-guides-local', cases: [], started_at: new Date().toISOString() };
const LIB_A = 'https://youtu.be/AAAAAAAAAAA';
const LIB_B = 'https://www.youtube.com/watch?v=BBBBBBBBBBB';
const OVERRIDE = 'https://youtu.be/CCCCCCCCCCC';
const LEGACY = 'https://example.com/synthetic-legacy-demo';
let h; let API; const T = {};

async function check(name, fn) {
  const started = Date.now();
  try { await fn(); } catch (error) { results.cases.push({ name, status: 'FAIL', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
  results.cases.push({ name, status: 'PASS', ms: Date.now() - started });
  console.log(`PASS ${name}`);
}
async function api(method, url, { token, json, headers = {}, raw } = {}) {
  const response = await fetch(API + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw || (json ? JSON.stringify(json) : undefined) });
  const type = response.headers.get('content-type') || '';
  const body = method === 'HEAD' ? null : (type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()));
  return { status: response.status, body, headers: response.headers };
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const M = '/api/exercise-media';
const FULL = { x: 0, y: 0, width: 1, height: 1 };
const PHOTOS = path.join(LOCAL_DIR, 'fixtures-photos');
const sql = (text) => h.psql(text).trim();
const json = (text) => JSON.parse(sql(text) || 'null');
const modes = (workoutId) => BASELINE ? null : modesNow(workoutId);
const modesNow = (workoutId) => json(`select coalesce(jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position), '[]') from public.workout_exercises where workout_id = '${workoutId}' and not archived`);
const denverToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let plainLibraryId = null;
const plainLibrary = () => plainLibraryId;

async function main() {
  const head = spawnSync('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n');
  results.tested_source = { head: head[0], tree: head[1], worktree_dirty: spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() !== '' };
  if (!BASELINE && !fs.existsSync(path.join(PHOTOS, 'fixtures-manifest.json'))) {
    assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'backend/scripts/generate-exercise-media-fixtures.cjs'), PHOTOS, '--images-only'], { stdio: 'inherit' }).status, 0);
  }
  h = new MediaHarness({ mediaRoot: path.join(LOCAL_DIR, `media-guides-${Date.now()}`), mode: 'photos' });
  await h.startDatabase({ reset: true });
  await h.startPostgrest();
  await h.startGateway();
  h.seed();
  API = (await h.startApi({ media: !BASELINE })).url;
  for (const key of (BASELINE ? ['coach-a', 'client-1'] : Object.keys(IDENTITIES))) T[key] = await h.login(key, API);
  const client = IDENTITIES['client-1'].profile;

  if (BASELINE) { await quickReplay({ lib: null, client }); return; }
  const lib = (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Guide Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', video_url: LIB_A } })).body;
  const plain = (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Guide Band Row', category: 'Synthetic', equipment: 'Band' } })).body;
  assert.ok(lib.id && plain.id, 'library exercises created');
  plainLibraryId = plain.id;

  let template; let assignment; let log; let snapshotBefore;
  await check('new workouts store explicit modes; old request shapes stay unclassified legacy', async () => {
    const created = await api('POST', '/api/programs/workouts', { token: T['coach-a'], json: { name: 'Synthetic guide template', exercises: [
      { exercise_library_id: lib.id, custom_name: lib.name, sets: '3', reps: '8', video_link_mode: 'inherit', video_url: '' },
      { exercise_library_id: lib.id, custom_name: lib.name, sets: '2', reps: '5', video_link_mode: 'override', video_url: OVERRIDE },
      // Old browser shape (no key) that copied a link: preserved as NULL legacy, never guessed.
      { exercise_library_id: lib.id, custom_name: lib.name, sets: '1', reps: '5', video_url: LEGACY },
      // Old browser shape with no link: NULL legacy that still falls back to the library.
      { exercise_library_id: plain.id, custom_name: plain.name, sets: '2', reps: '10', video_url: '' },
    ] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    template = created.body;
    assert.deepEqual(modes(template.id), [['inherit', null], ['override', OVERRIDE], [null, LEGACY], [null, null]]);
    assert.deepEqual(template.exercises.map((row) => row.demo && [row.demo.source, row.demo.video_id || row.demo.url]), [
      ['library', 'AAAAAAAAAAA'], ['override', 'CCCCCCCCCCC'], ['legacy', LEGACY], null,
    ]);
    const invalid = await api('POST', '/api/programs/workouts', { token: T['coach-a'], json: { name: 'Synthetic invalid', exercises: [{ exercise_library_id: lib.id, video_link_mode: 'inherit', video_url: OVERRIDE }] } });
    assert.equal(invalid.status, 400);
  });

  await check('a coach edit round trip (open + save) never freezes the inherited link', async () => {
    const opened = (await api('GET', `/api/programs/workouts/${template.id}`, { token: T['coach-a'] })).body;
    // What the editor sends: the stored mode and URL, never the library link.
    const exercises = opened.exercises.map((row) => ({ id: row.id, exercise_library_id: row.exercise_library_id, custom_name: row.custom_name, sets: row.sets, reps: row.reps, video_link_mode: row.video_link_mode ?? null, video_url: row.video_url || '' }));
    const saved = await api('PUT', `/api/programs/workouts/${template.id}`, { token: T['coach-a'], json: { name: opened.name, exercises } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(modes(template.id), [['inherit', null], ['override', OVERRIDE], [null, LEGACY], [null, null]]);
  });

  await check('assignment clone and client start keep inheritance live', async () => {
    const hidden = await api('PATCH', `/api/programs/workouts/${template.id}/hidden`, { token: T['coach-a'], json: { hidden: false } });
    assert.ok([200, 404].includes(hidden.status));
    const assigned = await api('POST', '/api/programs/workout-assignments', { token: T['coach-a'], json: { client_id: client, workout_id: template.id, assignment_mode: 'active' } });
    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    assignment = assigned.body;
    assert.deepEqual(modes(assignment.workout_id), [['inherit', null], ['override', OVERRIDE], [null, LEGACY], [null, null]]);
    const started = await api('POST', '/api/workout-logs/start', { token: T['client-1'], json: { workout_assignment_id: assignment.id } });
    assert.ok([200, 201].includes(started.status), JSON.stringify(started.body));
    log = started.body.workout_log;
    const detail = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body;
    assert.deepEqual(detail.exercises.map((row) => row.demo && row.demo.source), ['library', 'override', 'legacy', null]);
    assert.equal(detail.exercises[0].demo.video_id, 'AAAAAAAAAAA');
    assert.equal(detail.exercises[0].video_url, LIB_A);
    snapshotBefore = sql(`select jsonb_agg(to_jsonb(e) - 'updated_at' order by e.position) from public.workout_log_exercises e where workout_log_id = '${log.id}'`);
  });

  await check('a library replacement propagates to inheriting references only; nothing is rewritten', async () => {
    const rowsBefore = sql(`select jsonb_agg(to_jsonb(we) order by we.id) from public.workout_exercises we`);
    const replaced = await api('PUT', `/api/programs/exercise-library/${lib.id}`, { token: T['coach-a'], json: { video_url: LIB_B } });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    const added = await api('PUT', `/api/programs/exercise-library/${plain.id}`, { token: T['coach-a'], json: { video_url: LIB_A } });
    assert.equal(added.status, 200);
    assert.equal(sql(`select jsonb_agg(to_jsonb(we) order by we.id) from public.workout_exercises we`), rowsBefore, 'no workout row rewritten');
    const coachView = (await api('GET', `/api/programs/workouts/${template.id}`, { token: T['coach-a'] })).body;
    assert.deepEqual(coachView.exercises.map((row) => row.demo && (row.demo.video_id || row.demo.url)), ['BBBBBBBBBBB', 'CCCCCCCCCCC', LEGACY, 'AAAAAAAAAAA']);
    const assigned = (await api('GET', '/api/programs/client/assigned', { token: T['client-1'] })).body;
    const rows = assigned.workouts.find((row) => row.id === assignment.id).workout.exercises;
    assert.deepEqual(rows.map((row) => row.demo && [row.demo.source, row.demo.video_id || row.demo.url]), [
      ['library', 'BBBBBBBBBBB'], ['override', 'CCCCCCCCCCC'], ['legacy', LEGACY], ['library', 'AAAAAAAAAAA'],
    ]);
    for (const row of rows) assert.equal('video_link_mode' in row, false, 'client DTO omits the internal mode');
    const detail = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body;
    assert.deepEqual(detail.exercises.map((row) => row.demo && (row.demo.video_id || row.demo.url)), ['BBBBBBBBBBB', 'CCCCCCCCCCC', LEGACY, 'AAAAAAAAAAA']);
    assert.equal(sql(`select jsonb_agg(to_jsonb(e) - 'updated_at' order by e.position) from public.workout_log_exercises e where workout_log_id = '${log.id}'`), snapshotBefore, 'log snapshot unchanged');
  });

  await check('a deliberate Use library demo choice reclassifies one legacy row; others stay', async () => {
    const opened = (await api('GET', `/api/programs/workouts/${template.id}`, { token: T['coach-a'] })).body;
    const exercises = opened.exercises.map((row, index) => ({ id: row.id, exercise_library_id: row.exercise_library_id, custom_name: row.custom_name, sets: row.sets, reps: row.reps,
      ...(index === 2 ? { video_link_mode: 'inherit', video_url: '' } : { video_link_mode: row.video_link_mode ?? null, video_url: row.video_url || '' }) }));
    const saved = await api('PUT', `/api/programs/workouts/${template.id}`, { token: T['coach-a'], json: { name: opened.name, exercises } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(modes(template.id), [['inherit', null], ['override', OVERRIDE], ['inherit', null], [null, null]]);
    const edited = await api('PUT', `/api/programs/workouts/${template.id}`, { token: T['coach-a'], json: { name: opened.name, exercises: exercises.map((row, index) => (index === 3 ? { ...row, video_link_mode: null, video_url: OVERRIDE } : row)) } });
    assert.equal(edited.status, 400, 'an edited unclassified link must be classified');
  });

  await check('template copies and imports preserve the intended mode', async () => {
    const copy = await api('POST', `/api/programs/workouts/${template.id}/save-as-template`, { token: T['coach-a'], json: { name: 'Synthetic guide copy' } });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    assert.deepEqual(modes(copy.body.id), modes(template.id));
    const imported = await api('POST', '/api/programs/import/commit', { token: T['coach-a'], json: { draft: {
      program: { name: 'Synthetic guide import', frequency_days: 1 }, import_meta: { source_type: 'paste' },
      days: [{ day_number: 1, name: 'Day 1', exercises: [
        { name: lib.name, sets: '3', reps: '8' },
        { name: lib.name, sets: '3', reps: '8', video_url: OVERRIDE },
      ] }],
    } } });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    const workoutId = imported.body.program.days[0].workout_id;
    assert.deepEqual(modes(workoutId), [['inherit', null], ['override', OVERRIDE]]);
  });

  await quickReplay({ lib, client });
  await photoPipeline({ lib, log });
}

// Direct-upload grant transport as a browser would use it.
async function uploadPhoto(revision, file, { requestId = randomUUID(), bytes = fs.readFileSync(path.join(PHOTOS, file)), mime = 'image/jpeg' } = {}) {
  const issued = await api('POST', `${M}/revisions/${revision.id}/uploads`, { token: T['coach-a'], json: { request_id: requestId, role: 'source_image', bytes: bytes.length, mime_type: mime, expected_version: revision.version, rights_confirmed: true } });
  assert.ok([200, 201].includes(issued.status), JSON.stringify(issued.body));
  assert.equal(sql(`select state from public.exercise_media_upload_intents where id = '${issued.body.intent.id}'`), 'issued', 'intent persisted before the grant was used');
  const put = await api('PUT', issued.body.upload.url, { headers: issued.body.upload.headers, raw: bytes });
  assert.ok([200, 201].includes(put.status), `staging PUT ${put.status}`);
  const finalized = await api('POST', `${M}/revisions/${revision.id}/uploads/${issued.body.intent.id}/finalize`, { token: T['coach-a'], json: { expected_version: revision.version, rights_basis: 'owned', rights_confirmed: 'true', original_name: file } });
  return { issued: issued.body, finalized, bytes };
}

async function readyPhoto(exerciseId, file, { base = null, mime, crop = FULL } = {}) {
  let revision = (await api('POST', `${M}/exercises/${exerciseId}/drafts`, { token: T['coach-a'], json: { request_id: randomUUID(), confirm_exercise_id: exerciseId, ...(base ? { base_revision_id: base } : {}) } })).body.revision;
  const { finalized } = await uploadPhoto(revision, file, { mime });
  assert.equal(finalized.status, 201, JSON.stringify(finalized.body));
  revision = finalized.body.revision;
  revision = (await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token: T['coach-a'], json: { expected_version: revision.version, alt_text: 'Synthetic test photo (not instruction)', cues: ['Synthetic cue one', 'Synthetic cue two'], poster_crop: crop } })).body;
  assert.ok(Number.isInteger(revision.version), JSON.stringify(revision));
  return revision;
}

async function publishReady(exerciseId, revision) {
  revision = (await api('POST', `${M}/revisions/${revision.id}/review`, { token: T['coach-a'], json: { expected_version: revision.version, variant_confirmed: true, rights_confirmed: true, content_confirmed: true } })).body;
  const current = Number(sql(`select coalesce((select version from public.exercise_media_current where exercise_library_id = '${exerciseId}'), 0)`));
  const published = await api('POST', `${M}/exercises/${exerciseId}/publish`, { token: T['coach-a'], json: { revision_id: revision.id, expected_current_version: current } });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  return revision;
}

async function photoPipeline({ lib, log }) {
  const measures = {};
  await check('photos mode needs no worker: capabilities report image-only grant transport and inline processing', async () => {
    assert.deepEqual([...h.children.keys()], ['api'], 'no worker process was started');
    const caps = (await api('GET', `${M}/capabilities`, { token: T['coach-a'] })).body;
    assert.deepEqual([caps.enabled, caps.mode, caps.video_sources, caps.upload_transport, caps.processing], [true, 'photos', false, 'grant', 'inline']);
    assert.equal(caps.limits.image.max_bytes, 10 * 1024 * 1024);
  });

  await check('forged bytes and mismatched files never attach; video sources are refused', async () => {
    const draft = (await api('POST', `${M}/exercises/${lib.id}/drafts`, { token: T['coach-a'], json: { request_id: randomUUID(), confirm_exercise_id: lib.id } })).body.revision;
    const forged = await uploadPhoto(draft, 'forged.jpg', { bytes: Buffer.from('<!doctype html><script>alert(1)</script>') });
    assert.equal(forged.finalized.status, 415, JSON.stringify(forged.finalized.body));
    const truncated = fs.readFileSync(path.join(PHOTOS, 'goblet-squat-photo.jpg')).subarray(0, 5000);
    const broken = await uploadPhoto(draft, 'broken.jpg', { bytes: truncated });
    assert.equal(broken.finalized.status, 422, JSON.stringify(broken.finalized.body));
    assert.equal(sql(`select count(*) from public.exercise_media_assets where revision_id = '${draft.id}'`), '0');
    const video = await api('POST', `${M}/revisions/${draft.id}/uploads`, { token: T['coach-a'], json: { request_id: randomUUID(), role: 'source_video', bytes: 1000, mime_type: 'video/mp4', expected_version: draft.version, rights_confirmed: true } });
    assert.equal(video.status, 409);
    assert.equal(video.body.code, 'video_sources_disabled');
    const other = await api('POST', `${M}/revisions/${draft.id}/uploads`, { token: T['coach-b'], json: { request_id: randomUUID(), role: 'source_image', bytes: 1000, mime_type: 'image/jpeg', expected_version: draft.version, rights_confirmed: true } });
    assert.equal(other.status, 404, 'another coach cannot upload into this draft');
    await api('POST', `${M}/revisions/${draft.id}/archive`, { token: T['coach-a'], json: {} });
  });

  let first; let posterId;
  await check('grant -> direct PUT -> authoritative finalize; double finalize replays; inline processing without a worker', async () => {
    let revision = (await api('POST', `${M}/exercises/${lib.id}/drafts`, { token: T['coach-a'], json: { request_id: randomUUID(), confirm_exercise_id: lib.id } })).body.revision;
    const upload = await uploadPhoto(revision, 'goblet-squat-photo.jpg');
    assert.equal(upload.finalized.status, 201, JSON.stringify(upload.finalized.body));
    const intentId = upload.issued.intent.id;
    const asset = json(`select to_jsonb(a) from public.exercise_media_assets a where id = '${intentId}'`);
    assert.equal(asset.sha256, sha(upload.bytes));
    assert.equal(asset.storage_key, `sources/${intentId}.jpg`);
    assert.equal(sql(`select state from public.exercise_media_upload_intents where id = '${intentId}'`), 'attached');
    const replay = await api('POST', `${M}/revisions/${revision.id}/uploads/${intentId}/finalize`, { token: T['coach-a'], json: { expected_version: upload.finalized.body.revision.version, rights_basis: 'owned', rights_confirmed: 'true' } });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(sql(`select count(*) from public.exercise_media_assets where revision_id = '${revision.id}' and role = 'source_image' and not archived`), '1');
    revision = (await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token: T['coach-a'], json: { expected_version: upload.finalized.body.revision.version, alt_text: 'Synthetic test photo (not instruction)', cues: ['Synthetic cue one'], poster_crop: FULL } })).body;
    const started = Date.now();
    const processed = await api('POST', `${M}/revisions/${revision.id}/process`, { token: T['coach-a'], json: { expected_version: revision.version } });
    measures.inline_process_request_ms = Date.now() - started;
    assert.equal(processed.status, 200, JSON.stringify(processed.body));
    assert.equal(processed.body.status, 'ready', 'rendered inline in the same request');
    const job = json(`select to_jsonb(j) from public.exercise_media_jobs j where revision_id = '${revision.id}'`);
    assert.deepEqual([job.state, job.attempts], ['succeeded', 1]);
    const poster = json(`select to_jsonb(a) from public.exercise_media_assets a where revision_id = '${revision.id}' and role = 'poster' and not archived`);
    assert.ok(poster.bytes <= 160 * 1024);
    assert.match(poster.processor_version, /^sharp 0\.35\.5 \/ libvips /);
    measures.poster_bytes = Number(poster.bytes);
    measures.source_bytes = upload.bytes.length;
    first = await publishReady(lib.id, processed.body);
    posterId = poster.id;
  });

  await check('clients get current derivatives only, re-authorized on every GET/HEAD/Range; originals stay uploader/admin-only', async () => {
    const detail = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body;
    const row = detail.exercises.find((e) => e.exercise_library_id === lib.id);
    assert.equal(row.media.kind, 'photo');
    assert.equal(row.media.poster.asset_id, posterId);
    assert.deepEqual(row.media.cues, ['Synthetic cue one']);
    assert.equal(JSON.stringify(row.media).includes('sources/'), false, 'no source key in the client DTO');
    const context = { type: 'workout_log', id: log.id };
    const links = await api('POST', `${M}/links`, { token: T['client-1'], json: { context, assets: [{ asset_id: posterId }] } });
    assert.equal(links.status, 200, JSON.stringify(links.body));
    const url = links.body.links[0].url;
    const got = await api('GET', url);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/jpeg');
    assert.equal(got.body.length, measures.poster_bytes);
    const head = await api('HEAD', url);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(measures.poster_bytes));
    const range = await api('GET', url, { headers: { range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal(range.body.length, 100);
    assert.equal((await api('POST', `${M}/links`, { token: T['client-2'], json: { context, assets: [{ asset_id: posterId }] } })).status, 404, 'another client');
    const source = sql(`select id from public.exercise_media_assets where revision_id = '${first.id}' and role = 'source_image' and not archived`);
    const revisionContext = { type: 'revision', id: first.id };
    assert.equal((await api('POST', `${M}/links`, { token: T['coach-b'], json: { context: revisionContext, assets: [{ asset_id: source }] } })).status, 404, 'other coach cannot read the original');
    assert.equal((await api('POST', `${M}/links`, { token: T['admin'], json: { context: revisionContext, assets: [{ asset_id: source }] } })).status, 200, 'admin may');
    assert.equal((await api('POST', `${M}/links`, { token: T['coach-a'], json: { context: revisionContext, assets: [{ asset_id: source }] } })).status, 200, 'uploader may');
  });

  await check('a replacement leaves the old photo current until its own review and publication', async () => {
    const replacement = await readyPhoto(lib.id, 'goblet-squat-photo.webp', { base: first.id, mime: 'image/webp' });
    const processed = (await api('POST', `${M}/revisions/${replacement.id}/process`, { token: T['coach-a'], json: { expected_version: replacement.version } })).body;
    assert.equal(processed.status, 'ready');
    const before = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body.exercises.find((e) => e.exercise_library_id === lib.id);
    assert.equal(before.media.revision_id, first.id, 'still the published guide');
    await publishReady(lib.id, processed);
    const after = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body.exercises.find((e) => e.exercise_library_id === lib.id);
    assert.equal(after.media.revision_id, replacement.id);
    first = replacement;
  });

  await check('withdrawal between capability issue and GET is enforced', async () => {
    const detail = (await api('GET', `/api/workout-logs/${log.id}`, { token: T['client-1'] })).body.exercises.find((e) => e.exercise_library_id === lib.id);
    const link = (await api('POST', `${M}/links`, { token: T['client-1'], json: { context: { type: 'workout_log', id: log.id }, assets: [{ asset_id: detail.media.poster.asset_id }] } })).body.links[0].url;
    assert.equal((await api('GET', link)).status, 200);
    const current = Number(sql(`select version from public.exercise_media_current where exercise_library_id = '${lib.id}'`));
    assert.equal((await api('POST', `${M}/revisions/${first.id}/archive`, { token: T['coach-a'], json: { expected_current_version: current } })).status, 200);
    assert.equal((await api('GET', link)).status, 404, 'withdrawn bytes are no longer served');
    assert.equal((await api('HEAD', link)).status, 404);
  });

  await check('a request that dies mid-render leaves a lease; resume processes the same version after expiry', async () => {
    // Portrait source (EXIF orientation 6): a 16:9 band in ORIENTED coordinates.
    const revision = await readyPhoto(plainLibrary(), 'split-squat-portrait.jpg', { crop: { x: 0, y: 0.1, width: 1, height: (1080 * 9 / 16) / 1350 } });
    const coach = IDENTITIES['coach-a'].profile;
    // The "dead" request: queued and claimed under a lease, then nothing more.
    assert.equal(json(`select public.exercise_media_request_processing('${coach}', '${revision.id}', ${revision.version})`).outcome, 'queued');
    assert.equal(json(`select public.exercise_media_claim_revision_job('${coach}', '${revision.id}', 'dead-request', 30)`).outcome, 'claimed');
    const busy = await api('POST', `${M}/revisions/${revision.id}/process/resume`, { token: T['coach-a'] });
    assert.equal(busy.body.status, 'processing', 'a live lease is not stolen');
    sql(`update public.exercise_media_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where revision_id = '${revision.id}'`);
    const resumed = await api('POST', `${M}/revisions/${revision.id}/process/resume`, { token: T['coach-a'] });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.status, 'ready');
    assert.equal(json(`select to_jsonb(j) from public.exercise_media_jobs j where revision_id = '${revision.id}'`).attempts, 2);
    assert.equal((await api('POST', `${M}/revisions/${revision.id}/process/resume`, { token: T['coach-b'] })).status, 404);
  });
  results.measures = measures;
}

async function quickReplay({ lib: existing, client }) {
  const lib = existing || (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Guide Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', video_url: LIB_A } })).body;
  await check(`Quick create: exact v1 hash${BASELINE ? '' : ', derived fresh-row modes'}, committed replay after replacement, no writes`, async () => {
    const body = { request_id: randomUUID(), client_id: client, assigned_for: denverToday(), name: 'Synthetic quick guides', notes: '', exercises: [
      { exercise_library_id: lib.id, custom_name: lib.name, sets: '3', reps: '8' },
      { exercise_library_id: lib.id, custom_name: lib.name, sets: '2', reps: '5', video_url: OVERRIDE },
      { custom_name: 'Synthetic quick custom', sets: '1', reps: '5' },
    ] };
    const rejected = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: { ...body, exercises: [{ ...body.exercises[0], video_link_mode: 'inherit' }] } });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /video_link_mode/);
    assert.equal(sql(`select count(*) from public.workout_assignments where create_request_id = '${body.request_id}'`), '0', 'rejected mode key wrote nothing');

    const created = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const quick = created.body.assignment;
    const expectedHash = quickSessionHash(normalizeQuickSessionCreate(body, { today: denverToday() }).payload);
    assert.match(expectedHash, /^v1:[0-9a-f]{64}$/);
    assert.equal(sql(`select create_request_hash from public.workout_assignments where id = '${quick.id}'`), expectedHash);
    if (!BASELINE) assert.deepEqual(modes(quick.workout_id), [['inherit', null], ['override', OVERRIDE], [null, null]]);

    await api('PUT', `/api/programs/exercise-library/${lib.id}`, { token: T['coach-a'], json: { video_url: LIB_A } });
    const countBefore = sql('select count(*) from public.workout_exercises');
    const rowsBefore = sql(`select jsonb_agg(to_jsonb(we) order by we.position) from public.workout_exercises we where workout_id = '${quick.workout_id}'`);
    const receiptBefore = sql(`select to_jsonb(w) - 'updated_at' from public.workout_assignments w where id = '${quick.id}'`);
    const replay = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: body });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.state, 'replayed');
    assert.equal(replay.body.assignment.id, quick.id);
    assert.equal(sql('select count(*) from public.workout_exercises'), countBefore, 'replay inserted nothing');
    assert.equal(sql(`select jsonb_agg(to_jsonb(we) order by we.position) from public.workout_exercises we where workout_id = '${quick.workout_id}'`), rowsBefore, 'replay rewrote nothing');
    assert.equal(sql(`select to_jsonb(w) - 'updated_at' from public.workout_assignments w where id = '${quick.id}'`), receiptBefore, 'receipt unchanged');
    if (!BASELINE) assert.equal(replay.body.assignment.workout.exercises[0].demo.video_id, 'AAAAAAAAAAA', 'inherited demo is current');
    const mismatch = await api('POST', '/api/programs/quick-sessions', { token: T['coach-a'], json: { ...body, exercises: [{ ...body.exercises[0], video_url: LIB_A }, ...body.exercises.slice(1)] } });
    assert.equal(mismatch.status, 409, 'a genuinely different existing video_url mismatches');

    const library = await api('POST', `/api/programs/quick-sessions/${quick.id}/save-to-library`, { token: T['coach-a'] });
    assert.equal(library.status, 201, JSON.stringify(library.body));
    if (!BASELINE) assert.deepEqual(modes(library.body.template_id), [['inherit', null], ['override', OVERRIDE], [null, null]]);
  });
}

main().then(async () => {
  results.finished_at = new Date().toISOString();
  results.status = 'PASS';
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`exercise guides local integration passed (${results.cases.length} cases)`);
  await h.down({ keepDatabase: KEEP });
}).catch(async (error) => {
  results.finished_at = new Date().toISOString();
  results.status = 'FAIL';
  try { fs.mkdirSync(LOCAL_DIR, { recursive: true }); fs.writeFileSync(RESULTS, `${JSON.stringify(results, null, 2)}\n`); } catch { /* best effort */ }
  console.error(error.output || error.stack || error.message);
  if (h) await h.down({ keepDatabase: KEEP }).catch((downError) => console.error(`teardown failed: ${downError.message}`));
  process.exitCode = 1;
});
