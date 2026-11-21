// Disposable PostgreSQL (WASM) execution of the whole-week SQL groups.
// Single connection: proves SQL behavior/grants, NOT multi-connection races
// (see concurrency.sh) and NOT hosted application. No URLs, keys or env files.
//
//   PGLITE_MODULE=/abs/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/whole_week/pglite-check.mjs
//   ... node supabase/tests/whole_week/pglite-check.mjs --full   # every repo migration in filename order
//
// PGlite is a test-only module outside this repository; it is not a project dependency.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to a test-only @electric-sql/pglite build outside this repository');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const full = process.argv.includes('--full');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const contrib = async (name) => (await import(pathToFileURL(path.join(path.dirname(process.env.PGLITE_MODULE), 'contrib', `${name}.js`))))[name];
const db = full
  ? new PGlite({ extensions: { pgcrypto: await contrib('pgcrypto'), btree_gist: await contrib('btree_gist') } })
  : new PGlite();
const migrationName = (await readdir(path.join(root, 'supabase/migrations'))).find((name) => name.endsWith('_whole_week_outside_activity.sql'));
if (!migrationName) throw new Error('whole-week migration not found');

let failures = 0;
try {
  if (full) {
    // Same Supabase-shaped prelude as supabase/tests/cue_retry/pglite-check.mjs.
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;create schema auth;
      create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as 'select null::uuid';create schema extensions;create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[],owner uuid,created_at timestamptz default now(),updated_at timestamptz default now());
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb,path_tokens text[],version text,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz);
      create function storage.foldername(name text) returns text[] language sql as 'select string_to_array(name, ''/'')';grant usage on schema public to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant all on functions to anon,authenticated,service_role;create publication supabase_realtime;`);
    const migrations = (await readdir(path.join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort();
    for (const name of migrations) await db.exec(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'));
    console.log(`Applied ${migrations.length} repository migrations in filename order`);
  } else {
    await db.exec(await readFile(path.join(here, 'schema.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'supabase/migrations', migrationName), 'utf8'));
    console.log(`Applied standalone fixture schema + ${migrationName}`);
  }
  const fixtures = await readFile(path.join(here, 'fixtures.sql'), 'utf8');
  const groups = (await readdir(here)).filter((name) => /^0\d_.*\.sql$/.test(name)).sort();
  for (const group of groups) {
    try {
      await db.exec(`begin;\n${fixtures}\n${await readFile(path.join(here, group), 'utf8')}\nrollback;`);
      console.log(`${group} PASS`);
    } catch (error) {
      failures += 1;
      console.error(`${group} FAIL: ${error.message}`);
      await db.exec('rollback;').catch(() => {});
      await db.exec('reset role;').catch(() => {});
    }
  }
  // Every group rolled back: nothing persists between groups.
  const leftover = await db.query('select (select count(*) from public.outside_activities)::int a, (select count(*) from public.outside_activity_receipts)::int r');
  if (leftover.rows[0].a || leftover.rows[0].r) { failures += 1; console.error('FAIL: rows leaked out of a rolled-back group'); }
} finally {
  await db.close();
}
if (failures) {
  console.error(`${failures} whole-week SQL group(s) failed`);
  process.exit(1);
}
console.log('PASS whole-week SQL groups (single connection; races are in concurrency.sh)');
