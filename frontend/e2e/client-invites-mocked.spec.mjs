import {test,expect} from '@playwright/test';
const actor='10000000-0000-4000-8000-0000000000a1',clientId='20000000-0000-4000-8000-0000000000b1',attempt='30000000-0000-4000-8000-0000000000c1';
const summary={attempt_id:attempt,status:'unknown',retryable:true,next_retry_at:null,needs_confirmation:false,message_key:'unknown'};
async function install(context,state){
 await context.addInitScript(()=>{try{localStorage.setItem('cvf_access_token','fictional-token');}catch{/* about:blank has no storage origin */}});
 await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname.replace(/^\/api/,''),method=req.method(),body=req.postData()?JSON.parse(req.postData()):{};
 const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/auth/me')return json({role:'coach',email:'coach@example.invalid',profile:{id:actor,name:'Test Coach'}});
 if(path==='/notifications/unread-count')return json({unread:0});
 if(path==='/clients'&&method==='GET')return json([state.client]);
 if(path==='/clients'&&method==='POST'){state.creates.push(body);if(state.deferCreates){const first=state.creates.length===1;if(first)state.commit=new Promise(r=>{state.releaseCreate=r;});await state.commit;return first?json({client:state.client,replayed:false,invite:null},201):json({code:'request_mismatch',client:state.client},409);}if(state.createMalformed)return json({client:{id:clientId}},201);if(state.loseCreates)return route.abort('failed');return json({client:state.client,replayed:false,invite:body.invite_now?summary:null},201);}
 if(path.startsWith('/clients/create-requests/')){if(state.lookupNetwork)return route.abort('failed');if(state.lookupData)return json(state.lookupData);if(state.lookupStatus)return json({error:'unavailable'},state.lookupStatus);if(state.committed)return json({status:'committed',client:state.client,invite:summary});return json({status:'absent'});}
 if(path===`/clients/${clientId}`&&state.refreshError)return json({error:'unavailable'},500);
 if(path===`/clients/${clientId}`)return json({...state.client,invite:summary});
 if(path.endsWith('/invite')||path.endsWith('/invite/resend')){
  state.actions.push(body);const kind=path.endsWith('/resend')?'resend':body.invited?'on':'off';
  if(kind==='on'&&state.delayOn){await new Promise(r=>{state.releaseOn=r;});}
  else if(kind!=='resend')state.client.invited=body.invited;
  const outcome=state.confirmationOutcome&&state.actions.length===1?state.confirmationOutcome:state.stale&&state.actions.length===1?'stale':'selected';
  return json({action:{action_id:body.action_id,replayed:false,result:{outcome}},invite:summary});
 }
 if(path.endsWith('/week-rhythm'))return json({week_total:0});
 if(path.includes('/waivers/'))return json({signed:false,current_version:null});
 return json([]);
 });
}
const fixture=()=>({client:{id:clientId,coach_id:actor,name:'Fictional Client',email:'fictional@example.invalid',phone:null,goals:null,health_notes:null,invited:false,auth_user_id:null,archived:false,created_at:'2026-10-01T00:00:00Z'},creates:[],actions:[]});
async function open(page){await page.goto('/coach/clients');await page.getByTestId('add-client-button').click();}
async function fill(page,name='Fictional New'){await page.getByTestId('client-name-input').fill(name);await page.getByTestId('client-email-input').fill('fictional@example.invalid');}
test('checkbox off by default, successful create clears only its identity',async({page,context})=>{const s=fixture();await install(context,s);await open(page);await expect(page.getByTestId('client-send-invite-checkbox')).not.toBeChecked();await fill(page);await page.getByTestId('client-save-button').click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(s.creates[0].invite_now).toBe(false);expect(s.creates[0].request_id).toMatch(/^[0-9a-f-]{36}$/);expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cvf_client_create_pending')).length)).toBe(0);});
test('two distinct tab identities survive reload and exact-entry clear',async({page,context})=>{
 const s=fixture();s.loseCreates=true;await install(context,s);const second=await context.newPage();
 await open(page);await fill(page,'Fictional A');await page.getByTestId('client-save-button').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be confirmed');
 await open(second);await fill(second,'Fictional B');await second.getByTestId('client-save-button').click();await expect(second.getByTestId('client-save-message')).toContainText('could not be confirmed');expect(s.creates[0].request_id).not.toBe(s.creates[1].request_id);
 await page.reload();await second.reload();await expect(page.getByTestId('recover-client-save')).toHaveCount(2);s.committed=true;await page.getByTestId('recover-client-save').first().click();await expect(page.getByTestId('recover-client-save')).toHaveCount(1);await expect(second.getByTestId('recover-client-save')).toHaveCount(1);
});
test('lookup errors block re-entry and successful absence preserves same id',async({page,context})=>{
 const s=fixture();s.loseCreates=true;await install(context,s);await open(page);await fill(page);await page.getByTestId('client-save-button').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be confirmed');const old=s.creates[0].request_id;
 await page.reload();s.lookupStatus=500;await page.getByTestId('recover-client-save').click();await expect(page.getByRole('button',{name:'Retry lookup',exact:true})).toBeVisible();await expect(page.getByTestId('client-name-input')).not.toBeVisible();
 s.lookupStatus=0;await page.getByRole('button',{name:'Retry lookup',exact:true}).click();await fill(page);s.loseCreates=false;await page.getByTestId('client-save-button').click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(s.creates.at(-1).request_id).toBe(old);
});
test('delayed on after newer off cannot restore permission',async({page,context})=>{
 const s=fixture();s.delayOn=true;await install(context,s);await page.goto(`/coach/clients/${clientId}`);await expect(page.getByTestId('client-invite-switch')).toBeVisible();await page.getByTestId('client-invite-switch').click();await expect.poll(()=>s.actions.length).toBe(1);await page.getByTestId('client-invite-switch').click();await expect(page.getByTestId('client-claim-permission')).toHaveText('Can claim account: no');s.releaseOn();await expect(page.getByTestId('client-invite-switch')).not.toBeChecked();await expect(page.getByTestId('client-claim-permission')).toHaveText('Can claim account: no');
});
test('stale result reconfirms with fresh action identity/current attempt',async({page,context})=>{
 const s=fixture();s.stale=true;await install(context,s);await page.goto(`/coach/clients/${clientId}`);await page.getByTestId('client-invite-switch').click();await page.getByTestId('confirm-client-invite').click();await expect.poll(()=>s.actions.length).toBe(2);expect(s.actions[0].action_id).not.toBe(s.actions[1].action_id);expect(s.actions[1].supersedes_attempt_id).toBe(attempt);
});

for(const [label,scenario] of [['401',{lookupStatus:401}],['403',{lookupStatus:403}],['404',{lookupStatus:404}],['network',{lookupNetwork:true}],['malformed',{lookupData:{status:'committed',client:{id:clientId}}}]])test(`recovery ${label} retains identity and blocks draft`,async({page,context})=>{
 const s=fixture();s.loseCreates=true;await install(context,s);await open(page);await fill(page);await page.getByTestId('client-save-button').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be confirmed');await page.reload();Object.assign(s,scenario);await page.getByTestId('recover-client-save').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be verified');await expect(page.getByTestId('client-name-input')).not.toBeVisible();expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cvf_client_create_pending')).length)).toBe(1);
});
test('needs confirmation uses new action/current binding and informed choice',async({page,context})=>{
 const s=fixture();s.confirmationOutcome='needs_confirmation';await install(context,s);await page.goto(`/coach/clients/${clientId}`);await page.getByTestId('client-invite-switch').click();await expect(page.getByTestId('confirm-client-invite')).toHaveText('Confirm new send despite duplicate risk');await page.getByTestId('confirm-client-invite').click();await expect.poll(()=>s.actions.length).toBe(2);expect(s.actions[0].action_id).not.toBe(s.actions[1].action_id);expect(s.actions[1].confirm_duplicate_risk).toBe(true);expect(s.actions[1].supersedes_attempt_id).toBe(attempt);
});
test('failed current-state refresh retains exact transport command and cannot assert permission',async({page,context})=>{
 const s=fixture();await install(context,s);await page.goto(`/coach/clients/${clientId}`);await page.getByTestId('client-invite-switch').waitFor();s.refreshError=true;await page.getByTestId('client-invite-switch').click();await expect(page.getByTestId('client-claim-permission')).toHaveText('Can claim account: unable to verify');await page.getByRole('button',{name:'Retry invitation change',exact:true}).click();await expect.poll(()=>s.actions.length).toBe(2);expect(s.actions[1]).toEqual(s.actions[0]);await expect(page.getByRole('button',{name:'Retry state lookup',exact:true})).toBeVisible();s.refreshError=false;await page.getByRole('button',{name:'Retry state lookup',exact:true}).click();await expect(page.getByTestId('client-claim-permission')).toHaveText('Can claim account: yes');
});
test('corrupt record stays visible and blocked until explicit discard',async({page,context})=>{
 const s=fixture();await install(context,s);await open(page);await fill(page);s.loseCreates=true;await page.getByTestId('client-save-button').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be confirmed');await page.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('cvf_client_create_pending'));localStorage.setItem(k,'{broken');});await page.reload();await page.getByTestId('recover-client-save').click();await expect(page.getByTestId('client-save-message')).toContainText("couldn't be read");await expect(page.getByTestId('client-name-input')).not.toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Discard pending save',exact:true}).click();await expect(page.getByTestId('recover-client-save')).toHaveCount(0);
});

for(const failure of ['blocked','full'])test(`storage ${failure} warning survives lost save response`,async({page,context})=>{
 const s=fixture();s.loseCreates=true;await install(context,s);await context.addInitScript(failure=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('cvf_client_create_pending'))throw new DOMException('Fictional storage failure',failure==='full'?'QuotaExceededError':'SecurityError');return original.call(this,key,value);};},failure);
 await open(page);await fill(page);await page.getByTestId('client-save-button').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be confirmed');await expect(page.getByTestId('client-save-durability-warning')).toContainText('Recovery after reload is unavailable');const id=s.creates[0].request_id;await page.getByTestId('client-save-button').click();await expect.poll(()=>s.creates.length).toBe(2);expect(s.creates[1].request_id).toBe(id);await expect(page.getByTestId('client-save-durability-warning')).toBeVisible();
});
test('malformed successful create retains identity and exact retry',async({page,context})=>{
 const s=fixture();s.createMalformed=true;await install(context,s);await open(page);await fill(page);await page.getByTestId('client-save-button').click();await expect(page.getByTestId('client-save-message')).toContainText('could not be confirmed');const id=s.creates[0].request_id;s.createMalformed=false;await page.getByTestId('client-save-button').click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(s.creates[1].request_id).toBe(id);
});
test('absence before original commit reuses identity and resolves mismatch to original client',async({page,context})=>{
 const s=fixture();s.deferCreates=true;await install(context,s);await open(page);await fill(page,'Original');await page.getByTestId('client-save-button').click();await expect.poll(()=>s.creates.length).toBe(1);const id=s.creates[0].request_id;await page.reload();await page.getByTestId('recover-client-save').click();await expect(page.getByTestId('client-save-message')).toContainText('No saved client was found');await fill(page,'Changed');await page.getByTestId('client-save-button').click();await expect.poll(()=>s.creates.length).toBe(2);expect(s.creates[1].request_id).toBe(id);s.releaseCreate();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByText('The earlier save already created this client.')).toBeVisible();expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cvf_client_create_pending')).length)).toBe(0);
});
