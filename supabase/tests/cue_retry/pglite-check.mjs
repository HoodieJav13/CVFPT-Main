// Disposable real PostgreSQL/WASM execution. No Supabase URLs/keys/env files.
import {readFile,readdir,mkdtemp} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw Error('Set the existing test-only PGLITE_MODULE path');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const contrib=async n=>(await import(pathToFileURL(path.join(path.dirname(process.env.PGLITE_MODULE),'contrib',`${n}.js`))))[n];
const directory=process.argv[3]||await mkdtemp('/tmp/cvf-cue-db-');const phase=process.argv[2]||'write';
const db=new PGlite(directory,{extensions:{pgcrypto:await contrib('pgcrypto'),btree_gist:await contrib('btree_gist')}});
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rpc=(name,args)=>scalar(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v));
let assertions=0;const check=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const denied=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);assertions++;};
try{
 if(phase==='write'){
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as 'select null::uuid';create schema extensions;create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[],owner uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb,path_tokens text[],version text,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz);
 create function storage.foldername(name text) returns text[] language sql as 'select string_to_array(name, ''/'')';grant usage on schema public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant all on functions to anon,authenticated,service_role;create publication supabase_realtime;`);
 const migrations=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).map(name=>({name,file:`supabase/migrations/${name}`}));
 if(process.env.CUE_HISTORY_MIGRATION)migrations.push({name:path.basename(process.env.CUE_HISTORY_MIGRATION),file:process.env.CUE_HISTORY_MIGRATION});
 migrations.sort((a,b)=>a.name.localeCompare(b.name));
 for(const item of migrations)await db.exec(await readFile(item.file,'utf8'));
 console.log(`Applied ${migrations.length} actual migrations in filename order in owned disk store${process.env.CUE_HISTORY_MIGRATION?' (including Program History compatibility)':''}`);
 await db.exec(`insert into auth.users(id,email) values('${id(101)}','coach@example.invalid'),('${id(102)}','other@example.invalid'),('${id(103)}','admin@example.invalid'),('${id(111)}','client@example.invalid'),('${id(112)}','otherclient@example.invalid');
 insert into public.coaches(id,auth_user_id,name,email,is_admin) values('${id(1)}','${id(101)}','Cue Coach','coach@example.invalid',false),('${id(2)}','${id(102)}','Other Coach','other@example.invalid',false),('${id(3)}','${id(103)}','Admin Coach','admin@example.invalid',true);
 insert into public.clients(id,auth_user_id,coach_id,name) values('${id(11)}','${id(111)}','${id(1)}','Cue Client'),('${id(12)}','${id(112)}','${id(2)}','Other Client');
 insert into public.exercise_library(id,name) values('${id(51)}','Fictional Squat');
 insert into public.workouts(id,coach_id,client_id,is_template,name) values('${id(5)}','${id(1)}','${id(11)}',false,'Cue Practice');
 insert into public.workout_exercises(id,workout_id,exercise_library_id,sets,reps,position) values('${id(61)}','${id(5)}','${id(51)}','1','8',0);
 insert into public.programs(id,coach_id,client_id,is_template,name,frequency_days) values('${id(6)}','${id(1)}','${id(11)}',false,'Cue Program',2);
 insert into public.program_days(id,program_id,day_number,workout_id) values('${id(71)}','${id(6)}',1,'${id(5)}'),('${id(72)}','${id(6)}',2,'${id(5)}');
 insert into public.program_assignments(id,program_id,client_id) values('${id(7)}','${id(6)}','${id(11)}');`);
 const start=async(day=71)=>rpc('start_workout_log_with_cues',[id(11),id(7),id(day),null,'client',null,null,id(111)]);
 const finish=async log=>{await rpc('complete_all_workout_sets_v2',[log,id(11),'client',null]);await rpc('complete_workout_log_v2',[log,id(11),null,null,null]);};
 const ex=log=>scalar('select id from public.workout_log_exercises where workout_log_id=$1',[log]);
 const old=(await start()).workout_log_id;await finish(old);const oldEx=await ex(old);
 const original=await scalar('select jsonb_build_object(\'log\',to_jsonb(l),\'ex\',(select jsonb_agg(e) from public.workout_log_exercises e where e.workout_log_id=l.id),\'sets\',(select jsonb_agg(s) from public.workout_log_sets s join public.workout_log_exercises e on e.id=s.workout_log_exercise_id where e.workout_log_id=l.id)) from public.workout_logs l where id=$1',[old]);
 const read=(auth,log=old,exercise=oldEx)=>rpc('read_exercise_cues',[id(auth),log,exercise]);
 const mutate=(auth,body,log=old,exercise=oldEx)=>rpc('mutate_exercise_cue',[id(auth),log,exercise,body]);
 const body={action:'create',request_id:id(201),text:'Press the floor away.',source_version:(await read(101)).source_version};
 await db.exec('set role service_role');
 const cue=await mutate(101,body);check(cue.verdict,'pending');check(await mutate(101,body),cue);
 await denied(()=>mutate(101,{...body,text:'Different'}),'P0409');
 await denied(()=>mutate(111,{...body,request_id:id(202)}),'P0403');await denied(()=>read(112),'P0404');await denied(()=>read(11),'P0404');await denied(()=>read(102),'P0404');await denied(()=>read(101,old,id(999)),'P0404');
 check((await read(111)).outgoing[0].text,body.text);check((await read(103)).outgoing.length,1);
 await db.exec(`reset role;update public.clients set coach_id='${id(2)}' where id='${id(11)}';set role service_role;`);
 await denied(()=>read(101),'P0404');await denied(()=>mutate(101,body),'P0404');await denied(()=>rpc('start_workout_log_with_cues',[id(11),id(7),id(71),null,'coach',id(1),null,id(101)]),'P0404');
 check((await read(102)).outgoing.length,1);
 await db.exec(`reset role;update public.clients set coach_id='${id(1)}' where id='${id(11)}';set role service_role;`);
 // A failed replay-receipt insert must also roll the cue edit back.
 await db.exec(`reset role;create function public.cue_receipt_test_fail() returns trigger language plpgsql as $$begin raise exception 'injected cue receipt failure';end$$;create trigger cue_receipt_test_fail before insert on public.exercise_cue_receipts for each row execute function public.cue_receipt_test_fail();set role service_role;`);
 await assert.rejects(mutate(101,{action:'edit',cue_id:cue.id,revision:cue.revision,text:'Must roll back',source_version:body.source_version,request_id:id(230)}),/injected cue receipt failure/);assertions++;
 check((await read(101)).outgoing[0].text,body.text);
 await db.exec('reset role;drop trigger cue_receipt_test_fail on public.exercise_cue_receipts;drop function public.cue_receipt_test_fail();set role service_role;');
 const edited=await mutate(101,{action:'edit',cue_id:cue.id,revision:cue.revision,text:'Slow the descent.',source_version:body.source_version,request_id:id(203)});
 await denied(()=>mutate(101,{action:'cancel',cue_id:cue.id,revision:1,request_id:id(204)}),'P0409');
 // Wrong day with identical exercise/library never binds.
 const wrong=(await start(72)).workout_log_id;check((await read(111,wrong,await ex(wrong))).incoming.length,0);await finish(wrong);
 // Link failure rolls back the real canonical workout creation and all children.
 await db.exec(`reset role;create function public.cue_test_fail() returns trigger language plpgsql as $$begin raise exception 'injected cue link failure';end$$;create trigger cue_test_fail before update on public.exercise_attempt_cues for each row execute function public.cue_test_fail();set role service_role;`);
 const logCount=await scalar('select count(*)::int from public.workout_logs');
 await assert.rejects(start(),/injected cue link failure/);assertions++;
 check(await scalar('select count(*)::int from public.workout_logs'),logCount);
 await db.exec('reset role;drop trigger cue_test_fail on public.exercise_attempt_cues;drop function public.cue_test_fail();set role service_role;');
 const retry=(await start()).workout_log_id;const retryEx=await ex(retry);let linked=(await read(111,retry,retryEx)).incoming[0];check(linked.text,edited.text);check(linked.retry_exercise_id,retryEx);
 check((await start()).outcome,'resumed');
 await denied(()=>mutate(101,{action:'edit',cue_id:cue.id,revision:linked.revision,text:'Too late',source_version:body.source_version,request_id:id(205)}),'P0409');
 await denied(()=>mutate(101,{action:'verdict',cue_id:cue.id,revision:linked.revision,verdict:'fixed',request_id:id(206)},retry,retryEx),'P0409');
 // A changed active attempt remains an earlier-plan cue, never a false success.
 await db.query('update public.workout_log_exercises set plan_revision=plan_revision+1 where id=$1',[retryEx]);
 check((await read(101,retry,retryEx)).incoming[0].stale_retry,true);
 await denied(()=>mutate(101,{action:'verdict',cue_id:cue.id,revision:linked.revision,verdict:'fixed',request_id:id(207)},retry,retryEx),'P0409');
 await db.query('update public.workout_log_exercises set plan_revision=plan_revision-1 where id=$1',[retryEx]);await finish(retry);
 for(const [i,verdict] of ['partial','nochange','pending','fixed'].entries()) {linked=(await read(101,retry,retryEx)).incoming[0];const result=await mutate(101,{action:'verdict',cue_id:cue.id,revision:linked.revision,verdict,request_id:id(210+i)},retry,retryEx);check(result.verdict,verdict);}
 await denied(()=>db.query('update public.workout_log_sets set actual_reps=99 where workout_log_exercise_id=$1',[oldEx]),'P0001');
 check(await scalar('select jsonb_build_object(\'log\',to_jsonb(l),\'ex\',(select jsonb_agg(e) from public.workout_log_exercises e where e.workout_log_id=l.id),\'sets\',(select jsonb_agg(s) from public.workout_log_sets s join public.workout_log_exercises e on e.id=s.workout_log_exercise_id where e.workout_log_id=l.id)) from public.workout_logs l where id=$1',[old]),original);
 // Fresh source cue: stale program skips linkage; soft cancel retains receipt.
 const freshCtx=await read(101,retry,retryEx);let fresh=await mutate(101,{...body,request_id:id(220),source_version:freshCtx.source_version},retry,retryEx);
 await db.query("update public.workout_exercises set reps='12' where id=$1",[id(61)]);
 check((await read(101,retry,retryEx)).outgoing[0].stale,true);
 const skipped=(await start()).workout_log_id;check((await read(111,skipped,await ex(skipped))).incoming.length,0);await finish(skipped);
 await mutate(101,{action:'cancel',cue_id:fresh.id,revision:fresh.revision,request_id:id(221)},retry,retryEx);check((await read(111,retry,retryEx)).outgoing[0].archived,true);
 // The existing standalone assignment model has its own exact retry identity.
 await db.query('insert into public.workout_assignments(id,client_id,workout_id) values($1,$2,$3)',[id(8),id(11),id(5)]);
 const standalone=()=>rpc('start_workout_log_with_cues',[id(11),null,null,id(8),'client',null,null,id(111)]);
 const solo=(await standalone()).workout_log_id;await finish(solo);const soloEx=await ex(solo);
 await mutate(101,{action:'create',request_id:id(240),text:'Standalone exact-source cue',source_version:(await read(101,solo,soloEx)).source_version},solo,soloEx);
 const soloRetry=(await standalone()).workout_log_id;check((await read(111,soloRetry,await ex(soloRetry))).incoming[0].text,'Standalone exact-source cue');await finish(soloRetry);
 await denied(()=>db.exec('delete from public.exercise_attempt_cues'),'42501');await denied(()=>db.exec('update public.exercise_cue_receipts set result=result'),'42501');
 for(const role of ['anon','authenticated']) {await db.exec(`reset role;set role ${role}`);await denied(()=>db.exec('select * from public.exercise_attempt_cues'),'42501');await denied(()=>read(101),'42501');await denied(()=>db.exec('select * from public.exercise_cue_receipts'),'42501');}
 await db.exec('reset role');
 check(await scalar("select count(*)::int from pg_policy where polrelid in ('public.exercise_attempt_cues'::regclass,'public.exercise_cue_receipts'::regclass)"),0);
 check(await scalar("select bool_and(relrowsecurity) from pg_class where oid in ('public.exercise_attempt_cues'::regclass,'public.exercise_cue_receipts'::regclass)"),true);
 await db.exec(`create table public.cue_test_ids(data jsonb);`);await db.query('insert into public.cue_test_ids values($1)',[JSON.stringify({old,oldEx,retry,retryEx,cue:cue.id})]);
 console.log(`PASS ${assertions} SQL behavior/authorization/rollback/immutability/grant assertions`);
 }else{
 const ids=await scalar('select data from public.cue_test_ids');const loaded=await rpc('read_exercise_cues',[id(111),ids.old,ids.oldEx]);check(loaded.outgoing[0].verdict,'fixed');check(loaded.outgoing[0].retry_log_id,ids.retry);console.log('PASS separate Node process reopened persisted SQL cue -> retry -> Fixed');
 const {default:http}=await import('./http-check.cjs');await http(db,ids,{serve:phase==='serve',verify:phase==='verify'});
 }
}finally{await db.close();}
if(phase==='write'){const child=spawnSync(process.execPath,[process.argv[1],'read',directory],{env:process.env,stdio:'inherit'});if(child.status!==0)process.exit(child.status||1);const again=spawnSync(process.execPath,[process.argv[1],'verify',directory],{env:process.env,stdio:'inherit'});if(again.status!==0)process.exit(again.status||1);console.log(`LOCAL_CUE_DB ${directory}`);}
