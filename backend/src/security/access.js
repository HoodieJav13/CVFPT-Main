// Shared training library access model (docs/shared-training-library-design.md):
//  - Templates (is_template !== false) are shared by every coach: any coach may
//    read, edit, and assign them. Admin may do everything.
//  - Client instances (is_template === false) belong to the client's coach, who
//    alone (or an admin) may read or edit them.
// Rows without the column (pre-split fixtures) count as templates, matching the
// migration default.
function isTemplate(row) {
  return row?.is_template !== false;
}

function canAccessClient(user, clientRow) {
  if (!user || !clientRow) return false;
  if (user.role === 'admin') return true;
  return user.role === 'coach' && clientRow.coach_id === user.coach?.id;
}

function canAccessWorkout(user, workout) {
  if (!user || !workout || workout.archived) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'coach') return false;
  return isTemplate(workout) || workout.coach_id === user.coach?.id;
}

// Editing follows the same rule as reading: templates are open to every coach
// because an edit only affects future assignments; instances stay with their
// client's coach.
function canManageWorkout(user, workout) {
  return canAccessWorkout(user, workout);
}

function canAccessProgram(user, program) {
  if (!user || !program) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'coach') return false;
  return isTemplate(program) || program.coach_id === user.coach?.id;
}

// A template can be cloned onto a client only while it is live and unhidden.
function canAssignTemplate(row) {
  return Boolean(row) && isTemplate(row) && !row.archived && !row.hidden;
}

function canAccessWorkoutAssignment(user, assignment) {
  if (!assignment || assignment.archived) return false;
  return canAccessClient(user, assignment.client);
}

// Template programs may only compose template workouts. A client's program
// instance may only reference workouts that belong to that same client, so an
// instance can never be re-linked to a shared template.
function programDaysUseAccessibleWorkouts(user, days, workouts, { instanceClientId = null } = {}) {
  const workoutIds = [...new Set((days || []).map((day) => day.workout_id).filter(Boolean))];
  const workoutsById = new Map((workouts || []).map((workout) => [workout.id, workout]));
  return workoutIds.every((id) => {
    const workout = workoutsById.get(id);
    if (!canAccessWorkout(user, workout)) return false;
    if (instanceClientId) return workout.client_id === instanceClientId;
    return isTemplate(workout);
  });
}

module.exports = {
  isTemplate,
  canAccessClient,
  canAccessProgram,
  canAccessWorkout,
  canAssignTemplate,
  canManageWorkout,
  canAccessWorkoutAssignment,
  programDaysUseAccessibleWorkouts,
};
