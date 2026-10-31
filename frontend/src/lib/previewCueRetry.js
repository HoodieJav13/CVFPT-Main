import { cueContext, linkNextCues, mutateCue } from './cueRetry.js';

export const CUE_CLIENT_ID = 'client_cue_demo';
export const CUE_SCENARIO_KEY = 'cvf_preview_cue_retry';
const DB_NAME = 'cvf_preview_cue_retry_v1';
const KEYS = ['clients', 'programs', 'programDays', 'programAssignments', 'workouts', 'workoutExercises',
  'programAssignmentExerciseLoads', 'workoutLogs', 'workoutLogExercises', 'workoutLogSets', 'cueRetries', 'cueReceipts'];
export function cueScenarioEnabled() {
  try {
    if (new URLSearchParams(window.location.search).get('cueRetry') === '1') localStorage.setItem(CUE_SCENARIO_KEY, '1');
    return localStorage.getItem(CUE_SCENARIO_KEY) === '1';
  } catch { return false; }
}
export function seedCueScenario(state) {
  if (state.clients.some(row => row.id === CUE_CLIENT_ID)) return;
  const stamp = '2026-01-01T10:00:00.000Z';
  const base = { archived: false, created_at: stamp, updated_at: stamp };
  state.clients.push({ ...base, id: CUE_CLIENT_ID, coach_id: 'coach_marcus', name: 'Casey · Cue demo', email: 'casey.cue@example.com', invited: true, auth_user_id: 'auth_cue_demo', goals: 'Fictional local cue practice' });
  state.programs.push({ ...base, id: 'cue_program', coach_id: 'coach_marcus', client_id: CUE_CLIENT_ID, name: 'Cue retry · local demo', description: 'Fictional local practice. Stored in this browser.', frequency_days: 1, is_template: false, hidden: false });
  state.workouts.push({ ...base, id: 'cue_workout', coach_id: 'coach_marcus', client_id: CUE_CLIENT_ID, name: 'Cue practice', is_template: false, hidden: false });
  state.programDays.push({ ...base, id: 'cue_day', program_id: 'cue_program', day_number: 1, workout_id: 'cue_workout', notes: '' });
  state.programAssignments.push({ ...base, id: 'cue_assignment', program_id: 'cue_program', client_id: CUE_CLIENT_ID, client: { id: CUE_CLIENT_ID, name: 'Casey · Cue demo' } });
  const exercise = { ...state.workoutExercises.find(row => row.id === 'wex_1'), ...base, id: 'cue_source', workout_id: 'cue_workout', sets: '1', reps: '8', rest: '', rest_seconds: 0 };
  state.workoutExercises.push(exercise);
  state.workoutLogs.push({ ...base, id: 'cue_log_source', client_id: CUE_CLIENT_ID, program_assignment_id: 'cue_assignment', program_day_id: 'cue_day', workout_name: 'Cue practice', status: 'completed', started_at: stamp, completed_at: '2026-01-01T11:00:00.000Z', notes: null, feedback: null });
  state.workoutLogExercises.push({ ...base, id: 'cue_attempt_source', workout_log_id: 'cue_log_source', source_workout_exercise_id: exercise.id, exercise_library_id: exercise.exercise_library_id, exercise_name: 'Goblet Squat', prescribed_sets: '1', prescribed_reps: '8', prescribed_load_value: 30, prescribed_load_unit: 'lb', prescribed_notes: exercise.notes, prescribed_tempo: exercise.tempo, position: 0, client_notes: null });
  state.workoutLogSets.push({ ...base, id: 'cue_set_source', workout_log_id: 'cue_log_source', workout_log_exercise_id: 'cue_attempt_source', set_number: 1, set_origin: 'prescribed', status: 'completed', actual_load_value: 30, actual_load_unit: 'lb', actual_reps: 8, actual_rpe: 7, completed_at: '2026-01-01T11:00:00.000Z' });
  state.cueRetries = []; state.cueReceipts = [];
}

function selectRows(state) {
  const client = row => row.client_id === CUE_CLIENT_ID;
  const programs = state.programs.filter(client);
  const programIds = new Set(programs.map(row => row.id));
  const days = state.programDays.filter(row => programIds.has(row.program_id));
  const workouts = state.workouts.filter(client);
  const workoutIds = new Set(workouts.map(row => row.id));
  const assignments = state.programAssignments.filter(client);
  const assignmentIds = new Set(assignments.map(row => row.id));
  const logs = state.workoutLogs.filter(client);
  const logIds = new Set(logs.map(row => row.id));
  return {
    clients: state.clients.filter(row => row.id === CUE_CLIENT_ID), programs, programDays: days, programAssignments: assignments, workouts,
    workoutExercises: state.workoutExercises.filter(row => workoutIds.has(row.workout_id)),
    programAssignmentExerciseLoads: state.programAssignmentExerciseLoads.filter(row => assignmentIds.has(row.program_assignment_id)),
    workoutLogs: logs, workoutLogExercises: state.workoutLogExercises.filter(row => logIds.has(row.workout_log_id)),
    workoutLogSets: state.workoutLogSets.filter(row => logIds.has(row.workout_log_id)),
    cueRetries: state.cueRetries || [], cueReceipts: state.cueReceipts || [],
  };
}
export const cueSnapshot = state => structuredClone(selectRows(state));
function restore(state, data) {
  const previous = selectRows(state);
  for (const key of KEYS) {
    const ids = new Set(previous[key].map(row => row.id));
    state[key] = (state[key] || []).filter(row => !ids.has(row.id));
    // Cue collections are exclusively owned by this isolated scenario.
    if (key === 'cueRetries' || key === 'cueReceipts') state[key] = [];
    state[key].push(...structuredClone(data[key]));
  }
}
function validEnvelope(value) {
  return value && value.schema === 1 && Number.isInteger(value.revision) && value.revision >= 1
    && KEYS.every(key => Array.isArray(value.data?.[key]));
}
function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('scenario');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Local cue storage is blocked by another window. Close it and reload.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export function readCueStore(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scenario', 'readonly');
    const request = tx.objectStore('scenario').get('current');
    tx.oncomplete = () => {
      if (request.result && !validEnvelope(request.result)) reject(new Error('Local cue data has an unsupported format. No data was replaced.'));
      else resolve(request.result || null);
    };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Cannot read local cue storage'));
  });
}
export function commitCueStore(db, expectedRevision, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scenario', 'readwrite');
    const store = tx.objectStore('scenario');
    const request = store.get('current');
    let conflict = false;
    request.onsuccess = () => {
      if ((request.result?.revision || 0) !== expectedRevision) { conflict = true; tx.abort(); return; }
      try { store.put({ schema: 1, revision: expectedRevision + 1, data }, 'current'); }
      catch { tx.abort(); }
    };
    tx.oncomplete = () => resolve(expectedRevision + 1);
    tx.onabort = tx.onerror = () => reject(Object.assign(new Error(conflict
      ? 'Local training changed in another tab. Reload and review before retrying.'
      : 'Could not save local training. Check browser storage, then reload and retry.'), { status: conflict ? 409 : 503 }));
  });
}

// This adapter exists only inside the double-gated preview module. It is not
// a backend security boundary. All durable data is fictional and origin-local.
export async function createPreviewCueRetry(state) {
  if (!cueScenarioEnabled()) return null;
  seedCueScenario(state);
  let db, storageError;
  try {
    db = await openStore();
    let saved = await readCueStore(db);
    if (!saved) {
      try { await commitCueStore(db, 0, cueSnapshot(state)); }
      catch (error) { if (error.status !== 409) throw error; }
      saved = await readCueStore(db);
    }
    restore(state, saved.data);
  } catch (error) { storageError = error; }
  let queue = Promise.resolve();
  return {
    handle(config, method, path, payload, actor, ok, fail) {
      const match = path.match(/^\/workout-logs\/([^/]+)\/exercises\/([^/]+)\/cue-retry$/);
      if (!match || !['get', 'post'].includes(method)) return undefined;
      if (storageError) return fail(config, 503, 'Local cue storage is unavailable. Nothing can be saved. Enable browser storage and reload.');
      try {
        const log = state.workoutLogs.find(row => row.id === match[1] && row.client_id === CUE_CLIENT_ID);
        if (!log) return fail(config, 404, 'Local exercise attempt not found');
        return ok(method === 'get' ? cueContext(state, actor, match[1], match[2])
          : mutateCue(state, actor, match[1], match[2], payload), config);
      } catch (error) { return fail(config, error.status || 500, error.message); }
    },
    link(logId) { linkNextCues(state, logId); },
    wrap(adapter, fail) {
      return config => {
        const run = async () => {
          const before = structuredClone(state);
          let saved;
          try {
            if (!storageError) {
              saved = await readCueStore(db);
              restore(state, saved.data);
            }
            const response = await adapter(config);
            const after = cueSnapshot(state);
            const previous = saved?.data || cueSnapshot(before);
            if (JSON.stringify(after) !== JSON.stringify(previous)) {
              if (storageError) throw Object.assign(new Error('Local storage is unavailable. No training changes were saved. Reload and retry.'), { status: 503 });
              await commitCueStore(db, saved.revision, after);
            }
            return response;
          } catch (error) {
            // Restore all fixture state after failure; don't acknowledge a save
            // that only happened in memory. The next call re-reads durable data.
            Object.keys(state).forEach(key => { delete state[key]; }); Object.assign(state, before);
            if (error.response) throw error;
            return fail(config, error.status || 503, error.message || 'Local storage unavailable. Reload and retry.');
          }
        };
        const pending = queue.then(run, run);
        queue = pending.catch(() => {});
        return pending;
      };
    },
  };
}
