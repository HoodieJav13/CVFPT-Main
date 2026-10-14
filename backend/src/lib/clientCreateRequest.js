const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizeClientCreate(body,targetCoachId) {
 return {name:String(body.name||'').trim(),email:body.email?String(body.email).trim().toLowerCase():null,
 phone:body.phone||null,goals:body.goals||null,health_notes:body.health_notes||null,coach_id:targetCoachId,invite_now:body.invite_now===true};
}
function hashClientCreate(n){return createHash('sha256').update(JSON.stringify([n.name,n.email,n.phone,n.goals,n.health_notes,n.coach_id,n.invite_now])).digest('hex');}
function toInviteSummary(a,now=Date.now()) {
 if(!a)return null;
 const abandoned=a.status==='pending'&&a.admitted_calls>a.completed_calls&&a.lease_expires_at&&Date.parse(a.lease_expires_at)<=now;
 const status=abandoned?'unknown':a.status;
 const deadline=a.first_provider_call_at?Date.parse(a.first_provider_call_at)+23*3600000:Infinity;
 const retryable=a.status!=='accepted'&&!a.closed_at&&!a.retry_disabled&&Boolean(a.provider_body)&&now<deadline;
 return {attempt_id:a.id,status,retryable,next_retry_at:a.retry_after_at||null,
 needs_confirmation:a.status!=='accepted'&&Boolean(a.uncertain||a.admitted_calls>a.completed_calls)&&!retryable,message_key:status};
}
function clientRecoverySummary(c){return Object.fromEntries(['id','name','email','coach_id','invited','auth_user_id','archived'].map(k=>[k,c[k]]));}
module.exports={UUID,normalizeClientCreate,hashClientCreate,toInviteSummary,clientRecoverySummary};
