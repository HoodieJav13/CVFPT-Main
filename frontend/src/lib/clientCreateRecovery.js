const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prefix=({environment,actorId})=>`cvf_client_create_pending:v1:${encodeURIComponent(environment)}:${encodeURIComponent(actorId)}:`;
export const pendingKey=context=>prefix(context)+context.requestId;
export function recoveryStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function writePending(context,record,storage=recoveryStorage()){
 try{storage.setItem(pendingKey(context),JSON.stringify({v:1,request_id:context.requestId,state:record.state,created_at:record.created_at}));return {durable:true};}catch{return {durable:false};}
}
export function listPending(context,storage=recoveryStorage()){
 const entries=[];try{for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith(prefix(context)))continue;
  const requestId=key.slice(prefix(context).length);let record=null,corrupt=false;
  try{record=JSON.parse(storage.getItem(key));if(!record||record.v!==1||!UUID.test(requestId)||record.request_id!==requestId||typeof record.state!=='string'||!Number.isFinite(Date.parse(record.created_at)))corrupt=true;}catch{corrupt=true;}
  entries.push({key,context:{...context,requestId},record:corrupt?null:record,corrupt});
 }}catch{return entries;}return entries;
}
export function clearPending(context,storage=recoveryStorage()){try{storage.removeItem(pendingKey(context));return true;}catch{return false;}}
export function classifyRecovery(response){
 if(response?.status!==200)return {kind:'blocked'};
 const data=response.data;
 if(data?.status==='absent')return {kind:'absent'};
 if(data?.status==='committed'&&typeof data.client?.id==='string'&&data.client.id&&typeof data.client.name==='string'&&typeof data.client.coach_id==='string'&&typeof data.client.invited==='boolean'&&typeof data.client.archived==='boolean'&&(data.client.email===null||typeof data.client.email==='string')&&(data.client.auth_user_id===null||typeof data.client.auth_user_id==='string'))return {kind:'committed',client:data.client,invite:data.invite||null};
 return {kind:'blocked'};
}
