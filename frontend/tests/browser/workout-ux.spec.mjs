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

for (const width of [320,390,1440]) test(`decimal loads fit without horizontal overflow at ${width}px`, async ({ page }) => {
 await page.setViewportSize({ width, height: 900 }); await tracker(page);
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 for (const n of [exerciseName,'Chest-supported row']) {
  const fit = await page.getByLabel(`${n} set 1 weight`, { exact:true }).evaluate(e => { const s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d'); c.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; return { available:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight), required:c.measureText(e.value).width+16 }; });
  expect(fit.available).toBeGreaterThanOrEqual(fit.required);
 }
});
test('rest reserves dock space and retains adjustment, reload and dismissal', async ({ page }) => {
 await page.setViewportSize({ width:390,height:844 }); await tracker(page);
 await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click(); await page.getByRole('button',{name:'Complete set 1',exact:true}).first().click();
 const dock=page.getByTestId('workout-control-dock'); await expect(dock.getByTestId('rest-timer')).toBeVisible();
 // A client can scroll either secondary control clear of the shared dock;
 // the timer has no separate fixed overlay over those actions.
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
