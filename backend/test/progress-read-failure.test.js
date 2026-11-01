const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

test('nested existing progress entry-read failure cannot become an empty successful goal history',async(t)=>{
 const filename=path.resolve(__dirname,'../src/routes/progress.js');
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const db={from(table){const result=table==='metrics'?{data:[{id:'00000000-0000-4000-8000-000000000801',name:'Fictional goal',unit:'count'}],error:null}:{data:null,error:{code:'XX000',message:'Synthetic entry read failure'}};const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},then(resolve,reject){return Promise.resolve(result).then(resolve,reject);}};return q;}};
 const originalRequire=mod.require.bind(mod);
 mod.require=(id)=>{
  if(id==='express')return express;
  if(id==='../supabase')return{ supabaseAdmin:db };
  if(id==='../utils/logger')return{ logError(){} };
  if(id==='../middleware/auth')return{
   requireAuth:(req,res,next)=>{req.user={role:'client',client:{id:'00000000-0000-4000-8000-000000000813'}};next();},
   requireClient:(_req,_res,next)=>next(),requireCoach:(_req,res)=>res.sendStatus(403),canAccessClient:()=>false,
  };
  return originalRequire(id);
 };
 mod._compile(fs.readFileSync(filename,'utf8'),filename);
 const app=express();app.use('/progress',mod.exports);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/progress/mine`);
 assert.equal(response.status,500);
 const body=await response.json();assert.equal(body.error,'Failed to load your progress');
});
