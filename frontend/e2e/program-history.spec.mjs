import { test, expect, usePreviewRole, callPreviewApi as rawCallPreviewApi } from './preview-test.mjs';

async function callPreviewApi(page, ...args) {
 await page.evaluate(async()=>{ const mod=await import('/src/lib/api.js'); await mod.previewReady; });
 return rawCallPreviewApi(page,...args);
}

test('client program history is unavailable, remains read-only, and does not create a snapshot on read', async ({page})=>{
 await usePreviewRole(page,'coach'); await page.goto('/coach/clients/client_sarah');await page.getByTestId('tab-programs').click();
 await page.getByTestId('assigned-program-card').filter({hasText:'Sarah Mobility Plan'}).getByTestId('program-history-open').click();
 await expect(page.getByTestId('program-history-unavailable')).toBeVisible();
 await expect(page.getByTestId('program-history-dialog')).toContainText('Sarah Martinez');
 const first=await callPreviewApi(page,'get','/programs/program_sarah_mobility/history');
 expect(first.data.revisions).toEqual([]);
 expect(await callPreviewApi(page,'get','/programs/program_sarah_mobility/history')).toEqual(first);
 await expect(page.getByRole('button',{name:/undo|restore|apply/i})).toHaveCount(0);
});
for(const width of [320,390,1440]) test(`stored fixture revision values and revision selector render at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===1440?950:844}); await usePreviewRole(page,'coach'); await page.goto('/coach/programs');
 await page.getByRole('tab',{name:'Programs',exact:true}).click();
 await page.getByTestId('program-card').filter({hasText:'History example'}).getByTestId('program-history-open').click();
 const dialog=page.getByTestId('program-history-dialog');await expect(dialog).toContainText('Preview only');await expect(dialog).toContainText('Marcus Rivera');
 await expect(dialog.getByTestId('program-history-changes')).toContainText('sets');
 await expect(dialog).toContainText('Comparing revision 1 → 2');
 const revisions=(await callPreviewApi(page,'get','/programs/program_history_example/history')).data.revisions;
 expect(revisions[0].snapshot.days[0].workout.exercises[0].sets).toBe('3');expect(revisions[1].snapshot.days[0].workout.exercises.find(e=>e.id==='history_squat').sets).toBe('4');
 await page.getByTestId('program-history-revision').selectOption('0');await expect(dialog).toContainText('Author unavailable');await expect(dialog).toContainText('Date unavailable');await expect(dialog).toContainText('No earlier revision');
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
 await page.getByTestId('program-history-revision').selectOption('1');
});
test('successful preview saves capture forward revisions; completed logs and other program histories stay unchanged',async({page})=>{
 await usePreviewRole(page,'coach');await page.goto('/coach');
 const historyBefore=(await callPreviewApi(page,'get','/workout-logs/client/client_sarah')).data;
 const p=(await callPreviewApi(page,'get','/programs/program_sarah_mobility')).data;
 expect((await callPreviewApi(page,'put',`/programs/${p.id}`,{...p,name:'Updated recovery plan',days:p.days})).status).toBe(200);
 const history=(await callPreviewApi(page,'get',`/programs/${p.id}/history`)).data.revisions;
 expect(history).toHaveLength(2);expect(history[0].author).toBeNull();expect(history[0].recorded_at).toBeNull();expect(history[1].author.name).toBe('Marcus Rivera');expect(history[1].snapshot.name).toBe('Updated recovery plan');
 expect((await callPreviewApi(page,'get','/workout-logs/client/client_sarah')).data).toEqual(historyBefore);
 expect((await callPreviewApi(page,'get','/programs/program_foundation/history')).data.revisions).toEqual([]);
 await page.reload(); expect((await callPreviewApi(page,'get',`/programs/${p.id}/history`)).data.revisions).toEqual([]);
});
test('history refuses client role',async({page})=>{
 await usePreviewRole(page,'client');await page.goto('/client');expect((await callPreviewApi(page,'get','/programs/program_history_example/history')).status).toBe(403);

});

test('missing program stays masked and history load errors retry cleanly',async({page})=>{
 await usePreviewRole(page,'coach');await page.goto('/coach/clients/client_sarah');await page.getByTestId('tab-programs').click();
 expect((await callPreviewApi(page,'get','/programs/missing/history')).status).toBe(404);
 await page.evaluate(()=>localStorage.setItem('cvf_preview_fail','reads'));
 await page.getByTestId('assigned-program-card').filter({hasText:'Sarah Mobility Plan'}).getByTestId('program-history-open').click();
 const dialog=page.getByTestId('program-history-dialog');await expect(dialog.getByRole('alert')).toBeVisible();
 await page.evaluate(()=>localStorage.removeItem('cvf_preview_fail'));await dialog.getByRole('button',{name:'Try again'}).click();await expect(dialog.getByTestId('program-history-unavailable')).toBeVisible();
});
test('failed preview save captures no revision and a workout edit keeps completed snapshot values unchanged',async({page})=>{
 await usePreviewRole(page,'coach');await page.goto('/coach');
 const before=(await callPreviewApi(page,'get','/workout-logs/log_preview_complete')).data;
 const program=(await callPreviewApi(page,'get','/programs/program_sarah_mobility')).data;
 await page.evaluate(()=>localStorage.setItem('cvf_preview_fail','write-once'));
 expect((await callPreviewApi(page,'put',`/programs/${program.id}`,{...program,name:'Not saved'})).status).toBeGreaterThanOrEqual(400);
 expect((await callPreviewApi(page,'get',`/programs/${program.id}/history`)).data.revisions).toEqual([]);
 const workout=(await callPreviewApi(page,'get','/programs/workouts/workout_upper_a')).data;
 workout.exercises[0].sets='5';expect((await callPreviewApi(page,'put',`/programs/workouts/${workout.id}`,workout)).status).toBe(200);
 expect((await callPreviewApi(page,'get','/workout-logs/log_preview_complete')).data).toEqual(before);
 expect((await callPreviewApi(page,'get','/programs/program_foundation/history')).data.revisions).toHaveLength(2);
});

test('closing a delayed history read cannot replace the next program dialog',async({page})=>{
 await usePreviewRole(page,'coach');await page.goto('/coach/programs');await page.getByRole('tab',{name:'Programs',exact:true}).click();
 await page.evaluate(()=>localStorage.setItem('cvf_preview_latency',JSON.stringify([{path:'program_history_example/history',ms:800}])));
 await page.getByTestId('program-card').filter({hasText:'History example'}).getByTestId('program-history-open').click();
 await expect(page.getByRole('status').filter({hasText:'Loading program history'})).toBeVisible();await page.getByTestId('program-history-dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.getByTestId('program-card').filter({hasText:'Foundation Strength - Phase 1'}).getByTestId('program-history-open').click();
 await expect(page.getByTestId('program-history-unavailable')).toBeVisible();
 await callPreviewApi(page,'get','/programs/program_history_example/history');
 await expect(page.getByTestId('program-history-dialog')).toContainText('Foundation Strength - Phase 1');await expect(page.getByTestId('program-history-revision')).toHaveCount(0);
});
