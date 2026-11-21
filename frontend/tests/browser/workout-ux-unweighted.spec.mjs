import { test, expect } from '@playwright/test';
import { setupWorkoutUx } from './workout-ux-fixture.mjs';
test('phone: unweighted stretch omits weight and units while reps and weighted movement remain editable', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const {fixture}=await setupWorkoutUx(page);
  const ex=fixture.log.exercises[0];
  Object.assign(ex,{exercise_name:"World's Greatest Stretch",equipment:'Bodyweight',category:'Mobility',prescribed_load_value:null});
  for(const set of ex.sets) Object.assign(set,{actual_load_value:null,actual_load_unit:null});
  await page.goto('/client/workouts/ux-log/track');
  await expect(page.getByTestId('workout-tracker')).toBeVisible();
  await expect(page.getByLabel(/Greatest Stretch set \d+ weight/i)).toHaveCount(0);
  const focus=page.getByTestId('focus-panel');
  if(await focus.count()) {
    await expect(focus.getByTestId('focus-prescription')).not.toContainText(/load|lb|kg/i);
    await focus.getByTestId('focus-log').click();
    const editor=focus.getByTestId('focus-editor');
    await expect(editor.getByLabel(/weight/i)).toHaveCount(0);
    await editor.getByLabel(/set 1 performed reps/i).fill('5');
    await expect(focus.getByTestId('focus-log')).not.toContainText(/weight not recorded/i);
  }
  await expect(page.getByLabel(/Greatest Stretch set 1 performed reps/i).first()).toBeAttached();
  await expect(page.getByLabel(/Chest-supported row set 1 weight$/i).first()).toBeAttached();
});
