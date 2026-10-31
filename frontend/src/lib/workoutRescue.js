// Fixture-only whole-workout choices. No catalog ranking, medical rules or source claims.
export const RESCUE_PROGRAM = 'program_foundation';
export const RESCUE_DAY = 'day_foundation_1';
export const RESCUE_EQUIPMENT = ['dumbbells', 'cable'];
const name = (row) => row.custom_name || row.library_exercise?.name || row.exercise_name || 'Exercise';
// Compare the complete authoritative fixture, before media DTO hydration. This deliberately
// invalidates approvals on any original edit instead of guessing whether it is material.
export function rescueVersion(original) {
  // Opaque freshness token, not an authorization proof. Do not return private source
  // fields inside a client-visible JSON token. Real rollout requires server revisions.
  let hash = 0xcbf29ce484222325n;
  for (const char of JSON.stringify(original)) hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n);
  return `fixture-${hash.toString(16)}`;
}
export function rescueMatches(branch, context) {
  return Boolean(branch.enabled && Array.isArray(context?.equipment) && Number.isFinite(Number(context.minutes)) && Number(context.minutes) >= branch.minutes
    && branch.equipment.every((item) => context.equipment.includes(item)));
}
export function validateRescueBranch(branch, original) {
  if (!branch || typeof branch.name !== 'string' || typeof branch.intent !== 'string' || !branch.name.trim() || !branch.intent.trim()) return 'Add a name and the intent this option keeps.';
  if (branch.name.length > 80 || branch.intent.length > 400) return 'Use a shorter name or intent note.';
  if (!Number.isInteger(branch.minutes) || branch.minutes < 1 || branch.minutes > 50) return 'Estimate a duration from 1 to 50 minutes.';
  if (!Array.isArray(branch.equipment) || branch.equipment.some((item) => !RESCUE_EQUIPMENT.includes(item))) return 'Choose supported equipment.';
  if (!Array.isArray(branch.items) || !branch.items.length) return 'Keep at least one exercise.';
  const seen = new Set();
  for (const item of branch.items) {
    if (!item || typeof item.source_id !== 'string') return 'Each exercise must come from this original.';
    const source = original.workout.exercises.find((row) => row.id === item.source_id);
    if (!source || seen.has(item.source_id)) return 'Each exercise must come from this original, once.';
    seen.add(item.source_id);
    if (!Number.isInteger(item.sets) || item.sets < 1 || item.sets > Number(source.sets)) return 'Keep between one and the original number of sets.';
  }
  return null;
}
export function rescueExercises(original, branch) {
  return original.workout.exercises.flatMap((source) => {
    const item = branch.items.find((row) => row.source_id === source.id);
    return item ? [{ ...structuredClone(source), sets: String(item.sets) }] : [];
  });
}
export function rescueDiff(original, branch) {
  return original.workout.exercises.map((source) => {
    const item = branch.items.find((row) => row.source_id === source.id);
    return { id: source.id, name: name(source), change: !item ? 'Dropped' : Number(source.sets) === item.sets ? 'Unchanged' : `${source.sets} → ${item.sets} sets` };
  });
}
export function resolveRescue(original, plan, request) {
  if (!original || plan.version !== rescueVersion(original) || request.version !== plan.version) return { error: 'stale_original' };
  if (request.revision !== plan.revision) return { error: 'stale_branch' };
  const branch = plan.branches.find((row) => row.id === request.branch_id && row.enabled);
  if (!branch) return { error: 'missing_fallback' };
  if (validateRescueBranch(branch, original) || !rescueMatches(branch, request)) return { error: 'combination_conflict' };
  return { branch, exercises: rescueExercises(original, branch), changes: rescueDiff(original, branch) };
}
export function createRescueFixture(original) {
  const items = (sets, includeCore) => original.workout.exercises.filter((_, index) => includeCore || index < 2).map((row) => ({ source_id: row.id, sets: Math.min(sets, Number(row.sets)) }));
  return { version: rescueVersion(original), revision: 1, branches: [
    { id: 'rescue_short', name: '25-minute gym option', minutes: 25, equipment: ['dumbbells', 'cable'], enabled: true, intent: 'Keep squat, hinge and trunk practice with fewer sets. Demonstration coaching note.', items: items(2, true) },
    { id: 'rescue_equipment', name: 'Dumbbells only', minutes: 40, equipment: ['dumbbells'], enabled: true, intent: 'Keep squat and hinge work; omit the cable exercise today. Demonstration coaching note.', items: items(3, false) },
  ] };
}
