// Normal Vite frontend (previewMode=false) -> real Express routes -> actual local SQL.
// Surrounding shell reads + provider token verification are explicitly synthetic.
const {spawn}=require('node:child_process');
const {once}=require('node:events');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
const {chromium}=require('../../../frontend/node_modules/@playwright/test');
const cwd=path.resolve(__dirname,'../../..');
const evidence=process.env.RESCUE_EVIDENCE_DIR||'/tmp/workout-rescue-durable-browser';
const dbDirectory=process.argv[2];if(!dbDirectory)throw Error('Pass a disposable SQL proof database directory.');
const env={PATH:process.env.PATH,HOME:process.env.HOME,PGLITE_MODULE:process.env.PGLITE_MODULE,RESCUE_LOCAL_PORT:'58416'};
let api;let ids;let browser;let frontend;
async function startFrontend(){
 frontend=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','58417','--strictPort'],{cwd:path.join(cwd,'frontend'),env:{PATH:env.PATH,HOME:env.HOME,REACT_APP_PREVIEW_MODE:'false',REACT_APP_BACKEND_URL:'http://127.0.0.1:58416'},stdio:['ignore','pipe','pipe']});
 let output='';frontend.stderr.on('data',chunk=>process.stderr.write(chunk));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Frontend startup timeout '+output)),15000);frontend.once('exit',code=>{clearTimeout(timer);reject(Error('Frontend exited '+code+' '+output));});frontend.stdout.on('data',chunk=>{output+=chunk;if(output.includes('http://127.0.0.1:58417/')){clearTimeout(timer);resolve();}});});
}
async function startApi(){
 const child=spawn(process.execPath,['supabase/tests/workout_rescue/pglite-check.mjs','serve',dbDirectory],{cwd,env,stdio:['ignore','pipe','pipe']});api=child;
 let output='';child.stderr.on('data',d=>process.stderr.write(d));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Local API startup timeout: '+output)),15000);child.once('exit',code=>{clearTimeout(timer);reject(Error('API exited '+code+' '+output));});child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('DURABLE_IDS ')){ids=JSON.parse(output.split('DURABLE_IDS ')[1].split('\n')[0]);clearTimeout(timer);resolve();}});});
 console.log('Started SQL-backed API process',child.pid);
}
async function stopApi(){if(!api)return;const child=api;api=null;if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await once(child,'exit');}
async function pageFor(actor,viewport){const context=await browser.newContext({viewport,serviceWorkers:'block'});await context.addInitScript(actor=>localStorage.setItem('cvf_access_token',actor),actor);const page=await context.newPage();page.on('response',async response=>{if(response.status()>=400)console.log('HTTP_FAILURE',response.status(),response.url(),(await response.text()).slice(0,300));});return {page,context};}
(async()=>{
 await fs.mkdir(evidence,{recursive:true});await startFrontend();await startApi();browser=await chromium.launch({headless:true});
 const {page:coach,context:coachContext}=await pageFor(ids.coachAuth,{width:1440,height:1000});const pageErrors=[];coach.on('pageerror',e=>pageErrors.push(e.message));coach.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text());});
 await coach.goto('http://127.0.0.1:58417/coach/programs');
 await coach.getByTestId('training-builder-tab-programs').click();await coach.getByRole('button',{name:'Define fallbacks',exact:true}).click();
 let dialog=coach.getByTestId('rescue-dialog');await dialog.getByLabel('Option name',{exact:true}).fill('25 minutes after process restart');
 await dialog.getByLabel('Intent kept and tradeoff').fill('Keep the original squat and hinge instructions; fewer sets and no core exercise today.');
 const saveResponse=coach.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/rescue'));
 await dialog.getByRole('button',{name:'Save options',exact:true}).click();const saved=await saveResponse;assert.equal(saved.status(),200);await dialog.getByText('Options saved.',{exact:false}).waitFor();
 await coach.screenshot({path:path.join(evidence,'coach-saved-1440.png')});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await stopApi();await startApi(); // actual child-process restart; the disk store is reopened.
 await coach.reload();await coach.getByTestId('training-builder-tab-programs').click();await coach.getByRole('button',{name:'Define fallbacks',exact:true}).click();
 await coach.getByTestId('rescue-dialog').getByLabel('Option name',{exact:true}).filter({visible:true}).waitFor();
 assert.equal(await coach.getByLabel('Option name',{exact:true}).inputValue(),'25 minutes after process restart');
 await coach.screenshot({path:path.join(evidence,'coach-reloaded-1440.png')});await coachContext.close();
 const {page:client,context:clientContext}=await pageFor(ids.clientAuth,{width:1440,height:1000});client.on('pageerror',e=>pageErrors.push(e.message));client.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text());});
 await client.goto('http://127.0.0.1:58417/client/programs');await client.getByRole('button',{name:'Find an option',exact:true}).click();dialog=client.getByTestId('rescue-dialog');
 await dialog.getByLabel('Time available (minutes)').fill('10');await dialog.getByText('No coach-authored fallback fits',{exact:false}).waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Use this option',exact:true}).isDisabled(),true);
 await dialog.getByLabel('Time available (minutes)').fill('25');await dialog.getByLabel('Cable station').uncheck();await dialog.getByRole('button',{name:/25 minutes after process restart/}).click();
 await dialog.getByTestId('rescue-changes').getByText('Core:',{exact:false}).waitFor();
 assert.match(await dialog.getByTestId('rescue-changes').innerText(),/Dropped/);
 await client.screenshot({path:path.join(evidence,'client-reloaded-1440.png')});await client.setViewportSize({width:390,height:844});
 assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth),true);await client.screenshot({path:path.join(evidence,'client-reloaded-390.png')});
 assert.equal(await client.getByRole('button',{name:'Define fallbacks',exact:true}).count(),0);
 const startedResponse=client.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/workout-logs/start'));
 await dialog.getByRole('button',{name:'Use this option',exact:true}).click();const response=await startedResponse;
 assert.equal(response.status(),201,await response.text());const started=await response.json();
 assert.equal(started.workout_log.rescue_snapshot.branch_name,'25 minutes after process restart');
 await client.waitForURL(/\/client\/workouts\/[^/]+\/track/);await client.getByText('Next: Original',{exact:false}).waitFor();
 await client.screenshot({path:path.join(evidence,'tracker-390.png')});await client.setViewportSize({width:1440,height:1000});await client.screenshot({path:path.join(evidence,'tracker-1440.png')});
 assert.deepEqual(pageErrors,[]);
 await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({mode:'normal frontend, real Express/SQL, synthetic provider verifier and shell reads',database:dbDirectory,program:ids.program,day:ids.day,storedAfterApiRestart:true,workoutLogId:started.workout_log.id,receipt:started.workout_log.rescue_snapshot,errors:pageErrors},null,2));
 await clientContext.close();console.log('PASS normal-mode browser: coach save -> real API process restart -> persisted choice -> desktop/mobile explicit client diff -> real SQL start -> existing guided tracker');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await stopApi();if(frontend && frontend.exitCode===null && frontend.signalCode===null){frontend.kill('SIGTERM');await once(frontend,'exit');}});
