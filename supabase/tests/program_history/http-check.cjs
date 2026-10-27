// Real mounted Express program routes + SQL-backed test adapter. No hosted calls.
const assert=require('node:assert/strict');
module.exports=async function httpCheck(db, options={}){
 const supabasePath=require.resolve('../../../backend/src/supabase');
 const routerPath=require.resolve('../../../backend/src/routes/programs');
 const authPath=require.resolve('../../../backend/src/middleware/auth');
 const saved=[supabasePath,routerPath,authPath].map(p=>[p,require.cache[p]]);
 let reassignDuringRpc=false;
 const calls=[];const allowed=new Set(['coaches','clients','programs','program_days','workouts','workout_exercises','exercise_library','program_assignments','program_assignment_exercise_loads','program_change_revisions']);
 const safe=value=>{if(!/^[a-z_]+$/.test(value))throw Error('Invalid SQL test identifier');return value;};
 const adapter={from(table){assert.ok(allowed.has(table),table);const filters=[],values=[];let columns='',ordering='',limit='';
  const query={select(c){columns=c;return this;},eq(k,v){values.push(v);filters.push(`${safe(k)}=$${values.length}`);return this;},in(k,v){values.push(v);filters.push(`${safe(k)}=any($${values.length})`);return this;},order(k,opts={}){ordering=` order by ${safe(k)} ${opts.ascending===false?'desc':'asc'}`;return this;},limit(n){assert.ok(Number.isInteger(n));limit=` limit ${n}`;return this;},async maybeSingle(){const r=await run();return {data:r.data[0]||null};},then(ok,bad){return run().then(ok,bad);}};
  async function run(){const rows=(await db.query(`select * from public.${table}${filters.length?' where '+filters.join(' and '):''}${ordering}${limit}`,values)).rows;
   for(const row of rows){if(columns.includes('client_owner:'))row.client_owner=row.client_id?(await db.query('select coach_id from public.clients where id=$1',[row.client_id])).rows[0]:null;
    if(columns.includes('library_exercise:'))row.library_exercise=(await db.query('select * from public.exercise_library where id=$1',[row.exercise_library_id])).rows[0]||null;
    if(columns.includes('client:'))row.client=(await db.query('select id,name,coach_id from public.clients where id=$1',[row.client_id])).rows[0]||null;
   }return {data:rows,error:null};}return query;},async rpc(name,args){calls.push(name);assert.ok(['save_program_with_history','save_workout_with_program_history'].includes(name));try{if(reassignDuringRpc){reassignDuringRpc=false;await db.query("update public.clients set coach_id='00000000-0000-4000-8000-000000000002' where id='00000000-0000-4000-8000-000000000011'");}const keys=Object.keys(args);const {rows}=await db.query(`select public.${safe(name)}(${keys.map((k,i)=>`${safe(k)}=>$${i+1}`).join(',')}) as result`,Object.values(args).map(v=>Array.isArray(v)?JSON.stringify(v):v));return {data:rows[0].result,error:null};}catch(error){return {data:null,error};}}};
 const auth={requireAuth(req,res,next){const role=req.headers.authorization;if(!role)return res.status(401).json({error:'Missing auth'});req.user={role,coach:{id:'00000000-0000-4000-8000-000000000001'}};next();},requireCoach(req,res,next){return ['coach','admin'].includes(req.user.role)?next():res.status(403).json({error:'Coach required'});},requireClient(req,res,next){return res.status(403).end();},canAccessClient:require('../../../backend/src/security/access').canAccessClient};
 require.cache[supabasePath]={id:supabasePath,filename:supabasePath,loaded:true,exports:{supabaseAdmin:adapter}};require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:auth};delete require.cache[routerPath];
 const express=require('../../../backend/node_modules/express');const app=express();app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:58261');res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');if(req.method==='OPTIONS')return res.status(204).end();next();});app.use(express.json());app.use('/programs',require(routerPath));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const program='00000000-0000-4000-8000-000000000006';const url=`http://127.0.0.1:${server.address().port}/programs/${program}`;
 if(options.serve){console.log(`DURABLE_LOCAL_API ${url}`);await new Promise(()=>{});}
 try{
  const prior=(await (await fetch(`${url}/history`,{headers:{authorization:'coach'}})).json()).revisions;
  const days=(await db.query('select day_number,workout_id,notes from public.program_days where program_id=$1 and not archived order by day_number',[program])).rows;
  const response=await fetch(url,{method:'PUT',headers:{authorization:'coach','content-type':'application/json'},body:JSON.stringify({name:'Saved through Express',frequency_days:2,days})});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.deepEqual(calls,['save_program_with_history']);
  const result=await (await fetch(`${url}/history`,{headers:{authorization:'coach'}})).json();assert.equal(result.capture,'durable');assert.equal(result.revisions.length,prior.length+1);assert.equal(result.revisions.at(-1).snapshot.name,'Saved through Express');
  reassignDuringRpc=true;
  const denied=await fetch(url,{method:'PUT',headers:{authorization:'coach','content-type':'application/json'},body:JSON.stringify({name:'Race must not save',frequency_days:2,days})});
  assert.equal(denied.status,404,'ownership change between HTTP check and transaction must remain masked');
  assert.equal((await db.query('select count(*)::int as n from public.program_change_revisions')).rows[0].n,result.revisions.length);
  await db.query("update public.clients set coach_id='00000000-0000-4000-8000-000000000001' where id='00000000-0000-4000-8000-000000000011'");
  assert.equal((await db.query('select name from public.programs where id=$1',[program])).rows[0].name,'Saved through Express');
  assert.equal((await fetch(`${url}/history`,{headers:{authorization:'client'}})).status,403);assert.equal((await fetch(`${url}/history`)).status,401);
  await db.query("update public.clients set coach_id='00000000-0000-4000-8000-000000000002' where id='00000000-0000-4000-8000-000000000011'");
  assert.equal((await fetch(`${url}/history`,{headers:{authorization:'coach'}})).status,404);
  assert.equal((await fetch(`${url}/history`,{headers:{authorization:'admin'}})).status,200);
  await db.query("update public.clients set coach_id='00000000-0000-4000-8000-000000000001' where id='00000000-0000-4000-8000-000000000011'");
  console.log('PASS mounted Express edit -> SQL transaction -> stored history -> read DTO; client/anonymous denials');
 }finally{await new Promise(r=>server.close(r));saved.forEach(([p,value])=>{if(value)require.cache[p]=value;else delete require.cache[p];});}
};
