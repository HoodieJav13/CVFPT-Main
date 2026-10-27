// Synthetic in-process API for the small-group conductor tests (fictional
// data only). Mirrors the contracts the conductor uses, as implemented by the
// real routes: Quick Session create with request-id replay and fingerprint
// mismatch, coach start (started / resumed / conflict / already_completed),
// set PATCH, extra set with client_operation_id dedupe, complete, abandon.
// It is NOT the real Auth/API/DB and proves nothing about server privacy.

export const COACH = { id: 'fict-coach-g1', name: 'Fictional Coach G1', email: 'coach-g1@example.invalid', is_admin: false };
export const TRAINEES = [
  { id: 'fict-trainee-ana', name: 'Ana Fictional' },
  { id: 'fict-trainee-ben', name: 'Ben Fictional' },
  { id: 'fict-trainee-cam', name: 'Cam Fictional' },
  { id: 'fict-trainee-dee', name: 'Dee Fictional' },
  { id: 'fict-trainee-eli', name: 'Eli Fictional (substitute)' },
].map((row) => ({ ...row, coach_id: COACH.id, email: `${row.id}@example.invalid`, archived: false, invited: true }));
export const LIBRARY = [
  { id: 'fict-lib-goblet', name: 'Goblet Squat' },
  { id: 'fict-lib-bench', name: 'Barbell Bench Press' },
  { id: 'fict-lib-row', name: 'Cable Row' },
  { id: 'fict-lib-pushup', name: 'Push-up' },
  { id: 'fict-lib-dbbench', name: 'DB Bench Press' },
].map((row) => ({ ...row, archived: false, hidden: false }));

export class HttpError extends Error {
  constructor(status, data) {
    super(`HTTP ${status}`);
    this.response = { status, data };
  }
}
export const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

export function createGroupServer() {
  const db = { assignments: [], logs: [], requests: [], faults: [], seq: 0, activeOther: new Set(), groups: [], conflicts: [], events: new Map() };
  const nextId = (prefix) => `${prefix}-${++db.seq}`;
  const fingerprint = (body) => JSON.stringify({ ...body, request_id: undefined });

  function logView(log) {
    return { ...log, exercises: log.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => ({ ...set })) })) };
  }

  // fault: { method, path (RegExp), mode: 'drop-reply' | 'no-reach' | 'status', status, times }
  function takeFault(method, path) {
    const fault = db.faults.find((row) => row.method === method && row.path.test(path) && row.times > 0);
    if (fault) fault.times -= 1;
    return fault || null;
  }

  function handle(method, path, body = {}) {
    if (method === 'GET' && path === '/auth/me') return { role: 'coach', email: COACH.email, profile: COACH };
    if (method === 'GET' && path === '/clients') return TRAINEES;
    if (method === 'GET' && path === '/programs/exercise-library') return LIBRARY;
    // Coach-only conductor record (pt-session-events/v1 §4), minimal mirror.
    if (method === 'GET' && path === '/group-sessions/open') return { sessions: db.groups.filter((row) => row.status === 'open') };
    if (method === 'POST' && path === '/group-sessions') {
      const existing = db.groups.find((row) => row.id === body.id);
      if (existing) return { outcome: 'replayed', session: existing };
      const row = { id: body.id, title: body.title, mode: body.mode, participants: body.participant_ids, station_state: body.station_state || null, status: 'open', revision: 0 };
      db.groups.push(row);
      return { outcome: 'created', session: row };
    }
    let group = path.match(/^\/group-sessions\/([^/]+)$/);
    if (method === 'PATCH' && group) {
      const row = db.groups.find((item) => item.id === group[1]);
      if (!row) throw new HttpError(404, { error: 'Session not found' });
      if (row.revision !== body.base_revision) throw new HttpError(409, { error: 'changed', session: row });
      Object.assign(row, { station_state: body.station_state ?? row.station_state, status: body.status || row.status, revision: row.revision + 1 });
      return { session: row };
    }
    if (method === 'POST' && path === '/programs/quick-sessions') {
      const receipt = db.assignments.find((row) => row.request_id === body.request_id);
      if (receipt) {
        if (receipt.hash !== fingerprint(body)) throw new HttpError(409, { state: 'request_mismatch' });
        return { state: 'replayed', assignment: receipt };
      }
      if (!TRAINEES.some((row) => row.id === body.client_id)) throw new HttpError(404, { state: 'not_found' });
      const assignment = { id: nextId('assign'), client_id: body.client_id, kind: 'quick', assigned_for: body.assigned_for, name: body.name, notes: body.notes, exercises: body.exercises, request_id: body.request_id, hash: fingerprint(body) };
      db.assignments.push(assignment);
      return { state: 'created', assignment };
    }
    if (method === 'POST' && path === '/workout-logs/start') {
      const assignment = db.assignments.find((row) => row.id === body.workout_assignment_id && row.client_id === body.client_id);
      if (!assignment) throw new HttpError(404, { error: 'Assigned workout not found' });
      const same = db.logs.find((row) => row.workout_assignment_id === assignment.id);
      if (same?.status === 'completed') throw new HttpError(409, { error: 'This dated workout has already been completed', workout_log: logView(same) });
      if (same?.status === 'active') return { outcome: 'resumed', workout_log: logView(same) };
      if (db.activeOther.has(body.client_id) || db.logs.some((row) => row.client_id === body.client_id && row.status === 'active')) {
        throw new HttpError(409, { error: 'Finish or abandon your active workout first', active_workout: { id: 'other' } });
      }
      const exercise = assignment.exercises[0];
      const logExerciseId = nextId('logex');
      const log = {
        id: nextId('log'), client_id: body.client_id, workout_assignment_id: assignment.id, status: 'active', started_by_coach_id: COACH.id,
        exercises: [{
          id: logExerciseId, exercise_name: exercise.custom_name || exercise.exercise_library_id, prescribed_reps: exercise.reps,
          sets: Array.from({ length: Number(exercise.sets) }, (_, index) => ({ id: nextId('set'), workout_log_exercise_id: logExerciseId, set_number: index + 1, set_origin: 'prescribed', status: 'pending', actual_reps: null, actual_load_value: null, actual_load_unit: null, client_operation_id: null, archived: false })),
        }],
      };
      db.logs.push(log);
      return { outcome: 'started', workout_log: logView(log) };
    }
    let match = path.match(/^\/workout-logs\/([^/]+)$/);
    if (method === 'GET' && match) {
      const log = db.logs.find((row) => row.id === match[1]);
      if (!log) throw new HttpError(404, { error: 'Workout log not found' });
      return logView(log);
    }
    match = path.match(/^\/workout-logs\/([^/]+)\/sets\/([^/]+)$/);
    if (method === 'PATCH' && match) {
      const log = db.logs.find((row) => row.id === match[1]);
      if (!log) throw new HttpError(404, { error: 'Workout log not found' });
      const set = log.exercises.flatMap((row) => row.sets).find((row) => row.id === match[2]);
      if (log.status !== 'active') {
        // pt-session-events/v1 (apply_workout_set_event): a contract write to a
        // finished log is kept as a disagreement for the coach and never changes
        // the logged set; a legacy write (no event_id) is refused.
        if (!body.event_id) throw new HttpError(409, { error: 'Workout is not active' });
        if (!set) throw new HttpError(404, { error: 'Workout set not found' });
        const seen = db.events.get(body.event_id);
        if (seen) return { ...set, event: { id: body.event_id, outcome: 'replayed', original_outcome: seen.outcome, conflict_id: seen.conflictId } };
        const incoming = { status: body.status, actual_reps: body.actual_reps, actual_load_value: body.actual_load_value, actual_load_unit: body.actual_load_unit };
        const same = Object.entries(incoming).every(([key, value]) => (set[key] ?? null) === (value ?? null));
        const conflictId = same ? null : nextId('conflict');
        if (!same) db.conflicts.push({ id: conflictId, logId: log.id, setId: set.id, eventId: body.event_id, baseRevision: body.base_revision, incoming });
        db.events.set(body.event_id, { outcome: same ? 'unchanged' : 'conflict', conflictId });
        return { ...set, event: { id: body.event_id, outcome: same ? 'unchanged' : 'conflict', conflict_id: conflictId } };
      }
      if (!set) throw new HttpError(404, { error: 'Workout set not found' });
      Object.assign(set, { status: body.status, actual_reps: body.actual_reps, actual_load_value: body.actual_load_value, actual_load_unit: body.actual_load_unit, revision: (set.revision || 0) + 1 });
      return { ...set, event: body.event_id ? { id: body.event_id, outcome: 'applied' } : undefined };
    }
    match = path.match(/^\/workout-logs\/([^/]+)\/exercises\/([^/]+)\/sets$/);
    if (method === 'POST' && match) {
      const log = db.logs.find((row) => row.id === match[1]);
      if (!log || log.status !== 'active') throw new HttpError(409, { error: 'Workout is not active' });
      const exercise = log.exercises.find((row) => row.id === match[2]);
      if (!exercise) throw new HttpError(404, { error: 'Workout exercise not found' });
      const existing = exercise.sets.find((row) => row.client_operation_id === body.client_operation_id);
      if (existing) return { ...existing };
      const set = { id: nextId('set'), workout_log_exercise_id: exercise.id, set_number: Math.max(...exercise.sets.map((row) => row.set_number)) + 1, set_origin: 'extra', status: 'pending', actual_reps: null, actual_load_value: null, actual_load_unit: null, client_operation_id: body.client_operation_id, archived: false };
      exercise.sets.push(set);
      return { ...set };
    }
    match = path.match(/^\/workout-logs\/([^/]+)\/(complete|abandon)$/);
    if (method === 'POST' && match) {
      const log = db.logs.find((row) => row.id === match[1]);
      if (!log) throw new HttpError(404, { error: 'Workout log not found' });
      if (match[2] === 'complete') {
        if (!log.exercises.some((row) => row.sets.some((set) => set.status === 'completed'))) throw new HttpError(400, { error: 'Complete at least one set' });
        log.status = 'completed';
      } else log.status = 'abandoned';
      return logView(log);
    }
    throw new HttpError(404, { error: `Synthetic route missing: ${method} ${path}` });
  }

  // Applies faults: 'no-reach' fails before the write, 'drop-reply' performs
  // the write and then loses the reply, 'status' answers with an error.
  function request(method, path, body) {
    db.requests.push({ method, path, body: body ? JSON.parse(JSON.stringify(body)) : null });
    const fault = takeFault(method, path);
    if (fault?.mode === 'no-reach') throw networkError();
    if (fault?.mode === 'status') throw new HttpError(fault.status, { error: 'Synthetic failure' });
    const result = handle(method, path, body);
    if (fault?.mode === 'drop-reply') throw networkError();
    return result;
  }

  // axios-shaped client for unit tests.
  const api = {
    get: async (path) => ({ data: request('GET', path) }),
    post: async (path, body) => ({ data: request('POST', path, body) }),
    patch: async (path, body) => ({ data: request('PATCH', path, body) }),
  };

  return { db, api, request, fault: (row) => db.faults.push({ times: 1, ...row }) };
}
