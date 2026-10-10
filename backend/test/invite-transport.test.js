const test=require('node:test'); const assert=require('node:assert/strict');
const {callInviteProvider}=require('../src/services/inviteTransport');
const id='aaaaaaaa-0000-4000-8000-000000000001';
const env={RESEND_API_KEY:'fictional-key'};
const body={from:'from@example.invalid',to:['to@example.invalid'],reply_to:'reply@example.invalid',subject:'Invite',html:'<p>Fictional</p>',text:'Fictional'};
const answer=(status,data,headers={})=>({status,headers:{get:k=>headers[k]},json:async()=>data});
const call=(fetchImpl,clock)=>callInviteProvider({attemptId:id,providerBody:body,admittedCalls:1},{env,fetchImpl,clock});
test('exact HTTP contract and frozen key/body across uncertain retry',async()=>{
 const calls=[]; const fetchImpl=async(url,options)=>{calls.push({url,options}); return answer(200,{id});};
 assert.deepEqual(await call(fetchImpl),{kind:'accepted',provider_message_id:id}); await call(fetchImpl);
 assert.equal(calls[0].url,'https://api.resend.com/emails'); assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.headers['Content-Type'],'application/json');
 assert.equal(calls[0].options.headers['Authorization'],'Bearer fictional-key');
 assert.equal(calls[0].options.headers['Idempotency-Key'],`invite/${id}`);
 assert.equal(calls[1].options.body,calls[0].options.body); assert.deepEqual(JSON.parse(calls[0].options.body),body);
});
for(const bad of [null,{},[],{id:''},{id:' '},{id:5},{id:'invalid'}, {id:' '+id}]) test('invalid accepted body '+JSON.stringify(bad),async()=>assert.equal((await call(async()=>answer(200,bad))).kind,'unknown'));
for(const [status,name,kind] of [[409,'concurrent_idempotent_requests','backoff'],[409,'invalid_idempotent_request','unknown'],[429,'rate_limit_exceeded','backoff'],[429,'daily_quota_exceeded','backoff'],[429,'monthly_quota_exceeded','disabled'],[403,'validation_error','rejected'],[401,'missing_api_key','rejected'],[422,'missing_required_field','rejected'],[403,'rate_limit_exceeded','unknown'],[400,'new_unknown','unknown'],[500,'application_error','unknown']]) test(`classify ${status}/${name}`,async()=>assert.equal((await call(async()=>answer(status,{name,message:'raw-private-address@example.invalid'}))).kind,kind));
test('bare rejection and truncated JSON remain unknown',async()=>{
 assert.equal((await call(async()=>answer(403,{}))).kind,'unknown');
 assert.equal((await call(async()=>({status:200,json:async()=>{throw Error('raw-private-address@example.invalid');}}))).kind,'unknown');
});
test('deadline covers stalled body, aborts and ignores late valid response',async()=>{
 let now=0,timeout,cleared=false,signal,resolveBody;
 const clock={now:()=>now,setTimeout:(fn,ms)=>{assert.equal(ms,8000);timeout=fn;return 1;},clearTimeout:()=>{cleared=true;}};
 const pending=call(async(_url,opts)=>{signal=opts.signal;return {status:200,json:()=>new Promise(r=>{resolveBody=r;})};},clock);
 await new Promise(r=>setImmediate(r)); now=8000;timeout();
 assert.deepEqual(await pending,{kind:'unknown',code:'timeout'}); assert.equal(signal.aborted,true); assert.equal(cleared,true);
 resolveBody({id}); await new Promise(r=>setImmediate(r));
});
test('late body after elapsed deadline is unknown even before timer callback',async()=>{
 let now=0; const clock={now:()=>now,setTimeout:()=>1,clearTimeout:()=>{}};
 assert.equal((await call(async()=>({status:200,json:async()=>{now=8001;return {id};}}),clock)).code,'timeout');
});
test('retry-after parsing is bounded and daily quota uses midnight UTC',async()=>{
 const c={now:()=>0,setTimeout,clearTimeout};
 const r=await call(async()=>answer(429,{name:'rate_limit_exceeded',message:'limited'},{'retry-after':'3'}),c);
 assert.equal(r.retry_after_at,'1970-01-01T00:00:03.000Z');
 const d=await call(async()=>answer(429,{name:'daily_quota_exceeded',message:'quota'}),c); assert.equal(d.retry_after_at,'1970-01-02T00:00:00.000Z');
});
test('network/error canaries never escape outcome or console logging',async()=>{
 const logged=[]; const orig=console.error;console.error=(...args)=>logged.push(args);
 try {const out=await call(async()=>{throw Error('raw-private-address@example.invalid');});assert.deepEqual(out,{kind:'unknown',code:'network'});assert.deepEqual(logged,[]);}finally{console.error=orig;}
});

test('deadline includes error classification and header validation',async()=>{
 let now=0,signal;const clock={now:()=>now,wallNow:()=>0,setTimeout:()=>1,clearTimeout:()=>{}};
 const out=await call(async(_url,opts)=>{signal=opts.signal;return {status:429,json:async()=>({name:'rate_limit_exceeded',message:'limited'}),headers:{get(){now=8001;return '3';}}};},clock);
 assert.deepEqual(out,{kind:'unknown',code:'timeout'});assert.equal(signal.aborted,true);
});
