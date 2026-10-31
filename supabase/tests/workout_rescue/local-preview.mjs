// Loopback-only interactive laboratory. This is a TEST launcher, never application auth.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const directory=process.argv[2];
if(!process.env.PGLITE_MODULE || !/^\/(?:private\/)?tmp\/cvf-rescue-db-[A-Za-z0-9_-]+$/.test(directory||'')) throw Error('Pass an owned /tmp/cvf-rescue-db-* proof store and PGLITE_MODULE.');
const child=spawn(process.execPath,['supabase/tests/workout_rescue/pglite-check.mjs','serve',directory],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,PGLITE_MODULE:process.env.PGLITE_MODULE,RESCUE_LOCAL_PORT:'58416'},stdio:['ignore','pipe','inherit']});
let ids;let output='';let server;
async function close(){if(server)await server.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}}
process.once('SIGINT',()=>close().then(()=>process.exit(0)));process.once('SIGTERM',()=>close().then(()=>process.exit(0)));
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SQL API startup timed out')),15000);child.once('exit',code=>{clearTimeout(timer);reject(Error(`SQL API exited ${code}`));});child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('DURABLE_IDS ')){ids=JSON.parse(output.split('DURABLE_IDS ')[1].split('\n')[0]);clearTimeout(timer);resolve();}});});
 process.env.REACT_APP_PREVIEW_MODE='false';process.env.REACT_APP_BACKEND_URL='http://127.0.0.1:58416';
 const frontend=path.join(root,'frontend');process.chdir(frontend);
 const {createServer}=await import(pathToFileURL(path.join(frontend,'node_modules/vite/dist/node/index.js')));
 server=await createServer({root:frontend,configFile:path.join(frontend,'vite.config.js'),cacheDir:'/tmp/cvf-rescue-interactive-cache',server:{host:'127.0.0.1',port:58417,strictPort:true},plugins:[{name:'local-synthetic-rescue-personas',configureServer(vite){vite.middlewares.use('/__rescue_demo',(req,res)=>{
  const role=req.url?.split('?')[0].replace(/^\//,'');
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(role==='coach'||role==='client') {
   const actor=role==='coach'?ids.coachAuth:ids.clientAuth;
   res.end(`<!doctype html><title>Local synthetic Rescue</title><p>Opening a fictional ${role} in the loopback-only laboratory.</p><script>localStorage.setItem('cvf_access_token',${JSON.stringify(actor)});localStorage.removeItem('cvf_refresh_token');location.replace(${JSON.stringify(`/${role}/programs`)});</script>`);
  } else res.end('<!doctype html><title>Local synthetic Workout Rescue</title><h1>Local synthetic Workout Rescue</h1><p>Fictional identities and data. Normal frontend and real local SQL; provider verification is a test adapter. No real credentials.</p><p><a href="/__rescue_demo/coach">Review as fictional coach</a></p><p><a href="/__rescue_demo/client">Review as fictional client</a></p>');
 });}}]});
 await server.listen();console.log(`LOCAL SYNTHETIC ONLY — normal frontend, persisted SQL store ${directory}`);console.log('REVIEW http://127.0.0.1:58417/__rescue_demo');
 await new Promise(()=>{});
} catch(error){console.error(error.message);await close();process.exitCode=1;}
