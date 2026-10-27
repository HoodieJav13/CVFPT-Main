const {supabaseAdmin}=require('../supabase');
const {configured,FROM}=require('./email');
const {renderInviteMessage}=require('./accountRecovery');
const {callInviteProvider}=require('./inviteTransport');
const {toInviteSummary,clientRecoverySummary}=require('../lib/clientCreateRequest');
const {canAccessClient}=require('../security/access');
const ATTEMPT_FIELDS='id,status,uncertain,retry_disabled,provider_body,retry_after_at,first_provider_call_at,closed_at,admitted_calls,completed_calls,lease_expires_at';
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw new Error('Invite operation unavailable');return data;}
function renderInviteBody({client,coachName},env=process.env){if(!configured(env))return null;return {from:FROM,reply_to:env.NOTIFY_REPLY_TO,...renderInviteMessage({client,coachName},env)};}
async function readAttempt(attemptId,db=supabaseAdmin){if(!attemptId)return null;const {data,error}=await db.from('client_invite_attempts').select(ATTEMPT_FIELDS).eq('id',attemptId).maybeSingle();if(error)throw new Error('Invite state unavailable');return toInviteSummary(data);}
async function latestInvite(clientId,db=supabaseAdmin){const {data,error}=await db.from('client_invite_attempts').select(ATTEMPT_FIELDS).eq('client_id',clientId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();if(error)throw new Error('Invite state unavailable');return toInviteSummary(data);}
async function deliverInviteAttempt({actorId,attemptId},{db=supabaseAdmin,transport=callInviteProvider}={}) {
 const admitted=await rpc(db,'admit_invite_call',{p_actor:actorId,p_attempt_id:attemptId});
 if(admitted?.outcome==='not_found')return null;
 if(!admitted?.admitted)return admitted?.invite||await readAttempt(attemptId,db);
 const outcome=await transport({attemptId,providerBody:admitted.provider_body,admittedCalls:admitted.admitted_calls});
 try{return await rpc(db,'complete_invite_call',{p_attempt_id:attemptId,p_lease_token:admitted.lease_token,p_outcome:outcome});}
 catch {return {attempt_id:attemptId,status:'unknown',retryable:true,next_retry_at:null,needs_confirmation:false,message_key:'completion_unknown'};}
}
async function lookupCreateRequest({actorId,requestId,user},{db=supabaseAdmin}={}) {
 const {data:receipt,error}=await db.from('client_create_requests').select('client_id,create_attempt_id').eq('actor_coach_id',actorId).eq('request_id',requestId).maybeSingle();
 if(error)throw new Error('Client recovery unavailable'); if(!receipt)return {status:'absent'};
 const {data:client,error:clientError}=await db.from('clients').select('id,name,email,coach_id,invited,auth_user_id,archived').eq('id',receipt.client_id).maybeSingle();
 if(clientError)throw new Error('Client recovery unavailable');
 if(!client||!canAccessClient(user,client))return {status:'blocked'};
 return {status:'committed',client:clientRecoverySummary(client),invite:await readAttempt(receipt.create_attempt_id,db)};
}
module.exports={rpc,renderInviteBody,readAttempt,latestInvite,deliverInviteAttempt,lookupCreateRequest};
