import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
if (!process.env.PGLITE_MODULE) throw Error('Set PGLITE_MODULE to the existing test-only PGlite module.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
const contrib = (n) => import(pathToFileURL(path.join(path.dirname(process.env.PGLITE_MODULE), 'contrib', `${n}.js`)));
const phase = process.argv[2] || 'write';
const directory = process.argv[3] || await mkdtemp('/tmp/cvf-rescue-db-');
if (!/^\/(?:private\/)?tmp\/cvf-rescue-db-[A-Za-z0-9_-]+$/.test(directory)) throw Error('Only a disposable /tmp/cvf-rescue-db-* store is allowed.');
const db = new PGlite(directory, { extensions: { pgcrypto: (await contrib('pgcrypto')).pgcrypto, btree_gist: (await contrib('btree_gist')).btree_gist } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const coachAuth=id(101), clientAuth=id(111), otherAuth=id(102), adminAuth=id(103);
const program=id(6), assignment=id(7), client=id(11), workout=id(5);
const read = async (actor=coachAuth, assigned=null) => (await db.query('select public.read_workout_rescue($1,$2,$3,$4) as result',[program,day,actor,assigned])).rows[0].result;
let day;
process.once('SIGTERM', async()=>{await db.close();process.exit(0);});
try {
 if (phase==='write') {
  // The same disposable Supabase scaffolding used by the repository's SQL regression lanes.
  const template=await readFile('supabase/tests/pr121_concurrency/pglite-check.mjs','utf8');
  const boot=template.match(/await db.exec\(`(set timezone[\s\S]*?create publication supabase_realtime;)`\);/)[1];
  await db.exec(boot);
  const names=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
  for(const name of names) await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
  console.log(`Applied ${names.length} actual local migrations; last ${names.at(-1)}`);
  if(process.env.RESCUE_COMPAT_HISTORY_SQL){await db.exec(await readFile(process.env.RESCUE_COMPAT_HISTORY_SQL,'utf8'));console.log('Compatibility: applied separate Program History migration in this disposable test DB only');}
  const fixtures=await readFile('supabase/tests/pr120_repairs/fixtures.sql','utf8');
  await db.exec(fixtures.replace("update public.workout_logs set status = 'completed'","insert into public.workout_log_sets(id,workout_log_exercise_id,set_number,status,actual_load_value,actual_load_unit,actual_reps,completed_at) values ('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000037',1,'completed',42,'lb',8,now()); update public.workout_logs set status = 'completed'"));
  await db.query("update public.programs set name='LOCAL DEMONSTRATION · Foundation Strength' where id=$1",[program]);
  await db.query("update public.workouts set name='Fictional lower strength' where id=$1",[workout]);
  await db.query("update public.workout_logs set status='abandoned' where client_id=$1 and status='active'",[client]);
  await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6),($7,$8)',[coachAuth,'coach@example.invalid',clientAuth,'client@example.invalid',otherAuth,'other@example.invalid',adminAuth,'admin@example.invalid']);
  await db.query('update public.coaches set auth_user_id=$1 where id=$2',[coachAuth,id(1)]);
  await db.query('update public.clients set auth_user_id=$1 where id=$2',[clientAuth,client]);
  await db.query('insert into public.coaches(id,auth_user_id,name,email,is_admin) values ($1,$2,$3,$4,false),($5,$6,$7,$8,true)',[id(2),otherAuth,'Other coach','other@example.invalid',id(3),adminAuth,'Admin','admin@example.invalid']);
  await db.query("insert into public.workout_exercises(id,workout_id,custom_name,sets,reps,position,default_load_value,default_load_unit,rest) values ($1,$2,'Hinge','3','10',1,40,'lb','90s'),($3,$2,'Core','3','10',2,null,null,'45s')",[id(62),workout,id(63)]);
 }
 day=(await db.query('select id from public.program_days where program_id=$1 and not archived order by day_number',[program])).rows[0].id;
 if(phase==='write') {
  const first=await read(); assert.deepEqual(first.plan.branches,[]); assert.equal(first.plan.revision,0);
  const branch={id:'short',name:'25-minute dumbbells',minutes:25,equipment:['dumbbells'],intent:'Retain squat and hinge; reduce sets and omit core.',enabled:true,items:[{source_id:id(61),sets:1},{source_id:id(62),sets:2}]};
  await db.exec('set role service_role');
  await db.query('select public.save_workout_rescue($1,$2,$3,$4,$5,$6)',[program,day,coachAuth,first.plan.version,0,JSON.stringify([branch])]);
  const saved=await read(); assert.equal(saved.plan.revision,1); assert.equal(saved.plan.branches[0].intent,branch.intent);
  await assert.rejects(db.query('select public.save_workout_rescue($1,$2,$3,$4,$5,$6)',[program,day,coachAuth,first.plan.version,0,'[]']),/changed/i);
  await assert.rejects(read(otherAuth),/not found/i);
  await assert.rejects(read(clientAuth),/not found/i);
  assert.equal((await read(clientAuth,assignment)).plan.revision,1);
  await assert.rejects(db.query('select public.save_workout_rescue($1,$2,$3,$4,$5,$6)',[program,day,clientAuth,saved.plan.version,1,'[]']),/coach|required|not found/i);
  await db.exec('reset role');
  const source=JSON.stringify((await db.query('select * from public.workout_exercises where workout_id=$1 order by id',[workout])).rows);
  const history=JSON.stringify((await db.query("select to_jsonb(l) as log,(select jsonb_agg(e order by e.id) from public.workout_log_exercises e where e.workout_log_id=l.id) as exercises,(select jsonb_agg(s order by s.id) from public.workout_log_sets s join public.workout_log_exercises se on se.id=s.workout_log_exercise_id where se.workout_log_id=l.id) as sets from public.workout_logs l where status='completed' order by id")).rows);
  const clientView=await read(clientAuth,assignment);
  const request={branch_id:'short',version:saved.plan.version,revision:1,selection_version:clientView.selection_version,minutes:25,equipment:['dumbbells'],request_id:id(201)};
  const start=async (r=request, actor=clientAuth, target=client) => (await db.query('select public.start_workout_rescue_with_cues($1,$2,$3,$4,$5,$6) as result',[actor,target,assignment,day,JSON.stringify(r),null]).catch(error=>{ if(/operator does not exist/.test(error.message)) console.error(error.where); throw error; })).rows[0].result;
  await db.exec('set role service_role');
  await db.query("insert into public.program_assignment_exercise_loads(id,program_assignment_id,program_day_id,workout_exercise_id,load_value,load_unit) values ($1,$2,$3,$4,55,'lb')",[id(401),assignment,day,id(61)]);
  await assert.rejects(start(),/changed/i,'assignment load changed after review must reject the old selection');
  await db.query('update public.program_assignment_exercise_loads set archived=true where id=$1',[id(401)]);
  for(const change of [{minutes:10},{equipment:[]},{branch_id:'missing'},{version:'old'},{revision:0},{selection_version:'old'}]) await assert.rejects(start({...request,...change}),/fallback|changed|fit/i);
  await assert.rejects(start(request,otherAuth),/not found/i);
  await assert.rejects(start(request,clientAuth,id(12)),/not found/i);
  // A failure after canonical start and Rescue application must roll back the entire start.
  await db.exec(`reset role; create function public.fail_rescue_test() returns trigger language plpgsql as $$ begin raise exception 'injected rescue receipt failure'; end $$; create trigger fail_rescue_test before insert on public.workout_rescue_start_receipts for each row execute function public.fail_rescue_test(); set role service_role;`);
  await assert.rejects(start(),/injected rescue receipt failure/);
  assert.equal((await db.query("select count(*)::int as n from public.workout_logs where client_id=$1 and status='active'",[client])).rows[0].n,0);
  await db.exec('reset role;drop trigger fail_rescue_test on public.workout_rescue_start_receipts;drop function public.fail_rescue_test();set role service_role;');
  const result=await start();assert.equal(result.outcome,'started');
  assert.equal((await start()).outcome,'replayed');
  assert.equal((await start({...request,request_id:id(202)})).outcome,'conflict');
  await assert.rejects(start({...request,minutes:50}),/request.*changed/i);
  const log=(await db.query('select * from public.workout_logs where id=$1',[result.workout_log_id])).rows[0];
  const exercises=(await db.query('select exercise_name,prescribed_sets,prescribed_reps,prescribed_load_value from public.workout_log_exercises where workout_log_id=$1 and not archived order by position',[log.id])).rows;
  assert.deepEqual(exercises.map(e=>[e.exercise_name,e.prescribed_sets,e.prescribed_reps]),[['Original','1','8'],['Hinge','2','10']]);
  assert.equal(exercises[1].prescribed_load_value,'40');
  assert.equal((await db.query('select count(*)::int as n from public.workout_log_sets s join public.workout_log_exercises e on e.id=s.workout_log_exercise_id where e.workout_log_id=$1 and not s.archived and not e.archived',[log.id])).rows[0].n,3);
  assert.equal(log.rescue_snapshot.intent,branch.intent);
  assert.equal(log.rescue_snapshot.author_name_snapshot,'Fictional Repair Coach');
  assert.equal(log.rescue_snapshot.authored_by,id(1));
  await assert.rejects(db.query('update public.workout_rescue_start_receipts set request_hash=request_hash'),/permission denied|append.only/i);
  assert.equal((await db.query("select bool_and(relrowsecurity) as secured from pg_class where oid in ('public.workout_rescue_plans'::regclass,'public.workout_rescue_start_receipts'::regclass)")).rows[0].secured,true);
  await db.exec('reset role');
  assert.equal(JSON.stringify((await db.query('select * from public.workout_exercises where workout_id=$1 order by id',[workout])).rows),source);
  assert.equal(JSON.stringify((await db.query("select to_jsonb(l) as log,(select jsonb_agg(e order by e.id) from public.workout_log_exercises e where e.workout_log_id=l.id) as exercises,(select jsonb_agg(s order by s.id) from public.workout_log_sets s join public.workout_log_exercises se on se.id=s.workout_log_exercise_id where se.workout_log_id=l.id) as sets from public.workout_logs l where status='completed' order by id")).rows),history);
  await assert.rejects(db.query("update public.workout_log_sets set actual_reps=99 where id=$1",[id(99)]),/completed|immutable|not active/i);
  await db.query("update public.workout_logs set status='completed',completed_at=now() where id=$1",[log.id]);
  const sealed=JSON.stringify((await db.query('select * from public.workout_logs where id=$1',[log.id])).rows);
  if(process.env.RESCUE_COMPAT_HISTORY_SQL){
    const rows=(await db.query('select * from public.workout_exercises where workout_id=$1 and not archived order by position',[workout])).rows;
    await db.query('select public.save_workout_with_program_history($1,$2,$3,$4,$5,$6)',[workout,id(1),'Fictional lower strength',null,'Changed original intent',JSON.stringify(rows)]);
    assert.ok((await db.query('select count(*)::int as n from public.program_change_revisions')).rows[0].n>=2);
  } else await db.query("update public.workouts set goal='Changed original intent' where id=$1",[workout]);
  assert.equal((await read()).stale,true);
  await assert.rejects(start({...request,request_id:id(203)}),/changed/i);
  assert.equal((await start()).outcome,'replayed','a committed receipt is replayable after original edits or completion');
  assert.equal(JSON.stringify((await db.query('select * from public.workout_logs where id=$1',[log.id])).rows),sealed);
  await db.query('update public.clients set coach_id=$1 where id=$2',[id(2),client]);
  await assert.rejects(read(coachAuth),/not found/i);assert.equal((await read(adminAuth)).stale,true);
  await db.query('update public.clients set coach_id=$1 where id=$2',[id(1),client]);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.workout_rescue_plans'),/permission denied/);
    await assert.rejects(read(),/permission denied/);
    await db.exec('reset role');
  }
  await writeFile(path.join(directory,'receipt-test.json'),JSON.stringify({day,logId:log.id,request}));
  console.log('PASS SQL authorization/current ownership, stale original/context/revision, compatibility, transactional failure, explicit snapshots, unchanged source/history, grants and replay');
 } else {
  const stored=JSON.parse(await readFile(path.join(directory,'receipt-test.json'),'utf8'));
  if(phase==='read') assert.equal((await read()).plan.branches[0].name,'25-minute dumbbells');
  const log=(await db.query('select * from public.workout_logs where id=$1',[stored.logId])).rows[0];
  assert.equal(log.rescue_snapshot.branch_id,'short');assert.equal(log.status,'completed');
  console.log('PASS separate process restart: saved coach choices and completed Rescue receipt survived');
  const {default:httpCheck}=await import('./http-check.cjs'); await httpCheck(db,{program,day,assignment,coachAuth,clientAuth,otherAuth,adminAuth,client},{serve:phase==='serve',port:phase==='serve'?Number(process.env.RESCUE_LOCAL_PORT||58416):0});
 }
} catch(error) { console.error('FAIL',error.message,error.where||'', error.detail||''); process.exitCode=1; } finally { await db.close(); }
if(phase==='write' && !process.exitCode) { const child=spawnSync(process.execPath,[process.argv[1],'read',directory],{env:process.env,stdio:'inherit'}); if(child.status)process.exit(child.status); console.log(`LOCAL_DB ${directory}`); }
