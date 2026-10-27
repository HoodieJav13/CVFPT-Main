// Disposable real PostgreSQL/WASM execution. No Supabase URLs/keys/env files.
import {readFile,readdir,mkdtemp} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw Error('Set the existing test-only PGLITE_MODULE path');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE));
const contrib=async n=>(await import(pathToFileURL(path.join(path.dirname(process.env.PGLITE_MODULE),'contrib',`${n}.js`))))[n];
const directory=process.argv[3]||await mkdtemp('/tmp/cvf-combined-db-');const phase=process.argv[2]||'write';
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
 migrations.sort((a,b)=>a.name.localeCompare(b.name));
 for(const item of migrations)await db.exec(await readFile(item.file,'utf8'));
 console.log(`Applied ${migrations.length} actual migrations in filename order in owned disk store`);
 await db.exec(`insert into auth.users(id,email) values('${id(101)}','coach@example.invalid'),('${id(102)}','other@example.invalid'),('${id(103)}','admin@example.invalid'),('${id(111)}','client@example.invalid'),('${id(112)}','otherclient@example.invalid');
 insert into public.coaches(id,auth_user_id,name,email,is_admin) values('${id(1)}','${id(101)}','Cue Coach','coach@example.invalid',false),('${id(2)}','${id(102)}','Other Coach','other@example.invalid',false),('${id(3)}','${id(103)}','Admin Coach','admin@example.invalid',true);
 insert into public.clients(id,auth_user_id,coach_id,name) values('${id(11)}','${id(111)}','${id(1)}','Cue Client'),('${id(12)}','${id(112)}','${id(2)}','Other Client');
 insert into public.exercise_library(id,name) values('${id(51)}','Fictional Squat');
 insert into public.workouts(id,coach_id,client_id,is_template,name) values('${id(5)}','${id(1)}','${id(11)}',false,'Cue Practice');
 insert into public.workout_exercises(id,workout_id,exercise_library_id,sets,reps,position) values('${id(61)}','${id(5)}','${id(51)}','1','8',0);
 insert into public.programs(id,coach_id,client_id,is_template,name,frequency_days) values('${id(6)}','${id(1)}','${id(11)}',false,'Cue Program',2);
 insert into public.program_days(id,program_id,day_number,workout_id) values('${id(71)}','${id(6)}',1,'${id(5)}'),('${id(72)}','${id(6)}',2,'${id(5)}');
 insert into public.program_assignments(id,program_id,client_id) values('${id(7)}','${id(6)}','${id(11)}');`);

 await db.exec(`insert into public.workout_exercises(id,workout_id,exercise_library_id,custom_name,sets,reps,position) values('${id(62)}','${id(5)}','${id(51)}','Same library, different source','2','8',1),('${id(63)}','${id(5)}',null,'Dropped core','1','10',2);`);
 const start=()=>rpc('start_workout_log_with_cues',[id(11),id(7),id(71),null,'client',null,null,id(111)]);
 const finish=async log=>{await rpc('complete_all_workout_sets_v2',[log,id(11),'client',null]);await rpc('complete_workout_log_v2',[log,id(11),null,null,null]);};
 const old=(await start()).workout_log_id;await finish(old);
 const sourceExercises=(await db.query('select * from public.workout_log_exercises where workout_log_id=$1 order by position',[old])).rows;
 const read=(ex,auth=101,log=old)=>rpc('read_exercise_cues',[id(auth),log,ex]);
 const mutate=(body,ex,log=old,auth=101)=>rpc('mutate_exercise_cue',[id(auth),log,ex,body]);
 const sealed=async()=>scalar("select jsonb_build_object('log',to_jsonb(l),'ex',(select jsonb_agg(e order by e.id) from public.workout_log_exercises e where e.workout_log_id=l.id),'sets',(select jsonb_agg(s order by s.id) from public.workout_log_sets s join public.workout_log_exercises e on e.id=s.workout_log_exercise_id where e.workout_log_id=l.id)) from public.workout_logs l where id=$1",[old]);
 const original=await sealed();
 await db.exec('set role service_role');
 const cues=[];
 for(const [i,e] of sourceExercises.entries())cues.push(await mutate({action:'create',request_id:id(401+i),text:'Exact source '+e.source_workout_exercise_id,source_version:(await read(e.id)).source_version},e.id));
 const view=()=>rpc('read_workout_rescue',[id(6),id(71),id(111),id(7)]);
 const initial=await view();
 const branch={id:'short',name:'Short approved choice',minutes:25,equipment:['dumbbells'],intent:'Keep squat, reduce volume, omit other sources.',enabled:true,items:[{source_id:id(61),sets:1}]};
 await rpc('save_workout_rescue',[id(6),id(71),id(101),initial.current_version,0,[branch]]);
 let current=await view();
 const request={branch_id:'short',version:current.plan.version,revision:current.plan.revision,selection_version:current.selection_version,minutes:25,equipment:['dumbbells'],request_id:id(410)};
 const rescue=(body=request,auth=111)=>rpc('start_workout_rescue_with_cues',[id(auth),id(11),id(7),id(71),body,null]);
 const counts=()=>scalar("select jsonb_build_array((select count(*) from public.workout_logs),(select count(*) from public.workout_log_exercises),(select count(*) from public.workout_log_sets),(select count(*) from public.workout_rescue_start_receipts))");
 const before=await counts();
 // Missing integration binding is exposed by a real trigger failure: the whole
 // Rescue start, snapshots and receipt must roll back when cue binding fails.
 await db.exec("reset role;create function public.combined_fail() returns trigger language plpgsql as $$begin raise exception 'injected combined failure';end$$;create trigger combined_fail before update on public.exercise_attempt_cues for each row execute function public.combined_fail();set role service_role;");
 await assert.rejects(rescue(),/injected combined failure/);assertions++;
 check(await counts(),before,'cue failure rolls all newly created rows back');
 await db.exec('reset role;drop trigger combined_fail on public.exercise_attempt_cues;create trigger combined_fail before insert on public.workout_rescue_start_receipts for each row execute function public.combined_fail();set role service_role;');
 await assert.rejects(rescue(),/injected combined failure/);assertions++;
 check(await counts(),before,'receipt failure rolls cue binding and all rows back');
 check((await read(sourceExercises[0].id)).outgoing[0].retry_log_id,null);
 await db.exec('reset role;drop trigger combined_fail on public.workout_rescue_start_receipts;drop function public.combined_fail();set role service_role;');
 // Load freshness rejects the old reviewed selection and also suppresses a
 // waiting cue when the client subsequently reviews the new load.
 await db.query("insert into public.program_assignment_exercise_loads(id,program_assignment_id,program_day_id,workout_exercise_id,load_value,load_unit) values($1,$2,$3,$4,55,'lb')",[id(450),id(7),id(71),id(61)]);
 await assert.rejects(rescue(),/changed/);assertions++;
 current=await view();const loaded=(await rescue({...request,request_id:id(451),selection_version:current.selection_version})).workout_log_id;
 check((await scalar('select count(*)::int from public.exercise_attempt_cues where retry_log_id=$1',[loaded])),0,'load change must not bind stale source cues');
 await finish(loaded);await db.query('update public.program_assignment_exercise_loads set archived=true where id=$1',[id(450)]);
 await denied(()=>rescue(request,102),'P0001');
 const result=await rescue();check(result.outcome,'started');
 const retry=result.workout_log_id;
 const retained=(await db.query('select * from public.workout_log_exercises where workout_log_id=$1 and not archived',[retry])).rows;check(retained.length,1);check(retained[0].source_workout_exercise_id,id(61));
 let incoming=(await read(retained[0].id,111,retry)).incoming;check(incoming.length,1);check(incoming[0].id,cues[0].id);
 check((await read(sourceExercises[1].id)).outgoing[0].retry_log_id,null,'same library different source omitted');check((await read(sourceExercises[2].id)).outgoing[0].retry_log_id,null,'dropped source omitted');
 check(incoming[0].stale_retry,false,'fingerprint uses final Rescue prescription');
 check((await rescue()).outcome,'replayed');check((await rescue()).workout_log_id,retry);
 await assert.rejects(rescue({...request,minutes:50}),/request.*changed/);assertions++;
 check((await rescue({...request,request_id:id(411)})).outcome,'conflict');
 await finish(retry);
 await mutate({action:'verdict',cue_id:cues[0].id,revision:incoming[0].revision,verdict:'fixed',request_id:id(412)},retained[0].id,retry);
 check((await read(retained[0].id,111,retry)).incoming[0].verdict,'fixed');
 check(await sealed(),original,'completed source log and performed sets immutable');
 check(await scalar('select count(*)::int from public.program_change_revisions'),0,'Rescue and cue activity never journal fixture data');
 const rows=(await db.query('select * from public.workout_exercises where workout_id=$1 and not archived order by position',[id(5)])).rows;
 rows[0].reps='12';await rpc('save_workout_with_program_history',[id(5),id(1),'Cue Practice',null,null,rows]);
 check(await scalar('select count(*)::int from public.program_change_revisions'),2,'one baseline + actual edit');
 check((await view()).stale,true);
 check((await read(sourceExercises[1].id)).outgoing[0].stale,true);
 await assert.rejects(rescue({...request,request_id:id(413)}),/changed/);assertions++;
 check((await rescue()).outcome,'replayed','replay after completion/source edit does not bind again');
 check(await sealed(),original);
 await denied(()=>db.query('update public.program_change_revisions set source=source'),'42501');
 for(const table of ['workout_rescue_plans','workout_rescue_start_receipts','program_change_revisions','exercise_attempt_cues','exercise_cue_receipts']){
 check(await scalar('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]),true);
 check(await scalar('select count(*)::int from pg_policy where polrelid=$1::regclass',['public.'+table]),0);
 }
 // Missing original source must not match a surviving same-library exercise.
 await db.query('update public.workout_exercises set archived=true where id=$1',[id(62)]);
 check(await rpc('exercise_cue_source_version',[old,sourceExercises[1].id]),null);
 const missingAttempt=(await start()).workout_log_id;
 check((await scalar('select count(*)::int from public.exercise_attempt_cues where retry_log_id=$1',[missingAttempt])),0);
 await finish(missingAttempt);
 check((await read(sourceExercises[1].id)).outgoing[0].retry_log_id,null);
 await db.query('update public.workout_exercises set archived=false where id=$1',[id(62)]);
 const combinedSignature='public.start_workout_rescue_with_cues(uuid,uuid,uuid,uuid,jsonb,uuid)';
 check(await scalar('select prosecdef from pg_proc where oid=$1::regprocedure',[combinedSignature]),false);
 for(const role of ['anon','authenticated'])check(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,combinedSignature]),false);
 check(await scalar("select has_function_privilege('service_role',$1,'EXECUTE')",[combinedSignature]),true);
 // Existing Quick edit/start behavior still traverses canonical functions.
 await db.query('insert into public.workouts(id,coach_id,client_id,is_template,name) values($1,$2,$3,false,$4)',[id(88),id(1),id(11),'Synthetic Quick']);
 await db.query("insert into public.workout_exercises(id,workout_id,custom_name,sets,reps,position) values($1,$2,'Quick drill','1','8',0)",[id(89),id(88)]);
 await db.query("insert into public.workout_assignments(id,client_id,workout_id,kind,assignment_mode,assigned_for,created_by_coach_id,create_request_id,create_request_hash) values($1,$2,$3,'quick','dated',current_date,$4,$5,'v1:'||repeat('a',64))",[id(87),id(11),id(88),id(1),id(86)]);
 // A transaction may begin before a cue is authored, then acquire the start
 // lock after it. Canonical started_at uses now() (transaction-start time).
 // The already-persisted waiting cue must still attach at fresh-start binding.
 await db.query('insert into public.workout_assignments(id,client_id,workout_id) values($1,$2,$3)',[id(91),id(11),id(5)]);
 const ordinary=()=>rpc('start_workout_log_with_cues',[id(11),null,null,id(91),'client',null,null,id(111)]);
 const beforeLong=(await ordinary()).workout_log_id;await finish(beforeLong);
 const beforeLongEx=await scalar('select id from public.workout_log_exercises where workout_log_id=$1 and source_workout_exercise_id=$2',[beforeLong,id(61)]);
 await db.exec('begin');
 const longCue=await mutate({action:'create',request_id:id(490),text:'Cue saved after transaction began',source_version:(await read(beforeLongEx,101,beforeLong)).source_version},beforeLongEx,beforeLong);
 const afterLong=(await ordinary()).workout_log_id;
 const linkedLong=await scalar('select retry_log_id from public.exercise_attempt_cues where id=$1',[longCue.id]);
 check(linkedLong,afterLong,'eligible cue must not be excluded by transaction-start timestamp');
 const lateSource=await scalar('select id from public.workout_log_exercises where workout_log_id=$1 and source_workout_exercise_id=$2',[beforeLong,id(62)]);
 const late=await mutate({action:'create',request_id:id(491),text:'Saved after active start',source_version:(await read(lateSource,101,beforeLong)).source_version},lateSource,beforeLong);
 check((await ordinary()).outcome,'resumed');check(await scalar('select retry_log_id from public.exercise_attempt_cues where id=$1',[late.id]),null,'resume never retroactively binds');
 await db.exec('commit');await finish(afterLong);
 const afterResume=(await ordinary()).workout_log_id;check(await scalar('select retry_log_id from public.exercise_attempt_cues where id=$1',[late.id]),afterResume);await finish(afterResume);
 const quickRows=(await db.query('select * from public.workout_exercises where workout_id=$1',[id(88)])).rows;
 check(await rpc('save_workout_with_program_history',[id(88),id(1),'Synthetic Quick',null,null,quickRows]),id(88));
 const quickStart=(await rpc('start_workout_log_with_cues',[id(11),null,null,id(87),'client',null,null,id(111)])).workout_log_id;
 await assert.rejects(rpc('save_workout_with_program_history',[id(88),id(1),'Too late',null,null,quickRows]),/quick_session_started/);assertions++;
 await finish(quickStart);check((await rpc('start_workout_log_with_cues',[id(11),null,null,id(87),'client',null,null,id(111)])).outcome,'already_completed');
 check(await scalar('select count(*)::int from public.program_change_revisions'),2,'unlinked Quick writes do not fabricate program history');
 await db.exec('reset role;create table public.pt_combined_test_ids(data jsonb);');
 await db.query('insert into public.pt_combined_test_ids values($1)',[JSON.stringify({old,oldEx:sourceExercises[0].id,retry,retryEx:retained[0].id,day:id(71),request})]);
 console.log(`PASS ${assertions} combined SQL assertions; cue and receipt rollback; exact-source omissions; final fingerprint; stale load/history; replay and immutable completed records`);
 }else{
 const ids=await scalar('select data from public.pt_combined_test_ids');
 check((await rpc('read_exercise_cues',[id(111),ids.retry,ids.retryEx])).incoming[0].verdict,'fixed');
 console.log('PASS separate-process combined Rescue cue verdict persistence');
 const {default:http}=await import('./http-check.cjs');await http(db,ids,{serve:phase==='serve'});
 }
}finally{await db.close();}
if(phase==='write'){const child=spawnSync(process.execPath,[process.argv[1],'read',directory],{env:process.env,stdio:'inherit'});if(child.status!==0)process.exit(child.status||1);console.log(`LOCAL_COMBINED_DB ${directory}`);}
