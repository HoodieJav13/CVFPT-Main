import {test} from 'node:test';import assert from 'node:assert/strict';
import {pendingKey,writePending,listPending,clearPending,classifyRecovery} from '../../src/lib/clientCreateRecovery.js';
const A={environment:'test',actorId:'coach',requestId:'a0000000-0000-4000-8000-000000000001'},B={...A,requestId:'a0000000-0000-4000-8000-000000000002'};
const storage=()=>{const map=new Map();return {get length(){return map.size},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('distinct entries survive exact-entry clear and contain no sensitive draft',()=>{
 const s=storage();const r=c=>({v:1,request_id:c.requestId,state:'pending',created_at:'2026-10-09T00:00:00Z',health_notes:'PRIVATE',email:'PRIVATE'});
 assert.notEqual(pendingKey(A),pendingKey(B));writePending(A,r(A),s);writePending(B,r(B),s);assert.equal(listPending(A,s).length,2);
 assert.doesNotMatch(s.getItem(pendingKey(A)),/PRIVATE|email|health_notes/);clearPending(A,s);assert.equal(s.getItem(pendingKey(A)),null);assert.ok(s.getItem(pendingKey(B)));
 assert.equal(listPending({...A,actorId:'other'},s).length,0);assert.equal(listPending({...A,environment:'production'},s).length,0);
});
test('storage failure/corruption never pretend durable recovery',()=>{
 assert.equal(writePending(A,{v:1,request_id:A.requestId,state:'pending',created_at:'x'},{setItem(){throw Error('blocked')}}).durable,false);
 const s=storage();s.setItem(pendingKey(A),'{broken');const entries=listPending(A,s);assert.equal(entries[0].corrupt,true);assert.notEqual(s.getItem(pendingKey(A)),null);
});
for(const status of [401,403,404,500])test('error '+status+' never means absence',()=>assert.equal(classifyRecovery({status,data:{status:'absent'}}).kind,'blocked'));
test('only valid 200 discriminants enable absence or committed',()=>{
 assert.equal(classifyRecovery({status:200,data:{status:'absent'}}).kind,'absent');
 assert.equal(classifyRecovery({status:200,data:{status:'committed'}}).kind,'blocked');
 assert.equal(classifyRecovery({status:200,data:{status:'committed',client:{id:A.requestId}}}).kind,'blocked');
 assert.equal(classifyRecovery({status:200,data:{status:'committed',client:{id:A.requestId,name:'Fictional',coach_id:'coach',invited:false,archived:false,email:null,auth_user_id:null}}}).kind,'committed');
 assert.equal(classifyRecovery(Error('network')).kind,'blocked');assert.equal(classifyRecovery({status:200,data:null}).kind,'blocked');
});
