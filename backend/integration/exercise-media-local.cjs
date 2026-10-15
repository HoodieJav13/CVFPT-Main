#!/usr/bin/env node
// Real local integration for exercise media: real bytes -> real Express app
// (real login, requireAuth, profile checks) -> PostgREST service_role -> real
// SQL functions -> real LocalMediaStore -> real FFmpeg worker process ->
// authorized capability bytes. Fictional loopback auth and synthetic data only.
//   npm --prefix backend run test:media:integration [-- --keep]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID, createHmac } = require('node:crypto');
const { MediaHarness, IDENTITIES, ROOT, LOCAL_DIR, RUN_DIR, waitFor } = require('./exercise-media-harness.cjs');

const KEEP = process.argv.includes('--keep');
const FIXTURES = path.join(LOCAL_DIR, 'fixtures');
const ABUSE = path.join(LOCAL_DIR, 'abuse');
const EVIDENCE = path.join(LOCAL_DIR, 'evidence');
const results = { schema_version: 1, started_at: new Date().toISOString(), cases: [], measurements: {}, tested_source: null };
const issuedTokens = new Set();
let h; let API; let T = {};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); } catch (error) { results.cases.push({ name, status: 'FAIL', ms: Date.now() - started, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
  results.cases.push({ name, status: 'PASS', ms: Date.now() - started });
  console.log(`PASS ${name} (${Date.now() - started}ms)`);
}
async function api(method, url, { token, json, form, headers = {}, base = API } = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
    body: form || (json ? JSON.stringify(json) : undefined),
  });
  const type = response.headers.get('content-type') || '';
  const body = method === 'HEAD' ? null : type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body, headers: response.headers };
}
const M = '/api/exercise-media';
function form(file, fields = {}, { bytes, name } = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ request_id: randomUUID(), rights_basis: 'owned', rights_confirmed: 'true', rights_note: 'Synthetic fixture generated locally by the project', ...fields })) data.append(key, String(value));
  data.append('file', new Blob([bytes || fs.readFileSync(file)]), name || path.basename(file));
  return data;
}
async function upload(token, revision, role, file, fields = {}, extra = {}) {
  return api('POST', `${M}/revisions/${revision.id}/sources?role=${role}`, { token, form: form(file, { expected_version: revision.version, ...fields }, extra) });
}
async function patch(token, revision, body) {
  const response = await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token, json: { expected_version: revision.version, ...body } });
  assert.equal(response.status, 200, `recipe ${JSON.stringify(response.body)}`);
  return response.body;
}
async function draft(token, exerciseId, base = null) {
  const response = await api('POST', `${M}/exercises/${exerciseId}/drafts`, { token, json: { request_id: randomUUID(), confirm_exercise_id: exerciseId, ...(base ? { base_revision_id: base } : {}) } });
  assert.equal(response.status, 201, `draft ${JSON.stringify(response.body)}`);
  return response.body.revision;
}
async function processAndWait(token, revision) {
  const queued = await api('POST', `${M}/revisions/${revision.id}/process`, { token, json: { expected_version: revision.version } });
  assert.equal(queued.status, 200, `process ${JSON.stringify(queued.body)}`);
  const started = Date.now();
  const done = await waitFor(async () => {
    const current = await api('GET', `${M}/revisions/${revision.id}`, { token });
    return ['ready', 'failed'].includes(current.body.status) ? current.body : null;
  }, { timeoutMs: 240_000, intervalMs: 400, what: `processing ${revision.id}` });
  done.processing_ms = Date.now() - started;
  return done;
}
const ATTEST = { variant_confirmed: true, rights_confirmed: true, content_confirmed: true };
async function reviewAndPublish(token, revision, expectedCurrent) {
  const reviewed = await api('POST', `${M}/revisions/${revision.id}/review`, { token, json: { expected_version: revision.version, ...ATTEST } });
  assert.equal(reviewed.status, 200, `review ${JSON.stringify(reviewed.body)}`);
  const published = await api('POST', `${M}/exercises/${revision.exercise_id}/publish`, { token, json: { revision_id: revision.id, expected_current_version: expectedCurrent } });
  assert.equal(published.status, 200, `publish ${JSON.stringify(published.body)}`);
  return published.body;
}
async function links(token, context, assetIds) {
  const response = await api('POST', `${M}/links`, { token, json: { context, assets: assetIds.map((asset_id) => ({ asset_id })) } });
  for (const link of response.body?.links || []) issuedTokens.add(link.url.split('/').pop());
  return response;
}
const FULL = { x: 0, y: 0, width: 1, height: 1 };
const sql = (text) => h.psql(text).trim();

async function main() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  results.tested_source = { head, tracked_changes: dirty ? dirty.split('\n') : [] };
  fs.mkdirSync(EVIDENCE, { recursive: true });
  if (!fs.existsSync(path.join(FIXTURES, 'fixtures-manifest.json'))) {
    const generated = spawnSync(process.execPath, [path.join(ROOT, 'backend/scripts/generate-exercise-media-fixtures.cjs'), FIXTURES], { stdio: 'inherit' });
    assert.equal(generated.status, 0, 'fixture generation');
  }
  const mediaRoot = path.join(LOCAL_DIR, `media-it-${Date.now()}`);
  h = new MediaHarness({ mediaRoot });
  await h.startDatabase({ reset: true });
  await h.startPostgrest();
  await h.startGateway();
  h.seed();
  // The run performs ~40 uploads per coach; the default 10/15 min limit is
  // proven separately below against a second API instance at the default.
  const apiChild = await h.startApi({ env: { CORS_ORIGINS: 'http://127.0.0.1:4999', EXERCISE_MEDIA_UPLOADS_PER_WINDOW: '500' } });
  API = apiChild.url;
  await h.startWorker({ leaseSeconds: 8 });
  h.writeRuntime({ purpose: 'integration test' });
  for (const key of Object.keys(IDENTITIES)) T[key] = await h.login(key, API);
  const quarantine = path.join(mediaRoot, 'quarantine');
  const quarantineEmpty = () => !fs.existsSync(quarantine) || fs.readdirSync(quarantine).length === 0;

  // ----- Library + workout setup through the real coach APIs -------------------
  const exercises = {};
  for (const [key, name, video] of [['goblet', 'Synthetic Goblet Squat', null], ['split', 'Synthetic Split Squat', 'https://example.com/library-split'],
    ['row', 'Synthetic Band Row', 'https://example.com/library-band-row'], ['plank', 'Synthetic Plank', null], ['shuttle', 'Synthetic Shuttle Walk', null], ['wall', 'Synthetic Wall Sit (no media)', null]]) {
    const created = await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name, category: 'Synthetic', equipment: 'Synthetic', video_url: video } });
    assert.equal(created.status, 201); exercises[key] = created.body.id;
  }
  const exerciseRow = (key, extra = {}) => ({ exercise_library_id: exercises[key], custom_name: '', sets: 2, reps: '8', rest: '60s', ...extra });
  const workout = await api('POST', '/api/programs/workouts', { token: T['coach-a'], json: { name: 'Synthetic Media Session', exercises: [
    exerciseRow('goblet'), exerciseRow('split'), exerciseRow('row', { video_url: 'https://example.com/coach-override' }), exerciseRow('plank'), exerciseRow('shuttle'), exerciseRow('wall'),
    { exercise_library_id: null, custom_name: 'Synthetic custom move (no library id)', sets: 1, reps: '5' },
  ] } });
  assert.equal(workout.status, 201, JSON.stringify(workout.body));
  const assign = async (coach, client) => (await api('POST', '/api/programs/workout-assignments', { token: T[coach], json: { client_id: IDENTITIES[client].profile, workout_id: workout.body.id } })).body;
  const assignment1 = await assign('coach-a', 'client-1');
  const assignment2 = await assign('coach-b', 'client-2');
  assert.ok(assignment1.id && assignment2.id);
  const startLog = async (token, assignmentId) => {
    const started = await api('POST', '/api/workout-logs/start', { token, json: { workout_assignment_id: assignmentId } });
    assert.ok([200, 201].includes(started.status), JSON.stringify(started.body));
    return started.body.workout_log;
  };
  const exerciseOf = (log, key) => log.exercises.find((row) => row.exercise_library_id === exercises[key]);

  let gobletPhoto;
  await check('client cannot mutate media; coach routes need coach role', async () => {
    assert.equal((await api('POST', `${M}/exercises/${exercises.goblet}/drafts`, { token: T['client-1'], json: { request_id: randomUUID(), confirm_exercise_id: exercises.goblet } })).status, 403);
    assert.equal((await api('GET', `${M}/capabilities`, { token: T['client-1'] })).status, 403);
    assert.equal((await api('GET', `${M}/capabilities`)).status, 401);
    assert.equal((await api('GET', `${M}/capabilities`, { token: 'forged.token.value' })).status, 401);
  });

  await check('photo-only: upload JPEG, crop, alt/cues, real processing, explicit review, publish (no video)', async () => {
    let revision = await draft(T['coach-a'], exercises.goblet);
    const t0 = Date.now();
    const uploaded = await upload(T['coach-a'], revision, 'source_image', path.join(FIXTURES, 'goblet-squat-photo.jpg'));
    results.measurements.photo_upload_ms = Date.now() - t0;
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    revision = uploaded.body.revision;
    assert.equal(revision.sources.image.width, 1600); assert.equal(revision.sources.video, null);
    assert.equal(JSON.stringify(revision).includes('sources/'), false, 'no storage key in coach DTO');
    revision = await patch(T['coach-a'], revision, { alt_text: 'Synthetic test photo for the goblet squat identity', cues: ['Synthetic cue one', 'Synthetic cue two'], poster_crop: FULL });
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'ready', JSON.stringify(revision));
    results.measurements.photo_processing_ms = revision.processing_ms;
    const poster = revision.derivatives.find((d) => d.role === 'poster');
    assert.equal(poster.width, 640); assert.equal(poster.height, 360); assert.ok(poster.bytes <= 160 * 1024);
    results.measurements.photo_poster_bytes = poster.bytes;
    // Ready is not approved: publishing before review is refused.
    const early = await api('POST', `${M}/exercises/${exercises.goblet}/publish`, { token: T['coach-a'], json: { revision_id: revision.id, expected_current_version: 0 } });
    assert.equal(early.status, 409); assert.equal(early.body.code, 'not_ready');
    const published = await reviewAndPublish(T['coach-a'], revision, 0);
    assert.equal(published.current_version, 1);
    gobletPhoto = published.revision;
  });

  let log1;
  await check('client workout shows the current photo inline; text/external fallbacks intact; bytes are the processed derivative', async () => {
    log1 = await startLog(T['client-1'], assignment1.id);
    const detail = (await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-1'] })).body;
    const goblet = exerciseOf(detail, 'goblet');
    assert.equal(goblet.media.kind, 'photo'); assert.equal(goblet.media.alt_text, 'Synthetic test photo for the goblet squat identity');
    assert.equal(goblet.media.preview, null); assert.equal(goblet.media.instruction, null);
    assert.equal(exerciseOf(detail, 'split').media, null);
    assert.equal(exerciseOf(detail, 'row').video_url, 'https://example.com/coach-override', 'workout override wins');
    assert.equal(exerciseOf(detail, 'split').video_url, 'https://example.com/library-split', 'library fallback');
    const custom = detail.exercises.find((row) => !row.exercise_library_id);
    assert.equal(custom.media, null);
    const text = JSON.stringify(detail);
    for (const forbidden of ['storage_key', 'sha256', 'rights_note', 'uploaded_by', 'sources/', 'derivatives/']) assert.equal(text.includes(forbidden), false, forbidden);
    const issued = await links(T['client-1'], { type: 'workout_log', id: log1.id }, [goblet.media.poster.asset_id]);
    assert.equal(issued.status, 200); assert.equal(issued.headers.get('cache-control'), 'private, no-store');
    const content = await api('GET', issued.body.links[0].url);
    assert.equal(content.status, 200); assert.equal(content.headers.get('content-type'), 'image/jpeg');
    assert.equal(content.body.indexOf(Buffer.from('Exif')), -1); assert.equal(content.body.indexOf(Buffer.from('GPS')), -1);
    assert.equal(sha(content.body), sql(`select sha256 from public.exercise_media_assets where id = '${goblet.media.poster.asset_id}'`));
    assert.equal(content.body.length <= 160 * 1024, true);
  });

  await check('image abuse refused before ready: SVG, GIF, animated, truncated, dimension/pixel bombs, fake MIME; nothing stored', async () => {
    fs.mkdirSync(ABUSE, { recursive: true });
    let revision = await draft(T['coach-a'], exercises.split);
    const good = fs.readFileSync(path.join(FIXTURES, 'goblet-squat-photo.jpg'));
    const pngHeader = (w, h) => { const b = Buffer.alloc(33 + 12 + 12); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 6; b.writeUInt32BE(0, 33); b.write('IDAT', 37); return b; };
    const cases = [
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'), 'x.jpg', 415],
      ['gif', Buffer.from('GIF89a\x10\x00\x10\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04', 'binary'), 'x.gif', 415],
      ['truncated jpeg', good.subarray(0, Math.floor(good.length / 3)), 'x.jpg', 422],
      ['8193px png header', pngHeader(8193, 400), 'x.png', 422],
      ['decoded-pixel bomb', pngHeader(8000, 8000), 'x.png', 422],
      ['tiny png', pngHeader(100, 100), 'x.png', 422],
      ['empty', Buffer.alloc(0), 'x.jpg', 400],
      ['pdf renamed', Buffer.from('%PDF-1.7\n'), 'x.png', 415],
    ];
    const before = sql("select count(*) from public.exercise_media_assets where role = 'source_image'");
    for (const [label, bytes, name, status] of cases) {
      const response = await upload(T['coach-a'], revision, 'source_image', null, {}, { bytes, name });
      assert.equal(response.status, status, `${label}: ${response.status} ${JSON.stringify(response.body)}`);
      assert.ok(quarantineEmpty(), `${label}: quarantine not cleaned`);
    }
    assert.equal(sql("select count(*) from public.exercise_media_assets where role = 'source_image'"), before);
    revision = (await api('GET', `${M}/revisions/${revision.id}`, { token: T['coach-a'] })).body;
    assert.equal(revision.version, 1, 'refused uploads never touched the draft');
    // Animated WebP and APNG via the real encoder.
    const { DockerToolRunner, PROCESSOR_IMAGE } = require('../src/services/exerciseMedia/ffmpegProcessor');
    const runner = new DockerToolRunner({ image: PROCESSOR_IMAGE });
    await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=5:duration=1', '-c:v', 'libwebp_anim', '-loop', '0', '/out/anim.webp'], { outputDir: ABUSE, timeoutMs: 60_000 });
    await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=5:duration=1', '-plays', '0', '-f', 'apng', '/out/anim.png'], { outputDir: ABUSE, timeoutMs: 60_000 });
    for (const file of ['anim.webp', 'anim.png']) {
      const response = await upload(T['coach-a'], revision, 'source_image', path.join(ABUSE, file));
      assert.equal(response.status, 415, `${file} ${JSON.stringify(response.body)}`); assert.equal(response.body.code, 'animated_image_not_supported');
    }
    assert.ok(quarantineEmpty());
  });

  await check('EXIF-rotated portrait photo: oriented facts, crop band, metadata stripped (split squat variant)', async () => {
    let revision = await draft(T['coach-a'], exercises.split);
    revision = (await upload(T['coach-a'], revision, 'source_image', path.join(FIXTURES, 'split-squat-portrait.jpg'))).body.revision;
    assert.equal(revision.sources.image.width, 1080); assert.equal(revision.sources.image.height, 1350);
    const band = { x: 0, y: 0.1, width: 1, height: (1080 * 9 / 16) / 1350 };
    const stretched = await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token: T['coach-a'], json: { expected_version: revision.version, poster_crop: { x: 0, y: 0, width: 1, height: 1 } } });
    assert.equal(stretched.status, 422); assert.equal(stretched.body.code, 'crop_aspect_mismatch', 'never stretch');
    revision = await patch(T['coach-a'], revision, { alt_text: 'Synthetic test photo for the split squat identity (portrait source)', poster_crop: band });
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'ready');
    await reviewAndPublish(T['coach-a'], revision, 0);
  });

  let rowRevision;
  await check('video + custom thumbnail: preview <=2 MiB silent fast-start, separate instruction, escaped captions, transcript', async () => {
    let revision = await draft(T['coach-a'], exercises.row);
    revision = (await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'band-row.mp4'))).body.revision;
    assert.equal(revision.sources.video.duration_ms >= 5900 && revision.sources.video.duration_ms <= 6100, true);
    revision = (await upload(T['coach-a'], revision, 'source_image', path.join(FIXTURES, 'band-row-thumbnail.png'))).body.revision;
    const invalid = await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token: T['coach-a'], json: { expected_version: revision.version, preview_start_ms: 3000, preview_end_ms: 2000 } });
    assert.equal(invalid.status, 422); assert.equal(invalid.body.code, 'invalid_preview_range');
    revision = await patch(T['coach-a'], revision, {
      alt_text: 'Synthetic test thumbnail for the band row identity', cues: ['Synthetic cue'], poster_mode: 'uploaded_image', poster_crop: FULL,
      preview_start_ms: 1000, preview_end_ms: 3000, preview_crop: FULL, include_instruction: true, caption_language: 'en',
      caption_cues: [{ start_ms: 0, end_ms: 2000, text: 'Synthetic caption <b>one</b> & two' }, { start_ms: 2000, end_ms: 5000, text: 'Synthetic caption two' }],
      transcript: 'Synthetic transcript for a synthetic clip. Not exercise instruction.',
    });
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'ready', JSON.stringify(revision.failure_code));
    results.measurements.video_processing_ms = revision.processing_ms;
    const by = Object.fromEntries(revision.derivatives.map((d) => [d.role, d]));
    assert.deepEqual(Object.keys(by).sort(), ['captions', 'instruction', 'poster', 'preview']);
    assert.ok(by.preview.bytes <= 2 * 1024 * 1024 && by.preview.has_audio === false && Math.abs(by.preview.duration_ms - 2000) <= 120);
    assert.ok(by.instruction.bytes <= 25 * 1024 * 1024 && Math.max(by.instruction.width, by.instruction.height) <= 1080);
    Object.assign(results.measurements, { band_row_poster_bytes: by.poster.bytes, band_row_preview_bytes: by.preview.bytes, band_row_instruction_bytes: by.instruction.bytes, band_row_captions_bytes: by.captions.bytes });
    await reviewAndPublish(T['coach-a'], revision, 0);
    rowRevision = revision;
    const detail = (await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-1'] })).body;
    const media = exerciseOf(detail, 'row').media;
    assert.equal(media.kind, 'video'); assert.equal(media.instruction.captions_available, true);
    const issued = await links(T['client-1'], { type: 'workout_log', id: log1.id }, [media.preview.asset_id, media.instruction.asset_id, media.instruction.captions_asset_id]);
    assert.equal(issued.body.links.length, 3);
    const byAsset = Object.fromEntries(issued.body.links.map((l) => [l.asset_id, l]));
    const preview = await api('GET', byAsset[media.preview.asset_id].url);
    assert.equal(preview.headers.get('content-type'), 'video/mp4'); assert.equal(preview.body.toString('latin1', 4, 8), 'ftyp');
    const range = await api('GET', byAsset[media.instruction.asset_id].url, { headers: { range: 'bytes=0-1023' } });
    assert.equal(range.status, 206); assert.equal(range.body.length, 1024); assert.match(range.headers.get('content-range'), /^bytes 0-1023\/\d+$/);
    const instructionTtl = (Date.parse(byAsset[media.instruction.asset_id].expires_at) - Date.now()) / 1000;
    assert.ok(instructionTtl > 250 && instructionTtl <= 300, `instruction ttl ${instructionTtl}`);
    const vtt = (await api('GET', byAsset[media.instruction.captions_asset_id].url)).body.toString('utf8');
    assert.match(vtt, /^WEBVTT\nLanguage: en\n/); assert.ok(vtt.includes('Synthetic caption &lt;b&gt;one&lt;/b&gt; &amp; two'));
    const text = await api('POST', `${M}/text`, { token: T['client-1'], json: { context: { type: 'workout_log', id: log1.id }, exercise_id: exercises.row } });
    assert.equal(text.body.transcript, 'Synthetic transcript for a synthetic clip. Not exercise instruction.');
    const headOnly = await fetch(API + byAsset[media.preview.asset_id].url, { method: 'HEAD' });
    assert.equal(headOnly.status, 200); assert.ok(Number(headOnly.headers.get('content-length')) > 0);
  });

  await check('start/end stills from WebM (plank): frames kind with end-frame alt text', async () => {
    let revision = await draft(T['coach-a'], exercises.plank);
    revision = (await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'plank.webm'))).body.revision;
    const late = await api('PATCH', `${M}/revisions/${revision.id}/recipe`, { token: T['coach-a'], json: { expected_version: revision.version, poster_frame_ms: 5000 } });
    assert.equal(late.status, 422);
    revision = await patch(T['coach-a'], revision, { alt_text: 'Synthetic start still', end_frame_alt_text: 'Synthetic end still', poster_mode: 'video_frame', poster_frame_ms: 300, poster_crop: FULL, end_frame_ms: 4900, end_frame_crop: FULL });
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'ready', revision.failure_code);
    await reviewAndPublish(T['coach-a'], revision, 0);
    const media = exerciseOf((await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-1'] })).body, 'plank').media;
    assert.equal(media.kind, 'frames'); assert.equal(media.end_frame.alt_text, 'Synthetic end still');
  });

  await check('portrait MOV with audio: narrated instruction requires captions+transcript before review', async () => {
    let revision = await draft(T['coach-a'], exercises.shuttle);
    revision = (await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'shuttle-walk.mov'))).body.revision;
    assert.equal(revision.sources.video.width, 720); assert.equal(revision.sources.video.height, 1280); assert.equal(revision.sources.video.has_audio, true);
    const band = { x: 0, y: 0.3, width: 1, height: (720 * 9 / 16) / 1280 };
    revision = await patch(T['coach-a'], revision, { alt_text: 'Synthetic portrait still', poster_mode: 'video_frame', poster_frame_ms: 1000, poster_crop: band, preview_start_ms: 0, preview_end_ms: 1500, preview_crop: band, include_instruction: true, instruction_audio: true });
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'ready', revision.failure_code);
    const refused = await api('POST', `${M}/revisions/${revision.id}/review`, { token: T['coach-a'], json: { expected_version: revision.version, ...ATTEST } });
    assert.equal(refused.status, 422); assert.equal(refused.body.code, 'captions_required');
    revision = await patch(T['coach-a'], revision, { caption_language: 'en', caption_cues: [{ start_ms: 0, end_ms: 3000, text: 'Synthetic tone, not narration' }], transcript: 'Synthetic tone only.' });
    assert.equal(revision.status, 'draft', 'captions are part of the recipe');
    revision = await processAndWait(T['coach-a'], revision);
    const published = await reviewAndPublish(T['coach-a'], revision, 0);
    assert.equal(published.revision.derivatives.find((d) => d.role === 'instruction').has_audio, true);
  });

  await check('video abuse refused: playlist, truncated, >120s, >60fps, extra streams, legacy codec, mismatch', async () => {
    const { DockerToolRunner, PROCESSOR_IMAGE } = require('../src/services/exerciseMedia/ffmpegProcessor');
    const runner = new DockerToolRunner({ image: PROCESSOR_IMAGE });
    const make = (name, args) => runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args, '-threads', '2', `/out/${name}`], { outputDir: ABUSE, timeoutMs: 120_000 });
    await make('long.mp4', ['-f', 'lavfi', '-i', 'color=c=gray:size=160x160:rate=1:duration=121', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    await make('fast.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=120:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    await make('two.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=1', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1', '-map', '0', '-map', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
    await make('legacy.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=1', '-c:v', 'mpeg4']);
    let revision = await draft(T['coach-a'], exercises.wall);
    const mp4 = fs.readFileSync(path.join(FIXTURES, 'band-row.mp4'));
    const cases = [
      ['playlist renamed .mp4', null, { bytes: Buffer.from('#EXTM3U\n#EXTINF:1,\nhttp://127.0.0.1:9/a.ts\n'), name: 'x.mp4' }, 415],
      ['truncated mp4', null, { bytes: mp4.subarray(0, 2048), name: 'x.mp4' }, 422],
      ['121 seconds', path.join(ABUSE, 'long.mp4'), {}, 422],
      ['120 fps', path.join(ABUSE, 'fast.mp4'), {}, 422],
      ['two video streams', path.join(ABUSE, 'two.mp4'), {}, 422],
      ['mpeg4 codec', path.join(ABUSE, 'legacy.mp4'), {}, 415],
      ['jpeg as video', path.join(FIXTURES, 'goblet-squat-photo.jpg'), { name: 'x.mp4' }, 415],
    ];
    for (const [label, file, extra, status] of cases) {
      const response = await upload(T['coach-a'], revision, 'source_video', file, {}, extra);
      assert.equal(response.status, status, `${label}: ${response.status} ${JSON.stringify(response.body)}`);
      assert.ok(quarantineEmpty(), label);
    }
    revision = (await api('GET', `${M}/revisions/${revision.id}`, { token: T['coach-a'] })).body;
    assert.equal(revision.version, 1);
    // Idempotent upload: same request id + same bytes replays; changed bytes conflict.
    const requestId = randomUUID();
    const first = await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'band-row.mp4'), { request_id: requestId });
    assert.equal(first.status, 201);
    const again = await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'band-row.mp4'), { request_id: requestId });
    assert.equal(again.status, 200); assert.equal(again.body.replayed, true);
    const changed = await upload(T['coach-a'], first.body.revision, 'source_video', path.join(FIXTURES, 'goblet-squat-replacement.mp4'), { request_id: requestId });
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'request_mismatch');
    assert.ok(quarantineEmpty());
    await api('POST', `${M}/revisions/${revision.id}/archive`, { token: T['coach-a'], json: {} });
  });

  await check('ownership and IDOR matrix with real auth, PostgREST and SQL', async () => {
    const aDraft = await draft(T['coach-a'], exercises.wall);
    const filesBefore = fs.readdirSync(quarantine).length;
    assert.equal((await api('GET', `${M}/revisions/${aDraft.id}`, { token: T['coach-b'] })).status, 404);
    assert.equal((await upload(T['coach-b'], aDraft, 'source_image', path.join(FIXTURES, 'goblet-squat-photo.jpg'))).status, 404);
    assert.equal(fs.readdirSync(quarantine).length, filesBefore, 'no bytes staged for coach B');
    assert.equal((await api('PATCH', `${M}/revisions/${aDraft.id}/recipe`, { token: T['coach-b'], json: { expected_version: 1, alt_text: 'hijack' } })).status, 404);
    assert.equal((await api('POST', `${M}/revisions/${aDraft.id}/archive`, { token: T['coach-b'], json: {} })).status, 404);
    assert.equal((await api('POST', `${M}/exercises/${exercises.goblet}/publish`, { token: T['coach-b'], json: { revision_id: gobletPhoto.id, expected_current_version: 1 } })).status, 404);
    assert.equal((await api('POST', `${M}/revisions/${gobletPhoto.id}/archive`, { token: T['coach-b'], json: { expected_current_version: 1 } })).status, 404, 'B cannot withdraw A current');
    assert.equal((await links(T['coach-b'], { type: 'revision', id: aDraft.id }, [randomUUID()])).status, 404);
    // B proposes an alternative; replacing A's current needs admin.
    let bDraft = await draft(T['coach-b'], exercises.goblet);
    bDraft = (await upload(T['coach-b'], bDraft, 'source_image', path.join(FIXTURES, 'goblet-squat-photo.webp'))).body.revision;
    bDraft = await patch(T['coach-b'], bDraft, { alt_text: 'Synthetic alternative photo by coach B', poster_crop: FULL });
    bDraft = await processAndWait(T['coach-b'], bDraft);
    const reviewed = await api('POST', `${M}/revisions/${bDraft.id}/review`, { token: T['coach-b'], json: { expected_version: bDraft.version, ...ATTEST } });
    assert.equal(reviewed.status, 200);
    const refused = await api('POST', `${M}/exercises/${exercises.goblet}/publish`, { token: T['coach-b'], json: { revision_id: bDraft.id, expected_current_version: 1 } });
    assert.equal(refused.status, 403); assert.equal(refused.body.code, 'replace_requires_admin');
    assert.equal(sql(`select revision_id from public.exercise_media_current where exercise_library_id = '${exercises.goblet}'`), gobletPhoto.id, 'A current intact');
    // Forged actor/status fields never reach SQL.
    const forged = await api('PATCH', `${M}/revisions/${bDraft.id}/recipe`, { token: T['coach-b'], json: { expected_version: reviewed.body.version, uploaded_by_coach_id: IDENTITIES['coach-a'].profile } });
    assert.equal(forged.status, 400);
    // Clients: only their own log; never coach contexts; fabricated ids missing.
    const goblet = exerciseOf((await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-1'] })).body, 'goblet');
    assert.equal((await links(T['client-2'], { type: 'workout_log', id: log1.id }, [goblet.media.poster.asset_id])).status, 404);
    assert.equal((await links(T['client-1'], { type: 'library', exercise_id: exercises.goblet }, [goblet.media.poster.asset_id])).status, 404);
    assert.equal((await links(T['client-1'], { type: 'revision', id: bDraft.id }, [goblet.media.poster.asset_id])).status, 404);
    const fabricated = await links(T['client-1'], { type: 'workout_log', id: log1.id }, [randomUUID(), bDraft.derivatives[0].asset_id]);
    assert.equal(fabricated.status, 200); assert.equal(fabricated.body.links.length, 0); assert.equal(fabricated.body.missing.length, 2);
    assert.equal((await api('POST', `${M}/resolve`, { token: T['client-2'], json: { context: { type: 'workout_assignment', id: assignment1.id } } })).status, 404);
    assert.equal((await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-2'] })).status, 404);
    // Admin may replace.
    const admin = await api('POST', `${M}/exercises/${exercises.goblet}/publish`, { token: T.admin, json: { revision_id: bDraft.id, expected_current_version: 1 } });
    assert.equal(admin.status, 200); assert.equal(admin.body.current_version, 2);
    // Restore A's guide as current via a new A revision seeded from... admin withdraws B's, A republishes a fresh photo.
    assert.equal((await api('POST', `${M}/revisions/${bDraft.id}/archive`, { token: T.admin, json: { expected_current_version: 2 } })).status, 200);
    let restore = await draft(T['coach-a'], exercises.goblet);
    restore = (await upload(T['coach-a'], restore, 'source_image', path.join(FIXTURES, 'goblet-squat-photo.jpg'))).body.revision;
    restore = await patch(T['coach-a'], restore, { alt_text: 'Synthetic test photo for the goblet squat identity', cues: ['Synthetic cue one', 'Synthetic cue two'], poster_crop: FULL });
    restore = await processAndWait(T['coach-a'], restore);
    gobletPhoto = (await reviewAndPublish(T['coach-a'], restore, 3)).revision;
  });

  await check('capabilities re-authorize on every request: reassignment, archived client, replacement, expiry, tamper', async () => {
    const goblet = exerciseOf((await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-1'] })).body, 'goblet');
    const asset = goblet.media.poster.asset_id;
    const clientLink = (await links(T['client-1'], { type: 'workout_log', id: log1.id }, [asset])).body.links[0].url;
    const coachLink = (await links(T['coach-a'], { type: 'workout_log', id: log1.id }, [asset])).body.links[0].url;
    assert.equal((await api('GET', coachLink)).status, 200);
    sql(`update public.clients set coach_id = '${IDENTITIES['coach-b'].profile}' where id = '${IDENTITIES['client-1'].profile}'`);
    assert.equal((await api('GET', coachLink)).status, 404, 'former coach link dies on reassignment');
    assert.equal((await api('GET', clientLink)).status, 200, 'client keeps their own log');
    sql(`update public.clients set coach_id = '${IDENTITIES['coach-a'].profile}' where id = '${IDENTITIES['client-1'].profile}'`);
    sql(`update public.clients set archived = true where id = '${IDENTITIES['client-1'].profile}'`);
    assert.equal((await api('GET', clientLink)).status, 404, 'archived client profile');
    sql(`update public.clients set archived = false where id = '${IDENTITIES['client-1'].profile}'`);
    assert.equal((await api('GET', clientLink)).status, 200);
    // Expired: a token with a past expiry signed by the run's local secret.
    const [body] = clientLink.split('/').pop().split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const expiredBody = Buffer.from(JSON.stringify({ ...payload, e: Math.floor(Date.now() / 1000) - 5 })).toString('base64url');
    const expired = await api('GET', `${M}/content/${expiredBody}.${createHmac('sha256', h.linkSecret).update(expiredBody).digest('base64url')}`);
    assert.equal(expired.status, 403); assert.equal(expired.body.code, 'link_expired');
    const tampered = Buffer.from(JSON.stringify({ ...payload, a: randomUUID() })).toString('base64url');
    assert.equal((await api('GET', `${M}/content/${tampered}.${clientLink.split('.').pop()}`)).status, 404);
    // CORS: configured origin gets ACAO; others do not.
    const allowed = await api('GET', clientLink, { headers: { origin: 'http://127.0.0.1:4999' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4999');
    const foreign = await api('GET', clientLink, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
  });

  let completedLog;
  await check('replacement updates the current guide everywhere without touching prescriptions or history (image-only -> video)', async () => {
    // Finish the client's workout first: history must stay byte-stable.
    let detail = (await api('GET', `/api/workout-logs/${log1.id}`, { token: T['client-1'] })).body;
    const firstSet = exerciseOf(detail, 'goblet').sets[0];
    const saved = await api('PATCH', `/api/workout-logs/${log1.id}/sets/${firstSet.id}`, { token: T['client-1'], json: { status: 'completed', actual_reps: 8, actual_load_value: 20, actual_load_unit: 'kg' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await api('POST', `/api/workout-logs/${log1.id}/complete`, { token: T['client-1'], json: { notes: '', feedback: '', completed_at_local: new Date().toISOString() } })).status, 200);
    completedLog = log1.id;
    const strip = (log) => JSON.stringify(log.exercises.map(({ media, media_status: _s, ...rest }) => rest));
    const before = (await api('GET', `/api/workout-logs/${completedLog}`, { token: T['client-1'] })).body;
    const oldPoster = exerciseOf(before, 'goblet').media.poster.asset_id;
    const oldLink = (await links(T['client-1'], { type: 'workout_log', id: completedLog }, [oldPoster])).body.links[0].url;
    // Add video to the current photo without re-uploading the photo.
    const current = Number(sql(`select version from public.exercise_media_current where exercise_library_id = '${exercises.goblet}'`));
    let revision = await draft(T['coach-a'], exercises.goblet, gobletPhoto.id);
    assert.ok(revision.sources.image && revision.sources.image.copied, 'photo source carried over');
    revision = (await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'goblet-squat-replacement.mp4'))).body.revision;
    assert.equal(revision.recipe.poster_mode, 'uploaded_image', 'custom photo stays the poster');
    revision = await patch(T['coach-a'], revision, { preview_start_ms: 0, preview_end_ms: 2000, preview_crop: FULL });
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'ready', revision.failure_code);
    const published = await reviewAndPublish(T['coach-a'], revision, current);
    assert.equal(published.current_version, current + 1);
    const after = (await api('GET', `/api/workout-logs/${completedLog}`, { token: T['client-1'] })).body;
    assert.equal(strip(after), strip(before), 'log identity, prescription and performed sets unchanged');
    const media = exerciseOf(after, 'goblet').media;
    assert.equal(media.kind, 'video'); assert.equal(media.revision_id, revision.id); assert.equal(media.exercise_id, exercises.goblet);
    assert.equal((await api('GET', oldLink)).status, 404, 'previous guide links stop after replacement');
    // Client 2 (another assigned copy) sees the same current guide, no rebuild.
    const log2 = await startLog(T['client-2'], assignment2.id);
    assert.equal(exerciseOf((await api('GET', `/api/workout-logs/${log2.id}`, { token: T['client-2'] })).body, 'goblet').media.revision_id, revision.id);
    assert.equal(sql(`select count(*) from public.workout_log_exercises where workout_log_id = '${completedLog}' and exercise_library_id = '${exercises.goblet}'`), '1');
  });

  await check('publish race through the API: same expected version -> one 200, one 409', async () => {
    const prepare = async () => {
      let revision = await draft(T['coach-a'], exercises.wall);
      revision = (await upload(T['coach-a'], revision, 'source_image', path.join(FIXTURES, 'goblet-squat-photo.webp'))).body.revision;
      revision = await patch(T['coach-a'], revision, { alt_text: 'Synthetic wall sit placeholder photo', poster_crop: FULL });
      revision = await processAndWait(T['coach-a'], revision);
      return (await api('POST', `${M}/revisions/${revision.id}/review`, { token: T['coach-a'], json: { expected_version: revision.version, ...ATTEST } })).body;
    };
    const [x, y] = [await prepare(), await prepare()];
    const outcomes = await Promise.all([x, y].map((revision) => api('POST', `${M}/exercises/${exercises.wall}/publish`, { token: T['coach-a'], json: { revision_id: revision.id, expected_current_version: 0 } })));
    assert.deepEqual(outcomes.map((o) => o.status).sort(), [200, 409]);
    // Withdraw so the "no media" scenario stays real for the browser lane.
    const winner = outcomes.find((o) => o.status === 200).body.revision.id;
    assert.equal((await api('POST', `${M}/revisions/${winner}/archive`, { token: T['coach-a'], json: { expected_current_version: 1 } })).status, 200);
    assert.equal(sql(`select coalesce(revision_id::text,'none') from public.exercise_media_current where exercise_library_id = '${exercises.wall}'`), 'none');
  });

  await check('oversize source refused; worker crash mid-job: lease expires, same job resumes (attempt 2), no duplicate revision; prior current kept', async () => {
    const { DockerToolRunner, PROCESSOR_IMAGE } = require('../src/services/exerciseMedia/ffmpegProcessor');
    const runner = new DockerToolRunner({ image: PROCESSOR_IMAGE });
    // > 100 MiB source: refused (413) without being processed.
    await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=90', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '2', '/out/oversize.mp4'], { outputDir: ABUSE, timeoutMs: 180_000 });
    assert.ok(fs.statSync(path.join(ABUSE, 'oversize.mp4')).size > 100 * 1024 * 1024);
    await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=90', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '5M', '-maxrate', '5M', '-bufsize', '10M', '-pix_fmt', 'yuv420p', '-threads', '2', '/out/heavy.mp4'], { outputDir: ABUSE, timeoutMs: 180_000 });
    await h.stopChild('worker');
    const priorCurrent = sql(`select revision_id from public.exercise_media_current where exercise_library_id = '${exercises.row}'`);
    let revision = await draft(T['coach-a'], exercises.row, priorCurrent);
    const oversize = await upload(T['coach-a'], revision, 'source_video', path.join(ABUSE, 'oversize.mp4'));
    assert.equal(oversize.status, 413, JSON.stringify(oversize.body)); assert.ok(quarantineEmpty());
    const heavyUpload = await upload(T['coach-a'], revision, 'source_video', path.join(ABUSE, 'heavy.mp4'));
    assert.equal(heavyUpload.status, 201, JSON.stringify(heavyUpload.body));
    revision = heavyUpload.body.revision;
    revision = await patch(T['coach-a'], revision, { preview_start_ms: 0, preview_end_ms: 2000, preview_crop: FULL, caption_cues: [], include_instruction: true });
    const queued = await api('POST', `${M}/revisions/${revision.id}/process`, { token: T['coach-a'], json: { expected_version: revision.version } });
    assert.equal(queued.status, 200);
    await h.startWorker({ name: 'worker-crash', leaseSeconds: 8 });
    await waitFor(() => sql(`select state from public.exercise_media_jobs where revision_id = '${revision.id}'`) === 'running', { timeoutMs: 30_000, what: 'job running' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await h.stopChild('worker-crash', 'SIGKILL');
    assert.equal(sql(`select state || ':' || attempts from public.exercise_media_jobs where revision_id = '${revision.id}'`), 'running:1');
    assert.equal(sql(`select revision_id from public.exercise_media_current where exercise_library_id = '${exercises.row}'`), priorCurrent, 'current untouched while processing');
    await h.startWorker({ name: 'worker', leaseSeconds: 8 });
    const done = await waitFor(async () => {
      const current = await api('GET', `${M}/revisions/${revision.id}`, { token: T['coach-a'] });
      return ['ready', 'failed'].includes(current.body.status) ? current.body : null;
    }, { timeoutMs: 300_000, intervalMs: 1000, what: 'recovered job' });
    assert.equal(done.status, 'ready', done.failure_code);
    assert.equal(sql(`select count(*) || ':' || max(attempts) from public.exercise_media_jobs where revision_id = '${revision.id}'`), '1:2');
    assert.equal(sql(`select count(*) from public.exercise_media_revisions where id = '${revision.id}'`), '1');
    const instruction = done.derivatives.find((d) => d.role === 'instruction');
    results.measurements.heavy_1080p_90s = { source_bytes: fs.statSync(path.join(ABUSE, 'heavy.mp4')).size, instruction_bytes: instruction.bytes, preview_bytes: done.derivatives.find((d) => d.role === 'preview').bytes };
    await api('POST', `${M}/revisions/${revision.id}/archive`, { token: T['coach-a'], json: {} });
  });

  await check('failed replacement leaves the previous guide current and visible to clients', async () => {
    const priorCurrent = sql(`select revision_id from public.exercise_media_current where exercise_library_id = '${exercises.row}'`);
    let revision = await draft(T['coach-a'], exercises.row, priorCurrent);
    revision = (await upload(T['coach-a'], revision, 'source_video', path.join(FIXTURES, 'band-row.mp4'))).body.revision;
    revision = await patch(T['coach-a'], revision, { preview_start_ms: 0, preview_end_ms: 1500, preview_crop: FULL, caption_cues: [], include_instruction: false });
    const key = sql(`select storage_key from public.exercise_media_assets where revision_id = '${revision.id}' and role = 'source_video' and not archived`);
    fs.rmSync(path.join(mediaRoot, 'objects', key));
    revision = await processAndWait(T['coach-a'], revision);
    assert.equal(revision.status, 'failed'); assert.equal(revision.failure_code, 'source_missing');
    assert.equal(sql(`select revision_id from public.exercise_media_current where exercise_library_id = '${exercises.row}'`), priorCurrent);
    const log2 = sql(`select id from public.workout_logs where client_id = '${IDENTITIES['client-2'].profile}' and status = 'active'`);
    assert.equal(exerciseOf((await api('GET', `/api/workout-logs/${log2}`, { token: T['client-2'] })).body, 'row').media.revision_id, priorCurrent);
  });

  await check('interrupted upload and staged-upload crash recovery leave no partials and no orphaned rows', async () => {
    const revision = await draft(T['coach-a'], exercises.wall);
    const controller = new AbortController();
    const boundary = `----cvf${Date.now()}`;
    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="request_id"\r\n\r\n${randomUUID()}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.mp4"\r\nContent-Type: video/mp4\r\n\r\n`));
        c.enqueue(new Uint8Array(512 * 1024));
        await new Promise((resolve) => setTimeout(resolve, 400));
        controller.abort();
      },
    });
    await fetch(`${API}${M}/revisions/${revision.id}/sources?role=source_video`, { method: 'POST', headers: { authorization: `Bearer ${T['coach-a']}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, body: stream, duplex: 'half', signal: controller.signal }).catch(() => null);
    await waitFor(() => quarantineEmpty(), { timeoutMs: 10_000, what: 'aborted upload cleanup' });
    assert.equal(sql(`select count(*) from public.exercise_media_assets where revision_id = '${revision.id}'`), '0');
    // Crash between the asset row and the final rename: the worker's recovery
    // pass finishes the rename on restart.
    const uploadId = randomUUID();
    const bytes = fs.readFileSync(path.join(FIXTURES, 'goblet-squat-photo.jpg'));
    fs.mkdirSync(quarantine, { recursive: true });
    fs.writeFileSync(path.join(quarantine, `${uploadId}.part`), bytes);
    const asset = { id: uploadId, role: 'source_image', storage_key: `sources/${uploadId}.jpg`, mime_type: 'image/jpeg', bytes: bytes.length, width: 1600, height: 900, sha256: sha(bytes), rights_basis: 'owned', upload_request_id: randomUUID() };
    assert.match(sql(`select public.exercise_media_attach_source('${IDENTITIES['coach-a'].profile}', '${revision.id}', 1, '${JSON.stringify(asset)}'::jsonb)`), /"attached"/);
    await h.stopChild('worker');
    await h.startWorker({ name: 'worker', leaseSeconds: 8 });
    assert.ok(fs.existsSync(path.join(mediaRoot, 'objects', `sources/${uploadId}.jpg`)), 'recovered on worker start');
    assert.ok(quarantineEmpty());
    await api('POST', `${M}/revisions/${revision.id}/archive`, { token: T['coach-a'], json: {} });
  });

  await check('media lookup failure never blocks reading, editing or completing a workout', async () => {
    const log2 = sql(`select id from public.workout_logs where client_id = '${IDENTITIES['client-2'].profile}' and status = 'active'`);
    sql('revoke execute on function public.exercise_media_current_bundle(uuid[]) from service_role');
    try {
      const detail = await api('GET', `/api/workout-logs/${log2}`, { token: T['client-2'] });
      assert.equal(detail.status, 200);
      const goblet = exerciseOf(detail.body, 'goblet');
      assert.equal(goblet.media, null); assert.equal(goblet.media_status, 'unavailable');
      assert.equal(exerciseOf(detail.body, 'row').video_url, 'https://example.com/coach-override', 'external link survives');
      const set = goblet.sets[0];
      assert.equal((await api('PATCH', `/api/workout-logs/${log2}/sets/${set.id}`, { token: T['client-2'], json: { status: 'completed', actual_reps: 5, actual_load_value: 10, actual_load_unit: 'kg' } })).status, 200);
      assert.equal((await api('POST', `/api/workout-logs/${log2}/complete`, { token: T['client-2'], json: { notes: '', feedback: '', completed_at_local: new Date().toISOString() } })).status, 200);
    } finally {
      sql('grant execute on function public.exercise_media_current_bundle(uuid[]) to service_role');
    }
  });

  await check('batched hydration: a 50-exercise log costs the same queries as a 7-exercise log, and no video bytes are fetched by reads', async () => {
    const filler = [];
    for (let i = 0; i < 43; i += 1) filler.push((await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: `Synthetic Filler ${String(i + 1).padStart(2, '0')}` } })).body.id);
    const big = await api('POST', '/api/programs/workouts', { token: T['coach-a'], json: { name: 'Synthetic 50-exercise session', exercises: [
      ...Object.values(exercises).map((id) => ({ exercise_library_id: id, sets: 1, reps: '5' })), ...filler.map((id) => ({ exercise_library_id: id, sets: 1, reps: '5' })),
      { exercise_library_id: null, custom_name: 'Synthetic custom move', sets: 1, reps: '5' },
    ] } });
    assert.equal(big.status, 201); assert.equal(big.body.exercises.length, 50);
    const assignment = (await api('POST', '/api/programs/workout-assignments', { token: T['coach-a'], json: { client_id: IDENTITIES['client-1'].profile, workout_id: big.body.id } })).body;
    const bigLog = await startLog(T['client-1'], assignment.id);
    const count = async (id) => { h.restRequests.length = 0; const r = await api('GET', `/api/workout-logs/${id}`, { token: T['client-1'] }); assert.equal(r.status, 200); return h.restRequests.length; };
    const small = await count(completedLog);
    const large = await count(bigLog.id);
    results.measurements.hydration_queries = { seven_exercises: small, fifty_exercises: large };
    assert.equal(large, small, `queries 7-ex=${small} 50-ex=${large}`);
    const detail = (await api('GET', `/api/workout-logs/${bigLog.id}`, { token: T['client-1'] })).body;
    assert.equal(detail.exercises.length, 50);
    assert.equal(detail.exercises.filter((row) => row.media).length, 5);
    results.measurements.fifty_exercise_log_json_bytes = Buffer.byteLength(JSON.stringify(detail));
    await api('POST', `/api/workout-logs/${bigLog.id}/abandon`, { token: T['client-1'], json: {} });
  });

  await check('default upload limit: the 11th admitted upload in 15 minutes is refused with 429', async () => {
    const limited = await h.startApi({ name: 'api-default-limit' });
    const revision = await draft(T['coach-b'], exercises.wall);
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await api('POST', `${M}/revisions/${revision.id}/sources?role=source_image`, { token: T['coach-b'], base: limited.url, form: form(null, { expected_version: 1 }, { bytes: Buffer.from('not an image at all, refused after admission'), name: 'x.jpg' }) })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(415));
    assert.equal(statuses[10], 429);
    assert.equal((await api('POST', `${M}/revisions/${revision.id}/sources?role=source_image`, { token: T['coach-a'], base: limited.url, form: form(null, { expected_version: 1 }, { bytes: Buffer.from('x'), name: 'x.jpg' }) })).status, 404, 'limits are per coach; A is refused by ownership, not the limit');
    await h.stopChild('api-default-limit');
    await api('POST', `${M}/revisions/${revision.id}/archive`, { token: T['coach-b'], json: {} });
  });

  await check('disabled configuration: 503 for media routes and byte-identical workout payloads without media fields', async () => {
    const off = await h.startApi({ name: 'api-disabled', media: false });
    const status = await api('GET', `${M}/capabilities`, { token: T['coach-a'], base: off.url });
    assert.equal(status.status, 503); assert.equal(status.body.code, 'media_unavailable');
    const detail = (await api('GET', `/api/workout-logs/${completedLog}`, { token: T['client-1'], base: off.url })).body;
    assert.ok(detail.exercises.every((row) => !('media' in row) && !('media_status' in row)));
    await h.stopChild('api-disabled');
  });

  await check('server and worker logs carry no capabilities, storage keys, media text, rights notes or client identities', async () => {
    const logs = fs.readdirSync(RUN_DIR).filter((name) => name.endsWith(`-${h.runId}.log`)).map((name) => fs.readFileSync(path.join(RUN_DIR, name), 'utf8')).join('\n');
    assert.ok(issuedTokens.size > 5);
    for (const token of issuedTokens) assert.equal(logs.includes(token.slice(0, 40)), false, 'capability leaked');
    for (const needle of ['sources/', 'derivatives/', 'Synthetic test photo', 'Synthetic caption', 'Synthetic fixture generated locally', 'Synthetic Client Riley', 'Synthetic Client Jordan', 'client-1@media-local.invalid', h.password]) {
      assert.equal(logs.includes(needle), false, `log leak: ${needle.slice(0, 20)}`);
    }
    results.measurements.log_bytes_scanned = Buffer.byteLength(logs);
  });

  results.passed = results.cases.filter((c) => c.status === 'PASS').length;
  results.finished_at = new Date().toISOString();
}

main()
  .then(() => { console.log(`EXERCISE MEDIA LOCAL INTEGRATION: ${results.passed} cases PASS`); })
  .catch((error) => { console.error('EXERCISE MEDIA LOCAL INTEGRATION FAILED:', error.message, error.output || ''); process.exitCode = 1; results.error = error.message; })
  .finally(async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, 'integration-results.json'), `${JSON.stringify(results, null, 2)}\n`);
    if (h) {
      try { await h.down({ keepDatabase: KEEP }); } catch (error) { console.error('teardown failed', error.message); process.exitCode = 1; }
    }
  });
