// Preview-local domain: no notes/metrics/program rows are mutated here.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const live = row => row && !row.archived;
const find = (rows, id) => rows?.find(row => row.id === id && live(row));
const copy = value => structuredClone(value);
export const CUE_VERDICTS = { pending: 'Pending recheck', fixed: 'Fixed', partial: 'Partly helped', nochange: 'No change' };

function attempt(state, actor, logId, exerciseId) {
  const log = find(state.workoutLogs, logId);
  const client = find(state.clients, log?.client_id);
  const allowed = client && (actor?.role === 'client' ? actor.profile?.id === client.id
    : actor?.role === 'admin' || (actor?.role === 'coach' && actor.profile?.id === client.coach_id));
  const exercise = state.workoutLogExercises.find(row => row.id === exerciseId && row.workout_log_id === log?.id && live(row));
  if (!log || !allowed || !exercise) fail(404, 'Exercise attempt not found');
  return { log, exercise, client };
}

function sourceVersion(state, log, exercise) {
  const source = find(state.workoutExercises, exercise.source_workout_exercise_id);
  const workout = find(state.workouts, source?.workout_id);
  const assignment = find(state.programAssignments, log.program_assignment_id);
  const day = find(state.programDays, log.program_day_id);
  const program = find(state.programs, assignment?.program_id);
  if (!source || !workout || !assignment || !day || !program || assignment.client_id !== log.client_id
    || day.program_id !== program.id || day.workout_id !== workout.id) return null;
  // Exact serialized fixture values, not an auth token or a hosted version scheme.
  return JSON.stringify({ source, workout, assignment, day, program,
    loads: (state.programAssignmentExerciseLoads || []).filter(row => live(row)
      && row.program_assignment_id === assignment.id && row.program_day_id === day.id
      && row.workout_exercise_id === source.id) });
}
const performed = (state, exerciseId) => state.workoutLogSets.some(row => live(row)
  && row.workout_log_exercise_id === exerciseId && row.status === 'completed');
function retryVersion(exercise) {
  if (!live(exercise)) return null;
  const keys = Object.keys(exercise).filter(key => key.startsWith('prescribed_')
    || ['source_workout_exercise_id', 'exercise_library_id', 'exercise_name', 'tracking_type'].includes(key)).sort();
  return JSON.stringify({ ...Object.fromEntries(keys.map(key => [key, exercise[key]])), plan_revision: exercise.plan_revision || 0 });
}
function presented(state, row) {
  const log = find(state.workoutLogs, row.source_log_id);
  const exercise = find(state.workoutLogExercises, row.source_exercise_id);
  return { ...copy(row), retry_status: find(state.workoutLogs, row.retry_log_id)?.status || null,
    stale_retry: Boolean(row.retry_exercise_id) && row.retry_version !== retryVersion(find(state.workoutLogExercises, row.retry_exercise_id)), stale: !row.retry_exercise_id && (!log || !exercise || row.source_version !== sourceVersion(state, log, exercise)) };
}

export function cueContext(state, actor, logId, exerciseId) {
  const { log, exercise } = attempt(state, actor, logId, exerciseId);
  const version = sourceVersion(state, log, exercise);
  return {
    source_version: version,
    can_create: log.status === 'completed' && performed(state, exercise.id) && Boolean(version),
    can_recheck: log.status === 'completed' && performed(state, exercise.id),
    outgoing: (state.cueRetries || []).filter(row => row.source_exercise_id === exerciseId).map(row => presented(state, row)),
    incoming: (state.cueRetries || []).filter(row => row.retry_exercise_id === exerciseId && !row.archived).map(row => presented(state, row)),
  };
}

export function mutateCue(state, actor, logId, exerciseId, payload, now = new Date().toISOString()) {
  if (!['coach', 'admin'].includes(actor?.role)) fail(403, 'Coach access required');
  const { log, exercise } = attempt(state, actor, logId, exerciseId);
  if (!payload || !['create', 'edit', 'cancel', 'verdict'].includes(payload.action)
    || typeof payload.request_id !== 'string' || !payload.request_id || payload.request_id.length > 100) fail(400, 'Invalid cue request');
  const fingerprint = JSON.stringify({ actor: actor.profile?.id, logId, exerciseId, payload });
  const receipt = state.cueReceipts.find(row => row.request_id === payload.request_id);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) fail(409, 'This request was already used for a different change. Reload before retrying.');
    return copy(receipt.result);
  }
  const version = sourceVersion(state, log, exercise);
  let text;
  if (['create', 'edit'].includes(payload.action)) {
    if (typeof payload.text !== 'string' || !payload.text.trim() || Array.from(payload.text.trim()).length > 500) fail(400, 'Enter one actionable cue, up to 500 characters.');
    text = payload.text.trim();
    if (!version || version !== payload.source_version) fail(409, 'The program or assignment changed. Reload and review before saving a cue.');
    if (log.status !== 'completed' || !performed(state, exercise.id)) fail(409, 'Choose a completed exercise attempt with a performed set.');
  }
  let row;
  if (payload.action === 'create') {
    if (state.cueRetries.some(item => item.source_exercise_id === exerciseId && !item.archived)) fail(409, 'This attempt already has a cue. Reload to edit it.');
    if (state.cueRetries.some(item => !item.archived && !item.retry_exercise_id && item.client_id === log.client_id
      && item.source_workout_exercise_id === exercise.source_workout_exercise_id
      && item.program_assignment_id === log.program_assignment_id && item.program_day_id === log.program_day_id)) fail(409, 'This exercise already has a cue waiting for retry. Review that original attempt first.');
    row = { id: `cue_${payload.request_id}`, client_id: log.client_id, source_log_id: logId, source_exercise_id: exerciseId,
      source_workout_exercise_id: exercise.source_workout_exercise_id, program_assignment_id: log.program_assignment_id, program_day_id: log.program_day_id,
      text, source_version: version, author_coach_id: actor.profile.id, author_name: actor.profile.name,
      retry_log_id: null, retry_exercise_id: null, verdict: 'pending', revision: 1,
      created_at: now, updated_at: now, archived: false, rechecked_by: null, rechecked_at: null };
    state.cueRetries.push(row);
  } else {
    row = state.cueRetries.find(item => item.id === payload.cue_id && item.client_id === log.client_id && !item.archived);
    if (!row || (payload.action === 'verdict' ? row.retry_exercise_id !== exerciseId : row.source_exercise_id !== exerciseId)) fail(404, 'Cue not found');
    if (row.revision !== payload.revision) fail(409, 'This cue changed. Reload before trying again.');
    if (payload.action === 'verdict') {
      if (row.retry_version !== retryVersion(exercise)) fail(409, 'The retry plan changed. This cue belongs to the earlier attempt version; leave it pending.');
      if (!Object.hasOwn(CUE_VERDICTS, payload.verdict)) fail(400, 'Choose a recheck verdict');
      if (log.status !== 'completed' || !performed(state, exercise.id)) fail(409, 'Complete a performed retry attempt before recording a verdict.');
      Object.assign(row, { verdict: payload.verdict, rechecked_by: actor.profile.id, rechecked_at: now });
    } else {
      if (row.retry_exercise_id) fail(409, 'This cue is already attached to a retry. Its text and link are frozen.');
      if (payload.action === 'edit') Object.assign(row, { text, source_version: version });
      if (payload.action === 'cancel') row.archived = true;
    }
    row.revision += 1; row.updated_at = now;
  }
  state.cueReceipts.push({ request_id: payload.request_id, fingerprint, action: payload.action, at: now, result: copy(row) });
  return row;
}

export function linkNextCues(state, logId) {
  const log = find(state.workoutLogs, logId);
  if (!log || log.status !== 'active') return;
  for (const exercise of state.workoutLogExercises.filter(row => live(row) && row.workout_log_id === logId)) {
    for (const row of state.cueRetries || []) {
      if (row.archived || row.retry_exercise_id || row.client_id !== log.client_id || row.source_log_id === log.id
        || row.source_workout_exercise_id !== exercise.source_workout_exercise_id
        || row.program_assignment_id !== log.program_assignment_id || row.program_day_id !== log.program_day_id
        || Date.parse(log.started_at) < Date.parse(row.created_at)) continue;
      const sourceLog = find(state.workoutLogs, row.source_log_id);
      const sourceExercise = find(state.workoutLogExercises, row.source_exercise_id);
      if (!sourceLog || !sourceExercise || row.source_version !== sourceVersion(state, sourceLog, sourceExercise)) continue;
      Object.assign(row, { retry_log_id: log.id, retry_exercise_id: exercise.id, linked_at: log.started_at, retry_version: retryVersion(exercise), revision: row.revision + 1 });
    }
  }
}
