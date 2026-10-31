import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const modulePath=process.env.PGLITE_MODULE;
if(!modulePath) throw Error('Set test-only PGLITE_MODULE');
const {PGlite}=await import(pathToFileURL(modulePath));
const contrib=n=>import(pathToFileURL(path.join(path.dirname(modulePath),'contrib',`${n}.js`)));
const directory=process.argv[3] || await mkdtemp('/tmp/cvf-history-db-');
const phase=process.argv[2] || 'write';
const db=new PGlite(directory,{extensions:{pgcrypto:(await contrib('pgcrypto')).pgcrypto,btree_gist:(await contrib('btree_gist')).btree_gist}});
process.once('SIGTERM',async()=>{await db.close();process.exit(0);});
process.once('SIGINT',async()=>{await db.close();process.exit(0);});
const migrations=path.resolve('supabase/migrations');
const coach='00000000-0000-4000-8000-000000000001';
const program='00000000-0000-4000-8000-000000000006';
const workout='00000000-0000-4000-8000-000000000005';
try {
 if(phase==='write') {
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

 await db.exec((await readFile('supabase/tests/pr120_repairs/fixtures.sql','utf8')).replace("update public.workout_logs set status = 'completed'", "insert into public.workout_log_sets(id,workout_log_exercise_id,set_number,status,actual_load_value,actual_load_unit,actual_reps,completed_at) values ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000037',1,'completed',42,'lb',8,now()); update public.workout_logs set status = 'completed'"));
 assert.equal((await db.query('select count(*)::int as n from public.program_change_revisions')).rows[0].n,0,'migration must not backfill');
 const completed=JSON.stringify((await db.query("select to_jsonb(l) as log,(select jsonb_agg(e) from public.workout_log_exercises e where e.workout_log_id=l.id) as exercises,(select jsonb_agg(s) from public.workout_log_sets s join public.workout_log_exercises se on se.id=s.workout_log_exercise_id where se.workout_log_id=l.id) as sets from public.workout_logs l where l.status='completed'")).rows);
 const days=(await db.query('select day_number,workout_id,notes from public.program_days where program_id=$1 and not archived order by day_number',[program])).rows;
 await db.exec('set role service_role');
 await db.query('select public.save_program_with_history($1,$2,$3,$4,$5,$6)',[program,coach,'Persisted change',null,2,JSON.stringify(days)]);
 assert.equal((await db.query('select count(*)::int as n from public.program_change_revisions')).rows[0].n,2);
 await db.query('select public.save_program_with_history($1,$2,$3,$4,$5,$6)',[program,coach,'Persisted change',null,2,JSON.stringify(days)]);
 assert.equal((await db.query('select count(*)::int as n from public.program_change_revisions')).rows[0].n,2,'no-op edit must not manufacture a revision');
 const checkpoint=JSON.stringify((await db.query('select * from public.program_change_revisions order by id')).rows);
 // Inject history failure after the real program writer: both must roll back.
 await db.exec(`reset role; create function public.fail_history_test() returns trigger language plpgsql as $$ begin raise exception 'injected journal failure'; end $$; create trigger fail_history_test before insert on public.program_change_revisions for each row execute function public.fail_history_test(); set role service_role;`);
 await assert.rejects(db.query('select public.save_program_with_history($1,$2,$3,$4,$5,$6)',[program,coach,'Must roll back',null,2,JSON.stringify(days)]),/injected journal failure/);
 assert.equal((await db.query('select name from public.programs where id=$1',[program])).rows[0].name,'Persisted change');
 assert.equal(JSON.stringify((await db.query('select * from public.program_change_revisions order by id')).rows),checkpoint);
 await assert.rejects(db.query('select public.save_workout_with_program_history($1,$2,$3,$4,$5,$6)',[workout,coach,'Must roll back',null,null,'[]']),/injected journal failure/);
 assert.equal((await db.query('select name from public.workouts where id=$1',[workout])).rows[0].name,'Private Reused Workout');
 assert.equal((await db.query('select count(*)::int as n from public.workout_exercises where workout_id=$1 and not archived',[workout])).rows[0].n,1);
 await db.exec('reset role; drop trigger fail_history_test on public.program_change_revisions; drop function public.fail_history_test();');
 await db.exec("insert into public.coaches(id,name,email) values ('00000000-0000-4000-8000-000000000002','Other Coach','other@example.invalid'); set role service_role;");
 await assert.rejects(db.query('select public.save_program_with_history($1,$2,$3,$4,$5,$6)',[program,'00000000-0000-4000-8000-000000000002','Denied',null,2,JSON.stringify(days)]),/not found/i);
 await assert.rejects(db.query('update public.program_change_revisions set source=source'),/permission denied|append.only/i);
 await assert.rejects(db.query('delete from public.program_change_revisions'),/permission denied/i);
 for(const role of ['anon','authenticated']) {await db.exec(`reset role;set role ${role}`);await assert.rejects(db.query('select * from public.program_change_revisions'),/permission denied/);await assert.rejects(db.query('select public.save_program_with_history($1,$2,$3,$4,$5,$6)',[program,coach,'Denied',null,2,JSON.stringify(days)]),/permission denied/);}
 await db.exec('reset role;set role service_role');
 const exercises=(await db.query('select * from public.workout_exercises where workout_id=$1 and not archived order by position',[workout])).rows;
 exercises[0].reps='10';
 await db.query('select public.save_workout_with_program_history($1,$2,$3,$4,$5,$6)',[workout,coach,'Private Reused Workout',null,null,JSON.stringify(exercises)]);
 assert.equal((await db.query('select count(*)::int as n from public.program_change_revisions')).rows[0].n,3);
 const last=(await db.query('select snapshot from public.program_change_revisions order by id desc limit 1')).rows[0].snapshot;
 assert.equal(last.days[0].workout.exercises[0].reps,'10');
 await db.exec("reset role;update public.coaches set name='Renamed later' where id='00000000-0000-4000-8000-000000000001';");
 assert.equal((await db.query('select author_name_snapshot from public.program_change_revisions where author_coach_id is not null order by id desc limit 1')).rows[0].author_name_snapshot,'Fictional Repair Coach');
 await assert.rejects(db.query('update public.program_change_revisions set source=source'),/append.only/i);
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.program_change_revisions'::regclass")).rows[0].relrowsecurity,true);
 assert.equal((await db.query("select count(*)::int as n from pg_policy where polrelid='public.program_change_revisions'::regclass")).rows[0].n,0);
 await db.exec('reset role');
 assert.equal(JSON.stringify((await db.query("select to_jsonb(l) as log,(select jsonb_agg(e) from public.workout_log_exercises e where e.workout_log_id=l.id) as exercises,(select jsonb_agg(s) from public.workout_log_sets s join public.workout_log_exercises se on se.id=s.workout_log_exercise_id where se.workout_log_id=l.id) as sets from public.workout_logs l where l.status='completed'")).rows),completed);
 await assert.rejects(db.query("update public.workout_log_sets set actual_reps=99 where id='00000000-0000-4000-8000-000000000099'"),/completed|immutable|not active/i);
 console.log('PASS no backfill, atomic edit/revision, failure rollback, authorization, append-only grants, completed snapshot unchanged');
 } else if(phase==='read') {
 const rows=(await db.query('select * from public.program_change_revisions order by id')).rows;
 assert.equal(rows.length,3); assert.equal(rows[0].author_coach_id,null);assert.equal(rows[0].recorded_at,null);assert.equal(rows[1].author_name_snapshot,'Fictional Repair Coach');assert.equal(rows[1].snapshot.name,'Persisted change');
 const {diffProgramRevisions}=await import('../../../frontend/src/lib/programHistory.js');
 const changes=diffProgramRevisions(rows[0].snapshot,rows[1].snapshot);
 assert.deepEqual(changes.map(c=>[c.field,c.before,c.after]),[['name','Private Program','Persisted change']]);
 assert.equal(rows[2].snapshot.days[0].workout.exercises[0].reps,'10');
 const prescriptionChanges=diffProgramRevisions(rows[1].snapshot,rows[2].snapshot);
 assert.deepEqual(prescriptionChanges.map(c=>[c.field,c.before,c.after]),[['reps','8','10'],['reps','8','10']]);
 console.log('PASS separate-process reload reads durable revisions and exact stored before/after diff');
 const {default:httpCheck}=await import('./http-check.cjs');await httpCheck(db);
 } else {const {default:httpCheck}=await import('./http-check.cjs');await httpCheck(db,{serve:true});}

} finally {await db.close();}
if(phase==='write') {const r=spawnSync(process.execPath,[process.argv[1],'read',directory],{env:process.env,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);console.log(`LOCAL DB: ${directory}`);}
