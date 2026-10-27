// Optional disposable PostgreSQL (WASM) check for the PR120 repair SQL.
// SINGLE CONNECTION: it proves function logic, grants and statement-level
// rollback, not concurrent sessions or hosted application (see README.md).
//   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/pr120_repairs/pglite-check.mjs [migrations-dir]
// The test-only PGlite module stays outside this repository.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw Error('Set PGLITE_MODULE to a test-only @electric-sql/pglite dist/index.js; no repository dependency is added');
const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.resolve(process.argv[2] || path.join(here, '../../migrations'));
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const contrib = (n) => import(pathToFileURL(path.join(path.dirname(process.env.PGLITE_MODULE), 'contrib', `${n}.js`)));
const db = new PGlite({ extensions: { pgcrypto: (await contrib('pgcrypto')).pgcrypto, btree_gist: (await contrib('btree_gist')).btree_gist } });
let failed = 0;
try {
  // Minimal Supabase-shaped prelude, including its permissive default grants.
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
  const names = (await readdir(migrations)).filter((n) => n.endsWith('.sql')).sort();
  for (const name of names) await db.exec(await readFile(path.join(migrations, name), 'utf8'));
  console.log(`chain applied: ${names.length} migrations, last ${names.at(-1)}`);
  const fixtures = await readFile(path.join(here, 'fixtures.sql'), 'utf8');
  for (const file of (await readdir(here)).filter((n) => /^0.*\.sql$/.test(n)).sort()) {
    try {
      await db.exec(`begin;${fixtures}${await readFile(path.join(here, file), 'utf8')}`);
      console.log(`PASS ${file}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${file} :: ${String(error.message).split('\n')[0]}`);
    } finally {
      await db.exec('rollback;').catch(() => {});
    }
  }
} finally {
  await db.close();
}
if (failed) process.exitCode = 1;
