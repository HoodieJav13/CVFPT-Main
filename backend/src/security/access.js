function canAccessClient(user, clientRow) {
  if (!user || !clientRow) return false;
  if (user.role === 'admin') return true;
  return user.role === 'coach' && clientRow.coach_id === user.coach?.id;
}

function canAccessWorkout(user, workout) {
  if (!user || !workout || workout.archived) return false;
  if (user.role === 'admin') return true;
  return user.role === 'coach' && (!workout.coach_id || workout.coach_id === user.coach?.id);
}

function canAccessProgram(user, program) {
  if (!user || !program) return false;
  if (user.role === 'admin') return true;
  return user.role === 'coach' && program.coach_id === user.coach?.id;
}

function canAccessWorkoutAssignment(user, assignment) {
  if (!assignment || assignment.archived) return false;
  return canAccessClient(user, assignment.client);
}

function programDaysUseAccessibleWorkouts(user, days, workouts) {
  const workoutIds = [...new Set((days || []).map((day) => day.workout_id).filter(Boolean))];
  const workoutsById = new Map((workouts || []).map((workout) => [workout.id, workout]));
  return workoutIds.every((id) => canAccessWorkout(user, workoutsById.get(id)));
}

module.exports = {
  canAccessClient,
  canAccessProgram,
  canAccessWorkout,
  canAccessWorkoutAssignment,
  programDaysUseAccessibleWorkouts,
};
