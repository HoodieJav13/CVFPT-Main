// Actual Express workout router AND requireAuth. Only provider token verification
// and Supabase/PostgREST transport are replaced, by fictional identity + real SQL.
const assert=require('node:assert/strict');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
module.exports=async function httpCheck(db,ids,{serve=false,verify=false}={}){
 const supabasePath=require.resolve('../../../backend/src/supabase');
 const routePath=require.resolve('../../../backend/src/routes/workoutLogs');
 const authPath=require.resolve('../../../backend/src/middleware/auth');
 const originals=[supabasePath,routePath,authPath].map(p=>[p,require.cache[p]]);
 const safe=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error('Invalid test SQL identifier');return x;};
 const calls=[];let race=false;
 const users={'cue-coach':101,'cue-client':111,'cue-other':112,'cue-unrelated-coach':102,'cue-admin':103};
 const adapter={auth:{async getUser(token){return {data:{user:users[token]?{id:id(users[token]),email:'fictional@example.invalid'}:null},error:users[token]?null:{message:'Invalid fictional token'}};}},
 from(table){safe(table);const values=[],filters=[];let columns='*',orders=[],cap='',update=null,inserts=null;
  const filter=(k,v,op)=>{values.push(v);filters.push(`${safe(k)} ${op} $${values.length}`);};
  const q={select(c='*'){columns=c;return q;},upsert(rows){inserts=Array.isArray(rows)?rows:[rows];return q;},insert(rows){inserts=Array.isArray(rows)?rows:[rows];return q;},or(expression){const terms=expression.split(',').map(term=>{const [k,op,v]=term.split('.');assert.equal(op,'eq');values.push(v==='true'?true:v==='false'?false:v);return `${safe(k)}=$${values.length}`;});filters.push('('+terms.join(' or ')+')');return q;},eq(k,v){filter(k,v,'=');return q;},gte(k,v){filter(k,v,'>=');return q;},lte(k,v){filter(k,v,'<=');return q;},neq(k,v){filter(k,v,'<>');return q;},in(k,v){values.push(v);filters.push(`${safe(k)}=any($${values.length})`);return q;},is(k,v){if(v!==null)throw Error('Test IS only null');filters.push(`${safe(k)} is null`);return q;},not(k,op,v){if(op!=='is'||v!==null)throw Error('Unsupported test filter');filters.push(`${safe(k)} is not null`);return q;},order(k,opts={}){orders.push(`${safe(k)} ${opts.ascending===false?'desc':'asc'}`);return q;},limit(n){assert.ok(Number.isInteger(n)&&n>=0);cap=` limit ${n}`;return q;},update(body){update=body;return q;},async maybeSingle(){const r=await run();return {...r,data:r.data?.[0]||null};},async single(){return q.maybeSingle();},then(ok,bad){return run().then(ok,bad);}};
  async function run(){try{let sql;if(inserts){const keys=Object.keys(inserts[0]);const rows=inserts.map(row=>'('+keys.map(k=>{values.push(row[k]);return '$'+values.length;}).join(',')+')');sql=`insert into public.${table} (${keys.map(safe).join(',')}) values ${rows.join(',')} on conflict do nothing returning *`;}else if(update){const updates=Object.entries(update).map(([k,v])=>{values.push(v==='true'?true:v==='false'?false:v);return `${safe(k)}=$${values.length}`;});sql=`update public.${table} set ${updates.join(',')}${filters.length?' where '+filters.join(' and '):''} returning *`;}else sql=`select * from public.${table}${filters.length?' where '+filters.join(' and '):''}${orders.length?' order by '+orders.join(','):''}${cap}`;
   const rows=(await db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(sql,values);})).rows;
   if(columns.includes('program:'))for(const row of rows)row.program=(await db.query('select * from public.programs where id=$1',[row.program_id])).rows[0]||null;
   if(columns.includes('client_owner:'))for(const row of rows)row.client_owner=(await db.query('select coach_id from public.clients where id=$1',[row.client_id])).rows[0]||null;
   if(columns.includes('library_exercise:'))for(const row of rows)row.library_exercise=(await db.query('select * from public.exercise_library where id=$1',[row.exercise_library_id])).rows[0]||null;
   if(columns.includes('client:'))for(const row of rows)row.client=(await db.query('select * from public.clients where id=$1',[row.client_id])).rows[0]||null;
   return {data:rows,error:null};}catch(error){return {data:null,error};}}
  return q;},
 async rpc(name,args){calls.push(name);safe(name);if(race){race=false;await db.query('update public.clients set coach_id=$1 where id=$2',[id(2),id(11)]);}try{const keys=Object.keys(args);const tableRpc=name==='get_quick_session_completion';const result=await db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(`select ${tableRpc?'* from ':''}public.${name}(${keys.map((k,i)=>`${safe(k)}=>$${i+1}`).join(',')}) ${tableRpc?'':'as result'}`,Object.entries(args).map(([key,v])=>key==='p_assignment_ids'?v:v&&typeof v==='object'?JSON.stringify(v):v));});return {data:tableRpc?result.rows:result.rows[0].result,error:null};}catch(error){return {data:null,error};}}
 };
 require.cache[supabasePath]={id:supabasePath,filename:supabasePath,loaded:true,exports:{supabaseAdmin:adapter}};delete require.cache[routePath];delete require.cache[authPath];
 const express=require('../../../backend/node_modules/express');const {requireAuth}=require(authPath);
 const app=express();app.use(express.json());
 app.get('/api/auth/me',requireAuth,(req,res)=>res.json({role:req.user.role,profile:req.user.coach||req.user.client,email:req.user.email}));
 app.use('/api/workout-logs',require(routePath));
 app.use('/api/programs',require('../../../backend/src/routes/workoutRescue').createWorkoutRescueRouter({db:adapter,auth:require(authPath)}));
 app.use('/api/programs',require('../../../backend/src/routes/programs'));
 app.get('/api/clients/:id',requireAuth,async(req,res)=>res.json((await db.query('select * from public.clients where id=$1',[req.params.id])).rows[0]));
 app.get('/api/waivers/client/:id/status',requireAuth,(req,res)=>res.json({signed:true,needs_signature:false}));
 app.get('/api/clients',requireAuth,async(req,res)=>res.json((await db.query('select * from public.clients where not archived')).rows));
 app.get('/api/exercise-media/library-status',requireAuth,(req,res)=>res.json({enabled:false,exercises:[],summary:{}}));
 app.post('/api/telemetry/events',requireAuth,(req,res)=>res.status(202).json({accepted:true}));
 app.get('/api/cue-test/ids',requireAuth,async(req,res)=>res.json((await db.query('select data from public.pt_combined_http_test_ids')).rows[0].data));
 // Shell-only empty notification counters for normal-mode UI verification.
 app.get(['/api/notifications/unread-count','/api/messages/unread-count','/api/session-notes/unread-count','/api/announcements/unread-count'],requireAuth,(req,res)=>res.json({unread:0,count:0}));
 const server=app.listen(serve?58430:0,'127.0.0.1');await new Promise((r,j)=>{server.once('listening',r);server.once('error',j);});
 const origin=`http://127.0.0.1:${server.address().port}`;const base=origin+'/api';
 const request=async(path,{method='GET',body,token='cue-coach'}={})=>{const r=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const endpoint=(log,ex)=>`/workout-logs/${log}/exercises/${ex}/cue-retry`;
 if(serve){console.log(`COMBINED_REAL_LOCAL_API ${base} SOURCE ${ids.retry} ${ids.retryEx}`);const stop=async()=>{await new Promise(r=>server.close(r));await db.close();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);await new Promise(()=>{});}
 try{
 const source=endpoint(ids.retry,ids.retryEx);const context=await request(source);assert.equal(context.status,200,JSON.stringify(context));
 const body={action:'create',request_id:id(501),text:'Combined HTTP: steady descent.',source_version:context.data.source_version};
 assert.equal((await request(source,{method:'POST',body,token:'cue-client'})).status,403);
 const created=await request(source,{method:'POST',body});assert.equal(created.status,200,JSON.stringify(created));
 assert.equal((await request(source,{method:'POST',body})).data.id,created.data.id);
 const planPath=`/programs/${id(6)}/days/${id(71)}/rescue`;
 let view=(await request(planPath)).data;
 const plan={...view.plan,version:view.current_version};
 const saved=await request(planPath,{method:'PUT',body:plan});assert.equal(saved.status,200,JSON.stringify(saved));
 view=(await request(planPath+'?assignment_id='+id(7),{token:'cue-client'})).data;
 const startBody={program_assignment_id:id(7),program_day_id:id(71),client_id:id(12),p_auth_id:id(112),rescue:{branch_id:'short',version:view.plan.version,revision:view.plan.revision,selection_version:view.selection_version,minutes:25,equipment:['dumbbells'],request_id:id(502)}};
 race=true;
 assert.equal((await request('/workout-logs/start',{method:'POST',body:{...startBody,client_id:id(11)},token:'cue-coach'})).status,404,'reauthorize current coach after middleware');
 await db.query('update public.clients set coach_id=$1 where id=$2',[id(1),id(11)]);
 const countBeforeMissing=(await db.query('select count(*)::int as n from public.workout_logs')).rows[0].n;
 await db.exec('alter function public.start_workout_rescue_with_cues(uuid,uuid,uuid,uuid,jsonb,uuid) rename to combined_unavailable_test');
 const missing=await request('/workout-logs/start',{method:'POST',body:startBody,token:'cue-client'});
 assert.equal(missing.status,503);assert.equal(missing.data.error,'Workout start is currently unavailable.');
 assert.equal((await db.query('select count(*)::int as n from public.workout_logs')).rows[0].n,countBeforeMissing);
 await db.exec('alter function public.combined_unavailable_test(uuid,uuid,uuid,uuid,jsonb,uuid) rename to start_workout_rescue_with_cues');
 const started=await request('/workout-logs/start',{method:'POST',body:startBody,token:'cue-client'});assert.equal(started.status,201,JSON.stringify(started));
 const log=started.data.workout_log;assert.equal(log.client_id,id(11));assert.equal(log.exercises.length,1);const ex=log.exercises[0];
 const target=endpoint(log.id,ex.id);const incoming=(await request(target,{token:'cue-client'})).data.incoming;
 assert.equal(incoming.length,1);assert.equal(incoming[0].id,created.data.id);assert.equal(incoming[0].stale_retry,false);
 assert.equal((await request('/workout-logs/start',{method:'POST',body:startBody,token:'cue-client'})).data.workout_log.id,log.id);
 assert.equal((await request(target,{method:'POST',body:{action:'verdict',cue_id:incoming[0].id,revision:incoming[0].revision,verdict:'fixed',request_id:id(503)},token:'cue-client'})).status,403);
 assert.equal((await request(`/workout-logs/${log.id}/sets/${ex.sets[0].id}`,{method:'PATCH',token:'cue-client',body:{status:'completed',actual_reps:12}})).status,200);
 assert.equal((await request(`/workout-logs/${log.id}/complete`,{method:'POST',token:'cue-client',body:{}})).status,200);
 const verdict=await request(target,{method:'POST',body:{action:'verdict',cue_id:incoming[0].id,revision:incoming[0].revision,verdict:'fixed',request_id:id(504)}});assert.equal(verdict.status,200,JSON.stringify(verdict));
 const assigned=await request('/programs/client/assigned',{token:'cue-client'});assert.equal(assigned.status,200,JSON.stringify(assigned));assert.equal(assigned.data.programs.length,1,'normal client assignment embed');
 const history=`/programs/${id(6)}/history`;
 assert.equal((await request(history,{token:'cue-client'})).status,403);assert.equal((await request(history,{token:'cue-unrelated-coach'})).status,404);assert.equal((await request(history,{token:null})).status,401);
 const revisions=(await request(history)).data;assert.equal(revisions.capture,'durable');assert.equal(revisions.revisions.length,2);
 const program=(await request(`/programs/${id(6)}`)).data;
 const changed=await request(`/programs/${id(6)}`,{method:'PUT',body:{name:'Combined persisted program',frequency_days:2,days:program.days.map(d=>({day_number:d.day_number,workout_id:d.workout_id,notes:d.notes}))}});assert.equal(changed.status,200,JSON.stringify(changed));
 assert.equal((await request(history)).data.revisions.length,3);
 await db.exec('create table public.pt_combined_http_test_ids(data jsonb)');await db.query('insert into public.pt_combined_http_test_ids values($1)',[JSON.stringify({log:log.id,ex:ex.id})]);
 console.log('PASS combined actual Express/auth/SQL: cue -> Rescue -> exact retained attempt -> performed completion -> Fixed; replay; reassignment; role separation; history PUT/read');
 }finally{await new Promise(r=>server.close(r));originals.forEach(([p,v])=>v?require.cache[p]=v:delete require.cache[p]);}
};
