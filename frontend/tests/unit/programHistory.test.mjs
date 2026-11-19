import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotProgram, diffProgramRevisions, createPreviewHistory } from '../../src/lib/programHistory.js';
const before = { id: 'p', name: 'Plan', frequency_days: 1, days: [{ id: 'd', day_number: 1, notes: 'Easy', workout: { id: 'w', name: 'Strength', exercises: [{ id: 'a', custom_name: 'Squat', sets: '3', reps: '8', position: 0 }, { id: 'b', custom_name: 'Row', sets: '2', position: 1 }] } }] };
const clone = (x) => structuredClone(x);
test('stored revisions yield exact before/after values, removal/addition and relative order', () => {
  const after = clone(before);
  after.days[0].workout.exercises[0].sets = '4';
  after.days[0].workout.exercises.reverse();
  const changes = diffProgramRevisions(snapshotProgram(before), snapshotProgram(after));
  assert.deepEqual(changes.filter(c => c.field === 'sets').map(c => [c.before, c.after]), [['3','4']]);
  assert.equal(changes.filter(c => c.kind === 'reordered').length, 1);
  after.days[0].workout.exercises = [{ id: 'c', custom_name: 'Press', sets: '2' }];
  const replaced = diffProgramRevisions(snapshotProgram(before), snapshotProgram(after));
  assert.deepEqual(replaced.map(c => c.kind), ['removed','removed','added']);
});
test('day reorder and prescription units/notes/grouping are compared without mutating revisions', () => {
  const a = clone(before); a.days.push({ id: 'd2', day_number: 2, workout: { id: 'w2', exercises: [] } });
  const b = clone(a); b.days.reverse(); b.days[0].day_number=1; b.days[1].day_number=2;
  Object.assign(b.days[1].workout.exercises[0], { duration_value: 30, duration_unit: 's', coach_notes: 'Private', superset_group:'g', default_load_unit:'kg' });
  const frozen = JSON.stringify(a);
  const changes = diffProgramRevisions(snapshotProgram(a), snapshotProgram(b));
  assert.ok(changes.some(c => c.kind==='reordered' && c.path==='Days'));
  for (const field of ['duration_value','duration_unit','coach_notes','superset_group','default_load_unit']) assert.ok(changes.some(c => c.field===field), field);
  assert.equal(JSON.stringify(a),frozen);
});
test('missing history is unavailable; reads are detached and never invent a baseline', () => {
  const journal=createPreviewHistory();
  assert.deepEqual(journal.read('p'),[]);
  assert.equal(diffProgramRevisions(null,snapshotProgram(before)),null);
  journal.capture(before, {...before,name:'Updated'}, { id:'coach', name:'Coach' }, '2026-10-27T12:00:00Z', 'Program save');
  const rows=journal.read('p');
  assert.equal(rows.length,2); assert.equal(rows[0].author,null); assert.equal(rows[0].recorded_at,null);
  assert.equal(rows[1].author.name,'Coach'); assert.equal(rows[1].recorded_at,'2026-10-27T12:00:00Z');
  rows[0].snapshot.name='tampered'; assert.equal(journal.read('p')[0].snapshot.name,'Plan');
  assert.deepEqual(journal.read('other-client'),[]);
});
test('capture ignores no-ops and completion records, preserves unknown metadata and excludes arbitrary payload fields', () => {
  const journal=createPreviewHistory(); const a=clone(before); a.completed_logs=[{status:'completed',load:20}]; a.auth_user_id='secret';
  const frozen=JSON.stringify(a); journal.capture(a,a,null,null,'Program save');
  assert.deepEqual(journal.read('p'),[]); assert.equal(JSON.stringify(a),frozen);
  const b=clone(a); b.description='New'; journal.capture(a,b,null,null,'Program save');
  assert.equal(journal.read('p')[1].author,null); assert.equal(journal.read('p')[1].recorded_at,null);
  assert.equal(JSON.stringify(journal.read('p')).includes('completed_logs'),false);
  assert.equal(JSON.stringify(journal.read('p')).includes('secret'),false);
});
test('insertion does not falsely report unchanged exercises as reordered; replaced ids stay additions/deletions', () => {
  const b=clone(before); b.days[0].workout.exercises.unshift({id:'new',custom_name:'Warmup'});
  assert.deepEqual(diffProgramRevisions(snapshotProgram(before),snapshotProgram(b)).map(c=>c.kind),['added']);
  b.days[0].id='replacement';
  assert.deepEqual(diffProgramRevisions(snapshotProgram(before),snapshotProgram(b)).map(c=>c.kind),['removed','added']);
});

test('the literal fixture revisions compare to stored values, independent of mutable current programs', async () => {
 const { programHistoryFixtures } = await import('../../src/lib/programHistoryFixtures.js');
 const rows=programHistoryFixtures('2026-10-27T12:00:00Z').program_history_example;
 const changes=diffProgramRevisions(rows[0].snapshot,rows[1].snapshot);
 assert.deepEqual(changes.map(({kind,field,before,after})=>({kind,field,before,after})),[
  {kind:'changed',field:'notes',before:'Easy pace',after:'Steady progression'},
  {kind:'reordered',field:'order',before:['Goblet Squat','Cable Row'],after:['Cable Row','Goblet Squat']},
  {kind:'changed',field:'sets',before:'3',after:'4'},
 ]);
});

test('day additions and deletions retain the complete stored prescription values', () => {
 const next=clone(before);
 next.days.push({id:'extra',day_number:2,notes:'New day',workout:{id:'extra-workout',name:'Run',exercises:[{id:'run',custom_name:'Easy run',tracking_type:'duration_distance',duration_value:20,duration_unit:'min',distance_value:3,distance_unit:'km'}]}});
 const left=snapshotProgram(before),right=snapshotProgram(next);
 const added=diffProgramRevisions(left,right);assert.equal(added.length,1);assert.equal(added[0].kind,'added');assert.deepEqual(added[0].after,right.days[1]);
 const removed=diffProgramRevisions(right,left);assert.equal(removed.length,1);assert.equal(removed[0].kind,'removed');assert.deepEqual(removed[0].before,right.days[1]);
 assert.equal(diffProgramRevisions({...left,id:'other-client'},right),null);
});

test('intervening unobserved edits receive unknown metadata rather than being attributed to the next save', () => {
 const journal=createPreviewHistory();
 const first={...clone(before),description:'First save'};
 journal.capture(before,first,{id:'a',name:'A'},'2026-10-27T10:00:00Z','Program save');
 const observed=clone(first);observed.days[0].workout.exercises[0].reps='12';
 journal.capture(observed,{...observed,name:'Next save'},{id:'b',name:'B'},'2026-10-27T11:00:00Z','Program save');
 const rows=journal.read('p');assert.equal(rows.length,4);
 assert.equal(rows[2].author,null);assert.equal(rows[2].recorded_at,null);assert.match(rows[2].source,/intervening changes unavailable/);
 assert.equal(rows[3].author.name,'B');assert.equal(rows[3].snapshot.name,'Next save');
 assert.deepEqual(diffProgramRevisions(rows[2].snapshot,rows[3].snapshot).map(c=>c.field),['name']);
});
