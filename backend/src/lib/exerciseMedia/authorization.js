// Media read authorization. A client or coach never names exercise ids
// directly: they name a workout context, and the server derives which
// canonical exercises that context contains under the actor's CURRENT access.
// A fabricated asset/exercise id outside the context is indistinguishable from
// a missing one (404). Read failures propagate (5xx), never "not found".
const { canAccessClient, canAccessWorkout } = require('../../security/access');
const { isUuid } = require('./validation');

const CONTEXT_TYPES = new Set(['workout_log', 'workout_assignment', 'program_assignment', 'workout', 'library', 'revision']);
const COACH_ONLY = new Set(['workout', 'library', 'revision']);

function badContext() { const error = new Error('invalid_context'); error.status = 400; error.code = 'invalid_context'; return error; }

function parseContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badContext();
  const keys = Object.keys(value).sort().join(',');
  if (!CONTEXT_TYPES.has(value.type)) throw badContext();
  if (value.type === 'library') {
    if (keys !== 'exercise_id,type' || !isUuid(value.exercise_id)) throw badContext();
    return { type: 'library', exercise_id: value.exercise_id.toLowerCase() };
  }
  if (keys !== 'id,type' || !isUuid(value.id)) throw badContext();
  return { type: value.type, id: value.id.toLowerCase() };
}

const isCoachActor = (user) => user?.role === 'coach' || user?.role === 'admin';

// -> { kind: 'current', exerciseIds:Set } | { kind: 'revision', revision } | null
async function resolveContext(repo, user, context) {
  if (!user) return null;
  if (COACH_ONLY.has(context.type) && !isCoachActor(user)) return null;
  switch (context.type) {
    case 'workout_log': {
      const log = await repo.workoutLog(context.id);
      if (!log) return null;
      const allowed = user.role === 'client' ? log.client_id === user.client?.id : canAccessClient(user, log.client);
      if (!allowed) return null;
      return { kind: 'current', exerciseIds: await repo.logExerciseLibraryIds(log.id) };
    }
    case 'workout_assignment': {
      const assignment = await repo.workoutAssignment(context.id);
      if (!assignment) return null;
      const allowed = user.role === 'client' ? assignment.client_id === user.client?.id : canAccessClient(user, assignment.client);
      if (!allowed) return null;
      const live = await repo.liveWorkoutIds([assignment.workout_id]);
      return { kind: 'current', exerciseIds: await repo.workoutExerciseLibraryIds(live) };
    }
    case 'program_assignment': {
      const assignment = await repo.programAssignment(context.id);
      if (!assignment) return null;
      const allowed = user.role === 'client' ? assignment.client_id === user.client?.id : canAccessClient(user, assignment.client);
      if (!allowed) return null;
      const workoutIds = await repo.programWorkoutIds(assignment.program_id);
      if (!workoutIds) return null;
      return { kind: 'current', exerciseIds: await repo.workoutExerciseLibraryIds(await repo.liveWorkoutIds(workoutIds)) };
    }
    case 'workout': {
      const workout = await repo.workout(context.id);
      if (!canAccessWorkout(user, workout)) return null;
      return { kind: 'current', exerciseIds: await repo.workoutExerciseLibraryIds([workout.id]) };
    }
    case 'library': {
      const exercise = await repo.exercise(context.exercise_id);
      if (!exercise || exercise.archived) return null;
      return { kind: 'current', exerciseIds: new Set([exercise.id]) };
    }
    case 'revision': {
      const revision = await repo.revision(context.id);
      if (!revision || revision.archived) return null;
      if (user.role !== 'admin' && revision.uploaded_by_coach_id !== user.coach?.id) return null;
      return { kind: 'revision', revision };
    }
    default:
      return null;
  }
}

// Assets the resolved context may read right now: current derivatives of its
// exercises, or (owner/admin revision context) that revision's own assets.
async function allowedAssets(repo, resolved) {
  const allowed = new Map();
  if (!resolved) return allowed;
  if (resolved.kind === 'revision') {
    for (const asset of await repo.assetsFor([resolved.revision.id])) {
      allowed.set(asset.id, { asset, revisionId: resolved.revision.id, exerciseId: resolved.revision.exercise_library_id, draft: true });
    }
    return allowed;
  }
  const bundle = await repo.bundle([...resolved.exerciseIds]);
  for (const item of bundle) {
    for (const asset of item.assets || []) {
      allowed.set(asset.id, { asset, revisionId: item.revision_id, exerciseId: item.exercise_library_id, draft: false });
    }
  }
  return allowed;
}

module.exports = { parseContext, resolveContext, allowedAssets, CONTEXT_TYPES };
