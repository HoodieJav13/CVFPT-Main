const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canAccessClient,
  canAccessWorkout,
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

test('workout access allows own and global active workouts only', () => {
  assert.equal(canAccessWorkout(coachA, { id: 'own', coach_id: 'coach-a', archived: false }), true);
  assert.equal(canAccessWorkout(coachA, { id: 'global', coach_id: null, archived: false }), true);
  assert.equal(canAccessWorkout(coachA, { id: 'foreign', coach_id: 'coach-b', archived: false }), false);
  assert.equal(canAccessWorkout(coachA, { id: 'archived', coach_id: 'coach-a', archived: true }), false);
  assert.equal(canAccessWorkout(admin, { id: 'foreign', coach_id: 'coach-b', archived: false }), true);
});

test('only admins may mutate global workouts', () => {
  const own = { id: 'own', coach_id: 'coach-a', archived: false };
  const global = { id: 'global', coach_id: null, archived: false };
  assert.equal(canManageWorkout(coachA, own), true);
  assert.equal(canManageWorkout(coachB, own), false);
  assert.equal(canManageWorkout(coachA, global), false);
  assert.equal(canManageWorkout(admin, global), true);
  assert.equal(canManageWorkout(admin, { ...global, archived: true }), false);
});

test('workout assignment archive access follows client ownership and active state', () => {
  const assignment = { id: 'assignment-a', archived: false, client: { coach_id: 'coach-a' } };
  assert.equal(canAccessWorkoutAssignment(coachA, assignment), true);
  assert.equal(canAccessWorkoutAssignment(coachB, assignment), false);
  assert.equal(canAccessWorkoutAssignment(admin, assignment), true);
  assert.equal(canAccessWorkoutAssignment(coachA, { ...assignment, archived: true }), false);
  assert.equal(canAccessWorkoutAssignment(coachA, null), false);
});

test('program days reject foreign, archived, and missing workout references', () => {
  const days = [{ workout_id: 'own' }, { workout_id: 'global' }];
  const accessible = [
    { id: 'own', coach_id: 'coach-a', archived: false },
    { id: 'global', coach_id: null, archived: false },
  ];
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, accessible), true);
  assert.equal(programDaysUseAccessibleWorkouts(coachB, days, accessible), false);
  assert.equal(programDaysUseAccessibleWorkouts(coachA, [...days, { workout_id: 'missing' }], accessible), false);
  assert.equal(programDaysUseAccessibleWorkouts(coachA, days, [{ ...accessible[0], archived: true }, accessible[1]]), false);
  assert.equal(programDaysUseAccessibleWorkouts(admin, days, accessible), true);
});
