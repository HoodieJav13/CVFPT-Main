const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');
let actor, log, exercise, set, writes, rpcCalls, startOutcome;
const workout = { id: 'w-a', coach_id: 'coach-a', created_by: 'coach-a', name: 'Typed', is_template: true, archived: false };
function reset() {
  actor = { role: 'client', client: { id: 'client-a' } };
  log = { id: 'log-a', client_id: 'client-a', status: 'active', archived: false, client: { id: 'client-a', coach_id: 'coach-a', archived: false } };
  exercise = { id: 'ex-a', workout_log_id: 'log-a', tracking_type: 'duration_distance', archived: false };
  set = { id: 'set-a', workout_log_exercise_id: 'ex-a', status: 'pending', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, archived: false };
  writes = []; rpcCalls = [];
  startOutcome = 'started';
}
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) { rpcCalls.push({name,args}); return Promise.resolve({data: name === 'start_workout_log_v2' ? { outcome: startOutcome, workout_log_id: 'log-a' } : 'w-a', error: null}); },
  from(table) {
    const filters = []; let payload;
    const rows = () => (table === 'workout_logs' ? [log] : table === 'workout_log_exercises' ? [exercise] : table === 'workout_log_sets' ? [set] : table === 'workouts' ? [workout] : table === 'workout_exercises' ? [{ id: 'we-a', workout_id: 'w-a', custom_name: 'Run', tracking_type: 'duration_distance', duration_value: 20, duration_unit: 'min', distance_value: 2, distance_unit: 'mi', archived: false }] : []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key,value]); return chain; }, in() { return chain; }, order() { return chain; },
      update(value) { payload=value; return chain; }, maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { const row=rows()[0]; if (payload) { writes.push(payload); Object.assign(row, payload); } return Promise.resolve({ data: row, error: null }); },
      then(resolve) { return resolve({ data: rows(), count: 0, error: null }); } };
    return chain;
  },
} } };
const authPath=require.resolve('../src/middleware/auth');
require.cache[authPath]={ id:authPath,filename:authPath,loaded:true,exports:{
  requireAuth(req,res,next){req.user=actor;next();}, requireCoach(req,res,next){if (['coach','admin'].includes(actor.role)) next(); else res.status(403).json({error:'Coach access required'});}, requireClient(req,res,next){next();}, canAccessClient,
}};
const app=express(); app.use(express.json()); app.use('/api/workout-logs',require('../src/routes/workoutLogs')); app.use('/api/programs',require('../src/routes/programs'));
let server, base;
test.before(async()=>{ server=app.listen(0,'127.0.0.1'); await new Promise((resolve)=>server.once('listening',resolve)); base=`http://127.0.0.1:${server.address().port}`; });
test.after(()=>new Promise((resolve)=>server.close(resolve)));
async function patch(body) { const res=await fetch(`${base}/api/workout-logs/log-a/sets/set-a`,{ method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body) }); return { status:res.status,body:await res.json() }; }
const values={actual_duration_value:12.5,actual_duration_unit:'min',actual_distance_value:1.25,actual_distance_unit:'mi'};
test('mounted metric writes permit owner/client/admin and derive attribution from authenticated actor',async()=>{
  for (const user of [{role:'client',client:{id:'client-a'}},{role:'coach',coach:{id:'coach-a'}},{role:'admin',coach:{id:'admin-a'}}]) {
    reset();actor=user;
    const response=await patch({...values,entered_by:'coach',entered_by_coach_id:'forged'});
    assert.equal(response.status,200);assert.equal(response.body.actual_distance_unit,'mi');
    assert.equal(writes[0].entered_by,user.role==='client'?'client':'coach');
    assert.equal(writes[0].entered_by_coach_id,user.coach?.id??null);
    assert.equal((await patch({actual_rpe:7.5})).body.actual_duration_value,12.5);
  }
});

test('quick completion refuses resumed logs and uses one atomic fresh-log completion RPC', async () => {
  reset(); startOutcome = 'resumed'; Object.assign(set, values); log.notes = 'Existing note';
  let response = await fetch(`${base}/api/workout-logs/quick-complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workout_assignment_id: 'assignment-a' }) });
  assert.equal(response.status, 409);
  assert.deepEqual(rpcCalls.map((call) => call.name), ['start_workout_log_v2']);
  assert.equal(set.actual_duration_value, 12.5); assert.equal(log.notes, 'Existing note'); assert.equal(writes.length, 0);
  reset();
  response = await fetch(`${base}/api/workout-logs/quick-complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workout_assignment_id: 'assignment-a' }) });
  assert.equal(response.status, 201);
  assert.deepEqual(rpcCalls.map((call) => call.name), ['start_workout_log_v2', 'quick_complete_workout_log_v2']);
});
test('mounted foreign/archived/completed metric writes are masked before mutation',async()=>{
  for (const user of [{role:'client',client:{id:'client-b'}},{role:'coach',coach:{id:'coach-b'}}]) {reset();actor=user;assert.equal((await patch(values)).status,404);assert.equal(writes.length,0);}
  reset();log.status='completed';assert.equal((await patch(values)).status,409);assert.equal(writes.length,0);
  reset();log.archived=true;assert.equal((await patch(values)).status,404);assert.equal(writes.length,0);
  reset();actor={role:'coach',coach:{id:'coach-a'}};log.client.archived=true;assert.equal((await patch(values)).status,404);assert.equal(writes.length,0);
});
test('mounted validation rejects malformed metric pairs and forged tracking before mutation',async()=>{
  reset();assert.equal((await patch({...values,actual_duration_value:'12.5'})).status,400);assert.equal(writes.length,0);
  reset();exercise.tracking_type='reps_weight';assert.equal((await patch({...values,tracking_type:'duration_distance'})).status,400);assert.equal(writes.length,0);
  reset();assert.equal((await patch({...values,actual_distance_unit:'kg'})).status,400);assert.equal(writes.length,0);
});

async function saveWorkout(method, body) { const res = await fetch(`${base}/api/programs/workouts${method === 'PUT' ? '/w-a' : ''}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return res; }
test('coach configuration rejects invalid types before RPC and preserves fields omitted by legacy clients', async () => {
  reset(); assert.equal((await saveWorkout('POST', { name: 'Typed', exercises: [] })).status,403); assert.equal(rpcCalls.length,0);
  reset(); actor={role:'coach',coach:{id:'coach-a'}};
  assert.equal((await saveWorkout('POST',{name:'Typed',exercises:[{custom_name:'Run',tracking_type:'swimming'}]})).status,400);assert.equal(rpcCalls.length,0);
  assert.equal((await saveWorkout('POST',{name:'Typed',exercises:[{custom_name:'Run',tracking_type:'duration',duration_value:'15',duration_unit:'min'}]})).status,201);
  assert.equal(rpcCalls[0].args.p_exercises[0].duration_value,15);
  rpcCalls=[];
  assert.equal((await saveWorkout('PUT',{exercises:[{id:'we-a',custom_name:'Run',sets:'2'}]})).status,200);
  assert.equal(rpcCalls[0].args.p_exercises[0].tracking_type,'duration_distance');
  assert.equal(rpcCalls[0].args.p_exercises[0].distance_unit,'mi');
  rpcCalls=[]; Object.assign(workout,{is_template:false,client_id:'client-a',client_owner:{coach_id:'coach-a'}}); actor={role:'coach',coach:{id:'coach-b'}};
  assert.equal((await saveWorkout('PUT',{exercises:[]})).status,404);assert.equal(rpcCalls.length,0);
});
