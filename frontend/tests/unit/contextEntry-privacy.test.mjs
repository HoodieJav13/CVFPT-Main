import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingStore, freezeRequest, submitFrozen } from '../../src/lib/contextEntry.js';

const requestId='00000000-0000-4000-8000-000000000601';
const frozen=()=>freezeRequest({kind:'create',method:'post',url:'/outside-activities/mine',body:{request_id:requestId,revision:0,activity_type:'game',occurred_on:'2026-10-20',duration_seconds:600,effort_rpe:3,note:'PRIVATE_DRAFT_SENTINEL'}});
const capable={feature:'whole_week',contract:1,outside_activity_writes:'guarded'};

test('unconfirmed private activity draft stays out of browser persistence',()=>{
 const writes=[];const values=new Map();
 const storage={setItem:(key,value)=>{writes.push(value);values.set(key,value);},getItem:key=>values.get(key),removeItem:key=>values.delete(key)};
 const store=createPendingStore({scope:'fictional-actor:fictional-client',getStorage:()=>storage});
 store.save(frozen());
 const stored=writes.join('\n');
 for(const privateValue of ['PRIVATE_DRAFT_SENTINEL','2026-10-20','duration_seconds','effort_rpe','activity_type','"body"']) assert.equal(stored.includes(privateValue),false,privateValue+' persisted');
});

test('malformed 2xx response remains unknown and cannot clear the frozen operation',async()=>{
 let cleared=0;
 const outcome=await submitFrozen({api:{get:async()=>({data:capable}),request:async()=>({status:200,data:{}})},frozen:frozen(),store:{save(){},clear(){cleared++;}}});
 assert.equal(outcome.state,'unknown');
 assert.equal(cleared,0);
});

test('another operation response cannot confirm this frozen save',async()=>{
 let cleared=0;
 const data={request_id:'00000000-0000-4000-8000-000000000699',committed_revision:1,replayed:false,action:'create',resource:{id:'00000000-0000-4000-8000-000000000602',revision:1,archived:false}};
 const outcome=await submitFrozen({api:{get:async()=>({data:capable}),request:async()=>({status:201,data})},frozen:frozen(),store:{save(){},clear(){cleared++;}}});
 assert.equal(outcome.state,'unknown');
 assert.equal(cleared,0);
});

test('preferences need the returned next revision and desired bits before confirmation', async()=>{
 const { validPreferenceCommit }=await import('../../src/lib/contextEntry.js');
 assert.ok(validPreferenceCommit({preferences:{revision:3,activity_client_off:true}},2,{activity_client_off:true}));
 assert.ok(!validPreferenceCommit({},2,{activity_client_off:true}));
 assert.ok(!validPreferenceCommit({preferences:{revision:2,activity_client_off:true}},2,{activity_client_off:true}));
 assert.ok(!validPreferenceCommit({preferences:{revision:3,activity_client_off:false}},2,{activity_client_off:true}));
});

for (const status of [429, 400, 413, 422]) test(`an uncertain same-ID retry receiving pre-RPC ${status} stays unknown`, async () => {
  const store = createPendingStore({ scope: `retry-${status}`, getStorage: () => null });
  const operation = frozen();
  const api = { get: async () => ({ data: capable }), request: async () => { throw new Error('Lost committed response'); } };
  assert.equal((await submitFrozen({ api, frozen: operation, store })).state, 'unknown');
  api.request = async () => { throw Object.assign(new Error('Refused before RPC'), { response: { status, data: {} } }); };
  assert.equal((await submitFrozen({ api, frozen: operation, store, retry: true })).state, 'unknown');
  assert.deepEqual(store.load(), operation);
  const freshStore = createPendingStore({ scope: `fresh-${status}`, getStorage: () => null });
  assert.equal((await submitFrozen({ api, frozen: operation, store: freshStore })).state, 'rejected');
  assert.equal(freshStore.load(), null);
});

test('revocation during capability probe prevents request and storage of the private body', async () => {
  let current = true, release;
  const probe = new Promise(resolve => { release = resolve; });
  let sent = 0, stored = 0;
  const result = submitFrozen({ api: { get: () => probe, request: async () => { sent++; } }, frozen: frozen(), store: { save() { stored++; } }, isCurrent: () => current });
  current = false; release({ data: capable });
  assert.equal((await result).state, 'superseded');
  assert.equal(sent, 0); assert.equal(stored, 0);
});

test('revoked response is ignored without resurrecting cleared pending state', async () => {
  let current = true, release;
  const reply = new Promise((resolve, reject) => { release = reject; });
  const store = createPendingStore({ scope: 'revoked-response', getStorage: () => null });
  const result = submitFrozen({ api: { get: async () => ({ data: capable }), request: () => reply }, frozen: frozen(), store, isCurrent: () => current });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(store.load());
  current = false; store.clear(); release(new Error('Late ambiguous response'));
  assert.equal((await result).state, 'superseded'); assert.equal(store.load(), null);
});
