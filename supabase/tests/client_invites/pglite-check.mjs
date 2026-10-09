// Optional disposable PostgreSQL WASM check. Single connection: NOT a substitute
// for the owned Supabase reset or multi-connection races in run.sh.
import {readFile,readdir} from 'node:fs/promises';import {fileURLToPath,pathToFileURL} from 'node:url';import path from 'node:path';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to the temporary test-only module; no repository dependency is added');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));const db=new PGlite();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
 const baseline=await readFile(path.join(root,'supabase/migrations/20260710151327_baseline_schema.sql'),'utf8');
 await db.exec(baseline.slice(baseline.indexOf('create table if not exists coaches'),baseline.indexOf('-- ---------- Sessions')));
 const migration=(await readdir(path.join(root,'supabase/migrations'))).find(n=>n.endsWith('_client_invite_on_create.sql'));
 await db.exec(await readFile(path.join(root,'supabase/migrations',migration),'utf8'));console.log('Migration compiled in disposable PGlite');
 for(const f of (await readdir(path.dirname(fileURLToPath(import.meta.url)))).filter(n=>/^0.*\.sql$/.test(n)).sort()){
  await db.exec('begin;'+await readFile(new URL('./fixtures.sql',import.meta.url),'utf8')+await readFile(new URL('./'+f,import.meta.url),'utf8')+'rollback;');console.log(f+' PASS');
 }
}finally{await db.close();}
