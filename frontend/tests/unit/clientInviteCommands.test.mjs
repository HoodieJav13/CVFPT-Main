import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeInviteCommand,createIntentGuard} from '../../src/lib/clientInviteCommands.js';
test('reconfirmation mints id while transport retry preserves exact frozen command',()=>{
 let n=0;const uuid=()=>`id-${++n}`;const old=makeInviteCommand({kind:'resend',supersedesAttemptId:'attempt-1',confirmDuplicateRisk:false},uuid);
 const retry=old;assert.deepEqual(retry,old);assert.equal(retry.action_id,'id-1');
 const next=makeInviteCommand({kind:'resend',supersedesAttemptId:'attempt-2',confirmDuplicateRisk:true},uuid);assert.equal(next.action_id,'id-2');assert.equal(next.supersedes_attempt_id,'attempt-2');assert.equal(next.confirm_duplicate_risk,true);assert.ok(Object.isFrozen(old));
});
test('newer off, namespace switch and discard fence old callbacks',()=>{
 const guard=createIntentGuard();const context={environment:'test',actorId:'actor',clientId:'client',actionId:'on'};
 const on=guard.next(context);assert.ok(guard.isCurrent(on));const off=guard.next({...context,actionId:'off'});assert.equal(guard.isCurrent(on),false);assert.ok(guard.isCurrent(off));
 guard.next({...context,actorId:'other'});assert.equal(guard.isCurrent(off),false);guard.next(null);assert.equal(guard.isCurrent(on),false);
});
