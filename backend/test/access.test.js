const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canAccessClient,
  canAccessProgram,
  canAccessWorkout,
  canAssignTemplate,
  canManageWorkout,
  canAccessWorkoutAssignment,
  programDaysUseAccessibleWorkouts,
} = require('../src/security/access');

const coachA = { role: 'coach', coach: { id: 'coach-a' } };
const coachB = { role: 'coach', coach: { id: 'coach-b' } };
const admin = { role: 'admin', coach: { id: 'admin' } };

test('client ownership hides a different coach client while allowing admin', () => {
  const client = { id: 'client-a', coach_id: 'coach-a' };
  assert.equal(canAccessClient(coachA, client), true);
  assert.equal(canAccessClient(coachB, client), false);
  assert.equal(canAccessClient(admin, client), true);
  assert.equal(canAccessClient(coachA, null), false);
});

test('templates are shared by every coach; client instances stay with their coach', () => {
  const template = { id: 't', coach_id: 'coach-b', is_template: true, archived: false };
  const legacyRow = { id: 'legacy', coach_id: 'coach-b', archived: false }; // no is_template column value
  const global = { id: 'global', coach_id: null, is_template: true, archived: false };
  const instance = { id: 'i', coach_id: 'coach-a', is_template: false, client_id: 'c', archived: false };
  for (const row of [template, legacyRow, global]) {
    assert.equal(canAccessWorkout(coachA, row), true, `${row.id} readable by any coach`);
    assert.equal(canManageWorkout(coachA, row), true, `${row.id} editable by any coach`);
  }
  assert.equal(canAccessWorkout(coachA, instance), true);
  assert.equal(canManageWorkout(coachB, instance), false, 'another coach cannot touch a client instance');
  assert.equal(canAccessWorkout(coachB, instance), false);
  assert.equal(canAccessWorkout(admin, instance), true);
  assert.equal(canAccessWorkout(coachA, { ...template, archived: true }), false);
  assert.equal(canManageWorkout(admin, { ...global, archived: true }), false);
  assert.equal(canAccessWorkout({ role: 'client', client: { id: 'x' } }, template), false);
});

test('program access: templates open to coaches, instances owned by the client coach', () => {
  const template = { id: 'p', coach_id: 'coach-b', is_template: true };
  const instance = { id: 'pi', coach_id: 'coach-a', is_template: false, client_id: 'c' };
  assert.equal(canAccessProgram(coachA, template), true);
  assert.equal(canAccessProgram(coachA, instance), true);
  assert.equal(canAccessProgram(coachB, instance), false);
  assert.equal(canAccessProgram(admin, instance), true);
  assert.equal(canAccessProgram(null, template), false);
  assert.equal(canAccessProgram({ role: 'client' }, template), false);
});

test('only live, unhidden templates can be assigned', () => {
  assert.equal(canAssignTemplate({ is_template: true, archived: false, hidden: false }), true);
  assert.equal(canAssignTemplate({ archived: false }), true);
  assert.equal(canAssignTemplate({ is_template: true, hidden: true }), false);
  assert.equal(canAssignTemplate({ is_template: true, archived: true }), false);
  assert.equal(canAssignTemplate({ is_template: false, client_id: 'c' }), false, 'instances are never re-assigned');
  assert.equal(canAssignTemplate(null), false);
});

test('workout assignment archive access follows client ownership and active state', () => {
  const assignment = { id: 'assignment-a', archived: false, client: { coach_id: 'coach-a' } };
  assert.equal(canAccessWorkoutAssignment(coachA, assignment), true);
  assert.equal(canAccessWorkoutAssignment(coachB, assignment), false);
  assert.equal(canAccessWorkoutAssignment(admin, assignment), true);
  assert.equal(canAccessWorkoutAssignment(coachA, { ...assignment, archived: true }), false);
  assert.equal(canAccessWorkoutAssignment(coachA, null), false);
});

test('program days reject archived and missing workout references', () => {
  const days = [{ workout_id: 'own' }, { workout_id: 'global' }];
  const accessible = [
    { id: 'own', coach_id: 'coach-a', is_template: true, archived: false },
    { id: 'global', coach_id: null, is_template: true, archived: false },
  ];
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, accessible), true);
  assert.equal(programDaysUseAccessibleWorkouts(coachB, days, accessible), true, 'templates are shared');
  assert.equal(programDaysUseAccessibleWorkouts(coachA, [...days, { workout_id: 'missing' }], accessible), false);
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, [{ ...accessible[0], archived: true }, accessible[1]]), false);
  assert.equal(programDaysUseAccessibleWorkouts(admin, days, accessible), true);
});

test('template programs cannot compose client instances, and instances cannot link to templates', () => {
  const days = [{ workout_id: 'w' }];
  const instanceWorkout = { id: 'w', coach_id: 'coach-a', is_template: false, client_id: 'client-1', archived: false };
  const templateWorkout = { id: 'w', coach_id: 'coach-a', is_template: true, archived: false };
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, [instanceWorkout]), false);
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, [instanceWorkout], { instanceClientId: 'client-1' }), true);
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, [instanceWorkout], { instanceClientId: 'client-2' }), false);
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, [templateWorkout], { instanceClientId: 'client-1' }), false);
  assert.equal(programDaysUseAccessibleWorkouts(coachB, days, [instanceWorkout], { instanceClientId: 'client-1' }), false);
});
