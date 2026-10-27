const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeClientCreate,hashClientCreate,toInviteSummary}=require('../src/lib/clientCreateRequest');
test('normalized hash includes target and invite flag without supplied authority',()=>{
 const n=normalizeClientCreate({name:' Test ',email:' Test@Example.invalid ',health_notes:'fictional',invite_now:true,actor:'forged'},'coach');
 assert.equal(n.email,'test@example.invalid');assert.equal(n.name,'Test');assert.equal(n.coach_id,'coach');assert.equal(n.actor,undefined);
 assert.equal(hashClientCreate(n),hashClientCreate({...n}));assert.notEqual(hashClientCreate(n),hashClientCreate({...n,invite_now:false}));
});
test('summary excludes body/raw errors and accepted stays nonretryable',()=>{
 const s=toInviteSummary({id:'attempt',status:'accepted',provider_body:{secret:'canary'},last_error_code:'raw@private.invalid'});
 assert.equal(s.retryable,false);assert.equal(s.provider_body,undefined);assert.equal(s.last_error_code,undefined);
});
test('expired unfinished admission is unknown on recovery without rotating identity',()=>{
 const a={id:'a',status:'pending',provider_body:{text:'Frozen'},admitted_calls:1,completed_calls:0,lease_expires_at:'2026-10-09T00:00:00Z'};
 const summary=toInviteSummary(a,Date.parse('2026-10-09T00:00:01Z'));assert.equal(summary.status,'unknown');assert.equal(summary.message_key,'unknown');assert.equal(summary.retryable,true);assert.equal(summary.attempt_id,'a');
});
