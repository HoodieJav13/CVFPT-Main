// Invite-only transport. Never pass raw provider material to a logger or caller.
const {performance}=require('node:perf_hooks');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REJECTIONS={400:['invalid_idempotency_key','validation_error'],401:['missing_api_key','restricted_api_key'],403:['invalid_permission','restricted_api_key','suspended_api_key','validation_error'],422:['validation_error','invalid_attachment','invalid_parameter','missing_required_field','missing_required_parameter']};
const defaultClock={now:()=>performance.now(),wallNow:Date.now,setTimeout,clearTimeout};
async function callInviteProvider({attemptId,providerBody,admittedCalls=1},{env=process.env,fetchImpl=globalThis.fetch,clock=defaultClock}={}) {
 const controller=new AbortController(); const start=clock.now(); let expired=false,timer;
 const unknown=code=>({kind:'unknown',code});
 const deadline=new Promise(resolve=>{timer=clock.setTimeout(()=>{expired=true;controller.abort();resolve(unknown('timeout'));},8000);});
 const task=(async()=>{
  try {
   const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Idempotency-Key':`invite/${attemptId}`,'Authorization':`Bearer ${env.RESEND_API_KEY}`},
    body:JSON.stringify(providerBody),signal:controller.signal,
   });
   const data=await response.json();
   if(expired||clock.now()-start>=8000){controller.abort();return unknown('timeout');}
   if(response.status>=200&&response.status<300) return data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.id==='string'&&UUID.test(data.id)?{kind:'accepted',provider_message_id:data.id}:unknown('unclassified');
   if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.name!=='string'||typeof data.message!=='string') return unknown('unclassified');
   const code=data.name,status=response.status;
   const wall=(clock.wallNow||clock.now)();
   const after=seconds=>new Date(wall+seconds*1000).toISOString();
   if(status===409&&code==='concurrent_idempotent_requests') return {kind:'backoff',code,retry_after_at:after([5,30,120][Math.min(Math.max(admittedCalls-1,0),2)])};
   if(status===409&&code==='invalid_idempotent_request') return unknown(code);
   if(status===429&&code==='monthly_quota_exceeded') return {kind:'disabled',code};
   if(status===429&&code==='daily_quota_exceeded') {const next=new Date(wall);next.setUTCHours(24,0,0,0);return {kind:'backoff',code,retry_after_at:next.toISOString()};}
   if(status===429&&code==='rate_limit_exceeded') {
    const header=response.headers?.get('retry-after'); const numeric=header!=null&&/^\d+(\.\d+)?$/.test(header)?Number(header):NaN;
    const date=header?Date.parse(header):NaN;
    const seconds=Number.isFinite(numeric)?numeric:Number.isFinite(date)&&date>=wall?(date-wall)/1000:Math.min(60,2**Math.min(Math.max(admittedCalls,1),6));
    return {kind:'backoff',code,retry_after_at:after(seconds)};
   }
   if(REJECTIONS[status]?.includes(code)) return {kind:'rejected',code,http_status:status};
   return unknown('unclassified');
  } catch {return unknown(expired||clock.now()-start>=8000?'timeout':'network');}
 })();
 try{const outcome=await Promise.race([deadline,task]);if(expired||clock.now()-start>=8000){controller.abort();return unknown('timeout');}return outcome;}finally{clock.clearTimeout(timer);}
}
module.exports={callInviteProvider};
