// Tracking type "reps_weight" includes unweighted reps. Keep unknown exercises editable.
export function asksForLoad(exercise = {}) {
  const name = String(exercise.exercise_name || '').trim().toLowerCase();
  const equipment = String(exercise.equipment || '').trim().toLowerCase();
  if (Number(exercise.prescribed_load_value) > 0 || Number(exercise.prescribed_load_max) > 0 ||
      /\b(weighted|loaded|barbell|dumbbell|kettlebell|cable|vest)\b/.test(name)) return true;
  if (/^(body[ -]?weight|none|no equipment)$/.test(equipment)) return false;
  if (/\b(barbells?|dumbbells?|kettlebells?|cables?|weight stack|weight plates?|weighted vest)\b/.test(equipment)) return true;
  return !(/^(stretch|stretching|mobility|flexibility)$/i.test(exercise.category || '') ||
    /\b(stretch(?:ing)?|body[ -]?weight)\b/.test(name) ||
    /^(?:(?:side|front|reverse|incline|decline|knee|forearm) )?(?:planks?|push[ -]?ups?|pull[ -]?ups?|chin[ -]?ups?|air squats?|sit[ -]?ups?|burpees?)$/.test(name));
}
