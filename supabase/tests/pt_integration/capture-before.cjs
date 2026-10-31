// Actual pre-fix ClientDetail bytes from History input, isolated from source worktrees.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');const {once}=require('node:events');
const {chromium}=require('../../../frontend/node_modules/@playwright/test');
const root=path.resolve(__dirname,'../../..');const directory=process.argv[2];if(!/^\/tmp\/cvf-combined-db-[A-Za-z0-9_-]+$/.test(directory||''))throw Error('Pass an owned combined store');
const output=path.resolve(root,'../evidence/paired-private-entry');let api,web,browser;
async function child(args,cwd,ready){const p=spawn(process.execPath,args,{cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,PGLITE_MODULE:process.env.PGLITE_MODULE,REACT_APP_PREVIEW_MODE:'false',REACT_APP_BACKEND_URL:''},stdio:['ignore','pipe','pipe']});p.stderr.on('data',d=>process.stderr.write(d));await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Readiness timeout')),20000);p.once('exit',code=>{clearTimeout(timer);reject(Error('Child exited '+code));});p.stdout.on('data',d=>{text+=d;if(text.includes(ready)){clearTimeout(timer);resolve();}});});return p;}
async function stop(p){if(p&&p.exitCode===null&&p.signalCode===null){const ended=once(p,'exit');p.kill('SIGTERM');await ended;}}
(async()=>{await fs.mkdir(output,{recursive:true});const before=await fs.mkdtemp(path.join(os.tmpdir(),'cvf-integration-before-'));
 for(const name of ['src','public','index.html','vite.config.js','tailwind.config.js','postcss.config.js','package.json'])await fs.cp(path.join(root,'frontend',name),path.join(before,name),{recursive:true});
 await fs.symlink(path.join(root,'frontend/node_modules'),path.join(before,'node_modules'));
 const prior=execFileSync('git',['show','c5590a2:frontend/src/pages/coach/ClientDetail.jsx'],{cwd:root});
 const current=await fs.readFile(path.join(root,'frontend/src/pages/coach/ClientDetail.jsx'));
 await fs.writeFile(path.join(before,'src/pages/coach/ClientDetail.jsx'),prior);
 await fs.writeFile(path.join(before,'vite.baseline.mjs'),`import base from './vite.config.js';export default env=>{const c=base(env);return {...c,cacheDir:'/tmp/cvf-combined-before-cache',server:{...c.server,host:'127.0.0.1',port:58434,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:58430',changeOrigin:true}}}};};`);
 api=await child(['supabase/tests/pt_integration/pglite-check.mjs','serve',directory],root,'COMBINED_REAL_LOCAL_API');
 web=await child([path.join(before,'node_modules/vite/bin/vite.js'),'--config','vite.baseline.mjs'],before,'http://127.0.0.1:58434/');
 browser=await chromium.launch({headless:true});const page=await browser.newPage({serviceWorkers:'block'});await page.addInitScript(()=>localStorage.setItem('cvf_access_token','cue-coach'));
 await page.goto('http://127.0.0.1:58434/coach/clients/00000000-0000-4000-8000-000000000011?tab=programs');
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});const card=page.getByTestId('assigned-program-card');await card.waitFor();if(await card.getByRole('button',{name:'Define fallbacks',exact:true}).count())throw Error('Baseline unexpectedly contains new entry');await card.screenshot({path:path.join(output,`assigned-before-${width}.png`)});}
 await fs.writeFile(path.join(output,'source-manifest.json'),JSON.stringify({source:'Actual c5590a2 ClientDetail in otherwise combined frontend, normal SQL/API shell; no DOM removal',before:crypto.createHash('sha256').update(prior).digest('hex'),after:crypto.createHash('sha256').update(current).digest('hex'),directory},null,2));
 console.log('PASS actual before-state assigned-card captures at390/1440; source manifest retained');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await stop(web);await stop(api);});
