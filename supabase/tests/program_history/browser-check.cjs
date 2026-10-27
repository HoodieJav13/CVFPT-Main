// Fictional app shell + actual durable local Express/SQL history response.
// The binding is test-only; no production preview gate or API routing is changed.
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');const fs=require('node:fs');const assert=require('node:assert/strict');
const {chromium,expect}=require('../../../frontend/node_modules/@playwright/test');
const script='supabase/tests/program_history/pglite-check.mjs';
const setup=spawnSync(process.execPath,[script],{env:process.env,encoding:'utf8'});
if(setup.status!==0)throw Error(setup.stdout+setup.stderr);
process.stdout.write(setup.stdout);const directory=setup.stdout.match(/LOCAL DB: (.+)/)[1];
async function start(){const child=spawn(process.execPath,[script,'serve',directory],{env:process.env,stdio:['ignore','pipe','pipe']});let out='';const url=await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{out+=data;const match=out.match(/DURABLE_LOCAL_API (http:\/\/\S+)/);if(match)resolve(match[1]);});child.stderr.on('data',data=>out+=data);child.once('exit',code=>reject(Error(`server exited ${code}: ${out}`)));});return {child,url};}
async function stop(server){const ended=once(server.child,'exit');server.child.kill('SIGTERM');const [code]=await ended;assert.equal(code,0);}
async function bind(page,url){await page.evaluate(async endpoint=>{const {api,previewReady}=await import('/src/lib/api.js');await previewReady;const previous=api.defaults.adapter;api.defaults.adapter=async config=>{if(config.url==='/programs/program_history_example/history'){const response=await fetch(`${endpoint}/history`,{headers:{authorization:'coach'}});return {data:await response.json(),status:response.status,statusText:'OK',headers:{},config};}return previous(config);};},url);}
(async()=>{let server;let browser;try{
 server=await start();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('cvf_preview_role','coach'));await page.goto('http://127.0.0.1:58261/coach/programs');await page.getByRole('tab',{name:'Programs',exact:true}).click();await bind(page,server.url);
 const card=page.getByTestId('program-card').filter({hasText:'History example'});await card.getByTestId('program-history-open').click();const dialog=page.getByTestId('program-history-dialog');await dialog.getByText('Forward history · recorded with successful program and workout edits. Earlier history is unavailable.').waitFor();await expect(dialog).toContainText('Saved through Express');
 const program=await (await fetch(server.url,{headers:{authorization:'coach'}})).json();const body={name:'Durable browser edit',description:program.description,frequency_days:program.frequency_days,days:program.days.map(d=>({day_number:d.day_number,workout_id:d.workout_id,notes:d.notes}))};
 const response=await fetch(server.url,{method:'PUT',headers:{authorization:'coach','content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await stop(server);server=await start();await bind(page,server.url);await card.getByTestId('program-history-open').click();await expect(dialog).toContainText('Durable browser edit');assert.equal((await dialog.innerText()).includes('Saved through Express'),true);
 fs.mkdirSync('docs/program-history/durable-visual',{recursive:true});await page.screenshot({path:'docs/program-history/durable-visual/after-restart-390.png'});await page.setViewportSize({width:1440,height:950});await page.screenshot({path:'docs/program-history/durable-visual/after-restart-1440.png'});assert.deepEqual(errors,[]);
 console.log('PASS browser: actual SQL stored diff after program PUT, API process restart and read; 390/1440px; zero page errors');console.log(`DURABLE_TEST_DB ${directory}`);
 }finally{if(browser)await browser.close();if(server&&!server.child.killed)await stop(server);}})().catch(error=>{console.error(error);process.exitCode=1;});
