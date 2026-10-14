// Quick-session create recovery (docs/superpowers/specs/2026-10-09-quick-sessions-design.md, R1).
//
// Browser storage holds ONE immutable routing record per request:
//   key   cvf_quick_session_pending:v1:<environment>:<actor_coach_id>:<request_id>
//   value {v:1, request_id, client_id, state:'pending', created_at}
// Never a workout body, title, notes, loads, hash, server response or token, and never a
// whole-map rewrite. The workout body lives only in memory for identical retries.
//
// Every delayed response is fenced by (actor, auth/session epoch, page token, request id,
// client, operation generation[, assignment]) before it may display, clear storage, rotate
// identity, change the form, navigate, or chain Start/library. `not_found` never proves a
// rollback: the UUID and its record stay until a known commit or an explicit Discard.

export const PENDING_PREFIX = 'cvf_quick_session_pending:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Server ids (actor/client) are routing data only: a strict safe charset, never free text.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RECORD_KEYS = ['client_id', 'created_at', 'request_id', 'state', 'v'];
const SCOPE_PART = /^[A-Za-z0-9._-]{1,80}$/;

export const QUICK_SESSION_COPY = {
  unrecovered: "Couldn't recover an earlier save. It may still arrive. Check assignments or re-enter under this request.",
  uncertain: "We couldn't confirm this save. It may still arrive — retry to send the same session again.",
  libraryFailed: 'Session assigned — saving to library failed',
  corrupt: "An earlier quick-session save couldn't be read — check this client's assignments",
  storageUnavailable: "This browser can't keep a recovery note, so recovery after reload is unavailable. The save itself still works.",
  discardWarning: 'A save that was already sent may still arrive. Discarding only forgets it here so you can start a new quick session.',
  accessDenied: 'You no longer have access to this client, so the earlier save can’t be shown or re-entered.',
};

export function pendingKey({ environment, actorId, requestId }) {
  return `${PENDING_PREFIX}${environment}:${actorId}:${requestId}`;
}

function namespace({ environment, actorId }) {
  return `${PENDING_PREFIX}${environment}:${actorId}:`;
}

function validScope(scope) {
  return Boolean(scope) && SCOPE_PART.test(String(scope.environment || '')) && SAFE_ID.test(String(scope.actorId || ''));
}

export function pendingRecord({ requestId, clientId, createdAt }) {
  return { v: 1, request_id: requestId, client_id: clientId, state: 'pending', created_at: createdAt };
}

// Strict: exactly the allowlisted keys and shapes. Anything else is corrupt.
export function parsePendingValue(raw) {
  if (typeof raw !== 'string') return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(',') !== RECORD_KEYS.join(',')) return null;
  if (value.v !== 1 || value.state !== 'pending') return null;
  if (typeof value.request_id !== 'string' || !UUID.test(value.request_id)) return null;
  if (typeof value.client_id !== 'string' || !SAFE_ID.test(value.client_id)) return null;
  if (typeof value.created_at !== 'string' || Number.isNaN(Date.parse(value.created_at))) return null;
  return value;
}

function sameRecord(a, b) {
  return Boolean(a && b) && RECORD_KEYS.every((key) => a[key] === b[key]);
}

function safeGet(storage, key) {
  try { return { ok: true, value: storage.getItem(key) }; } catch { return { ok: false, value: null }; }
}

// Writes the immutable record BEFORE the first dispatch, then reads it back.
// Never rewrites an existing entry (a retry keeps the original value, or a removed
// entry stays removed). Blocked/full storage reports recoverable:false; the save proceeds.
export function persistPending(storage, record, scope) {
  if (!storage || !validScope(scope)) return { recoverable: false };
  const key = pendingKey({ ...scope, requestId: record.request_id });
  const serialized = JSON.stringify(record);
  const existing = safeGet(storage, key);
  if (!existing.ok) return { recoverable: false };
  if (existing.value !== null) return { recoverable: sameRecord(parsePendingValue(existing.value), record) };
  try {
    storage.setItem(key, serialized);
  } catch {
    return { recoverable: false };
  }
  const readBack = safeGet(storage, key);
  return { recoverable: readBack.ok && readBack.value === serialized };
}

// Removes only the exact key whose validated immutable value matches `record`.
// Already absent: nothing to do (true). Corrupt or mismatched: retained (false).
export function removeMatchingPending(storage, scope, record) {
  if (!storage || !validScope(scope) || !record) return false;
  const key = pendingKey({ ...scope, requestId: record.request_id });
  const existing = safeGet(storage, key);
  if (!existing.ok) return false;
  if (existing.value === null) return true;
  if (!sameRecord(parsePendingValue(existing.value), record)) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}

// Enumerates individual keys in the current actor/environment namespace only.
// Valid records are filtered to `clientId`; corrupt keys (bad value or malformed routing id)
// are reported for a scoped Discard and never trusted for routing.
export function listPending(storage, { environment, actorId, clientId }) {
  const result = { records: [], corrupt: [], available: true };
  if (!storage || !validScope({ environment, actorId })) return { ...result, available: false };
  const prefix = namespace({ environment, actorId });
  let keys = [];
  try {
    const count = storage.length;
    for (let i = 0; i < count; i += 1) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return { ...result, available: false };
  }
  keys = keys.sort();
  for (const key of keys) {
    const requestId = key.slice(prefix.length);
    const read = safeGet(storage, key);
    if (!read.ok) { result.available = false; continue; }
    if (read.value === null) continue;
    const record = UUID.test(requestId) ? parsePendingValue(read.value) : null;
    if (!record || record.request_id !== requestId) { result.corrupt.push(key); continue; }
    if (record.client_id === clientId) result.records.push(record);
  }
  result.records.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.request_id.localeCompare(b.request_id));
  return result;
}

// Explicit, scoped Discard of one key in the current namespace (valid or corrupt).
export function discardPendingKey(storage, scope, key) {
  if (!storage || !validScope(scope) || typeof key !== 'string' || !key.startsWith(namespace(scope))) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}

export function captureQuickOperation(context) {
  return {
    actorId: context.actorId,
    authEpoch: context.authEpoch,
    pageToken: context.pageToken,
    requestId: context.requestId,
    clientId: context.clientId,
    operationGeneration: context.operationGeneration,
    ...(context.assignmentId ? { assignmentId: context.assignmentId } : {}),
  };
}

export function isCurrentQuickOperation(fence, context) {
  if (!fence || !context) return false;
  return fence.actorId === context.actorId
    && fence.authEpoch === context.authEpoch
    && fence.pageToken === context.pageToken
    && fence.requestId === context.requestId
    && fence.clientId === context.clientId
    && fence.operationGeneration === context.operationGeneration
    && (fence.assignmentId || null) === (context.assignmentId || null);
}

// --------------------------------------------------------------------------------------
// Request body (in memory only). Resolved date/title are frozen before the first dispatch.
const EXERCISE_FIELDS = [
  'exercise_library_id', 'custom_name', 'sets', 'reps', 'default_load_value', 'default_load_unit',
  'rest', 'tempo', 'target_rpe', 'client_notes', 'coach_notes', 'video_url', 'superset_group',
  'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit',
];

export function denverToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
}

export function defaultQuickTitle(date) {
  return `Quick session · ${date}`;
}

export function buildQuickSessionBody(form, { requestId, clientId, today }) {
  const assignedFor = form.assigned_for || today;
  const name = String(form.name || '').trim() || defaultQuickTitle(assignedFor);
  return {
    request_id: requestId,
    client_id: clientId,
    assigned_for: assignedFor,
    name,
    notes: String(form.notes || '').trim() || null,
    exercises: (form.exercises || []).map((row) => {
      const out = {};
      for (const field of EXERCISE_FIELDS) {
        const value = row[field];
        if (value === undefined || value === '') continue;
        if (field === 'default_load_unit' && (row.default_load_value === '' || row.default_load_value == null)) continue;
        out[field] = value;
      }
      return out;
    }),
  };
}

// --------------------------------------------------------------------------------------
// Controller. `getContext()` returns the CURRENT {actorId, authEpoch, clientId, environment}.
function errorStatus(error) { return error?.response?.status ?? null; }
function errorBody(error) { return error?.response?.data ?? null; }
function errorMessage(error, fallback) { return errorBody(error)?.error || fallback; }

export function createQuickSessionController({
  api, storage, getContext, clock = () => new Date(), uuid, onChange = () => {}, onStarted = () => {},
}) {
  const newId = uuid || (() => globalThis.crypto.randomUUID());
  const pageToken = newId();
  let disposed = false;
  let owner = null;               // {actorId, authEpoch, clientId, environment} the in-memory state belongs to
  let lifecycleGeneration = 0;   // ownership of the visible request/session, across all channels
  const generations = new Map();  // channel -> generation
  let state;

  const blank = () => ({
    phase: 'editing', requestId: null, record: null, recoverable: null, message: null,
    assignment: null, start: { state: 'idle', message: null }, library: { state: 'idle', templateId: null },
    recoveries: {}, recovered: [], corrupt: [], storageAvailable: true,
  });
  let frozenBody = null;
  let persistedFor = null;        // request id whose record was already written (written once, ever)
  state = blank();

  const snapshot = () => ({
    ...state, recoveries: { ...state.recoveries }, recovered: [...state.recovered], corrupt: [...state.corrupt], hasFrozenBody: Boolean(frozenBody),
  });
  const emit = () => { if (!disposed) onChange(snapshot()); };
  const bump = (channel) => { const next = (generations.get(channel) || 0) + 1; generations.set(channel, next); return next; };
  const scopeOf = (ctx) => ({ environment: ctx.environment, actorId: ctx.actorId });

  function liveContext(channel, requestId, assignmentId = null) {
    const ctx = getContext();
    return {
      actorId: ctx.actorId, authEpoch: ctx.authEpoch, clientId: ctx.clientId, pageToken: disposed ? null : pageToken,
      requestId, operationGeneration: generations.get(channel) || 0, assignmentId,
    };
  }
  function fenceFor(channel, requestId, assignmentId = null, visible = true) {
    bump(channel);
    return { channel, lifecycle: visible ? lifecycleGeneration : null, fence: captureQuickOperation({ ...liveContext(channel, requestId, assignmentId), pageToken }) };
  }
  function current({ channel, fence, lifecycle }, liveRequestId) {
    return !disposed && (lifecycle === null || lifecycle === lifecycleGeneration)
      && isCurrentQuickOperation(fence, liveContext(channel, liveRequestId, fence.assignmentId ? state.assignment?.id : null));
  }

  // Account/session/client change: drop every in-memory body and invalidate every reply.
  function syncContext() {
    const ctx = getContext();
    const same = owner && owner.actorId === ctx.actorId && owner.authEpoch === ctx.authEpoch
      && owner.clientId === ctx.clientId && owner.environment === ctx.environment;
    if (same) return false;
    lifecycleGeneration += 1;
    owner = { actorId: ctx.actorId, authEpoch: ctx.authEpoch, clientId: ctx.clientId, environment: ctx.environment };
    for (const channel of [...generations.keys()]) bump(channel);
    frozenBody = null;
    persistedFor = null;
    state = blank();
    emit();
    return true;
  }

  function refreshPendingList() {
    const ctx = getContext();
    const listed = listPending(storage, { environment: ctx.environment, actorId: ctx.actorId, clientId: ctx.clientId });
    state.corrupt = listed.corrupt;
    state.storageAvailable = listed.available;
    return listed;
  }

  function rotateIdentity() {
    persistedFor = null;
    state.requestId = null;
    state.record = null;
    state.recoverable = null;
    frozenBody = null;
  }

  function knownCommitted(record, assignment) {
    const ctx = getContext();
    removeMatchingPending(storage, scopeOf(ctx), record);
    delete state.recoveries[record.request_id];
    if (state.requestId !== record.request_id) {
      // Another request (reload or another tab): report it without touching the builder.
      state.recovered = [...state.recovered.filter((entry) => entry.request_id !== record.request_id), { request_id: record.request_id, assignment }];
      return;
    }
    rotateIdentity();
    state.phase = 'saved';
    state.message = null;
    state.assignment = assignment;
    state.start = { state: 'idle', message: null };
    state.library = { state: assignment?.library_template_id ? 'saved' : 'idle', templateId: assignment?.library_template_id || null };
  }

  async function statusRead(record, { asCurrent }) {
    const channel = `status:${record.request_id}`;
    const op = fenceFor(channel, record.request_id, null, asCurrent);
    const liveRequest = () => (asCurrent ? state.requestId : record.request_id);
    if (!asCurrent) state.recoveries[record.request_id] = { record, state: 'checking' };
    emit();
    try {
      const { data } = await api.get(`/programs/quick-sessions/requests/${record.request_id}`);
      if (!current(op, liveRequest())) return 'stale';
      if (data?.state === 'committed' && data.assignment) {
        knownCommitted(record, data.assignment);
        emit();
        return 'committed';
      }
      throw Object.assign(new Error('unexpected'), { response: { status: 500 } });
    } catch (error) {
      if (!current(op, liveRequest())) return 'stale';
      const notFound = errorStatus(error) === 404;
      // Absence is not proof of rollback and never rotates the id.
      if (asCurrent) {
        state.phase = notFound ? 'unrecovered' : 'uncertain';
        state.message = notFound ? QUICK_SESSION_COPY.unrecovered : QUICK_SESSION_COPY.uncertain;
        state.assignment = null;
      } else {
        state.recoveries[record.request_id] = { record, state: notFound ? 'unrecovered' : 'uncertain' };
      }
      emit();
      return notFound ? 'not_found' : 'error';
    }
  }

  async function dispatchCreate(intent) {
    const record = state.record;
    const op = fenceFor('create', state.requestId);
    state.phase = 'saving';
    state.message = null;
    emit();
    let response;
    try {
      response = await api.post('/programs/quick-sessions', frozenBody);
    } catch (error) {
      if (!current(op, state.requestId)) return 'stale';
      const status = errorStatus(error);
      const body = errorBody(error);
      if (status === 409 && body?.state === 'request_mismatch') {
        // The authorized committed version decides; neither dispatch is presumed to have won.
        state.phase = 'checking';
        emit();
        const outcome = await statusRead(record, { asCurrent: true });
        return outcome === 'committed' ? 'committed_other' : outcome;
      }
      if (status === 404) {
        state.phase = 'unrecovered';
        state.message = QUICK_SESSION_COPY.unrecovered;
        emit();
        return 'not_found';
      }
      if (status && status >= 400 && status < 500) {
        // Definitive rejection: nothing was written. Same UUID; the coach may correct and resend.
        state.phase = 'rejected';
        state.message = errorMessage(error, 'Could not save the quick session');
        frozenBody = null;
        emit();
        return 'rejected';
      }
      state.phase = 'uncertain';
      state.message = QUICK_SESSION_COPY.uncertain;
      emit();
      return 'uncertain';
    }
    if (!current(op, state.requestId)) return 'stale';
    const assignment = response.data?.assignment;
    knownCommitted(record, assignment);
    // Capture ownership before emit: a subscriber can finish/reset synchronously.
    const assignmentId = assignment?.id;
    const continuation = fenceFor('continuation', null, assignmentId);
    emit();
    const sameSession = () => current(continuation, state.requestId);
    if (assignmentId && intent?.library && sameSession()) await saveToLibrary(assignmentId);
    if (assignmentId && intent?.start && sameSession()) await start(assignmentId);
    return response.data?.state || 'created';
  }

  async function save(form, intent = {}) {
    syncContext();
    if (state.phase === 'saving' || state.phase === 'checking') return 'busy';
    const ctx = getContext();
    if (!ctx.clientId || !ctx.actorId) return 'unavailable';
    const identical = Boolean(frozenBody) && state.phase === 'uncertain';
    if (!identical && !form) return 'needs_form';
    if (!identical) {
      if (state.phase === 'unrecovered') return 'needs_reentry';
      if (!state.requestId) {
        lifecycleGeneration += 1;
        state.assignment = null;
        state.start = { state: 'idle', message: null };
        state.library = { state: 'idle', templateId: null };
        state.requestId = newId();
        state.record = pendingRecord({ requestId: state.requestId, clientId: ctx.clientId, createdAt: clock().toISOString() });
      }
      frozenBody = buildQuickSessionBody(form, { requestId: state.requestId, clientId: ctx.clientId, today: denverToday(clock()) });
    }
    // Immutable routing record first, written once per request id. Retries never rewrite
    // it, and never recreate one that was removed (known success elsewhere or a Discard).
    if (persistedFor !== state.requestId) {
      state.recoverable = persistPending(storage, state.record, scopeOf(ctx)).recoverable;
      persistedFor = state.requestId;
    }
    return dispatchCreate(intent);
  }

  // Fresh, independent target-access check, then re-entry under the SAME UUID.
  async function reenter(record) {
    syncContext();
    lifecycleGeneration += 1;
    const op = fenceFor(`reenter:${record.request_id}`, record.request_id);
    try {
      await api.get(`/clients/${record.client_id}`);
    } catch (error) {
      if (!current(op, record.request_id)) return 'stale';
      const status = errorStatus(error);
      const denied = status === 403 || status === 404;
      if (state.requestId === record.request_id) { state.phase = 'unrecovered'; state.assignment = null; }
      state.recoveries[record.request_id] = { record, state: denied ? 'access_denied' : 'uncertain' };
      state.message = denied ? QUICK_SESSION_COPY.accessDenied : QUICK_SESSION_COPY.uncertain;
      emit();
      return denied ? 'denied' : 'error';
    }
    if (!current(op, record.request_id)) return 'stale';
    delete state.recoveries[record.request_id];
    state.requestId = record.request_id;
    state.record = record;
    state.recoverable = true;
    persistedFor = record.request_id;   // adopted from storage: never rewritten
    frozenBody = null;
    state.assignment = null;
    state.start = { state: 'idle', message: null };
    state.library = { state: 'idle', templateId: null };
    state.phase = 'editing';
    state.message = QUICK_SESSION_COPY.unrecovered;
    emit();
    return 'reentry';
  }

  async function start(assignmentId) {
    syncContext();
    if (!assignmentId || state.assignment?.id !== assignmentId) return 'stale';
    const ctx = getContext();
    const op = fenceFor(`start:${assignmentId}`, null, assignmentId);
    state.start = { state: 'starting', message: null };
    emit();
    try {
      const { data } = await api.post('/workout-logs/start', { client_id: ctx.clientId, workout_assignment_id: assignmentId });
      if (!current(op, null)) return 'stale';
      state.start = { state: 'started', message: null };
      emit();
      onStarted(data?.workout_log);
      return 'started';
    } catch (error) {
      if (!current(op, null)) return 'stale';
      const status = errorStatus(error);
      const active = errorBody(error)?.active_workout;
      state.start = status === 409
        ? { state: 'conflict', message: errorMessage(error, 'Finish or abandon the active workout first'), activeWorkoutId: active?.id || null }
        : { state: 'failed', message: errorMessage(error, 'Could not start the session') };
      emit();
      return status === 409 ? 'conflict' : 'failed';
    }
  }

  async function saveToLibrary(assignmentId) {
    syncContext();
    if (!assignmentId || state.assignment?.id !== assignmentId) return 'stale';
    const op = fenceFor(`library:${assignmentId}`, null, assignmentId);
    state.library = { state: 'saving', templateId: null };
    emit();
    try {
      const { data } = await api.post(`/programs/quick-sessions/${assignmentId}/save-to-library`);
      if (!current(op, null)) return 'stale';
      state.library = { state: 'saved', templateId: data?.template_id || null };
      if (state.assignment?.id === assignmentId) state.assignment = { ...state.assignment, library_template_id: data?.template_id || null };
      emit();
      return 'saved';
    } catch {
      if (!current(op, null)) return 'stale';
      state.library = { state: 'failed', templateId: null };
      emit();
      return 'failed';
    }
  }

  // Reload/storage-event recovery: guarded status reads only. Never resubmits, never
  // rewrites or recreates an entry, never resumes Start/library automatically.
  async function recoverAll() {
    syncContext();
    const listed = refreshPendingList();
    emit();
    const others = listed.records.filter((record) => record.request_id !== state.requestId);
    return Promise.all(others.map((record) => statusRead(record, { asCurrent: false })));
  }

  async function checkCurrent() {
    syncContext();
    if (!state.record) return 'none';
    state.phase = 'checking';
    emit();
    return statusRead(state.record, { asCurrent: true });
  }

  function discard(recordOrKey) {
    syncContext();
    const ctx = getContext();
    const key = typeof recordOrKey === 'string' ? recordOrKey : pendingKey({ ...scopeOf(ctx), requestId: recordOrKey.request_id });
    const removed = discardPendingKey(storage, scopeOf(ctx), key);
    const requestId = typeof recordOrKey === 'string' ? null : recordOrKey.request_id;
    if (requestId) {
      bump(`status:${requestId}`);
      delete state.recoveries[requestId];
      if (state.requestId === requestId) {
        bump('create');
        lifecycleGeneration += 1;
        rotateIdentity();
        state.phase = 'editing';
        state.message = null;
      }
    }
    state.corrupt = state.corrupt.filter((corruptKey) => corruptKey !== key);
    emit();
    return removed;
  }

  function dismissRecovered(requestId) {
    state.recovered = state.recovered.filter((entry) => entry.request_id !== requestId);
    emit();
  }

  function resetForNew() {
    syncContext();
    if (state.phase === 'saved') {
      lifecycleGeneration += 1;
      state.phase = 'editing';
      state.assignment = null;
      state.start = { state: 'idle', message: null };
      state.library = { state: 'idle', templateId: null };
      state.message = null;
      emit();
    }
  }

  function dispose() {
    disposed = true;
    frozenBody = null;
    state = blank();
    for (const channel of [...generations.keys()]) bump(channel);
  }

  syncContext();
  return {
    getState: snapshot, syncContext, save, reenter, start, retryStart: start, saveToLibrary, retryLibrary: saveToLibrary,
    recoverAll, checkCurrent, discard, resetForNew, dismissRecovered, dispose,
  };
}
