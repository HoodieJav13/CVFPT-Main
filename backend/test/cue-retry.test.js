const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {registerCueRetryRoutes}=require('../src/routes/cueRetry');
const id='00000000-0000-4000-8000-000000000001';
test('cue endpoints validate, use verified auth id and classify SQL failures',async t=>{
 const calls=[];let error=null;const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{incoming:[],outgoing:[]},error};}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(!req.headers.authorization)return res.status(401).end();req.user={role:req.headers.authorization,authUserId:id};next();});registerCueRetryRoutes(app,{db});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/${id}/exercises/${id}/cue-retry`;
 const req=(method,body,role='coach')=>fetch(url,{method,headers:{authorization:role,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await req('GET',null,'')).status,401);
 assert.equal((await req('POST',{action:'create'},'client')).status,403);assert.equal(calls.length,0);
 assert.equal((await req('POST',{action:'create',request_id:id,text:'Cue',source_version:'a'.repeat(32),actor:'forged'})).status,400);
 assert.equal((await req('GET')).status,200);assert.equal(calls[0].name,'read_exercise_cues');assert.equal(calls[0].args.p_auth_user_id,id);
 const body={action:'create',request_id:id,text:'Keep the heel down.',source_version:'a'.repeat(32)};
 assert.equal((await req('POST',body)).status,200);assert.equal(calls.at(-1).name,'mutate_exercise_cue');assert.deepEqual(calls.at(-1).args.p_request,body);
 for(const [code,status] of [['P0404',404],['P0409',409],['P0400',400],['P0403',403],['42883',503],['XX000',500]]){error={code,message:'Synthetic refusal'};assert.equal((await req('POST',body)).status,status);}
});
