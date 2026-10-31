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
   if(columns.includes('client:'))for(const row of rows)row.client=(await db.query('select * from public.clients where id=$1',[row.client_id])).rows[0]||null;
   return {data:rows,error:null};}catch(error){return {data:null,error};}}
  return q;},
 async rpc(name,args){calls.push(name);safe(name);if(race){race=false;await db.query('update public.clients set coach_id=$1 where id=$2',[id(2),id(11)]);}try{const keys=Object.keys(args);const result=await db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(`select public.${name}(${keys.map((k,i)=>`${safe(k)}=>$${i+1}`).join(',')}) as result`,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v));});return {data:result.rows[0].result,error:null};}catch(error){return {data:null,error};}}
 };
 require.cache[supabasePath]={id:supabasePath,filename:supabasePath,loaded:true,exports:{supabaseAdmin:adapter}};delete require.cache[routePath];delete require.cache[authPath];
 const express=require('../../../backend/node_modules/express');const {requireAuth}=require(authPath);
 const app=express();app.use(express.json());
 app.get('/api/auth/me',requireAuth,(req,res)=>res.json({role:req.user.role,profile:req.user.coach||req.user.client,email:req.user.email}));
 app.use('/api/workout-logs',require(routePath));
 app.get('/api/cue-test/ids',requireAuth,async(req,res)=>res.json((await db.query('select data from public.cue_http_test_ids')).rows[0].data));
 // Shell-only empty notification counters for normal-mode UI verification.
 app.get(['/api/notifications/unread-count','/api/messages/unread-count','/api/session-notes/unread-count','/api/announcements/unread-count'],requireAuth,(req,res)=>res.json({unread:0,count:0}));
 const server=app.listen(serve?58420:0,'127.0.0.1');await new Promise((r,j)=>{server.once('listening',r);server.once('error',j);});
 const base=`http://127.0.0.1:${server.address().port}/api/workout-logs`;
 const request=async(path,{method='GET',body,token='cue-coach'}={})=>{const r=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const endpoint=(log,ex)=>`/${log}/exercises/${ex}/cue-retry`;
 if(serve){console.log(`CUE_REAL_LOCAL_API ${base} SOURCE ${ids.retry} ${ids.retryEx}`);const stop=async()=>{await new Promise(r=>server.close(r));await db.close();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);await new Promise(()=>{});}
 try{
 if(verify){const row=(await db.query('select data from public.cue_http_test_ids')).rows[0].data;const response=await request(endpoint(row.log,row.ex),{token:'cue-client'});assert.equal(response.status,200);assert.equal(response.data.incoming[0].verdict,'fixed');console.log('PASS restarted API process reads SQL-backed Fixed verdict via real requireAuth');return;}
 const source=endpoint(ids.retry,ids.retryEx);const context=await request(source);assert.equal(context.status,200,JSON.stringify(context.data));
 assert.equal((await request(source,{token:null})).status,401);assert.equal((await request(source,{token:'not-a-provider-token'})).status,401);
 assert.equal((await request(source,{token:'cue-other'})).status,404);assert.equal((await request(source,{token:'cue-unrelated-coach'})).status,404);assert.equal((await request(source,{token:'cue-client'})).status,200);
 const body={action:'create',request_id:id(301),text:'HTTP cue: steady descent.',source_version:context.data.source_version};
 assert.equal((await request(source,{method:'POST',body,token:'cue-client'})).status,403);
 const created=await request(source,{method:'POST',body});assert.equal(created.status,200,JSON.stringify(created));assert.deepEqual(await request(source,{method:'POST',body}),created);
 assert.equal((await request(source,{method:'POST',body:{...body,text:'Forged replay'}})).status,409);
 // Reassign after actual requireAuth has resolved the HTTP actor, before RPC.
 race=true;assert.equal((await request(source,{method:'POST',body:{action:'cancel',cue_id:created.data.id,revision:created.data.revision,request_id:id(302)}})).status,404);
 assert.equal((await db.query('select archived from public.exercise_attempt_cues where id=$1',[created.data.id])).rows[0].archived,false);
 await db.query('update public.clients set coach_id=$1 where id=$2',[id(1),id(11)]);
 const started=await request('/start',{method:'POST',token:'cue-client',body:{program_assignment_id:id(7),program_day_id:id(71),client_id:id(12),p_auth_user_id:id(112)}});
 assert.equal(started.status,201,JSON.stringify(started));const log=started.data.workout_log;assert.equal(log.client_id,id(11));
 const ex=log.exercises[0];const target=endpoint(log.id,ex.id);
 let incoming=(await request(target,{token:'cue-client'})).data.incoming[0];assert.equal(incoming.text,body.text);
 assert.equal((await request(target,{method:'POST',body:{action:'verdict',cue_id:incoming.id,revision:incoming.revision,verdict:'fixed',request_id:id(303)}})).status,409);
 const setResult=await request(`/${log.id}/sets/${ex.sets[0].id}`,{method:'PATCH',token:'cue-client',body:{status:'completed',actual_reps:8}});assert.equal(setResult.status,200,JSON.stringify(setResult));
 const completed=await request(`/${log.id}/complete`,{method:'POST',token:'cue-client',body:{}});assert.equal(completed.status,200,JSON.stringify(completed));
 const verdict={action:'verdict',cue_id:incoming.id,revision:incoming.revision,verdict:'fixed',request_id:id(304)};
 assert.equal((await request(target,{method:'POST',body:verdict})).status,200);assert.equal((await request(target,{token:'cue-client'})).data.incoming[0].verdict,'fixed');
 assert.equal((await request(`/${ids.old}/sets/${(await db.query('select id from public.workout_log_sets where workout_log_exercise_id=$1',[ids.oldEx])).rows[0].id}`,{method:'PATCH',token:'cue-client',body:{status:'pending'}})).status,409);
 const quick=await request('/quick-complete',{method:'POST',token:'cue-client',body:{program_assignment_id:id(7),program_day_id:id(71)}});assert.equal(quick.status,201,JSON.stringify(quick));
 assert.ok(calls.includes('start_workout_log_with_cues'));assert.ok(calls.includes('mutate_exercise_cue'));
 await db.exec('create table public.cue_http_test_ids(data jsonb)');await db.query('insert into public.cue_http_test_ids values($1)',[JSON.stringify({log:log.id,ex:ex.id})]);
 console.log('PASS actual Express + requireAuth + SQL: create -> start -> set -> complete -> verdict; provider shim only, ownership-race masking/replay/wrong-client/immutable history');
 }finally{await new Promise(r=>server.close(r));originals.forEach(([p,v])=>v?require.cache[p]=v:delete require.cache[p]);}
};
