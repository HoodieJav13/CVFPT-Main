const { supabaseAdmin } = require('../supabase');
const { validateUuid } = require('../validation/business');

// A session may carry a workout template the owning coach can use: their own,
// or a shared one (coach_id null — the same set GET /programs/workouts offers).
// Archived workouts are excluded by the queries below.
function usable(workout, coachId) {
  return Boolean(workout) && (workout.coach_id === null || workout.coach_id === coachId);
}

// Single attachment. null detaches. Returns { ok, value | error }.
async function validateWorkoutAttachment(workoutId, coachId) {
  if (workoutId === null) return { ok: true, value: null };
  const idValidation = validateUuid(workoutId, 'Workout ID');
  if (!idValidation.ok) return { ok: false, error: idValidation.error };
  const { data: workout } = await supabaseAdmin.from('workouts').select('id, coach_id')
    .eq('id', idValidation.value).eq('archived', false).maybeSingle();
  if (!usable(workout, coachId)) return { ok: false, error: 'Workout not found' };
  return { ok: true, value: workout.id };
}

// Bulk variant for a series: one query for all distinct ids (a repeating
// program references only a handful of templates). null/undefined are skipped.
async function validateWorkoutIds(workoutIds, coachId) {
  const distinct = [...new Set((workoutIds || []).filter((id) => id !== null && id !== undefined))];
  for (const id of distinct) {
    const validation = validateUuid(id, 'Workout ID');
    if (!validation.ok) return { ok: false, error: validation.error };
  }
  if (!distinct.length) return { ok: true, value: [] };
  const { data, error } = await supabaseAdmin.from('workouts').select('id, coach_id')
    .in('id', distinct).eq('archived', false);
  if (error) throw error;
  const found = new Map((data || []).map((workout) => [String(workout.id).toLowerCase(), workout]));
  for (const id of distinct) {
    if (!usable(found.get(id.toLowerCase()), coachId)) return { ok: false, error: 'Workout not found' };
  }
  return { ok: true, value: distinct };
}

module.exports = { validateWorkoutAttachment, validateWorkoutIds };
