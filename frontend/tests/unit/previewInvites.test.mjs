import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPreviewInvites} from '../../src/lib/previewInvites.js';
const request='a0000000-0000-4000-8000-000000000001',action='b0000000-0000-4000-8000-000000000001';
test('fictional receipts replay one row and return invite-only recovery',()=>{
 const f=createPreviewInvites();const rows=[];const payload={request_id:request,name:' Fictional ',email:'TEST@EXAMPLE.INVALID',invite_now:true,health_notes:'PRIVATE'};
 const r=f.create('coach',payload,rows,'coach');assert.equal(r.status,201);assert.equal(r.data.invite.status,'accepted');assert.equal(rows[0].invited,true);
 const replay=f.create('coach',payload,rows,'coach');assert.equal(replay.data.replayed,true);assert.equal(rows.length,1);
 const lookup=f.recover('coach',request,rows,()=>true);assert.equal(lookup.data.status,'committed');assert.equal(lookup.data.client.health_notes,undefined);assert.equal(f.recover('other',request,rows,()=>true).data.status,'absent');
 assert.equal(f.create('coach',{...payload,name:'Changed'},rows,'coach').status,409);
});
test('fictional action replay and fresh reconfirmation preserve permission rules',()=>{
 const f=createPreviewInvites();const rows=[];const r=f.create('coach',{request_id:request,name:'Fictional',email:'test@example.invalid',invite_now:true},rows,'coach');const c=rows[0],first=r.data.invite.attempt_id;
 let on=f.action('coach',c,{action_id:action,invited:true,supersedes_attempt_id:null},'switch_on');assert.equal(on.data.action.result.outcome,'stale');
 let off=f.action('coach',c,{action_id:action.replace(/1$/,'2'),invited:false},'switch_off');assert.equal(c.invited,false);
 on=f.action('coach',c,{action_id:action,invited:true},'switch_on');assert.equal(on.data.action.replayed,true);assert.equal(c.invited,false);
 const fresh=f.action('coach',c,{action_id:action.replace(/1$/,'3'),supersedes_attempt_id:first,invited:true},'switch_on');assert.equal(fresh.data.action.result.outcome,'selected');assert.equal(c.invited,true);
 c.auth_user_id='claimed';off=f.action('coach',c,{action_id:action.replace(/1$/,'4'),invited:false},'switch_off');assert.equal(off.data.action.result.outcome,'already_claimed');assert.equal(c.invited,true);
});

test('unknown preview retry uses same attempt and disabled uncertainty needs a fresh confirmed action',()=>{
 let outcome='unknown';const f=createPreviewInvites({outcome:()=>outcome}),rows=[];const r=f.create('coach',{request_id:request,name:'Fictional',email:'test@example.invalid',invite_now:true},rows,'coach');let c=rows[0],attempt=r.data.invite.attempt_id;
 const retry=f.action('coach',c,{action_id:action,supersedes_attempt_id:attempt},'resend');assert.equal(retry.data.action.result.attempt_id,attempt);
 outcome='unknown_disabled';const second=f.create('coach',{request_id:request.replace(/1$/,'2'),name:'Fictional Other',email:'test@example.invalid',invite_now:true},rows,'coach');c=rows[1];attempt=second.data.invite.attempt_id;
 const command={action_id:action.replace(/1$/,'2'),supersedes_attempt_id:attempt};const risk=f.action('coach',c,command,'resend');assert.equal(risk.data.action.result.outcome,'needs_confirmation');
 const replay=f.action('coach',c,{...command,confirm_duplicate_risk:true},'resend');assert.equal(replay.data.action.result.outcome,'needs_confirmation');
 outcome='accepted';const confirmed=f.action('coach',c,{...command,action_id:action.replace(/1$/,'3'),confirm_duplicate_risk:true},'resend');assert.equal(confirmed.data.invite.status,'accepted');assert.notEqual(confirmed.data.invite.attempt_id,attempt);
});
