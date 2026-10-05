import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { setupWorkoutUx, exerciseName } from '../../frontend/tests/browser/workout-ux-fixture.mjs';
import { writeFile,readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const folder=new URL('.',import.meta.url).pathname;
const sources={before:{sha:'cda1beae5857bb1ce98b44b596ada6def085edce',url:'http://127.0.0.1:42744'},after:{sha:'5f835410275f0091f1c375341608d50e8c81c60e',url:'http://127.0.0.1:42742'}};
const browser=await chromium.launch();const captures=[];
async function anchor(page,locator,y){await locator.evaluate((e,target)=>window.scrollTo({top:Math.max(0,scrollY+e.getBoundingClientRect().top-target),left:0,behavior:'instant'}),y);}
async function metrics(locator){return locator.evaluate(e=>{const s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d');c.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;const r=e.getBoundingClientRect();return {rect:r.toJSON(),value:e.value,usableWidth:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),textWidth:c.measureText(e.value||'').width,font:c.font,labels:[...(e.labels||[])].map(l=>l.textContent.trim()),invalid:e.getAttribute('aria-invalid'),describedBy:e.getAttribute('aria-describedby')};});}
const scenes=['weight','builder-top','builder-lower','builder-targets','rest-clear','rest-overlay','rest-controls','validation','touch-targets'];
for(const width of [320,390,1440]) for(const scene of (width===1440?['weight','builder-top']:scenes)) for(const [version,source] of Object.entries(sources)) {
 const height=width===320?640:width===390?844:900;const context=await browser.newContext({viewport:{width,height},baseURL:source.url,colorScheme:'dark',locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce'});
 const page=await context.newPage();await page.addInitScript(()=>{Date.now=()=>1791201600000;localStorage.setItem('theme','dark');});
 const role=scene.startsWith('builder')?'coach':'client';const {fixture,results}=await setupWorkoutUx(page,role);fixture.log.started_at='2026-10-05T11:55:00.000Z';
 const detail={};let scrollState='';
 if(scene.startsWith('builder')){
  await page.goto('/coach/programs');await page.getByTestId('training-builder-tab-workouts').click();await page.getByTestId(width===1440?'workout-rail-create':'workout-create-button').click();
  const editor=width===1440?page.getByTestId('workout-editor-pane'):page.getByRole('dialog');await editor.waitFor();if(width!==1440)await page.waitForFunction(e=>getComputedStyle(e).opacity==='1',await editor.elementHandle());
  for(const [id,value] of [['workout-name-input','Synthetic day'],['workout-exercise-name-input',exerciseName],['workout-exercise-sets-input','3'],['workout-exercise-reps-input','8–10'],['workout-exercise-rpe-input','7'],['workout-exercise-default-load-input','135.5'],['workout-exercise-client-notes-input','Synthetic client instruction'],['workout-exercise-coach-notes-input','Synthetic internal note']])await editor.getByTestId(id).fill(value);
  if(scene==='builder-targets'){ await editor.getByLabel('Exercise tracking type').selectOption('duration_distance'); await editor.getByLabel('Target duration unit',{exact:true}).selectOption('min'); await editor.getByLabel('Target duration',{exact:true}).fill('20'); await editor.getByLabel('Target distance unit',{exact:true}).selectOption('km'); await editor.getByLabel('Target distance',{exact:true}).fill('3'); await editor.getByLabel('Exercise tracking type').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'})); scrollState='Duration + distance selected, target 20 min / 3 km; tracking selector at common scroll anchor.'; } else if(scene==='builder-lower'){await editor.getByTestId('workout-exercise-coach-notes-input').evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));scrollState='Coach notes anchored in the scrollable editor; numeric offsets recorded.';}
  else{await editor.evaluate(e=>e.scrollTo({top:0,left:0,behavior:'instant'}));await page.evaluate(()=>scrollTo({top:0,left:0,behavior:'instant'}));scrollState='Top of editor, expanded first exercise.';}
  detail.editor=await editor.evaluate(e=>({clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,scrollTop:e.scrollTop,rect:e.getBoundingClientRect().toJSON()}));
  detail.sets=await metrics(editor.getByTestId('workout-exercise-sets-input'));
 } else if(scene==='touch-targets'){
  await page.goto('/client/programs?view=other');await page.getByTestId('start-standalone-workout').waitFor();await page.evaluate(()=>scrollTo({top:0,left:0,behavior:'instant'}));scrollState='Top of Other assigned workouts; no start/download action performed.';
  for(const id of ['start-standalone-workout','download-workout-pdf'])detail[id]=await page.getByTestId(id).evaluate(e=>e.getBoundingClientRect().toJSON());
 } else {
  await page.goto('/client/workouts/ux-log/track');await page.getByTestId('workout-tracker').waitFor();
  const weight=page.getByLabel(`${exerciseName} set 1 weight`,{exact:true});
  if(scene==='weight'){await anchor(page,weight,260);scrollState='First exercise, set 1 weight top anchored at 260px.';detail.weight=await metrics(weight);}
  if(scene==='validation'){
   const rpe=page.getByLabel(`${exerciseName} set 1 performed RPE`,{exact:true});await rpe.fill('11');await rpe.blur();await anchor(page,rpe,260);scrollState='Same invalid RPE 11 blurred; RPE top anchored at 260px.';detail.rpe=await metrics(rpe);detail.error=await rpe.evaluate(e=>document.getElementById(e.getAttribute('aria-describedby'))?.textContent||null);detail.writes=results.writes;
  }
  if(scene.startsWith('rest')){
   await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();await page.getByTestId('rest-timer').waitFor();
   const control=page.getByTestId('same-as-last-time').first();const target=scene==='rest-clear'?Math.round(height/2)-22:height-194;
   if(scene==='rest-controls'){
    await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,left:0,behavior:'instant'}));
    scrollState='Document bottom: running rest controls and finish actions, frozen 60s rest, first superset round completed.';
   }else{
    await anchor(page,control,target);
    detail.requestedControlTop=target;
    scrollState=`First Same as last time requested top ${target}px, first superset round completed, frozen 60s rest. Actual top and scroll offsets recorded; page-top clamping disclosed below.`;
   }
   const checks=scene==='rest-controls'?[page.getByTestId('rest-minus'),page.getByTestId('rest-plus'),page.getByTestId('rest-timer'),page.getByRole('button',{name:'Complete all remaining',exact:true}),page.getByRole('button',{name:'Finish workout',exact:true})]:[page.getByRole('button',{name:'Add set',exact:true}).first(),control];
   detail.controls=[];
   for(const locator of checks)detail.controls.push(await locator.evaluate(e=>{const r=e.getBoundingClientRect();return{name:e.getAttribute('aria-label')||e.textContent.trim(),rect:r.toJSON(),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),allNinePointsHit:[0.2,0.5,0.8].every(x=>[0.2,0.5,0.8].every(y=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))))};}));
   if(scene!=='rest-controls'){
    const actualTop=detail.controls[1].rect.top;detail.actualControlTop=actualTop;
    detail.alignmentDifference=actualTop===target?null:`Requested ${target}px; actual ${actualTop}px because scrolling clamps at the document boundary.`;
   }
   detail.dock=await page.getByTestId('workout-control-dock').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),position:getComputedStyle(e).position}));
   detail.timer=await page.getByTestId('rest-timer').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),text:e.textContent.trim(),insideDock:Boolean(e.closest('[data-testid="workout-control-dock"]'))}));
   if(version==='after'&&detail.controls.some(c=>!c.allNinePointsHit))throw new Error(JSON.stringify({scene,width,controls:detail.controls}));
  }
 }
 await page.evaluate(()=>document.fonts.ready);const file=`screenshots/${scene}-${width}-${version}.png`;await page.screenshot({path:`${folder}/${file}`,animations:'disabled'});
 const screen=await page.evaluate(()=>({scrollX,scrollY,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,viewportHeight:innerHeight,theme:document.documentElement.className,bodyColor:getComputedStyle(document.body).backgroundColor}));
 const fullContext=[];
 if(scene==='weight'||scene==='touch-targets'||scene==='rest-controls'){
  const full=`screenshots/${scene}-${width}-${version}-full.png`;await page.screenshot({path:`${folder}/${full}`,fullPage:true,animations:'disabled'});fullContext.push(full);
 }
 if(results.errors.length||results.unexpected.length)throw new Error(JSON.stringify({scene,width,version,errors:results.errors,unexpected:results.unexpected}));
 captures.push({scene,width,height,version,sourceSHA:source.sha,file,sha256:createHash('sha256').update(await readFile(`${folder}/${file}`)).digest('hex'),fullContext,scrollState,screen,detail,pageErrors:results.errors,unexpectedApi:results.unexpected});console.log(`${scene} ${width} ${version}: ${screen.documentWidth}px`);await context.close();
}
const allScreenshotHashes={};for(const file of (await readdir(`${folder}/screenshots`)).filter(f=>f.endsWith('.png')).sort())allScreenshotHashes[`screenshots/${file}`]=createHash('sha256').update(await readFile(`${folder}/screenshots/${file}`)).digest('hex');
await writeFile(`${folder}/manifest.json`,JSON.stringify({schemaVersion:2,createdAt:new Date().toISOString(),browser:browser.version(),sources,fixture:'Identical synthetic workout-ux-fixture.mjs data, log started_at fixed 2026-10-05T11:55Z, Date.now frozen to 2026-10-05T12:00Z, no real client data.',appSourceChangedAfterInitialReview:true,limitations:['Synthetic intercepted API responses prove rendered frontend behavior, not hosted/backend data writes or authorization.','Requested logical anchors match; changed content heights cause different numeric scroll offsets. At 390px rest-overlay Before clamps to actual y633 at scrollY0 versus requested y650; After reaches y650 at scrollY271.','D7 correction removes sticky positioning: timer and finish controls remain at the end of the workout and are no longer pinned during logging.','Chromium dark/reduced-motion capture only; no physical keyboard, iOS Safari or installed PWA proof.'],captures,allScreenshotHashes},null,2));await browser.close();
