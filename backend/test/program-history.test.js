const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const { historyHandler }=require('../src/lib/programHistory');
test('history boundary follows current client ownership, masks missing/archived and reads no completed data', async t=>{
  let currentOwner='a'; let reads=0;
  const handler=historyHandler(async id=>{reads++; if(id==='error')throw Error('offline');return id==='missing'?null:{id,is_template:id==='template',client_id:'client',coach_id:'a',client_owner:{coach_id:currentOwner},archived:id==='archived'};});
  const app=express(); app.use((req,res,next)=>{req.user=req.headers.authorization?{role:req.headers.authorization,coach:{id:'a'}}:null;next();});
  app.get('/:id/history',handler); const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>new Promise(r=>server.close(r)));
  const get=(id,role)=>fetch(`http://127.0.0.1:${server.address().port}/${id}/history`,{headers:role?{authorization:role}:{}});
  assert.equal((await get('p')).status,401); assert.equal((await get('p','client')).status,403); assert.equal(reads,0);
  const response=await get('p','coach'); assert.equal(response.status,200); const payload=await response.json(); assert.equal(payload.availability,'unavailable');assert.deepEqual(payload.revisions,[]);assert.equal(payload.program_id,'p');
  currentOwner='other'; assert.equal((await get('p','coach')).status,404);assert.equal((await get('p','admin')).status,200);assert.equal((await get('template','coach')).status,200);
  for(const id of ['missing','archived'])assert.equal((await get(id,'admin')).status,404);
  assert.equal((await get('error','coach')).status,500);
});

test('mounted programs history uses real auth and only the owned-row program read',async t=>{
 const sp=require.resolve('../src/supabase');const rp=require.resolve('../src/routes/programs');const ap=require.resolve('../src/middleware/auth');
 const saved=[sp,rp,ap].map(p=>[p,require.cache[p]]);let actor;let owner='a';const tables=[];const completed=Object.freeze({status:'completed',load:50});
 const fake={auth:{getUser:async token=>{actor=token;return {data:{user:{id:token}}};}},from(table){tables.push(table);const filters={};return {select(){return this;},order(){return this;},limit(){return Promise.resolve({data:null,error:{code:'PGRST205'}});},eq(k,v){filters[k]=v;return this;},async maybeSingle(){
  if(table==='coaches')return {data:actor==='client'?null:{id:'a',is_admin:actor==='admin'}};
  if(table==='clients')return {data:{id:'client'}};
  if(table==='programs')return {data:filters.id==='missing'?null:{id:filters.id,is_template:filters.id==='template',coach_id:'a',client_id:'c',client_owner:{coach_id:owner},archived:false}};
  throw Error(`Unexpected read: ${table}`);
 }}}};
 require.cache[sp]={id:sp,filename:sp,loaded:true,exports:{supabaseAdmin:fake}};delete require.cache[rp];delete require.cache[ap];
 t.after(()=>saved.forEach(([p,value])=>{if(value)require.cache[p]=value;else delete require.cache[p];}));
 const app=express();app.use('/programs',require(rp));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const get=(id,token)=>fetch(`http://127.0.0.1:${server.address().port}/programs/${id}/history`,{headers:token?{authorization:`Bearer ${token}`}:{}});
 assert.equal((await get('p')).status,401);assert.equal((await get('p','client')).status,403);assert.equal(tables.includes('programs'),false);
 tables.length=0;const response=await get('p','coach');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(tables,['coaches','programs','program_change_revisions']);assert.deepEqual((await response.json()).revisions,[]);
 owner='b';assert.equal((await get('p','coach')).status,404);assert.equal((await get('p','admin')).status,200);assert.equal((await get('template','coach')).status,200);assert.equal((await get('missing','coach')).status,404);
 assert.deepEqual(completed,{status:'completed',load:50});assert.equal(tables.some(x=>/workout/.test(x)),false);
});

test('history returns persisted revisions and propagates storage failures rather than unavailable',async()=>{
 const handler=historyHandler(async()=>({id:'p',is_template:true}),async()=>[{id:'1',snapshot:{id:'p',name:'Saved'},author:null,recorded_at:null,source:'Stored baseline'}]);
 let result;const res={setHeader(){},status(code){this.code=code;return this;},json(value){result=value;return this;}};
 await handler({params:{id:'p'},user:{role:'coach',coach:{id:'a'}}},res);
 assert.equal(result.availability,'available');assert.equal(result.capture,'durable');assert.equal(result.revisions[0].snapshot.name,'Saved');
});


test('revision storage failure remains retryable and is never reported as missing history',async()=>{
 const handler=historyHandler(async()=>({id:'p',is_template:true}),async()=>{throw Error('storage offline');});
 let payload;const res={setHeader(){},status(code){this.code=code;return this;},json(value){payload=value;return this;}};
 await handler({params:{id:'p'},user:{role:'coach',coach:{id:'a'}}},res);
 assert.equal(res.code,500);assert.equal(payload.error,'Could not load program history');assert.equal('availability' in payload,false);
});
