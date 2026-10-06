export const exerciseName='Single-arm Dumbbell Bulgarian Split Squat with Front-foot Elevation';
function data() {
 const sets=(id,load)=>[1,2,3].map(n=>({id:`${id}-set-${n}`,workout_log_exercise_id:id,set_number:n,status:'pending',set_origin:'prescribed',actual_load_value:load,actual_load_unit:'lb',actual_reps:null,actual_rpe:null,actual_duration_value:null,actual_duration_unit:null,actual_distance_value:null,actual_distance_unit:null}));
 const exercises=[{id:'ex-a',exercise_name:exerciseName,tracking_type:'reps_weight',prescribed_sets:3,prescribed_reps:'8–10',prescribed_rpe:'7',prescribed_rest_seconds:60,superset_group:'group-a',sort_order:0,sets:sets('ex-a',135.5)},{id:'ex-b',exercise_name:'Chest-supported row',tracking_type:'reps_weight',prescribed_sets:3,prescribed_reps:'10',prescribed_rpe:'7',prescribed_rest_seconds:60,superset_group:'group-a',sort_order:1,sets:sets('ex-b',27.5)}];
 exercises.push({id:'ex-c',exercise_name:'Synthetic run',tracking_type:'duration_distance',prescribed_sets:3,prescribed_duration_unit:'min',prescribed_distance_unit:'km',prescribed_rest_seconds:60,sets:sets('ex-c',null)});
 const log={id:'ux-log',client_id:'ux-client',workout_name:'Synthetic phone workout',status:'active',started_at:new Date().toISOString(),exercises,coach_responses:[]};
 const workout={id:'ux-workout',name:'Synthetic phone workout',coach_id:'ux-coach',exercises:[{id:'ux-prescription',custom_name:exerciseName,sets:'3',reps:'8–10',rest:'60s',tempo:'3010',target_rpe:'7',default_load_value:135.5,default_load_unit:'lb',client_notes:'Client-visible instruction',coach_notes:'Coach-only instruction',tracking_type:'reps_weight'}]};
 return {log,workout};
}
export async function setupWorkoutUx(page, role = 'client') {
 const results = { errors: [], unexpected: [], writes: [] };
 await page.emulateMedia({ reducedMotion: 'reduce' });
 const fixture=data();
 page.on('pageerror',error=>results.errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('cvf_access_token','synthetic-ux-token'));
 await page.route('**/api/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname.replace(/^\/api/,''),method=r.method();
  const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path==='/auth/me') return json({role,email:'synthetic@example.invalid',profile:{id:role==='coach'?'ux-coach':'ux-client',name:'Synthetic UX',waiver_signed:true}});
  if(path==='/telemetry/events') return route.fulfill({status:204});
  if(path==='/workout-logs/coach-feedback/unread-count') return json({unread:0});
  if(path==='/notifications/unread-count') return json({unread:0});
  if(path==='/workout-logs/ux-log'&&method==='GET') return json(fixture.log);
  if(path==='/workout-logs/mine') return json([]);
  if(path==='/workout-logs/active') return json(null);
  if(path==='/programs/client/assigned') return json({programs:[],workouts:[{id:'ux-assignment',assignment_mode:'active',workout:fixture.workout}]});
  if(path.startsWith('/workout-logs/ux-log/sets/')&&method==='PATCH') { const set=fixture.log.exercises.flatMap(e=>e.sets).find(s=>s.id===path.split('/').at(-1));results.writes.push(r.postDataJSON());Object.assign(set,r.postDataJSON());return json(set); }
  if(path==='/programs/exercise-library') return json([]);
  if(path==='/programs/workouts') return json([fixture.workout]);
  if(path==='/programs/workouts/ux-workout') return json(fixture.workout);
  if(path==='/programs'||path==='/clients') return json([]);
  results.unexpected.push(`${role}: ${method} ${path}`);return json({error:'Unexpected synthetic route'},404);
 });
 return { fixture, results };
}
