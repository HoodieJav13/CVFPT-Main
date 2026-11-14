// SQL-integrated client rules check for set value origin (Ultra F1/F2 repair,
// 2026-11-12). Real migrations in disposable PGlite, the real frontend rule
// functions, and a small emulation of the backend's request mapping.
//   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/value_origin/client-integration.mjs
//
// Two databases:
//  - 'new': every migration (value origin schema present);
//  - 'old': every migration except 20261113000000 (a server that has not been
//    migrated: v1 RPC only, responses and reads without value_origin).
// Each statement runs in its own transaction (autocommit), so every request
// gets its own now(), as real requests do.
//
// Emulated backend (see backend/src/routes/workoutLogSession.js applySetEvent
// and workoutLogs.js PATCH /:id/sets/:setId):
//  - event write: workoutSetUpdatePayload-equivalent payload, v2 when an origin
//    is declared and the database has it, else v1; the reply is the returned
//    row plus { event: { id, outcome, original_outcome } };
//  - legacy no-event write: UPDATE with the payload's Node updated_at and the
//    actor stamp, no revision change;
//  - read: every set row of the exercise (to_jsonb, the same JSON PostgREST
//    gives for select('*')).
// It proves the client rules against real rows; it does not prove HTTP,
// authorization, concurrency or hosted behavior.
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ackPrefillMarker, annotateValueViews, exerciseQuickPlan, unresolvedPrefillSet,
} from '../../../frontend/src/lib/exerciseQuickComplete.js';

if (!process.env.PGLITE_MODULE) throw Error('Set PGLITE_MODULE to a test-only @electric-sql/pglite dist/index.js; no repository dependency is added');
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { actualMetrics } = require('../../../backend/src/lib/workoutMetrics.js');
const migrations = path.resolve(path.join(here, '../../migrations'));
const ORIGIN_MIGRATION = '20261113000000_set_value_origin.sql';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const contrib = (n) => import(pathToFileURL(path.join(path.dirname(process.env.PGLITE_MODULE), 'contrib', `${n}.js`)));
const LOG = '00000000-0000-4000-8000-000000000021';
const LIB = '00000000-0000-4000-8000-000000000051';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function database(mode) {
  const db = new PGlite({ extensions: { pgcrypto: (await contrib('pgcrypto')).pgcrypto, btree_gist: (await contrib('btree_gist')).btree_gist } });
  await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls; create role authenticator;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
    create schema extensions; create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, path_tokens text[], version text, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
    create or replace function storage.foldername(name text) returns text[] language sql as 'select string_to_array(name, ''/'')';
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create publication supabase_realtime;`);
  const names = (await readdir(migrations)).filter((n) => n.endsWith('.sql') && (mode === 'new' || n < ORIGIN_MIGRATION)).sort();
  for (const name of names) await db.exec(await readFile(path.join(migrations, name), 'utf8'));
  await db.exec(await readFile(path.join(here, '../pr120_repairs/fixtures.sql'), 'utf8'));
  await db.exec(await readFile(path.join(here, 'fixtures.sql'), 'utf8'));
  return { db, mode, migrations: names.length, last: names.at(-1), position: 100 };
}

// One exercise (prescribed 50 lb) with one untouched pending set holding the prefill.
async function freshExercise(ctx) {
  const exerciseId = randomUUID();
  const setId = randomUUID();
  ctx.position += 1;
  await ctx.db.query(`insert into public.workout_log_exercises(id, workout_log_id, exercise_library_id, exercise_name, position, prescribed_load_value, prescribed_load_unit)
    values ($1, $2, $3, 'Integration Press', $4, 50, 'lb')`, [exerciseId, LOG, LIB, ctx.position]);
  await ctx.db.query(`insert into public.workout_log_sets(id, workout_log_exercise_id, set_number, status, actual_load_value, actual_load_unit)
    values ($1, $2, 1, 'pending', 50, 'lb')`, [setId, exerciseId]);
  return { exerciseId, setId };
}

async function read(ctx, exerciseId) {
  const { rows: [{ e }] } = await ctx.db.query('select to_jsonb(e) as e from public.workout_log_exercises e where id = $1', [exerciseId]);
  const { rows } = await ctx.db.query('select to_jsonb(s) as s from public.workout_log_sets s where workout_log_exercise_id = $1 and not archived order by set_number', [exerciseId]);
  return { ...e, sets: rows.map((row) => row.s) };
}

// backend workoutSetUpdatePayload for a reps/weight exercise (validation omitted: inputs are valid).
function payloadFor(fields, set, exercise, now) {
  const has = (key) => Object.hasOwn(fields, key);
  const status = fields.status === 'completed' ? 'completed' : fields.status === 'pending' ? 'pending' : set.status;
  const loadValue = has('actual_load_value') ? fields.actual_load_value : set.actual_load_value;
  const loadUnit = has('actual_load_unit') ? fields.actual_load_unit : set.actual_load_unit;
  return {
    ...actualMetrics(fields, set, exercise),
    status,
    actual_load_value: loadValue === '' || loadValue === null ? null : Number(loadValue),
    actual_load_unit: loadValue === '' || loadValue === null ? null : loadUnit,
    actual_reps: has('actual_reps') ? fields.actual_reps : set.actual_reps,
    actual_rpe: has('actual_rpe') ? fields.actual_rpe : set.actual_rpe,
    completed_at: status === 'completed' ? now : null,
    updated_at: now,
  };
}

// PATCH /workout-logs/:id/sets/:setId with an event envelope.
async function eventWrite(ctx, exerciseId, setId, { eventId, actor = 'client', base, seq, fields, origin }) {
  const exercise = await read(ctx, exerciseId);
  const set = exercise.sets.find((row) => row.id === setId);
  const payload = JSON.stringify(payloadFor(fields, set, exercise, new Date().toISOString()));
  const coach = actor === 'coach' ? '00000000-0000-4000-8000-000000000001' : null;
  const declared = origin && ctx.mode === 'new';
  const { rows: [{ r }] } = declared
    ? await ctx.db.query('select public.apply_workout_set_event_v2($1, $2, $3, $4, $5, $6, false, $7, $8::jsonb, $9) as r',
      [setId, eventId, actor, coach, base, seq, exercise.plan_revision ?? 0, payload, origin])
    : await ctx.db.query('select public.apply_workout_set_event($1, $2, $3, $4, $5, $6, false, $7, $8::jsonb) as r',
      [setId, eventId, actor, coach, base, seq, exercise.plan_revision ?? 0, payload]);
  return { ...r.set, event: { id: eventId, outcome: r.outcome, original_outcome: r.original_outcome || null, conflict_id: r.conflict_id || null } };
}

// PATCH without an event id: the legacy writer (no revision, Node updated_at).
async function legacyWrite(ctx, setId, value) {
  await sleep(3);
  const { rows: [{ s }] } = await ctx.db.query(`update public.workout_log_sets set status = 'pending', actual_load_value = $2, actual_load_unit = 'lb',
    actual_reps = null, actual_rpe = null, completed_at = null, updated_at = $3, entered_by = 'coach', entered_by_coach_id = '00000000-0000-4000-8000-000000000001'
    where id = $1 returning to_jsonb(public.workout_log_sets.*) as s`, [setId, value, new Date().toISOString()]);
  return s;
}

/** A device: its own marker storage, and the tracker's quick-complete decision. */
function device() {
  const markers = {};
  return {
    markers,
    // enqueueSet: a prefill write binds { op, base }, an entered write { op, base, origin: 'entered' }.
    enqueue(setId, op, base, origin) { markers[setId] = origin === 'prefill' ? { op, base } : { op, base, origin: 'entered' }; },
    // onSetSaved -> ackPrefillMarker.
    ack(setId, op, response) {
      const next = ackPrefillMarker(markers[setId], { id: op, setId }, response);
      if (next) markers[setId] = next; else delete markers[setId];
    },
    quick(exercise) {
      const view = annotateValueViews(exercise, markers, { draftIds: new Set() });
      const unresolved = unresolvedPrefillSet(exercise, markers, () => false);
      return { view, plan: exerciseQuickPlan(view, { unresolved }) };
    },
  };
}

// Runs the device's quick complete for real (each entry as its own entered event).
async function runQuick(ctx, dev, exerciseId) {
  const exercise = await read(ctx, exerciseId);
  const { view, plan } = dev.quick(exercise);
  const sent = [];
  if (plan.available) {
    for (const entry of plan.entries) {
      const set = exercise.sets.find((row) => row.id === entry.setId);
      const op = randomUUID();
      dev.enqueue(entry.setId, op, set.revision, 'entered');
      const response = await eventWrite(ctx, exerciseId, entry.setId, { eventId: op, base: set.revision, seq: 50, fields: entry.payload, origin: 'entered' });
      dev.ack(entry.setId, op, response);
      sent.push({ load: entry.payload.actual_load_value, outcome: response.event.outcome });
    }
  }
  const after = (await read(ctx, exerciseId)).sets[0];
  return { views: view.sets.map((set) => set.value_view), available: plan.available, reason: plan.reason, sent, status: after.status, load: after.actual_load_value };
}

// Device A records the set with quick complete (load null: untouched prefill), then Undoes it.
async function quickThenUndo(ctx, dev, exerciseId, setId, { lose = false } = {}) {
  const first = await read(ctx, exerciseId);
  const { plan } = dev.quick(first);
  if (!plan.available || plan.entries[0].payload.actual_load_value !== null) throw Error(`setup quick ${JSON.stringify(plan)}`);
  const q = randomUUID();
  dev.enqueue(setId, q, 0, 'entered');
  dev.ack(setId, q, await eventWrite(ctx, exerciseId, setId, { eventId: q, base: 0, seq: 1, fields: plan.entries[0].payload, origin: 'entered' }));
  const u = randomUUID();
  const fields = plan.entries[0].restore;
  dev.enqueue(setId, u, 1, 'prefill');
  const response = await eventWrite(ctx, exerciseId, setId, { eventId: u, base: 1, seq: 2, fields, origin: 'prefill' });
  if (response.event.outcome !== 'applied' || response.revision !== 2) throw Error(`setup undo ${JSON.stringify(response)}`);
  if (!lose) dev.ack(setId, u, response);
  return { undo: u, restore: fields };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${JSON.stringify(detail)}`); };

async function vectors(ctx) {
  const tag = ctx.mode;
  // F1: acknowledged own Undo at revision 2, then a legacy no-event write of V
  // (revision and last_event_id stay), then reload and quick complete.
  for (const value of [50, 55]) {
    const { exerciseId, setId } = await freshExercise(ctx);
    const a = device();
    const { undo } = await quickThenUndo(ctx, a, exerciseId, setId);
    const legacy = await legacyWrite(ctx, setId, value);
    const proof = { revision: legacy.revision, lastEventIsUndo: legacy.last_event_id === undo, origin: legacy.value_origin ?? '(no column)' };
    const outcome = await runQuick(ctx, a, exerciseId);
    check(`${tag} F1 legacy ${value} after acknowledged Undo: explicit weight kept`, legacy.revision === 2 && proof.lastEventIsUndo && outcome.load === value, { proof, ...outcome });
    // Recovery: the person records the set on its own with the weight.
    if (!outcome.available) {
      const row = (await read(ctx, exerciseId)).sets[0];
      const op = randomUUID();
      a.enqueue(setId, op, row.revision, 'entered');
      a.ack(setId, op, await eventWrite(ctx, exerciseId, setId, { eventId: op, base: row.revision, seq: 9, fields: { actual_load_value: value, actual_load_unit: 'lb' }, origin: 'entered' }));
      const recovered = await runQuick(ctx, a, exerciseId);
      check(`${tag} F1 legacy ${value} recovery: own explicit entry records ${value}`, recovered.available && recovered.status === 'completed' && recovered.load === value, recovered);
    }
  }
  // F2: own Undo committed at revision 2, reply lost; another device explicitly
  // enters V at revision 3; the retry is replayed with the current row.
  for (const value of [50, 55]) {
    const { exerciseId, setId } = await freshExercise(ctx);
    const a = device();
    const b = device();
    const { undo, restore } = await quickThenUndo(ctx, a, exerciseId, setId, { lose: true });
    const bRow = (await read(ctx, exerciseId)).sets[0];
    const bop = randomUUID();
    b.enqueue(setId, bop, bRow.revision, 'entered');
    b.ack(setId, bop, await eventWrite(ctx, exerciseId, setId, { eventId: bop, base: bRow.revision, seq: 1, fields: { actual_load_value: value, actual_load_unit: 'lb' }, origin: 'entered' }));
    const retry = await eventWrite(ctx, exerciseId, setId, { eventId: undo, base: 1, seq: 2, fields: restore, origin: 'prefill' });
    a.ack(setId, undo, retry);
    const proof = { outcome: retry.event.outcome, original: retry.event.original_outcome, replyRevision: retry.revision, marker: a.markers[setId] ?? null };
    const outcome = await runQuick(ctx, a, exerciseId);
    check(`${tag} F2 replayed Undo then other device entered ${value}: weight kept`, retry.event.outcome === 'replayed' && retry.revision === 3 && outcome.load === value, { proof, ...outcome });
  }
  // Control: own Undo acknowledged, nobody else wrote, reload: untouched, recorded without a weight (no false gate).
  {
    const { exerciseId, setId } = await freshExercise(ctx);
    const a = device();
    await quickThenUndo(ctx, a, exerciseId, setId);
    const outcome = await runQuick(ctx, a, exerciseId);
    check(`${tag} control own acknowledged Undo + reload: not gated, prescription not recorded`, outcome.available && outcome.status === 'completed' && outcome.load === null, outcome);
  }
  // Control: own explicit same-value save (finding 01), reload: recorded as 50 (no false gate).
  {
    const { exerciseId, setId } = await freshExercise(ctx);
    const a = device();
    const op = randomUUID();
    a.enqueue(setId, op, 0, 'entered');
    a.ack(setId, op, await eventWrite(ctx, exerciseId, setId, { eventId: op, base: 0, seq: 1, fields: { actual_load_value: 50, actual_load_unit: 'lb' }, origin: 'entered' }));
    const outcome = await runQuick(ctx, a, exerciseId);
    check(`${tag} control own explicit same-value save + reload: records 50`, outcome.available && outcome.status === 'completed' && outcome.load === 50, outcome);
  }
  // Lost acknowledgement, no other writer: the replay cannot prove the
  // original state. New schema: the server origin (prefill) answers it.
  // Old server: gated, the 50 kept (never recorded as performed, never stripped).
  {
    const { exerciseId, setId } = await freshExercise(ctx);
    const a = device();
    const { undo, restore } = await quickThenUndo(ctx, a, exerciseId, setId, { lose: true });
    const retry = await eventWrite(ctx, exerciseId, setId, { eventId: undo, base: 1, seq: 2, fields: restore, origin: 'prefill' });
    a.ack(setId, undo, retry);
    const outcome = await runQuick(ctx, a, exerciseId);
    const ok = ctx.mode === 'new'
      ? outcome.available && outcome.status === 'completed' && outcome.load === null
      : !outcome.available && outcome.status === 'pending' && outcome.load === 50;
    check(`${tag} lost acknowledgement, replay only: ${ctx.mode === 'new' ? 'server prefill is untouched' : 'gated, 50 kept'}`, retry.event.outcome === 'replayed' && ok, outcome);
  }
  // Legacy no-revision write after a prior own ENTERED marker: the marker no
  // longer describes the row; the unknown 60 is gated, never recorded or stripped.
  {
    const { exerciseId, setId } = await freshExercise(ctx);
    const a = device();
    const op = randomUUID();
    a.enqueue(setId, op, 0, 'entered');
    a.ack(setId, op, await eventWrite(ctx, exerciseId, setId, { eventId: op, base: 0, seq: 1, fields: { actual_load_value: 55, actual_load_unit: 'lb' }, origin: 'entered' }));
    const legacy = await legacyWrite(ctx, setId, 60);
    const outcome = await runQuick(ctx, a, exerciseId);
    check(`${tag} legacy write after own entered marker: gated, 60 kept`, legacy.revision === 1 && legacy.last_event_id === op && !outcome.available && outcome.load === 60, outcome);
  }
}

let failed = 0;
for (const mode of ['new', 'old']) {
  const ctx = await database(mode);
  try {
    console.log(`${mode}: ${ctx.migrations} migrations, last ${ctx.last}`);
    await vectors(ctx);
  } finally {
    await ctx.db.close();
  }
}
failed = results.filter((row) => !row.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
