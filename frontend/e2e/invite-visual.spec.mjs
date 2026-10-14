import {test,expect} from '@playwright/test';
const actor='10000000-0000-4000-8000-0000000000a1',id='20000000-0000-4000-8000-0000000000b1';
const client={id,coach_id:actor,name:'Fictional Client',email:'fictional@example.invalid',invited:false,auth_user_id:null,archived:false,created_at:'2026-10-01T00:00:00Z'};
test('paired invite screenshots with fictional fixtures',async({page,context})=>{
 await context.addInitScript(()=>localStorage.setItem('cvf_access_token','fictional'));
 await context.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;const data=path.endsWith('/auth/me')?{role:'coach',email:'coach@example.invalid',profile:{id:actor,name:'Fictional Coach'}}:path.endsWith('/clients')?[client]:path.endsWith(`/clients/${id}`)?{...client,invite:null}:path.endsWith('/week-rhythm')?{week_total:0}:path.includes('/waivers/')?{signed:false,latest_version:null}:path.endsWith('/unread-count')?{unread:0}:[];return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 for(const [size,viewport] of [['desktop',{width:1390,height:900}],['mobile',{width:390,height:844}]]){
  await page.setViewportSize(viewport);await page.goto('/coach/clients');await page.getByTestId('add-client-button').click();await expect(page.getByRole('dialog')).toHaveCSS('opacity','1');await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${process.env.INVITE_QA_DIR}/${process.env.INVITE_QA_LABEL}-${size}-create.png`,fullPage:true});
  await page.goto(`/coach/clients/${id}`);await page.getByTestId('edit-client-button').waitFor();await page.screenshot({path:`${process.env.INVITE_QA_DIR}/${process.env.INVITE_QA_LABEL}-${size}-detail.png`,fullPage:true});
 }
});
