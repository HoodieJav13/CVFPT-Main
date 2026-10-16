#!/usr/bin/env node
// Exercise guides (photo + YouTube) on real local services: HTTP -> Express ->
// PostgREST -> SQL (disposable owned stack) with the fictional loopback auth
// gateway. LOCAL ONLY; synthetic identities and links; the API child runs with
// the loopback network guard, so no provider is ever contacted.
//   node integration/exercise-guides-local.cjs            # run, then tear the owned stack down
//   node integration/exercise-guides-local.cjs --keep-db  # leave the database for inspection
// Proves (docs/exercise-guides/design.md):
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
async function api(method, url, { token, json } = {}) {
  const response = await fetch(API + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined });
  const body = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  return { status: response.status, body };
}
const sql = (text) => h.psql(text).trim();
const json = (text) => JSON.parse(sql(text) || 'null');
const modes = (workoutId) => BASELINE ? null : modesNow(workoutId);
const modesNow = (workoutId) => json(`select coalesce(jsonb_agg(jsonb_build_array(video_link_mode, video_url) order by position), '[]') from public.workout_exercises where workout_id = '${workoutId}' and not archived`);
const denverToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const byLibrary = (rows, id) => rows.filter((row) => row.exercise_library_id === id);

async function main() {
  const head = spawnSync('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n');
  results.tested_source = { head: head[0], tree: head[1], worktree_dirty: spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() !== '' };
  h = new MediaHarness({ mediaRoot: path.join(LOCAL_DIR, `media-guides-${Date.now()}`) });
  await h.startDatabase({ reset: true });
  await h.startPostgrest();
  await h.startGateway();
  h.seed();
  API = (await h.startApi({ media: false })).url;
  for (const key of ['coach-a', 'client-1']) T[key] = await h.login(key, API);
  const client = IDENTITIES['client-1'].profile;

  if (BASELINE) { await quickReplay({ lib: null, client }); return; }
  const lib = (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Guide Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', video_url: LIB_A } })).body;
  const plain = (await api('POST', '/api/programs/exercise-library', { token: T['coach-a'], json: { name: 'Synthetic Guide Band Row', category: 'Synthetic', equipment: 'Band' } })).body;
  assert.ok(lib.id && plain.id, 'library exercises created');

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
