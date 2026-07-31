import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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
          actual_reps: null,
          actual_rpe: null,
          archived: false,
        }],
      };
    });
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

export function useWorkoutOutbox(logId, setLog, { onCompleteSynced, onCompleteRejected } = {}) {
  const storageKey = outboxStorageKey(logId);
  const initial = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  }, [storageKey]);
  const queueRef = useRef(initial);
  const processingRef = useRef(false);
  const retryRef = useRef(null);
  const syncedRef = useRef(onCompleteSynced);
  const rejectedRef = useRef(onCompleteRejected);
  syncedRef.current = onCompleteSynced;
  rejectedRef.current = onCompleteRejected;
  const [saveState, setSaveState] = useState(initial.length ? 'not_saved' : 'saved');
  const [online, setOnline] = useState(navigator.onLine);
  const [queuedComplete, setQueuedComplete] = useState(initial.some((operation) => operation.kind === 'complete'));

  const persist = useCallback((queue) => {
    queueRef.current = queue;
    if (queue.length) localStorage.setItem(storageKey, JSON.stringify(queue));
    else localStorage.removeItem(storageKey);
    setQueuedComplete(queue.some((operation) => operation.kind === 'complete'));
  }, [storageKey]);

  const flush = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) {
      setSaveState('not_saved');
      return false;
    }
    processingRef.current = true;
    window.clearTimeout(retryRef.current);
    try {
      while (queueRef.current.length) {
        setSaveState('saving');
        const operation = queueRef.current[0];
        try {
          const { data } = await api.request({ method: operation.method, url: operation.url, data: operation.data });
          if (operation.kind === 'add') {
            const pendingId = `pending-${operation.clientOperationId}`;
            setLog((current) => updateExercise(current, operation.exerciseId, (exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) => set.client_operation_id === operation.clientOperationId ? data : set),
            })));
            queueRef.current = queueRef.current.map((queued) => queued.setId === pendingId ? {
              ...queued,
              setId: data.id,
              url: queued.url.replace(pendingId, data.id),
            } : queued);
          }
          persist(queueRef.current.filter((queued) => queued.id !== operation.id));
          if (operation.kind === 'complete') {
            setLog(() => data);
            syncedRef.current?.(data);
          }
        } catch (error) {
          const status = error?.response?.status;
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
      processingRef.current = false;
    }
  }, [logId, persist, setLog]);

  const enqueue = useCallback((operation) => {
    const queued = { id: makeId(), attempts: 0, ...operation };
    persist([...queueRef.current, queued]);
    setLog((current) => applyOptimistic(current, queued));
    setSaveState('saving');
    window.setTimeout(() => flush(), 0);
  }, [flush, persist, setLog]);

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
