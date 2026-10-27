// Real Express Rescue/start routes and actual requireAuth profile/role resolution.
// Only provider token verification and the PostgREST transport are test adapters;
// all authorization RPCs, plan persistence and starts execute actual local SQL.
const assert=require('node:assert/strict');
const safe=s=>{if(!/^[a-z_][a-z_0-9]*$/.test(s))throw Error('Unsafe test SQL identifier');return s;};
module.exports=async function httpCheck(db,ids,{serve=false,port=0}={}) {
 const dbPath=require.resolve('../../../backend/src/supabase');
 const authPath=require.resolve('../../../backend/src/middleware/auth');
 const logsPath=require.resolve('../../../backend/src/routes/workoutLogs');
 let reassignBeforeRpc=false;
 const calls=[];const tokens=new Set([ids.coachAuth,ids.clientAuth,ids.otherAuth,ids.adminAuth]);
 const adapter={auth:{async getUser(token){return tokens.has(token)?{data:{user:{id:token,email:'fictional@example.invalid'}}}:{data:{user:null},error:{message:'Invalid token'}};}},
  from(table){safe(table);let fields='',orders=[],filters=[],values=[],cap='';
   const query={select(f){fields=f;return this;},is(k,v){assert.equal(v,null);filters.push(`${safe(k)} is null`);return this;},or(expression){const parts=expression.split(',').map(part=>{const [key,op,value]=part.split('.');assert.equal(op,'eq');values.push(value==='true'?true:value);return `${safe(key)}=$${values.length}`;});filters.push('('+parts.join(' or ')+')');return this;},async upsert(rows){try{for(const row of rows){const keys=Object.keys(row);await db.query(`insert into public.${table}(${keys.map(safe).join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict do nothing`,Object.values(row));}return {data:null,error:null};}catch(error){return {data:null,error};}},eq(k,v){values.push(v);filters.push(`${safe(k)}=$${values.length}`);return this;},in(k,v){values.push(v);filters.push(`${safe(k)}=any($${values.length})`);return this;},gte(k,v){values.push(v);filters.push(`${safe(k)}>=$${values.length}`);return this;},lte(k,v){values.push(v);filters.push(`${safe(k)}<=$${values.length}`);return this;},order(k,opts={}){orders.push(`${safe(k)} ${opts.ascending===false?'desc':'asc'}`);return this;},limit(n){assert.ok(Number.isInteger(n));cap=` limit ${n}`;return this;},async maybeSingle(){const result=await run();return {...result,data:result.data?.[0]||null};},then(ok,bad){return run().then(ok,bad);}};
   async function run(){try {
    const rows=(await db.query(`select * from public.${table}${filters.length?' where '+filters.join(' and '):''}${orders.length?' order by '+orders.join(','):''}${cap}`,values)).rows;
    for(const row of rows){
     if(fields.includes('client:clients'))row.client=(await db.query('select id,name,coach_id,archived from public.clients where id=$1',[row.client_id])).rows[0]||null;
     if(fields.includes('client_owner:'))row.client_owner=(await db.query('select coach_id from public.clients where id=$1',[row.client_id])).rows[0]||null;
     if(fields.includes('library:exercise_library'))row.library=(await db.query('select * from public.exercise_library where id=$1',[row.backup_exercise_library_id])).rows[0]||null;
    }
    return {data:rows,error:null};
   }catch(error){return {data:null,error};}}
   return query;
  },async rpc(name,args){calls.push({name,args});safe(name);try {
   assert.ok(['read_workout_rescue','save_workout_rescue','start_workout_rescue_with_cues','start_workout_log_v2','get_workout_exercise_history_v2'].includes(name),name);
   const entries=Object.entries(args);if(reassignBeforeRpc){reassignBeforeRpc=false;await db.query("update public.clients set coach_id='00000000-0000-4000-8000-000000000002' where id=$1",[ids.client]);}const history=name==='get_workout_exercise_history_v2';const {rows}=await db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(`select ${history?'* from ':''}public.${name}(${entries.map(([key],i)=>`${safe(key)}=>$${i+1}`).join(',')}) ${history?'':'as result'}`,entries.map(([,value])=>value&&typeof value==='object'?JSON.stringify(value):value));});return {data:history?rows:rows[0].result,error:null};
  }catch(error){console.error('LOCAL_SQL_RPC_FAILURE',name,error.message);return {data:null,error};}}
 };
 require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{supabaseAdmin:adapter}};delete require.cache[authPath];delete require.cache[logsPath];
 const logger=require('../../../backend/src/utils/logger');logger.logError=(context,error)=>console.error('LOCAL_API_DIAGNOSTIC',context,error?.message);
 const auth=require(authPath);const express=require('../../../backend/node_modules/express');
 const app=express();app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:58417');res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Allow-Methods','GET,PUT,POST,OPTIONS');if(req.method==='OPTIONS')return res.status(204).end();next();});app.use(express.json());
 app.get('/api/auth/me',auth.requireAuth,(req,res)=>res.json({role:req.user.role,email:req.user.email,profile:req.user.coach||req.user.client}));
 app.use('/api/programs',require('../../../backend/src/routes/workoutRescue').createWorkoutRescueRouter({db:adapter,auth}));
 app.get('/api/exercise-media/library-status',auth.requireAuth,(_req,res)=>res.json({enabled:false,exercises:[],summary:{}}));
 app.post('/api/telemetry/events',auth.requireAuth,(_req,res)=>res.status(202).json({accepted:true}));
 app.get('/api/notifications/unread-count',auth.requireAuth,(_req,res)=>res.json({unread:0}));
 async function programDto(){
  const program=(await db.query('select * from public.programs where id=$1',[ids.program])).rows[0];
  const original=(await db.query('select public.workout_rescue_original($1,$2) as result',[ids.program,ids.day])).rows[0].result;
  return {...program,days:[{id:ids.day,day_number:1,notes:original.day_notes,workout:original.workout}],exercise_count:original.workout.exercises.length};
 }
 // Bounded surrounding shell reads, not fixture Rescue implementations. The Rescue
 // read/save and workout-start paths below always use their real mounted handlers.
 app.get('/api/programs',auth.requireAuth,auth.requireCoach,async(_req,res)=>res.json([await programDto()]));
 app.get('/api/programs/exercise-library',auth.requireAuth,auth.requireCoach,async(_req,res)=>res.json((await db.query('select * from public.exercise_library where not archived')).rows));
 app.get('/api/programs/workouts',auth.requireAuth,auth.requireCoach,async(_req,res)=>res.json([(await programDto()).days[0].workout]));
 app.get('/api/clients',auth.requireAuth,auth.requireCoach,async(_req,res)=>res.json((await db.query('select * from public.clients where not archived')).rows));
 app.get('/api/programs/client/assigned',auth.requireAuth,auth.requireClient,async(req,res)=>{const program=await programDto();res.json({programs:(await db.query('select * from public.program_assignments where client_id=$1 and program_id=$2 and not archived',[req.user.client.id,ids.program])).rows.map(row=>({...row,program,exercise_loads:[]})),workouts:[]});});
 app.use('/api/workout-logs',require(logsPath));
 app.use((req,res)=>res.status(404).json({error:`Not in bounded local shell: ${req.method} ${req.path}`}));
 const server=app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;const path=`/api/programs/${ids.program}/days/${ids.day}/rescue`;
 if(serve){console.log(`DURABLE_LOCAL_API ${origin}`);console.log(`DURABLE_IDS ${JSON.stringify(ids)}`);await new Promise(()=>{});}
 const request=async(pathname,{actor=ids.coachAuth,method='GET',body}={})=>{
  const response=await fetch(origin+pathname,{method,headers:{...(actor?{authorization:`Bearer ${actor}`} : {}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};
 };
 try {
  assert.equal((await request(path,{actor:null})).status,401);
  assert.equal((await request(path,{actor:'not-a-token'})).status,401);
  assert.equal((await request(path,{actor:ids.otherAuth})).status,404);
  assert.equal((await request(path,{actor:ids.clientAuth})).status,404);
  assert.equal((await request(path+'?assignment_id='+ids.assignment,{actor:ids.clientAuth})).status,200);
  const first=(await request(path)).data;
  const plan={...first.plan,version:first.current_version};
  plan.branches[0].name='Saved through actual Express';
  assert.equal((await request(path,{method:'PUT',body:plan,actor:ids.clientAuth})).status,403);
  const saved=await request(path,{method:'PUT',body:{...plan,p_auth_id:ids.adminAuth}});
  assert.equal(saved.status,200,JSON.stringify(saved));
  assert.equal(saved.data.plan.revision,2);
  reassignBeforeRpc=true;
  assert.equal((await request(path,{method:'PUT',body:saved.data.plan})).status,404,'ownership change after middleware but before SQL must deny the save');
  assert.equal((await db.query('select revision from public.workout_rescue_plans where program_day_id=$1',[ids.day])).rows[0].revision,2);
  await db.query("update public.clients set coach_id='00000000-0000-4000-8000-000000000001' where id=$1",[ids.client]);
  assert.equal((await db.query('select authored_by from public.workout_rescue_plans where program_day_id=$1',[ids.day])).rows[0].authored_by,'00000000-0000-4000-8000-000000000001');
  const clientView=(await request(path+'?assignment_id='+ids.assignment,{actor:ids.clientAuth})).data;
  const rescue={branch_id:'short',version:clientView.plan.version,revision:2,selection_version:clientView.selection_version,request_id:'00000000-0000-4000-8000-000000000301',minutes:25,equipment:['dumbbells']};
  const body={program_assignment_id:ids.assignment,program_day_id:ids.day,rescue,suppress_start_notification:true};
  const invalid=await request('/api/workout-logs/start',{method:'POST',actor:ids.clientAuth,body:{...body,rescue:{...rescue,minutes:5}}});assert.equal(invalid.status,409,JSON.stringify(invalid));
  const started=await request('/api/workout-logs/start',{method:'POST',actor:ids.clientAuth,body});
  assert.equal(started.status,201,JSON.stringify(started));assert.equal(started.data.workout_log.rescue_snapshot.branch_name,'Saved through actual Express');
  assert.equal(started.data.workout_log.exercises.length,2);
  const replay=await request('/api/workout-logs/start',{method:'POST',actor:ids.clientAuth,body});assert.equal(replay.status,200);assert.equal(replay.data.workout_log.id,started.data.workout_log.id);
  assert.equal(calls.filter(x=>x.name==='start_workout_log_v2').length,0,'Rescue must never fall back to ordinary start');
  await db.query("update public.workout_logs set status='abandoned' where id=$1",[started.data.workout_log.id]);
  assert.equal((await request(path,{method:'PUT',body:plan})).status,409);
  console.log('PASS actual Express GET/PUT/start with actual auth middleware + SQL; provider verifier is fictional; anonymous/role/ownership/revision/compatibility/attribution/replay boundaries verified');
 }finally{await new Promise(resolve=>server.close(resolve));}
};
