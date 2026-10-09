// Fictional in-memory fixtures only; never sends email or persists client drafts.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const result=(data,status=200)=>({data,status});
const safeClient=c=>Object.fromEntries(['id','name','email','coach_id','invited','auth_user_id','archived'].map(k=>[k,c[k]]));
export function createPreviewInvites({outcome=()=>'accepted'}={}){
 const receipts=new Map(),actions=new Map(),attempts=new Map();let sequence=0;
 const nextId=()=>`f0000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
 const summary=a=>a?{attempt_id:a.id,status:a.status,retryable:a.status==='unknown'&&!a.disabled,next_retry_at:null,needs_confirmation:a.status==='unknown'&&a.disabled,message_key:a.status}:null;
 const latest=c=>summary(attempts.get(c.id));
 const makeAttempt=c=>{const selected=outcome();const a={id:nextId(),status:['unknown','unknown_disabled'].includes(selected)?'unknown':selected==='failed'?'failed':'accepted',disabled:selected==='unknown_disabled'};attempts.set(c.id,a);return a;};
 const normalize=(p,coach)=>({name:String(p.name||'').trim(),email:p.email?String(p.email).trim().toLowerCase():null,phone:p.phone||null,goals:p.goals||null,health_notes:p.health_notes||null,coach_id:coach,invite_now:p.invite_now===true});
 return {latest,
  create(actor,p,rows,coach,canAccess=c=>c.coach_id===actor){
   if(!UUID.test(p.request_id)||!String(p.name||'').trim()||('invite_now'in p&&typeof p.invite_now!=='boolean')||(p.invite_now&&!p.email))return result({error:'Invalid client request',no_write:true},400);
   const normalized=normalize(p,coach),hash=JSON.stringify(normalized),key=`${actor}/${p.request_id}`,old=receipts.get(key);
   if(old){const c=rows.find(row=>row.id===old.clientId);if(!c||!canAccess(c))return result({error:'Client not found'},404);if(old.hash!==hash)return result({code:'request_mismatch',client:safeClient(c),invite:summary(old.attempt)},409);return result({client:c,replayed:true,invite:summary(old.attempt)});}
   const c={...normalized,id:nextId(),invited:normalized.invite_now,auth_user_id:null,archived:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};delete c.invite_now;
   rows.push(c);const attempt=c.invited?makeAttempt(c):null;receipts.set(key,{hash,clientId:c.id,attempt});return result({client:c,replayed:false,invite:summary(attempt)},201);
  },
  recover(actor,request,rows,canAccess){const old=receipts.get(`${actor}/${request}`);if(!old)return result({status:'absent'});const c=rows.find(row=>row.id===old.clientId);if(!c||!canAccess(c))return result({error:'Recovery blocked'},404);return result({status:'committed',client:safeClient(c),invite:summary(old.attempt)});},
  action(actor,c,p,kind){
   if(!UUID.test(p.action_id)||('supersedes_attempt_id'in p&&p.supersedes_attempt_id!==null&&!UUID.test(p.supersedes_attempt_id))||('confirm_duplicate_risk'in p&&typeof p.confirm_duplicate_risk!=='boolean')||(kind!=='resend'&&typeof p.invited!=='boolean'))return result({error:'Invalid invitation action'},400);
   const key=`${actor}/${p.action_id}`,old=actions.get(key);
   if(old){if(old.clientId!==c.id||old.kind!==kind)return result({code:'action_mismatch'},409);return result({action:{action_id:p.action_id,replayed:true,result:old.result},invite:latest(c)});}
   let r;const prior=attempts.get(c.id);
   if(kind==='switch_off'){if(c.auth_user_id)r={outcome:'already_claimed'};else {c.invited=false;r={outcome:'switched_off'};}}
   else if(c.auth_user_id||c.archived||!c.email)r={outcome:'ineligible'};
   else if(kind==='resend'&&!c.invited)r={outcome:'withdrawn'};
   else {
    if(kind==='switch_on')c.invited=true;
    if((p.supersedes_attempt_id||null)!==(prior?.id||null))r={outcome:'stale',invite:latest(c)};
    else if(prior?.status==='unknown'&&!prior.disabled)r={outcome:'selected',attempt_id:prior.id};
    else if(prior?.status==='unknown'&&!p.confirm_duplicate_risk)r={outcome:'needs_confirmation',invite:latest(c)};
    else r={outcome:'selected',attempt_id:makeAttempt(c).id};
   }
   actions.set(key,{clientId:c.id,kind,result:r});return result({action:{action_id:p.action_id,replayed:false,result:r},invite:latest(c)});
  },
 };
}
