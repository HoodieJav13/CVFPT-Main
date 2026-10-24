// Small-group conductor: writes each visit's sets to that trainee's OWN
// Quick Session workout log through the existing coach APIs. No new routes.
//
// Retry safety (write-ahead: ids are stored before any request is sent):
//   * Quick Session create replays by its frozen request_id and body.
//   * Start resumes the same assignment's log (or reports it completed).
//   * Prescribed sets are PATCHed by set id: re-sending the same values is
//     idempotent. Extra sets are added with a stored client_operation_id that
//     the server deduplicates.
//   * Every log is checked to belong to the visit's trainee before any write.
import {
  updateVisit, updateVisitSet, visitsForRound,
} from './groupSession.js';

const CLOSED = new Set(['completed', 'abandoned', 'missing']);

function status(error) {
  return error?.response?.status ?? null;
}

function message(error, fallback) {
  return error?.response?.data?.error || fallback;
}

function retryable(error) {
  const code = status(error);
  return code === null || code === 408 || code === 429 || code >= 500;
}

function sameEntry(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

// Maps the server log onto the visit: prescribed sets by set number, extras
// by operation id. Server-saved values win over nothing; a local entry that
// differs from the server stays pending so it is re-sent.
export function reconcileVisitWithLog(visit, log) {
  const exercise = (log.exercises || [])[0];
  const serverSets = (exercise?.sets || []).filter((set) => !set.archived);
  const sets = visit.sets.map((set) => {
    const server = set.origin === 'extra'
      ? serverSets.find((row) => row.client_operation_id === set.operationId)
      : serverSets.find((row) => row.set_origin !== 'extra' && row.set_number === set.setNumber);
    if (!server) return set;
    const next = { ...set, setId: server.id, serverRevision: server.revision ?? set.serverRevision ?? 0 };
    if (server.status === 'completed') {
      const serverEntry = {
        reps: server.actual_reps ?? null,
        load: server.actual_load_value == null ? null : Number(server.actual_load_value),
        unit: server.actual_load_value == null ? null : (server.actual_load_unit || 'lb'),
      };
      if (!set.entry) return { ...next, entry: serverEntry, state: 'saved', error: null };
      if (sameEntry(set.entry, serverEntry)) return { ...next, state: 'saved', error: null };
    }
    return next;
  });
  const logStatus = log.status === 'completed' ? 'completed' : log.status === 'abandoned' ? 'abandoned' : 'active';
  return { ...visit, logId: log.id, logExerciseId: exercise?.id || null, sets, status: logStatus, error: null };
}

export function createGroupSessionSync({ api, getSession, commit }) {
  const chains = new Map();

  // One request sequence per visit, so a double tap can never race a create.
  function serial(key, task) {
    const previous = chains.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    chains.set(key, next.finally(() => { if (chains.get(key) === next) chains.delete(key); }));
    return next;
  }

  const visitOf = (key) => getSession()?.visits?.[key] || null;
  const setError = (key, error, extra = {}) => commit((session) => updateVisit(session, key, (visit) => ({ ...visit, error, ...extra })));

  async function ensureStarted(key) {
    let visit = visitOf(key);
    if (!visit) throw new Error('This entry is no longer part of the session.');
    if (visit.logId || CLOSED.has(visit.status)) return visit;
    commit((session) => updateVisit(session, key, (row) => ({ ...row, status: 'creating', error: null })));
    if (!visit.assignmentId) {
      try {
        const { data } = await api.post('/programs/quick-sessions', visit.body);
        const assignmentId = data?.assignment?.id;
        if (!assignmentId) throw new Error('missing assignment');
        commit((session) => updateVisit(session, key, (row) => ({ ...row, assignmentId })));
      } catch (error) {
        const code = status(error);
        const state = error?.response?.data?.state;
        const text = code === 409 && state === 'request_mismatch'
          ? 'This station record changed after it was first sent. Nothing was overwritten.'
          : code === 404 || code === 403
            ? `${visit.traineeName} is not available to you any more. Nothing was saved for them here.`
            : retryable(error) ? `Not saved yet for ${visit.traineeName}: no answer from the server. Retry when ready.` : message(error, 'Could not set up this station.');
        setError(key, text, { status: retryable(error) ? 'open' : 'blocked' });
        throw error;
      }
      visit = visitOf(key);
    }
    let log;
    try {
      const { data } = await api.post('/workout-logs/start', { workout_assignment_id: visit.assignmentId, client_id: visit.traineeId });
      log = data.workout_log;
    } catch (error) {
      const body = error?.response?.data || {};
      if (status(error) === 409 && body.workout_log && body.workout_log.workout_assignment_id === visit.assignmentId) {
        log = body.workout_log;
      } else {
        const text = status(error) === 409 && body.active_workout
          ? `${visit.traineeName} already has another workout in progress. Finish it in their tracker first; nothing was changed.`
          : retryable(error) ? `Not saved yet for ${visit.traineeName}: no answer from the server. Retry when ready.` : message(error, 'Could not start this station.');
        setError(key, text, { status: status(error) === 409 ? 'blocked' : 'open' });
        throw error;
      }
    }
    // Ownership check before any set write: this log must be the trainee's own.
    if (!log || log.client_id !== visit.traineeId || (log.workout_assignment_id && log.workout_assignment_id !== visit.assignmentId)) {
      setError(key, `The server returned a record that is not ${visit.traineeName}'s. Nothing was written.`, { status: 'blocked' });
      throw new Error('ownership mismatch');
    }
    commit((session) => updateVisit(session, key, (row) => reconcileVisitWithLog(row, log)));
    return visitOf(key);
  }

  async function sendSet(key, setKey) {
    const visit = await ensureStarted(key);
    if (CLOSED.has(visit.status)) return;
    let set = visit.sets.find((row) => row.key === setKey);
    if (!set?.entry || set.state === 'saved') return;
    if (!set.setId && set.origin === 'extra') {
      const { data } = await api.post(`/workout-logs/${visit.logId}/exercises/${visit.logExerciseId}/sets`, { client_operation_id: set.operationId });
      commit((session) => updateVisitSet(session, key, setKey, (row) => ({ ...row, setId: data.id })));
      set = visitOf(key).sets.find((row) => row.key === setKey);
    }
    if (!set.setId) throw Object.assign(new Error(`Set ${set.setNumber} is not on ${visit.traineeName}'s workout.`), { fatal: true });
    // pt-session-events/v1: the event id is stored before sending (write-ahead)
    // and the write is based on the server revision this device last saw.
    if (!set.eventId) {
      const eventId = globalThis.crypto.randomUUID();
      commit((session) => updateVisitSet(session, key, setKey, (row) => ({ ...row, eventId })));
      set = visitOf(key).sets.find((row) => row.key === setKey);
    }
    const sent = set.entry;
    const { data } = await api.patch(`/workout-logs/${visit.logId}/sets/${set.setId}`, {
      status: 'completed',
      actual_reps: sent.reps,
      actual_load_value: sent.load,
      actual_load_unit: sent.load == null ? null : sent.unit,
      event_id: set.eventId,
      base_revision: set.serverRevision ?? 0,
    });
    const outcome = data?.event?.outcome === 'replayed' ? data.event.original_outcome : data?.event?.outcome;
    if (outcome === 'conflict') {
      commit((session) => updateVisitSet(session, key, setKey, (row) => (sameEntry(row.entry, sent)
        ? { ...row, state: 'conflict', error: `${visit.traineeName} changed this set on their own phone first. Both values are kept; choose the final one in their workout.` }
        : row)));
      return;
    }
    commit((session) => updateVisitSet(session, key, setKey, (row) => (sameEntry(row.entry, sent)
      ? { ...row, state: 'saved', error: null, serverRevision: data?.revision ?? row.serverRevision }
      : row)));
    // The coach changed the value while it was sending: send the newer one.
    const latest = visitOf(key)?.sets.find((row) => row.key === setKey);
    if (latest?.entry && latest.state !== 'saved') await sendSet(key, setKey);
  }

  function saveSet(key, setKey) {
    return serial(key, async () => {
      try {
        await sendSet(key, setKey);
      } catch (error) {
        const visit = visitOf(key);
        const text = visit?.status === 'blocked' || (visit?.error && !visit?.logId) ? visit.error
          : error?.fatal ? error.message
          : status(error) === 409 ? `${visit?.traineeName || 'This'} station is already closed on the server; this value was not saved.`
            : status(error) === 400 ? message(error, 'Check the value.')
              : `Not saved yet: no answer from the server. It is kept here and will be retried.`;
        commit((session) => updateVisitSet(session, key, setKey, (row) => (row.entry && row.state !== 'saved' ? { ...row, state: 'failed', error: text } : row)));
      }
    });
  }

  function closeVisit(key) {
    return serial(key, async () => {
      const visit = visitOf(key);
      if (!visit || CLOSED.has(visit.status)) return;
      if (!visit.sets.some((set) => set.entry)) {
        commit((session) => updateVisit(session, key, (row) => ({ ...row, status: 'abandoned', error: null })));
        return;
      }
      if (!visit.logId) throw new Error('Sets are still saving.');
      // Never close over an entered set that is not saved (or kept as a
      // conflict): a closed visit is skipped by flush/sendSet, so the entry
      // would be stranded. It stays open, keeps its ids, and Retry re-sends it.
      const unsaved = visit.sets.filter((set) => set.entry && !['saved', 'conflict'].includes(set.state));
      if (unsaved.length) {
        setError(key, `Not closed: ${unsaved.length === 1 ? 'a set is' : `${unsaved.length} sets are`} not saved yet for ${visit.traineeName}. They are kept here; Retry to send them.`);
        throw new Error('Sets are not saved yet.');
      }
      try {
        await api.post(`/workout-logs/${visit.logId}/complete`, {});
        commit((session) => updateVisit(session, key, (row) => ({ ...row, status: 'completed', error: null })));
      } catch (error) {
        if (status(error) === 400) {
          await api.post(`/workout-logs/${visit.logId}/abandon`, {});
          commit((session) => updateVisit(session, key, (row) => ({ ...row, status: 'abandoned', error: null })));
          return;
        }
        // A lost reply may follow a completed write: read before retrying.
        try {
          const { data } = await api.get(`/workout-logs/${visit.logId}`);
          if (data?.status === 'completed' || data?.status === 'abandoned') {
            commit((session) => updateVisit(session, key, (row) => reconcileVisitWithLog(row, data)));
            return;
          }
        } catch { /* fall through to the retryable error */ }
        setError(key, 'Could not close this station yet. Retry when the connection is back.');
        throw error;
      }
    });
  }

  // Read each open visit back from the server (after a reload or reconnect),
  // then re-send anything still pending. Nothing is created twice.
  async function resume() {
    const session = getSession();
    if (!session) return;
    const open = Object.values(session.visits).filter((visit) => !CLOSED.has(visit.status));
    await Promise.all(open.map((visit) => serial(visit.key, async () => {
      if (!visit.logId) return;
      try {
        const { data } = await api.get(`/workout-logs/${visit.logId}`);
        if (data.client_id !== visit.traineeId) {
          setError(visit.key, `The server returned a record that is not ${visit.traineeName}'s. Nothing was written.`, { status: 'blocked' });
          return;
        }
        commit((current) => updateVisit(current, visit.key, (row) => reconcileVisitWithLog(row, data)));
      } catch (error) {
        if (status(error) === 404) setError(visit.key, `${visit.traineeName}'s workout record is no longer available. The values entered here are kept on this device.`, { status: 'missing' });
      }
    })));
    await flush();
  }

  async function flush() {
    const session = getSession();
    if (!session) return;
    const jobs = [];
    for (const visit of Object.values(session.visits)) {
      if (CLOSED.has(visit.status) || visit.status === 'blocked') continue;
      for (const set of visit.sets) if (set.entry && !['saved', 'conflict'].includes(set.state)) jobs.push(saveSet(visit.key, set.key));
    }
    await Promise.all(jobs);
  }

  async function closeRound(round) {
    await flush();
    const visits = visitsForRound(getSession(), round);
    await Promise.all(visits.map((visit) => closeVisit(visit.key).catch(() => {})));
  }

  // After the coach resolves a blocked visit (for example the trainee
  // finished another workout), try it again with the same stored ids.
  async function retryVisit(key) {
    commit((session) => updateVisit(session, key, (row) => (row.status === 'blocked' ? { ...row, status: 'open', error: null } : row)));
    const visit = visitOf(key);
    await Promise.all(visit.sets.filter((set) => set.entry && !['saved', 'conflict'].includes(set.state)).map((set) => saveSet(key, set.key)));
  }

  return { saveSet, closeVisit, closeRound, resume, flush, retryVisit };
}
