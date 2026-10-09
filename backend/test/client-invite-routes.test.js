const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const actor='10000000-0000-4000-8000-0000000000a1',clientId='20000000-0000-4000-8000-0000000000b1',requestId='a0000000-0000-4000-8000-000000000001',attemptId='c0000000-0000-4000-8000-000000000001';
const user={role:'coach',coach:{id:actor,name:'Coach Test'}};
const client={id:clientId,coach_id:actor,name:'Fictional',email:'fictional@example.invalid',invited:true,auth_user_id:null,archived:false,health_notes:'PRIVATE'};
const state={};const reset=()=>Object.assign(state,{receipt:null,readError:false,rpcCalls:[],rpcResult:{outcome:'created',client,attempt_id:null,replayed:false},rows:[],providerCalls:0,actionResult:null});reset();
const db={from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},insert(row){state.rows.push(row);return q},async single(){return {data:client,error:null}},async maybeSingle(){return {data:table==='client_create_requests'?state.receipt:table==='clients'?client:table==='coaches'?{id:actor}:null,error:state.readError?{message:'RAW_PRIVATE'}:null}},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q},async rpc(name,args){state.rpcCalls.push({name,args});if(name==='admit_invite_call')return {data:{admitted:false,invite:null},error:null};return {data:state.actionResult||state.rpcResult,error:null};}};
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../src/supabase',{supabaseAdmin:db});
stub('../src/middleware/auth',{requireAuth:(req,res,next)=>{req.user=user;next()},requireCoach:(req,res,next)=>['coach','admin'].includes(req.user.role)?next():res.status(403).json({error:'Coach access required'}),canAccessClient:(u,c)=>u.role==='admin'||u.coach.id===c.coach_id});
stub('../src/services/email',{configured:()=>false,FROM:'Test <from@example.invalid>',dispatchEmail:()=>{state.providerCalls++;}});
stub('../src/services/accountRecovery',{renderInviteMessage:()=>({to:['fictional@example.invalid'],subject:'Invite',html:'Fictional',text:'Fictional'}),sendInviteEmail:()=>{state.providerCalls++;},sendPasswordResetEmail:()=>{}});
const router=require('../src/routes/clients');
async function withServer(fn){const app=express();app.use(express.json());app.use('/api/clients',router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await fn(`http://127.0.0.1:${server.address().port}`)}finally{await new Promise(r=>server.close(r));}}
const send=async(url,path,method='GET',body)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
test('new create uses server authority and RPC while legacy insert remains plain',async()=>withServer(async url=>{
 reset();const r=await send(url,'/api/clients','POST',{request_id:requestId,name:' Fictional ',email:'TEST@EXAMPLE.INVALID',invite_now:false,actor:'forged'});
 assert.equal(r.status,201);assert.equal(r.data.replayed,false);assert.equal(state.rpcCalls[0].name,'create_client_with_request');assert.equal(state.rpcCalls[0].args.p_actor,actor);assert.equal(state.rows.length,0);
 reset();assert.equal((await send(url,'/api/clients','POST',{name:'Legacy'})).status,201);assert.equal(state.rpcCalls.length,0);assert.equal(state.rows.length,1);assert.equal(state.providerCalls,0);
}));
test('shape failures do no write and mismatch returns only authorized summary',async()=>withServer(async url=>{
 reset();let r=await send(url,'/api/clients','POST',{request_id:requestId,name:'Test',invite_now:true});assert.equal(r.status,400);assert.equal(r.data.no_write,true);assert.equal(state.rpcCalls.length,0);
 state.rpcResult={outcome:'request_mismatch',client,attempt_id:null};r=await send(url,'/api/clients','POST',{request_id:requestId,name:'Test'});assert.equal(r.status,409);assert.equal(r.data.code,'request_mismatch');assert.equal(r.data.client.health_notes,undefined);
}));
test('authorized recovery distinguishes absence, committed and lookup failure',async()=>withServer(async url=>{
 reset();const path=`/api/clients/create-requests/${requestId}`;
 assert.deepEqual((await send(url,path)).data,{status:'absent'});
 state.receipt={client_id:clientId,create_attempt_id:null};let r=await send(url,path);assert.equal(r.data.status,'committed');assert.equal(r.data.client.health_notes,undefined);
 state.readError=true;r=await send(url,path);assert.equal(r.status,500);assert.notEqual(r.data.status,'absent');assert.doesNotMatch(JSON.stringify(r.data),/RAW_PRIVATE/);
}));
test('switch command requires action identity and stale replay never admits email',async()=>withServer(async url=>{
 reset();let r=await send(url,`/api/clients/${clientId}/invite`,'PATCH',{invited:true});assert.equal(r.status,400);assert.equal(state.providerCalls,0);
 state.actionResult={action_id:requestId,replayed:true,result:{outcome:'stale'},attempt_id:attemptId};
 r=await send(url,`/api/clients/${clientId}/invite`,'PATCH',{invited:true,action_id:requestId,supersedes_attempt_id:attemptId,confirm_duplicate_risk:false});
 assert.equal(r.data.action.result.outcome,'stale');assert.equal(state.rpcCalls.filter(c=>c.name==='admit_invite_call').length,0);assert.equal(state.providerCalls,0);
}));
const services=require('../src/services/clientInvites');
test('completion failure stays unknown and admitted same-key retry passes frozen body',async()=>{
 const frozen={from:'test@example.invalid',to:['fictional@example.invalid'],text:'Frozen'};const calls=[];
 const isolated={async rpc(name,args){calls.push({name,args});if(name==='admit_invite_call')return {data:{admitted:true,lease_token:requestId,provider_body:frozen,admitted_calls:2}};return {error:{message:'raw'}};}};
 const result=await services.deliverInviteAttempt({actorId:actor,attemptId},{db:isolated,transport:async args=>{assert.deepEqual(args.providerBody,frozen);assert.equal(args.attemptId,attemptId);return {kind:'unknown',code:'timeout'};}});
 assert.equal(result.status,'unknown');assert.equal(calls[1].args.p_lease_token,requestId);
});

test('client role is refused, former owner cannot recover, admin target remains authoritative',async()=>withServer(async url=>{
 reset();user.role='client';assert.equal((await send(url,'/api/clients','POST',{request_id:requestId,name:'Test'})).status,403);assert.equal(state.rpcCalls.length,0);
 user.role='coach';state.receipt={client_id:clientId,create_attempt_id:null};const original=client.coach_id;client.coach_id='10000000-0000-4000-8000-0000000000a2';
 assert.equal((await send(url,`/api/clients/create-requests/${requestId}`)).status,404);client.coach_id=original;
 user.role='admin';let r=await send(url,'/api/clients','POST',{request_id:requestId,name:'Admin',coach_id:actor});assert.equal(r.status,201);assert.equal(state.rpcCalls.at(-1).args.p_client.coach_id,actor);user.role='coach';
}));
