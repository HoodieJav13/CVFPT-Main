import { test, expect } from '@playwright/test';
import { exerciseName, setupWorkoutUx } from './workout-ux-fixture.mjs';
async function tracker(page) {
 const data = await setupWorkoutUx(page); await page.goto('/client/workouts/ux-log/track');
 await expect(page.getByTestId('workout-tracker')).toBeVisible(); await page.evaluate(() => document.fonts.ready); return data;
}
async function editor(page) {
 const data = await setupWorkoutUx(page, 'coach'); await page.goto('/coach/programs');
 await page.getByTestId('training-builder-tab-workouts').click(); await page.getByTestId('workout-create-button').click();
 const dialog = page.getByRole('dialog'); await dialog.getByTestId('workout-exercise-name-input').fill(exerciseName); return { ...data, dialog };
}
async function touch(locator) { const box = await locator.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); }

for (const {width,height} of [{width:320,height:640},{width:390,height:844},{width:1440,height:900}]) test(`pinned controls reserve their own viewport region at ${width}px`, async ({page}) => {
 await page.setViewportSize({width,height}); await tracker(page);
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 const dock=page.getByTestId('workout-control-dock'); await expect(dock).toBeInViewport({ratio:1});
 const region=page.getByTestId('workout-scroll-region');
 const box=await region.boundingBox(), pinned=await dock.boundingBox();
 expect(box.y+box.height).toBeLessThanOrEqual(pinned.y);
 expect(box.height).toBeGreaterThan(44);
 for(const offset of [0,271,571,100000]) {
  await region.evaluate((e,y)=>e.scrollTo({top:y,behavior:'instant'}),offset);
  const moved=await dock.boundingBox();expect(moved.y).toBe(pinned.y);
  for(const id of ['rest-minus','rest-plus','rest-timer']) {
   const button=page.getByTestId(id);await expect(button).toBeInViewport({ratio:1});
   expect(await button.evaluate(e=>{const r=e.getBoundingClientRect();return [0.2,0.5,0.8].every(x=>[0.2,0.5,0.8].every(y=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))));})).toBe(true);
  }
 }
 for(const control of [page.getByRole('button',{name:'Add set',exact:true}).first(),page.getByTestId('same-as-last-time').first()]) {
  await control.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
  const bounds=await control.boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(box.y);expect(bounds.y+bounds.height).toBeLessThanOrEqual(box.y+box.height);
  expect(await control.evaluate(e=>{const r=e.getBoundingClientRect();return [0.1,0.5,0.9].every(x=>[0.1,0.5,0.9].every(y=>e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))));})).toBe(true);
 }
 const before=await region.evaluate(e=>e.scrollTop);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,80);
 await expect.poll(()=>region.evaluate(e=>e.scrollTop)).toBeGreaterThan(before);
 expect((await dock.boundingBox()).y).toBe(pinned.y);
});

for(const width of [320,390]) test(`44px workout actions preserve the title width at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await setupWorkoutUx(page);await page.goto('/client/programs?view=other');await page.evaluate(()=>document.fonts.ready);
 const start=page.getByTestId('start-standalone-workout'),pdf=page.getByTestId('download-workout-pdf');await touch(start);await touch(pdf);
 expect((await start.boundingBox()).width).toBeLessThanOrEqual(52);expect((await pdf.boundingBox()).width).toBeLessThanOrEqual(80);
 const lines=await page.getByText('Synthetic phone workout',{exact:true}).evaluate(e=>e.getBoundingClientRect().height/parseFloat(getComputedStyle(e).lineHeight));
 expect(lines).toBeLessThanOrEqual(width===390?1:2);
});

for (const width of [320,390,1440]) test(`decimal loads fit without horizontal overflow at ${width}px`, async ({ page }) => {
 await page.setViewportSize({ width, height: 900 }); await tracker(page);
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 for (const n of [exerciseName,'Chest-supported row']) {
  const fit = await page.getByLabel(`${n} set 1 weight`, { exact:true }).evaluate(e => { const s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d'); c.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; return { available:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight), required:c.measureText(e.value).width+16 }; });
  expect(fit.available).toBeGreaterThanOrEqual(fit.required);
 }
});
for (const { width, height, scrollY } of [{ width:320,height:640,scrollY:571 }, { width:390,height:844,scrollY:271 }, { width:1440,height:900,scrollY:271 }]) {
 test(`running rest leaves exercise actions unobscured at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width,height }); const { results } = await tracker(page);
  await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
  await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state','running');
  const region = page.getByTestId('workout-scroll-region');
  await region.evaluate((e,y) => e.scrollTo({ top:y,behavior:'instant' }),scrollY);
  expect(await region.evaluate(e => e.scrollTop)).toBe(scrollY);
  const actions = [page.getByRole('button',{name:'Add set',exact:true}).first(),page.getByTestId('same-as-last-time').first()];
  for (const action of actions) {
   await action.evaluate(e => e.scrollIntoView({ block:'center',behavior:'instant' }));
   await expect(action).toBeInViewport({ ratio:1 });
   expect(await action.evaluate(e => {
    const r=e.getBoundingClientRect();
    return [0.1,0.5,0.9].every(x => [0.1,0.5,0.9].every(y => e.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y))));
   })).toBe(true);
  }
  // Ordinary scrolling in the reserved entry region moves content without moving the controls.
  const top=(await actions[1].boundingBox()).y; const pane=await region.boundingBox(); await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2); await page.mouse.wheel(0,80);
  await expect.poll(async () => (await actions[1].boundingBox()).y).toBeLessThan(top);
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state','running');
  expect(results.errors).toEqual([]); expect(results.unexpected).toEqual([]);
 });
}
test('rest retains adjustment, reload and dismissal in the workout controls', async ({ page }) => {
 await page.setViewportSize({ width:390,height:844 }); await tracker(page);
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click(); await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 const dock=page.getByTestId('workout-control-dock'); await expect(dock.getByTestId('rest-timer')).toBeVisible();
 // Each secondary control remains reachable in the reserved entry region;
 // the timer and Finish stay in the separate footer.
 for (const control of [page.getByRole('button', { name: 'Add set', exact: true }).first(), page.getByTestId('same-as-last-time').first()]) {
  await control.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  expect(await control.evaluate(e => { const r=e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })).toBe(true);
 }

 const end=await page.evaluate(() => Number(localStorage.getItem('cvf_rest_timer_ux-log')));
 await page.getByTestId('rest-plus').click(); expect(await page.evaluate(() => Number(localStorage.getItem('cvf_rest_timer_ux-log')))).toBe(end+15000);
 await page.reload(); await expect(dock.getByTestId('rest-timer')).toBeVisible(); await page.getByTestId('rest-minus').click();
 expect(await page.evaluate(() => Number(localStorage.getItem('cvf_rest_timer_ux-log')))).toBe(end);
 await page.getByTestId('rest-timer').click(); await expect(page.getByTestId('rest-timer')).toHaveCount(0);
 expect(await page.evaluate(() => localStorage.getItem('cvf_rest_timer_ux-log'))).toBeNull();
});
for (const width of [320, 390]) test(`phone editor contains long names and controls meet 44px at ${width}px`, async ({ page }) => {
 await page.setViewportSize({width,height:844}); const {dialog}=await editor(page);
 expect(await dialog.evaluate(e=>e.scrollWidth)).toBeLessThanOrEqual(await dialog.evaluate(e=>e.clientWidth));
 for(const id of ['workout-exercise-drag-handle','workout-exercise-name-input','workout-exercise-sets-input','workout-save-button','workout-exercise-add-button']) await touch(dialog.getByTestId(id));
 await touch(dialog.getByRole('button', { name: 'Close', exact: true }));
});
for (const width of [320, 390]) test(`phone Start, PDF and completion actions fit at ${width}px`, async ({page})=>{
 await page.setViewportSize({width,height:844}); await setupWorkoutUx(page); await page.goto('/client/programs?view=other');
 for(const id of ['start-standalone-workout','download-workout-pdf']) await touch(page.getByTestId(id));
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.goto('/client/workouts/ux-log/track'); await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 await page.getByRole('button',{name:'Finish workout',exact:true}).click();
 for(const name of ['Keep tracking','Confirm completion']) await touch(page.getByTestId('workout-completion-dialog').getByRole('button',{name,exact:true}));
});

test('short viewport preserves document scrolling and focused input through resize', async ({page}) => {
 await page.setViewportSize({width:320,height:640});await tracker(page);
 const input=page.getByLabel(`${exerciseName} set 1 performed RPE`,{exact:true});await input.fill('7.5');
 await page.setViewportSize({width:320,height:260});
 await expect(input).toBeFocused();await expect(input).toHaveValue('7.5');await expect(input).toBeInViewport({ratio:1});
 const region=page.getByTestId('workout-scroll-region');expect(await region.evaluate(e=>getComputedStyle(e).overflowY)).toBe('visible');
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 await page.getByRole('button',{name:'Finish workout',exact:true}).evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
 await touch(page.getByRole('button',{name:'Finish workout',exact:true}));
 await page.setViewportSize({width:390,height:844});await expect(page.getByTestId('workout-control-dock')).toBeInViewport({ratio:1});
 const box=await region.boundingBox(),dock=await page.getByTestId('workout-control-dock').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(dock.y);
});

test('focused workout entry remains clear of navigation across short resize thresholds',async({page})=>{
 await page.setViewportSize({width:320,height:640});await tracker(page);
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 const input=page.getByLabel(`${exerciseName} set 2 weight`,{exact:true});await input.fill('135.5');
 for(const height of [405,404,400,320,200,640]) {
  await page.setViewportSize({width:320,height});await expect(input).toBeFocused();await expect(input).toHaveValue('135.5');
  await expect.poll(()=>input.evaluate(e=>{const r=e.getBoundingClientRect(),region=e.closest('[data-testid="workout-scroll-region"]'),s=getComputedStyle(region),p=region.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&(s.overflowY==='visible'||(r.top>=p.top&&r.bottom<=p.bottom));})).toBe(true);
 }
});

test('visual viewport shrink keeps a focused entry within the visible space',async({page})=>{
 await page.setViewportSize({width:320,height:640});await tracker(page);
 const input=page.getByLabel('Synthetic run set 3 performed distance',{exact:true});await input.focus();
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>280});visualViewport.dispatchEvent(new Event('resize'));});
 await expect(input).toBeFocused();await expect.poll(()=>input.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=280;})).toBe(true);
});

test('visual viewport pan keeps the focused field inside its visible bounds',async({page})=>{
 await page.setViewportSize({width:390,height:844});await tracker(page);
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 const input=page.getByLabel(`${exerciseName} set 2 weight`,{exact:true});await input.focus();
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>520});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>240});visualViewport.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>input.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=240&&r.bottom<=760;})).toBe(true);await expect(input).toBeFocused();
});

test('keyboard focus in a short viewport stays clear of fixed navigation',async({page})=>{
 await page.setViewportSize({width:320,height:320});await tracker(page);await page.getByTestId('workout-scroll-region').focus();
 for(let step=0;step<22;step++) {
  await page.keyboard.press('Tab');
  await expect.poll(()=>page.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return r.top>=65&&r.bottom<=255&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 }
});
