import {test,expect} from '../../../frontend/node_modules/@playwright/test/index.mjs';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../..',import.meta.url));let apiProcess;
async function start(){apiProcess=spawn(process.execPath,['supabase/tests/cue_retry/pglite-check.mjs','serve',process.env.CUE_TEST_DB_DIR],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});apiProcess.stderr.on('data',chunk=>process.stderr.write(chunk));await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('API readiness timeout')),20000);apiProcess.once('exit',code=>{clearTimeout(timeout);reject(Error('API exited '+code));});apiProcess.stdout.on('data',chunk=>{output+=chunk;if(output.includes('CUE_REAL_LOCAL_API')){clearTimeout(timeout);resolve();}});});}
async function stop(){const ended=once(apiProcess,'exit');apiProcess.kill('SIGTERM');await ended;}
test.beforeAll(start);test.afterAll(stop);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('normal frontend + real Express/SQL cue loop persists after API process restart',async({page,request},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{if(!localStorage.getItem('cvf_access_token'))localStorage.setItem('cvf_access_token','cue-coach');});
 const ids=await (await request.get('http://127.0.0.1:58420/api/cue-test/ids',{headers:{authorization:'Bearer cue-coach'}})).json();
 await page.goto(`/coach/workouts/${ids.log}`);
 await expect(page.getByRole('button',{name:'Add cue for next attempt'})).toBeVisible();
 await expect(page.getByLabel('Preview role')).toHaveCount(0);
 await expect(page.getByTestId('cue-retry-panel')).not.toContainText('Local demo');
 await page.getByRole('button',{name:'Add cue for next attempt'}).click();await page.getByLabel('One actionable cue').fill('Backend browser cue: press the floor away.');await page.getByRole('button',{name:'Save cue',exact:true}).click();
 await expect(page.getByTestId('outgoing-cue')).toContainText('Backend browser cue');
 const started=await request.post('http://127.0.0.1:58420/api/workout-logs/start',{headers:{authorization:'Bearer cue-client'},data:{program_assignment_id:id(7),program_day_id:id(71)}});expect(started.status()).toBe(201);const log=(await started.json()).workout_log;
 await page.evaluate(()=>localStorage.setItem('cvf_access_token','cue-client'));await page.goto(`/client/workouts/${log.id}/track`);
 await expect(page.getByTestId('incoming-cue')).toContainText('Backend browser cue');await expect(page.getByRole('button',{name:'Save recheck'})).toHaveCount(0);
 await page.getByLabel('Fictional Squat set 1 performed reps',{exact:true}).fill('8');await page.getByRole('button',{name:'Complete set 1',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mark incomplete set 1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Finish workout',exact:true}).click();await page.getByRole('button',{name:'Confirm completion',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/client/workouts/${log.id}$`));
 await page.evaluate(()=>localStorage.setItem('cvf_access_token','cue-coach'));await page.goto(`/coach/workouts/${log.id}`);
 await page.getByLabel('Did this cue help?').selectOption('fixed');await page.getByRole('button',{name:'Save recheck'}).click();await expect(page.getByTestId('incoming-cue')).toContainText('Coach recheck: Fixed');
 await stop();await start();await page.reload();await expect(page.getByTestId('incoming-cue')).toContainText('Coach recheck: Fixed');
 await page.screenshot({path:testInfo.outputPath('backend-normal-390.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.reload();await expect(page.getByTestId('incoming-cue')).toContainText('Backend browser cue');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:testInfo.outputPath('backend-normal-1440.png'),fullPage:true});expect(errors).toEqual([]);
});
