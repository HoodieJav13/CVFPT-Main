import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ackedSetRow, deliveredBy, isWriteBlocked, markRecheck, metricWriteAcknowledged, nextSendable, optimisticSetData, reconcileAddedSet, reconcileQueuedSet, replyRow, rewritePendingSetId } from '@/lib/workoutSync';

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
      sets: exercise.sets.map((set) => set.id === operation.setId ? { ...set, ...optimisticSetData(set, operation.data) } : set),
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

// Entries the server can no longer accept because the workout was finished
// (e.g. by the coach) before this device reconnected. They are kept on the
// device and shown, never silently deleted (review P2-1). Set values on
// existing sets do reach the server as a disagreement for the coach.
export function undeliveredStorageKey(logId) {
  return `cvf_workout_undelivered_${logId}`;
}

export function readUndelivered(logId) {
  try { return JSON.parse(localStorage.getItem(undeliveredStorageKey(logId)) || '[]'); } catch { return []; }
}

function dropUndelivered(logId, operationId) {
  try {
    const rows = readUndelivered(logId).filter((row) => row.id !== operationId);
    if (rows.length) localStorage.setItem(undeliveredStorageKey(logId), JSON.stringify(rows));
    else localStorage.removeItem(undeliveredStorageKey(logId));
  } catch { /* nothing kept */ }
}

function keepUndelivered(logId, operation) {
  try {
    const rows = readUndelivered(logId).filter((row) => row.id !== operation.id);
    rows.push({ ...operation, kept_at: new Date().toISOString() });
    localStorage.setItem(undeliveredStorageKey(logId), JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
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

// A queued write is parked for the person's choice (F6): only the tracker can resolve it.
export function hasParkedFor(logId) {
  return readQueue(logId).some((operation) => operation.parked);
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

// A rebuilt set write refused because its event id is bound to the first
// request it was sent as (apply_workout_set_event_v3; LOOK-A-INTEGRATION-REVIEW
// case 1). Only a rebuilt write, only once, only for that refusal.
export function isRebuiltReuse(operation, status, error) {
  return operation?.kind === 'set' && status === 409 && Boolean(operation.original) && !operation.resentOriginal
    && error?.response?.data?.error === 'That event id belongs to another set';
}

// Writes after a released/dropped one for the same set are re-checked against the next reply.
function markRecheckAfter(queue, operation) {
  const at = queue.findIndex((queued) => queued.id === operation.id);
  return queue.map((queued, index) => ((at < 0 || index > at) && queued.setId === operation.setId
    ? { ...queued, parked: false, recheck: true } : queued));
}

export function useWorkoutOutbox(logId, setLog, { onCompleteSynced, onCompleteRejected, getLog, onConflict, onSetSaved, onSetDropped, onParked } = {}) {
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
  const keptNoticeRef = useRef(false);
  const conflictRef = useRef(onConflict);
  const setSavedRef = useRef(onSetSaved);
  setSavedRef.current = onSetSaved;
  const setDroppedRef = useRef(onSetDropped);
  setDroppedRef.current = onSetDropped;
  const parkedRef = useRef(onParked);
  parkedRef.current = onParked;
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
    // The server's current row per set, from this run's set replies (F5).
    const knownRows = new Map();
    try {
      for (;;) {
        let operation = nextSendable(queueRef.current);
        if (!operation) break;
        setSaveState('saving');
        if (operation.recheck) {
          // Queued before a replayed reply for its set (F5): re-checked against
          // the server's current row before it is sent, never sent stale.
          const row = knownRows.get(operation.setId);
          if (row && deliveredBy(row, operation)) {
            // The server's current row names this very event as its last
            // write: another tab (or a lost reply) already delivered it. It is
            // acknowledged as saved and not sent again, so no copy bound
            // differently can be refused (LOOK-A-INTEGRATION-REVIEW residual
            // case 1). Its id and its Undo record are the server's, unchanged.
            persist(queueRef.current.filter((queued) => queued.id !== operation.id));
            const reply = { ...row, event: { id: operation.data.event_id, outcome: 'replayed', original_outcome: 'applied', conflict_id: null, change: null } };
            setLog((current) => updateExercise(current, operation.exerciseId, (exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) => (set.id === operation.setId ? ackedSetRow(set, reply) : set)),
            })));
            setSavedRef.current?.(operation, reply);
            continue;
          }
          const decision = row ? reconcileQueuedSet(operation, row) : null;
          if (!decision || decision.action !== 'send') {
            const parked = { ...operation, parked: true };
            persist(queueRef.current.map((queued) => (queued.id === operation.id ? parked : queued)));
            parkedRef.current?.(parked);
            continue;
          }
          // The exact first request is kept: if another tab already delivered
          // it, the server knows this event id only by that request.
          const ready = { ...operation, data: decision.data, recheck: false, original: operation.original || operation.data };
          persist(queueRef.current.map((queued) => (queued.id === operation.id ? ready : queued)));
          setLog((current) => applyOptimistic(current, ready));
          operation = ready;
        }
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
            const current = replyRow(data);
            if (current) knownRows.set(operation.setId, current);
            // A replay means this screen's copy of the set may be older than the
            // server's: every write still queued for it is re-checked first.
            if (outcome === 'replayed') persist(markRecheck(queueRef.current, operation.setId));
            // Keep the values on screen; adopt the server's revision so the next
            // write is based on what the server now holds (an applied reply
            // only: see ackedSetRow).
            setLog((current) => updateExercise(current, operation.exerciseId, (exercise) => ({
              ...exercise,
              sets: exercise.sets.map((set) => (set.id === operation.setId ? ackedSetRow(set, data) : set)),
            })));
            if (outcome === 'conflict' || (outcome === 'replayed' && data.event.original_outcome === 'conflict')) conflictRef.current?.(data);
            // The acknowledged operation (its queue id) and the server's answer.
            setSavedRef.current?.(operation, data);
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
          if (isRebuiltReuse(operation, status, error)) {
            // Duplicate drain (two tabs, one saved queue): the server refused
            // the rebuilt copy because this event id is already bound to the
            // first request, which another tab delivered. Send that exact
            // request once; the server answers it "replayed" with the current
            // row, so nothing is written twice and nothing is dropped. If it
            // is refused too, the ordinary rejection below applies.
            persist(queueRef.current.map((queued) => (queued.id === operation.id
              ? { ...queued, data: operation.original, original: null, resentOriginal: true } : queued)));
            continue;
          }
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            // Keep the entry on the device BEFORE it leaves the queue, so there
            // is no moment (an app close, a reload) where it exists nowhere.
            const keptFirst = operation.kind !== 'complete' && keepUndelivered(logId, operation);
            const remaining = queueRef.current.filter((queued) => queued.id !== operation.id);
            persist(remaining);
            // The server refused this operation: it will never be acknowledged,
            // so anything waiting on its acknowledgement is told now, in step
            // with leaving the queue.
            if (operation.kind === 'set') setDroppedRef.current?.(operation);
            let fresh = null;
            try {
              const { data } = await api.get(`/workout-logs/${logId}`);
              fresh = data;
              setLog(remaining.reduce((current, queued) => applyOptimistic(current, queued), data));
            } catch {
              // The failed write is still removed; a later page reload reconciles server state.
            }
            if (operation.kind !== 'complete' && ((fresh && fresh.status !== 'active') || (!fresh && (status === 409 || String(operation.setId || '').startsWith('pending-'))))) {
              // Finished elsewhere first: the performance stays on this device.
              if (!keptNoticeRef.current) {
                keptNoticeRef.current = true;
                toast.message('This workout was finished before your entries synced. They are kept on this phone; set values went to your coach to review.');
              }
              continue;
            }
            // Still active: an ordinary rejection (bad value), as before.
            if (keptFirst) dropUndelivered(logId, operation.id);
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
      // Anything left is parked, waiting for the person's choice or a fresh read.
      const waiting = queueRef.current.length > 0;
      setSaveState(waiting ? 'not_saved' : 'saved');
      return !waiting;
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
    // Behind a parked or re-checked write for the same set, it is re-checked too (F5).
    const behind = target.setId && queueRef.current.some((op) => op.setId === target.setId && (op.parked || op.recheck));
    const queued = { id: queueId, attempts: 0, ...enveloped, ...(behind ? { recheck: true } : {}) };
    persist([...queueRef.current, queued]);
    setLog((current) => applyOptimistic(current, queued));
    setSaveState('saving');
    window.setTimeout(() => flush(), 0);
    // Truthy as before; the queue id lets a caller recognise this operation's acknowledgement.
    return queueId;
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

  // Parked/re-check writes that are first in the queue for their set: the
  // ones a fresh read may decide (F5).
  const decidable = useCallback(() => queueRef.current.filter((operation, index) => (operation.parked || operation.recheck)
    && !queueRef.current.slice(0, index).some((earlier) => earlier.setId && earlier.setId === operation.setId)), []);
  const replaceQueued = useCallback((operationId, change) => {
    const target = queueRef.current.find((operation) => operation.id === operationId);
    if (!target) return null;
    const next = change(target);
    persist(next ? queueRef.current.map((operation) => (operation.id === operationId ? next : operation))
      : queueRef.current.filter((operation) => operation.id !== operationId));
    return { target, next };
  }, [persist]);
  // Send this write with these (reconciled or explicitly chosen) values; later
  // writes for the set are re-checked against its reply.
  const releaseParked = useCallback((operationId, data) => {
    const result = replaceQueued(operationId, (operation) => ({ ...operation, data, parked: false, recheck: false, original: operation.original || operation.data }));
    if (!result) return;
    persist(markRecheckAfter(queueRef.current, result.next));
    setLog((current) => applyOptimistic(current, result.next));
  }, [persist, replaceQueued, setLog]);
  // The person chose the saved values and nothing is left to write.
  const dropParked = useCallback((operationId) => {
    const result = replaceQueued(operationId, () => null);
    if (!result) return;
    persist(markRecheckAfter(queueRef.current, result.target));
    setDroppedRef.current?.(result.target);
  }, [persist, replaceQueued]);

  return {
    enqueue,
    flush,
    decidable,
    releaseParked,
    dropParked,
    hasParked: (setId) => queueRef.current.some((operation) => operation.setId === setId && operation.parked),
    isWaiting: (setId) => queueRef.current.some((operation) => operation.setId === setId && (operation.parked || operation.recheck)),
    // Anything parked or waiting for a re-check (F6): a queued Finish cannot sync before it.
    hasWaitingAny: () => queueRef.current.some((operation) => operation.parked || operation.recheck),
    // Whether an operation (by queue id) is still waiting to be sent or acknowledged.
    isQueued: (operationId) => queueRef.current.some((operation) => operation.id === operationId),
    hydrate,
    saveState,
    online,
    queuedComplete,
    removeQueuedComplete,
    markDirty: () => setSaveState('not_saved'),
  };
}
