const { supabaseAdmin } = require('../supabase');
const { validateUuid } = require('../validation/business');
const { canAccessClient } = require('../security/access');

// Columns a workout row needs for the ownership checks below. A client's
// private copy is governed by whoever coaches that client now, never by the
// coach stamped on the copy when it was cloned.
const WORKOUT_OWNER_COLUMNS = 'is_template, client_id, client_owner:clients!client_id(coach_id)';

// Templates are shared by every coach; legacy null-coach fixtures remain
// attachable. A private copy attaches only to its own client's sessions, for
// that client's current coach or an admin.
// Archived workouts are excluded by the queries below.
function usable(workout, { user, coachId, clientId }) {
  if (!workout) return false;
  if (workout.is_template === false) {
    return workout.client_id === clientId && canAccessClient(user, workout.client_owner);
  }
  return workout.is_template === true || workout.coach_id === null || workout.coach_id === coachId;
}

// Single attachment. null detaches. Returns { ok, value | error }.
// `context` is { user, coachId, clientId } of the session being written.
async function validateWorkoutAttachment(workoutId, context) {
  if (workoutId === null) return { ok: true, value: null };
  const idValidation = validateUuid(workoutId, 'Workout ID');
  if (!idValidation.ok) return { ok: false, error: idValidation.error };
  const { data: workout, error } = await supabaseAdmin.from('workouts').select(`id, coach_id, ${WORKOUT_OWNER_COLUMNS}`)
    .eq('id', idValidation.value).eq('archived', false).maybeSingle();
  if (error) throw error; // an operational failure is not "not found"
  if (!usable(workout, context)) return { ok: false, error: 'Workout not found' };
  return { ok: true, value: workout.id };
}

// Bulk variant for a series: one query for all distinct ids (a repeating
// program references only a handful of templates). null/undefined are skipped.
async function validateWorkoutIds(workoutIds, context) {
  const distinct = [...new Set((workoutIds || []).filter((id) => id !== null && id !== undefined))];
  for (const id of distinct) {
    const validation = validateUuid(id, 'Workout ID');
    if (!validation.ok) return { ok: false, error: validation.error };
  }
  if (!distinct.length) return { ok: true, value: [] };
  const { data, error } = await supabaseAdmin.from('workouts').select(`id, coach_id, ${WORKOUT_OWNER_COLUMNS}`)
    .in('id', distinct).eq('archived', false);
  if (error) throw error;
  const found = new Map((data || []).map((workout) => [String(workout.id).toLowerCase(), workout]));
  for (const id of distinct) {
    if (!usable(found.get(id.toLowerCase()), context)) return { ok: false, error: 'Workout not found' };
  }
  return { ok: true, value: distinct };
}

// Read side, for a workout embedded in a session row with WORKOUT_OWNER_COLUMNS.
// Templates show to anyone who can see the session; a private copy only to its
// own client, that client's current coach, or an admin. Returns the workout
// without the ownership columns, or null when the viewer may not see it.
function visibleAttachedWorkout(user, workout) {
  if (!workout) return null;
  const { is_template: isTemplate, client_id: clientId, client_owner: owner, ...rest } = workout;
  if (isTemplate === false) {
    const allowed = user?.role === 'client' ? clientId === user.client?.id : canAccessClient(user, owner);
    if (!allowed) return null;
  }
  return rest;
}

module.exports = {
  WORKOUT_OWNER_COLUMNS, validateWorkoutAttachment, validateWorkoutIds, visibleAttachedWorkout,
};
