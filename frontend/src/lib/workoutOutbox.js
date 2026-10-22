import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isWriteBlocked, metricWriteAcknowledged, reconcileAddedSet, rewritePendingSetId } from '@/lib/workoutSync';

/**
 * Offline outbox for workout writes (docs/offline-workout-completion.md).
 * Extracted from WorkoutTracker so the workout detail page can drain a
 * queued completion after navigation. FIFO with head-blocking retry: a
 * queued 'complete' operation is only ever sent once everything queued
 * before it has landed.
 */

export function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function updateExercise(log, exerciseId, updater) {
  if (!log) return log;
  return { ...log, exercises: log.exercises.map((exercise) => exercise.id === exerciseId ? updater(exercise) : exercise) };
}

export function applyOptimistic(log, operation) {
  if (!log) return log;
  if (operation.kind === 'set') {
    return updateExercise(log, operation.exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === operation.setId ? { ...set, ...operation.data } : set),
    }));
  }
  if (operation.kind === 'note') {
    return updateExercise(log, operation.exerciseId, (exercise) => ({ ...exercise, client_notes: operation.data.client_notes }));
  }
  if (operation.kind === 'add') {
    return updateExercise(log, operation.exerciseId, (exercise) => {
      if (exercise.sets.some((set) => set.client_operation_id === operation.clientOperationId)) return exercise;
      const setNumber = Math.max(0, ...exercise.sets.map((set) => set.set_number)) + 1;
      return {
        ...exercise,
        sets: [...exercise.sets, {
          id: `pending-${operation.clientOperationId}`,
          client_operation_id: operation.clientOperationId,
          workout_log_exercise_id: exercise.id,
          set_number: setNumber,
          set_origin: 'extra',
          status: 'pending',
          actual_load_value: exercise.prescribed_load_value,
          actual_load_unit: exercise.prescribed_load_unit,
          actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
          actual_reps: null,
          actual_rpe: null,
          archived: false,
        }],
      };
    });
  }
  if (operation.kind === 'substitute') {
    // pt-session-events/v1 (PT-Sub): a swap usable now (coach backup, or
    // chosen offline) shows its replacement immediately; the original row and
    // its prescription stay as they are. An online suggestion waits for the
    // coach, so only the waiting state is shown.
    const swap = operation.swap;
    const marked = updateExercise(log, operation.exerciseId, (exercise) => ({ ...exercise, pending_swap: swap }));
    if (!swap.activate || marked.exercises.some((exercise) => exercise.id === swap.replacementId)) return marked;
    const index = marked.exercises.findIndex((exercise) => exercise.id === operation.exerciseId);
    const original = marked.exercises[index];
    const replacement = {
      id: swap.replacementId, workout_log_id: log.id, exercise_name: swap.name, exercise_library_id: swap.libraryId,
      substitutes_log_exercise_id: operation.exerciseId, substitution_id: swap.id, source_workout_exercise_id: null,
      prescribed_sets: swap.targets.sets ? String(swap.targets.sets) : null, prescribed_reps: swap.targets.reps || null,
      prescribed_load_value: swap.targets.load_value ?? null, prescribed_load_unit: swap.targets.load_value == null ? null : (swap.targets.load_unit || 'lb'),
      tracking_type: 'reps_weight', position: original?.position ?? 0, plan_revision: 0, backups: [], sets: [], local_only: true,
    };
    const exercises = [...marked.exercises];
    exercises.splice(index + 1, 0, replacement);
    return { ...marked, exercises };
  }
  if (operation.kind === 'archive') {
    return updateExercise(log, operation.exerciseId, (exercise) => ({
      ...exercise,
      sets: exercise.sets.filter((set) => set.id !== operation.setId),
    }));
  }
  // 'complete' is not applied optimistically to the log body: the log stays
  // active locally (finished-locally is derived from queue contents) until
  // the server confirms — we do not celebrate unsynced data.
  return log;
}

export function outboxStorageKey(logId) {
  return `cvf_workout_outbox_${logId}`;
}

function readQueue(logId) {
  try { return JSON.parse(localStorage.getItem(outboxStorageKey(logId)) || '[]'); } catch { return []; }
}

/** True when a finish confirmation is persisted and waiting to sync. */
export function hasQueuedCompleteFor(logId) {
  return readQueue(logId).some((operation) => operation.kind === 'complete');
}

// pt-session-events/v1: every set write carries an idempotency id, the set
// revision this device last saw, a per-device sequence and whether it was made
// offline, so the server can replay safely and keep (never overwrite) a value
// someone else changed meanwhile (L12/CONTRACT.md §1).
function nextLocalSeq(logId) {
  const key = `cvf_workout_seq_${logId}`;
  let value = 0;
  try { value = Number(localStorage.getItem(key)) || 0; localStorage.setItem(key, String(value + 1)); } catch { /* sequence is advisory */ }
  return value + 1;
}

export function setEventEnvelope(log, operation, eventId, logId) {
  const exercise = log?.exercises?.find((row) => row.id === operation.exerciseId);
  const set = exercise?.sets?.find((row) => row.id === operation.setId);
  return {
    event_id: eventId,
    base_revision: Number.isInteger(set?.revision) ? set.revision : 0,
    local_seq: nextLocalSeq(logId),
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
    plan_revision_seen: Number.isInteger(exercise?.plan_revision) ? exercise.plan_revision : 0,
  };
}

export function useWorkoutOutbox(logId, setLog, { onCompleteSynced, onCompleteRejected, getLog, onConflict } = {}) {
  const storageKey = outboxStorageKey(logId);
  const initial = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  }, [storageKey]);
  const queueRef = useRef(initial);
  const inFlightRef = useRef(null);
  const retryRef = useRef(null);
  // pending-<operation> id -> real set id, for writes enqueued by a render
  // that still held the pending id when the add landed.
  const resolvedIdsRef = useRef(new Map());
  const syncedRef = useRef(onCompleteSynced);
  const rejectedRef = useRef(onCompleteRejected);
  const getLogRef = useRef(getLog);
  const conflictRef = useRef(onConflict);
  syncedRef.current = onCompleteSynced;
  rejectedRef.current = onCompleteRejected;
  getLogRef.current = getLog;
  conflictRef.current = onConflict;
  const [saveState, setSaveState] = useState(initial.length ? 'not_saved' : 'saved');
  const [online, setOnline] = useState(navigator.onLine);
  const [queuedComplete, setQueuedComplete] = useState(initial.some((operation) => operation.kind === 'complete'));

  const persist = useCallback((queue) => {
    queueRef.current = queue;
    if (queue.length) localStorage.setItem(storageKey, JSON.stringify(queue));
    else localStorage.removeItem(storageKey);
    setQueuedComplete(queue.some((operation) => operation.kind === 'complete'));
  }, [storageKey]);

  const flush = useCallback(() => {
    // A caller awaiting flush() during an in-progress run (e.g. finish()
    // right after a blur save) joins that run instead of getting a false
    // "offline" verdict while fully online.
    if (inFlightRef.current) return inFlightRef.current;
    if (!navigator.onLine) {
      setSaveState('not_saved');
      return Promise.resolve(false);
    }
    window.clearTimeout(retryRef.current);
    let finished = false;
    const run = (async () => {
    try {
      while (queueRef.current.length) {
        setSaveState('saving');
        const operation = queueRef.current[0];
        try {
          const { data } = await api.request({ method: operation.method, url: operation.url, data: operation.data });
          const outcome = data?.event?.outcome;
          if (operation.kind === 'set' && (!outcome || outcome === 'applied') && !metricWriteAcknowledged(operation.data, data)) {
            const error = new Error('The server did not acknowledge your metrics. They are kept on this device; retry after the app update.');
            error.metricAcknowledgementMissing = true;
            throw error;
          }
          if (operation.kind === 'add') {
            const pendingId = `pending-${operation.clientOperationId}`;
            resolvedIdsRef.current.set(pendingId, data.id);
            // Keep values edited on the pending row; the queued writes that
            // carry them are re-pointed at the real id below.
            setLog((current) => updateExercise(current, operation.exerciseId, (exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) => set.client_operation_id === operation.clientOperationId ? reconcileAddedSet(set, data) : set),
            })));
            queueRef.current = queueRef.current.map((queued) => rewritePendingSetId(queued, pendingId, data.id));
          }
          persist(queueRef.current.filter((queued) => queued.id !== operation.id));
          if (operation.kind === 'set' && outcome) {
            // Keep the values on screen; adopt the server's revision so the next
            // write is based on what the server now holds.
            setLog((current) => updateExercise(current, operation.exerciseId, (exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) => (set.id === operation.setId && outcome !== 'conflict'
                ? { ...set, revision: data.revision, last_actor_role: data.last_actor_role, completed_plan_revision: data.completed_plan_revision }
                : set)),
            })));
            if (outcome === 'conflict' || (outcome === 'replayed' && data.event.original_outcome === 'conflict')) conflictRef.current?.(data);
          }
          if (operation.kind === 'substitute' && data?.log) {
            const remaining = queueRef.current;
            setLog(remaining.reduce((current, queued) => applyOptimistic(current, queued), data.log));
          }
          if (operation.kind === 'complete') {
            setLog(() => data);
            syncedRef.current?.(data);
          }
        } catch (error) {
          if (error.metricAcknowledgementMissing && !operation.attempts) toast.error(error.message);
          const status = error?.response?.status;
          // An expired session (401, or the token refresh itself failing) says
          // nothing about the write: keep the queue for replay after sign-in.
          if (status === 401 || error?.config?.url?.includes('/auth/refresh')) {
            setSaveState('not_saved');
            return false;
          }
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            const remaining = queueRef.current.filter((queued) => queued.id !== operation.id);
            persist(remaining);
            let fresh = null;
            try {
              const { data } = await api.get(`/workout-logs/${logId}`);
              fresh = data;
              setLog(remaining.reduce((current, queued) => applyOptimistic(current, queued), data));
            } catch {
              // The failed write is still removed; a later page reload reconciles server state.
            }
            if (operation.kind === 'complete') {
              // Duplicate send after an ambiguous failure: already completed
              // on the server means success, not error.
              if (fresh?.status === 'completed') {
                syncedRef.current?.(fresh);
              } else {
                rejectedRef.current?.(error?.response?.data?.error || 'The workout could not be finished. It is active again.', fresh);
              }
            } else {
              toast.error(error?.response?.data?.error || 'A workout change was rejected. Check the value and try again.');
            }
            continue;
          }
          const attempts = (operation.attempts || 0) + 1;
          const updated = queueRef.current.map((queued) => queued.id === operation.id ? { ...queued, attempts } : queued);
          persist(updated);
          setSaveState('not_saved');
          const delay = Math.min(30_000, 1000 * (2 ** Math.min(attempts - 1, 5)));
          retryRef.current = window.setTimeout(() => flush(), delay);
          return false;
        }
      }
      setSaveState('saved');
      return true;
    } finally {
      finished = true;
      inFlightRef.current = null;
    }
    })();
    // An empty queue finishes synchronously, before this line: storing that
    // settled run would make every later flush() return it without sending.
    if (!finished) inFlightRef.current = run;
    return run;
  }, [logId, persist, setLog]);

  const enqueue = useCallback((operation) => {
    // A finished workout is sealed; the server would reject the write.
    if (isWriteBlocked(queueRef.current, operation)) return false;
    const resolvedId = operation.setId && resolvedIdsRef.current.get(operation.setId);
    const target = resolvedId ? rewritePendingSetId(operation, operation.setId, resolvedId) : operation;
    const queueId = makeId();
    const enveloped = target.kind === 'set' && !target.data?.event_id
      ? { ...target, data: { ...target.data, ...setEventEnvelope(getLogRef.current?.(), target, queueId, logId) } }
      : target;
    const queued = { id: queueId, attempts: 0, ...enveloped };
    persist([...queueRef.current, queued]);
    setLog((current) => applyOptimistic(current, queued));
    setSaveState('saving');
    window.setTimeout(() => flush(), 0);
    return true;
  }, [flush, logId, persist, setLog]);

  /** "Keep editing instead": a queued completion is client-local until sent. */
  const removeQueuedComplete = useCallback(() => {
    persist(queueRef.current.filter((operation) => operation.kind !== 'complete'));
    setSaveState(queueRef.current.length ? 'not_saved' : 'saved');
    if (queueRef.current.length) window.setTimeout(() => flush(), 0);
  }, [flush, persist]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); flush(); };
    const onOffline = () => { setOnline(false); setSaveState('not_saved'); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (initial.length) window.setTimeout(() => flush(), 0);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearTimeout(retryRef.current);
    };
  }, [flush, initial.length]);

  const hydrate = useCallback((log) => queueRef.current.reduce(
    (current, operation) => applyOptimistic(current, operation),
    log,
  ), []);

  return {
    enqueue,
    flush,
    hydrate,
    saveState,
    online,
    queuedComplete,
    removeQueuedComplete,
    markDirty: () => setSaveState('not_saved'),
  };
}
