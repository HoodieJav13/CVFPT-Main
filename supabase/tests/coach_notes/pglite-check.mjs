// Coach Notes database boundary check in a disposable single-connection
// PostgreSQL (PGlite, WASM). Not a full Supabase reset, not hosted, not a race
// test: it applies the actual migration to the minimum baseline coach/client
// schema and checks what each Supabase role can do with the new table.
//   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/coach_notes/pglite-check.mjs
// PGlite is a test-only module outside this repository, never a project dependency.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

if (!process.env.PGLITE_MODULE) throw Error('Set PGLITE_MODULE to a test-only @electric-sql/pglite build; no repository dependency is added');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrations = path.join(root, 'supabase/migrations');
const read = (name) => readFile(path.join(migrations, name), 'utf8');
const notesMigration = (await readdir(migrations)).find((name) => name.endsWith('_client_coach_notes.sql'));

const IDS = {
  coach: 'a0000000-0000-4000-8000-00000000000a',
  client: '1a000000-0000-4000-8000-0000000000a1',
  note: 'aa000000-0000-4000-8000-0000000000a1',
};

async function scenario(label, { withRepoDefaults }) {
  const db = new PGlite();
  const results = [];
  const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) throw new Error(`${label}: ${name} ${detail}`); };
  try {
    // Supabase roles and the permissive new-project default: browser roles get
    // every privilege on future public tables unless a migration revokes it.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create publication supabase_realtime;`);
    const baseline = await read('20260710151327_baseline_schema.sql');
    await db.exec(baseline.slice(baseline.indexOf('create table if not exists coaches'), baseline.indexOf('-- ---------- Sessions')));
    if (withRepoDefaults) await db.exec(await read('20260711060556_restrict_data_api_to_service_role.sql'));
    await db.exec(await read(notesMigration));
    record('migration compiles', true, notesMigration);

    await db.exec(`insert into public.coaches (id, name, email) values ('${IDS.coach}', 'Fictional Coach A', 'coach-a@example.invalid');
      insert into public.clients (id, coach_id, name) values ('${IDS.client}', '${IDS.coach}', 'Sample Client A');`);

    const asRole = async (role, sql) => {
      await db.exec(`set role ${role}`);
      try { await db.exec(sql); return 'ok'; } catch (error) { return error.code || error.message; } finally { await db.exec('reset role'); }
    };
    const insert = `insert into public.client_coach_notes (id, client_id, author_coach_id, author_name_snapshot, content) values ('${IDS.note}', '${IDS.client}', '${IDS.coach}', 'Fictional Coach A', 'Private fictional note.')`;

    // Browser roles (what PostgREST would use for anon/authenticated sessions).
    for (const role of ['anon', 'authenticated']) {
      for (const [verb, sql] of [
        ['select', 'select * from public.client_coach_notes'],
        ['insert', insert.replace(IDS.note, 'ab000000-0000-4000-8000-0000000000a1')],
        ['update', "update public.client_coach_notes set content = 'x'"],
        ['delete', 'delete from public.client_coach_notes'],
      ]) {
        const outcome = await asRole(role, sql);
        record(`${role} ${verb} is denied`, outcome === '42501', outcome);
      }
    }
    // The backend's service role: non-destructive access only.
    record('service_role insert', (await asRole('service_role', insert)) === 'ok');
    record('service_role select', (await asRole('service_role', 'select id from public.client_coach_notes')) === 'ok');
    record('service_role update', (await asRole('service_role', "update public.client_coach_notes set content = 'Edited fictional note.', updated_at = now()")) === 'ok');
    const del = await asRole('service_role', 'delete from public.client_coach_notes');
    record('service_role delete is denied (archive, never delete)', del === '42501', del);

    // Table state: RLS on, no policies, no realtime publication.
    const rls = await db.query("select relrowsecurity from pg_class where oid = 'public.client_coach_notes'::regclass");
    record('row level security enabled', rls.rows[0].relrowsecurity === true);
    const policies = await db.query("select count(*)::int as n from pg_policy where polrelid = 'public.client_coach_notes'::regclass");
    record('no RLS policies (no browser path)', policies.rows[0].n === 0);
    const published = await db.query("select count(*)::int as n from pg_publication_rel where prrelid = 'public.client_coach_notes'::regclass");
    record('not in any publication (no realtime subscription)', published.rows[0].n === 0);
    const grants = await db.query("select grantee, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'client_coach_notes' and grantee in ('anon','authenticated','service_role','PUBLIC') group by grantee order by grantee");
    record('grants are exactly service_role INSERT,SELECT,UPDATE', JSON.stringify(grants.rows) === JSON.stringify([{ grantee: 'service_role', p: 'INSERT,SELECT,UPDATE' }]), JSON.stringify(grants.rows));

    // Constraints: trimmed 1..4000 content, named author, existing client/coach.
    const bad = async (sql) => { try { await db.exec(sql); return 'accepted'; } catch (error) { return error.code; } };
    const row = (content, name = 'Fictional Coach A', client = IDS.client) => `insert into public.client_coach_notes (client_id, author_coach_id, author_name_snapshot, content) values ('${client}', '${IDS.coach}', '${name}', ${content})`;
    record('empty content refused', (await bad(row("''"))) === '23514');
    record('untrimmed content refused', (await bad(row("' padded '"))) === '23514');
    record('4001 characters refused', (await bad(row("repeat('x', 4001)"))) === '23514');
    record('4000 characters accepted', (await bad(row("repeat('x', 4000)"))) === 'accepted');
    record('blank author name refused', (await bad(row("'ok'", '  '))) === '23514');
    record('unknown client refused', (await bad(row("'ok'", 'Fictional Coach A', '1f000000-0000-4000-8000-0000000000ff'))) === '23503');
    return results;
  } finally {
    await db.close();
  }
}

const report = {};
for (const [label, options] of [['supabase-defaults-only', { withRepoDefaults: false }], ['with-repo-data-api-restriction', { withRepoDefaults: true }]]) {
  report[label] = await scenario(label, options);
  for (const { name, detail } of report[label]) console.log(`${label}: PASS ${name}${detail ? ` (${detail})` : ''}`);
}
assert.ok(Object.values(report).every((rows) => rows.every((r) => r.ok)));
console.log(`ALL PASS (${Object.values(report).flat().length} checks)`);
