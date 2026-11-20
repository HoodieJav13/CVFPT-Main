// In-browser simulation of the existing session-event backend, used only by
// the cockpit's fictional Replay. It is NOT a second backend: nothing here is
// served to a client, stored on an account or reachable in production. It
// mirrors, rule for rule, the real contract so replays exercise the same
// outcomes the live server returns:
//   - set writes: supabase/migrations/20261023000000_session_conductor_events.sql
//     apply_workout_set_event (replay by event id, event_id_reused, applied /
//     unchanged / conflict, the same-actor rule, completed-log immutability,
//     one open disagreement per set per side, deduped set_conflict notice);
//   - group sessions: backend/src/routes/conductor.js (create replay by id,
//     participant limits, coach ownership, CAS on base_revision, overview);
//   - notices: coach-scoped list and idempotent mark-read.
// Times are the simulated SERVER clock (world.nowMs). Device clocks never
// reach this module. Plain objects only, so a world can be cloned and diffed.

import { LIVE_MAX_PARTICIPANTS } from './config.js';

const VALUE_KEYS = ['status', 'actual_reps', 'actual_load_value', 'actual_load_unit'];

const iso = (ms) => new Date(ms).toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(status, error, extra = {}) {
  return { status, body: { error, ...extra } };
}
function okResult(body, status = 200) {
  return { status, body };
}

export function createWorld({ startMs, coaches, clients }) {
  return {
    nowMs: startMs,
    seq: 0,
    coaches: clone(coaches),
    clients: clone(clients),
    sessions: {},
    logs: {},
    events: {},
    conflicts: [],
    notices: [],
  };
}

export function cloneWorld(world) {
  return clone(world);
}

export function advance(world, ms) {
  world.nowMs += ms;
  return world.nowMs;
}

function nextId(world, prefix) {
  world.seq += 1;
  return `${prefix}_${String(world.seq).padStart(4, '0')}`;
}

function coachById(world, coachId) {
  return world.coaches.find((row) => row.id === coachId) || null;
}

// Mirrors canAccessClient: an admin reaches every client; a coach reaches
// their own (clients.coach_id). Archived clients are never accessible.
export function canAccessClient(world, coachId, clientId) {
  const coach = coachById(world, coachId);
  const client = world.clients.find((row) => row.id === clientId && !row.archived);
  if (!coach || !client) return false;
  return coach.role === 'admin' || client.coach_id === coach.id;
}

// ---------- Workout logs (fixture setup, as a started workout would be) ----------
export function startLog(world, { clientId, workoutName, exercises }) {
  const id = nextId(world, 'log');
  world.logs[id] = {
    id,
    client_id: clientId,
    status: 'active',
    workout_name: workoutName,
    started_at: iso(world.nowMs),
    completed_at: null,
    archived: false,
    exercises: exercises.map((exercise, position) => {
      const exerciseId = `${id}_x${position + 1}`;
      return {
        id: exerciseId,
        position,
        exercise_name: exercise.name,
        station: exercise.station || null,
        prescribed_reps: exercise.reps ?? null,
        prescribed_load_value: exercise.load ?? null,
        prescribed_load_unit: exercise.load == null ? null : exercise.unit || 'kg',
        rest_seconds: exercise.rest ?? 90,
        plan_revision: 0,
        sets: Array.from({ length: exercise.sets }, (_, index) => ({
          id: `${exerciseId}_s${index + 1}`,
          set_number: index + 1,
          status: 'pending',
          actual_reps: null,
          actual_load_value: null,
          actual_load_unit: null,
          revision: 0,
          last_actor_role: null,
          entered_by: null,
          entered_by_coach_id: null,
          last_event_id: null,
          updated_at: iso(world.nowMs),
          completed_at: null,
        })),
      };
    }),
  };
  return world.logs[id];
}

export function findSet(world, setId) {
  for (const log of Object.values(world.logs)) {
    for (const exercise of log.exercises) {
      const set = exercise.sets.find((row) => row.id === setId);
      if (set) return { log, exercise, set };
    }
  }
  return null;
}

function setValue(set) {
  return Object.fromEntries(VALUE_KEYS.map((key) => [key, set[key] ?? null]));
}

function sameValue(a, b) {
  return VALUE_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

function clientOf(world, clientId) {
  return world.clients.find((row) => row.id === clientId) || null;
}

// ---------- apply_workout_set_event ----------
// event: { set_id, event_id, actor_role, actor_coach_id, base_revision,
//          local_seq, offline, payload }
// Set value origin (migration 20261113000000, apply_workout_set_event_v2 and
// the set_value_origin_guard trigger), mirrored only for rows that carry
// value_origin: event.value_origin 'prefill' | 'entered' | undefined.
const performedOrNull = (value) => value === null || value === undefined;
function untouchedForOrigin(set) {
  return set.status === 'pending' && ['actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_distance_value'].every((key) => performedOrNull(set[key]))
    && (set.value_origin === 'prefill' || (set.value_origin === 'legacy' && set.revision === 0 && set.last_actor_role == null));
}
function originAfterApply(before, after, declared, eventId) {
  if (!declared) return { value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null };
  const prefillOk = declared === 'prefill' && after.status === 'pending'
    && ['actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_distance_value'].every((key) => performedOrNull(after[key]))
    && before.prefill_load_value != null && Number(after.actual_load_value) === Number(before.prefill_load_value)
    && after.actual_load_value != null && (after.actual_load_unit ?? null) === (before.prefill_load_unit ?? null);
  const untouched = untouchedForOrigin(before);
  return {
    value_origin: declared === 'entered' ? 'entered' : prefillOk ? 'prefill' : 'unknown',
    value_origin_nonce: eventId,
    prefill_load_value: untouched ? before.actual_load_value : null,
    prefill_load_unit: untouched ? before.actual_load_unit : null,
  };
}

export function applySetEvent(world, event) {
  if (!['client', 'coach'].includes(event.actor_role)) return fail(400, 'invalid actor');
  if (event.value_origin != null && !['prefill', 'entered'].includes(event.value_origin)) return fail(400, 'value_origin must be prefill or entered');
  const existing = world.events[event.event_id];
  if (existing) {
    if (existing.set_id !== event.set_id) return fail(409, 'That event id belongs to another set');
    const found = findSet(world, event.set_id);
    return okResult({ ...clone(found.set), event: { id: event.event_id, outcome: 'replayed', original_outcome: existing.outcome, conflict_id: existing.conflict_id } });
  }
  const found = findSet(world, event.set_id);
  if (!found || found.set.archived) return fail(404, 'Workout set not found');
  const { log, exercise, set } = found;

  const current = setValue(set);
  const payload = { ...(event.payload || {}) };
  delete payload.completed_at;
  delete payload.updated_at;
  const incoming = { ...current, ...Object.fromEntries(Object.entries(payload).filter(([key]) => VALUE_KEYS.includes(key))) };
  const sameActor = set.last_actor_role === event.actor_role
    && (event.actor_role === 'client' || set.entered_by_coach_id === (event.actor_coach_id ?? null));

  let outcome;
  if (log.status !== 'active') {
    outcome = sameValue(incoming, current) ? 'unchanged' : 'conflict';
  } else if (event.base_revision == null || event.base_revision === set.revision || sameActor
    || (set.last_actor_role == null && set.revision === 0)) {
    outcome = 'applied';
  } else if (sameValue(incoming, current)) {
    outcome = 'unchanged';
  } else {
    outcome = 'conflict';
  }

  let conflictId = null;
  if (outcome === 'applied') {
    const before = clone(set);
    Object.assign(set, incoming);
    set.completed_at = incoming.status === 'completed' ? (set.completed_at || iso(world.nowMs)) : null;
    set.entered_by = event.actor_role;
    set.entered_by_coach_id = event.actor_coach_id ?? null;
    set.revision += 1;
    set.last_actor_role = event.actor_role;
    set.last_event_id = event.event_id;
    set.updated_at = iso(world.nowMs);
    if (Object.hasOwn(before, 'value_origin')) Object.assign(set, originAfterApply(before, set, event.value_origin, event.event_id));
  } else if (outcome === 'conflict') {
    const open = world.conflicts.find((row) => row.workout_log_set_id === set.id && row.status === 'open' && row.incoming_actor_role === event.actor_role);
    if (open) {
      open.incoming_value = incoming;
      open.incoming_offline = open.incoming_offline || Boolean(event.offline);
      open.incoming_at = iso(world.nowMs);
      conflictId = open.id;
    } else {
      conflictId = nextId(world, 'conflict');
      world.conflicts.push({
        id: conflictId,
        workout_log_id: log.id,
        workout_log_set_id: set.id,
        client_id: log.client_id,
        kept_value: current,
        kept_actor_role: set.last_actor_role || set.entered_by,
        incoming_value: incoming,
        incoming_actor_role: event.actor_role,
        incoming_event_id: event.event_id,
        incoming_offline: Boolean(event.offline),
        incoming_at: iso(world.nowMs),
        status: 'open',
        created_at: iso(world.nowMs),
      });
      const client = clientOf(world, log.client_id);
      raiseNotice(world, {
        coachId: client?.coach_id,
        clientId: log.client_id,
        kind: 'set_conflict',
        dedupeKey: `conflict:${conflictId}`,
        logId: log.id,
        refId: conflictId,
        summary: `${client?.name || 'Client'}: two different values for ${exercise.exercise_name} set ${set.set_number}. Both are kept; choose the final value.`,
      });
    }
  }

  world.events[event.event_id] = {
    id: event.event_id,
    set_id: set.id,
    log_id: log.id,
    client_id: log.client_id,
    actor_role: event.actor_role,
    device_id: event.device_id || null,
    base_revision: event.base_revision ?? null,
    applied_revision: outcome === 'applied' ? set.revision : null,
    local_seq: event.local_seq ?? null,
    offline: Boolean(event.offline),
    outcome,
    conflict_id: conflictId,
    declared_origin: event.value_origin ?? null,
    created_at: iso(world.nowMs),
  };
  return okResult({ ...clone(set), event: { id: event.event_id, outcome, original_outcome: null, conflict_id: conflictId } });
}

export function completeLog(world, logId) {
  const log = world.logs[logId];
  if (!log || log.status !== 'active') return fail(409, 'The workout is no longer active.');
  log.status = 'completed';
  log.completed_at = iso(world.nowMs);
  return okResult(clone(log));
}

export function resolveConflict(world, coachId, conflictId, choice) {
  const conflict = world.conflicts.find((row) => row.id === conflictId);
  if (!conflict) return fail(404, 'Conflict not found');
  if (!canAccessClient(world, coachId, conflict.client_id)) return fail(404, 'Workout log not found');
  if (conflict.status === 'resolved') return fail(409, 'This disagreement was already resolved.');
  const value = choice === 'incoming' ? conflict.incoming_value : conflict.kept_value;
  const { set } = findSet(world, conflict.workout_log_set_id);
  Object.assign(set, value);
  set.revision += 1;
  set.last_actor_role = 'coach';
  set.entered_by = 'coach';
  set.entered_by_coach_id = coachId;
  set.updated_at = iso(world.nowMs);
  // An undeclared writer: the guard leaves the set unknown.
  if (Object.hasOwn(set, 'value_origin')) Object.assign(set, { value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null });
  conflict.status = 'resolved';
  conflict.resolution_choice = choice;
  return okResult({ outcome: 'resolved' });
}

// ---------- Coach notices ----------
function raiseNotice(world, { coachId, clientId, kind, dedupeKey, logId, refId, summary }) {
  if (!coachId) return;
  if (world.notices.some((row) => row.dedupe_key === dedupeKey)) return; // on conflict do nothing
  world.notices.push({
    id: nextId(world, 'notice'),
    coach_id: coachId,
    client_id: clientId,
    kind,
    dedupe_key: dedupeKey,
    workout_log_id: logId,
    ref_id: refId,
    summary: summary.slice(0, 300),
    created_at: iso(world.nowMs),
    read_at: null,
  });
}

export function raiseSubstitutionNotice(world, { clientId, logId, kind, summary }) {
  const client = clientOf(world, clientId);
  const refId = nextId(world, 'sub');
  raiseNotice(world, { coachId: client?.coach_id, clientId, kind, dedupeKey: `substitution:${refId}`, logId, refId, summary });
  return refId;
}

export function listNotices(world, coachId) {
  const rows = world.notices.filter((row) => row.coach_id === coachId && !row.read_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 100)
    .map((row) => {
      // The route selects every column except dedupe_key.
      const copy = clone(row);
      delete copy.dedupe_key;
      return copy;
    });
  return okResult({ notices: rows, server_time: iso(world.nowMs) });
}

export function markNoticeRead(world, coachId, noticeId) {
  const notice = world.notices.find((row) => row.id === noticeId && row.coach_id === coachId);
  if (!notice || notice.read_at) return okResult({ id: noticeId, already_read: true });
  notice.read_at = iso(world.nowMs);
  return okResult(clone(notice));
}

// ---------- Group conductor record ----------
function participantIds(session) {
  return (session.participants || []).filter((row) => !row.left_at).map((row) => row.client_id);
}

// limit mirrors the server (2..6 on create). The fictional replay passes its
// own larger limit explicitly; the live cockpit never does.
export function createGroupSession(world, coachId, body, { limit = LIVE_MAX_PARTICIPANTS } = {}) {
  const existing = world.sessions[body.id];
  if (existing) {
    if (existing.coach_id !== coachId) return fail(404, 'Session not found');
    return okResult({ outcome: 'replayed', session: clone(existing) });
  }
  const ids = [...new Set(Array.isArray(body.participant_ids) ? body.participant_ids : [])];
  if (ids.length < 2 || ids.length > limit) return fail(400, `Choose 2 to ${limit} trainees`);
  if (!ids.every((id) => canAccessClient(world, coachId, id))) return fail(404, 'Client not found');
  const now = iso(world.nowMs);
  world.sessions[body.id] = {
    id: body.id,
    coach_id: coachId,
    title: body.title || 'Small group',
    session_date: body.session_date,
    mode: body.mode === 'stations' ? 'stations' : 'participants',
    participants: ids.map((clientId) => ({ client_id: clientId, joined_at: now, left_at: null })),
    station_state: body.station_state || null,
    status: 'open',
    revision: 0,
    created_at: now,
    updated_at: now,
  };
  return okResult({ outcome: 'created', session: clone(world.sessions[body.id]) }, 201);
}

export function getGroupSession(world, coachId, sessionId) {
  const session = world.sessions[sessionId];
  if (!session || session.coach_id !== coachId) return fail(404, 'Session not found');
  return okResult({ session: clone(session), server_time: iso(world.nowMs) });
}

export function patchGroupSession(world, coachId, sessionId, body, { limit = LIVE_MAX_PARTICIPANTS } = {}) {
  const session = world.sessions[sessionId];
  if (!session || session.coach_id !== coachId) return fail(404, 'Session not found');
  if (!Number.isInteger(body.base_revision)) return fail(400, 'base_revision is required');
  if (body.base_revision !== session.revision) return fail(409, 'This session changed on another device.', { session: clone(session) });
  const now = iso(world.nowMs);
  if (Array.isArray(body.participant_ids)) {
    const ids = [...new Set(body.participant_ids)];
    if (ids.length < 1 || ids.length > limit) return fail(400, `Choose up to ${limit} trainees`);
    if (!ids.every((id) => canAccessClient(world, coachId, id))) return fail(404, 'Client not found');
    const kept = session.participants.map((row) => (ids.includes(row.client_id) || row.left_at ? row : { ...row, left_at: now }));
    for (const id of ids) if (!kept.some((row) => row.client_id === id && !row.left_at)) kept.push({ client_id: id, joined_at: now, left_at: null });
    session.participants = kept;
  }
  if (Object.hasOwn(body, 'station_state')) session.station_state = body.station_state;
  if (body.status === 'finished') session.status = 'finished';
  session.revision += 1;
  session.updated_at = now;
  return okResult({ session: clone(session) });
}

// Same shape and selection rules as GET /api/group-sessions/:id/overview,
// including its literal UTC-midnight filter on session_date (an inferred
// boundary hazard; see SYNTHETIC-FIXTURE-SPEC FX-26).
export function groupOverview(world, coachId, sessionId) {
  const session = world.sessions[sessionId];
  if (!session || session.coach_id !== coachId) return fail(404, 'Session not found');
  const ids = participantIds(session);
  const clients = ids.map((id) => world.clients.find((row) => row.id === id && !row.archived))
    .filter((row) => row && canAccessClient(world, coachId, row.id));
  const since = `${session.session_date}T00:00:00.000Z`;
  const latest = new Map();
  const logs = Object.values(world.logs)
    .filter((log) => !log.archived && clients.some((row) => row.id === log.client_id) && log.started_at >= since)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  for (const log of logs) {
    const current = latest.get(log.client_id);
    if (!current || (current.status !== 'active' && log.status === 'active')) latest.set(log.client_id, log);
  }
  const participants = ids.map((clientId) => {
    const client = clients.find((row) => row.id === clientId);
    const log = latest.get(clientId) || null;
    let done = 0;
    let total = 0;
    let lastWriteAt = null;
    let lastActor = null;
    for (const exercise of log?.exercises || []) {
      for (const set of exercise.sets) {
        total += 1;
        if (set.status === 'completed') done += 1;
        if (set.last_actor_role && (!lastWriteAt || set.updated_at > lastWriteAt)) { lastWriteAt = set.updated_at; lastActor = set.last_actor_role; }
      }
    }
    const openConflicts = log ? world.conflicts.filter((row) => row.workout_log_id === log.id && row.status === 'open').length : 0;
    return {
      client_id: clientId,
      name: client?.name || 'Unavailable',
      log: log ? {
        id: log.id, status: log.status, workout_name: log.workout_name, done, total,
        last_write_at: lastWriteAt, last_actor_role: lastActor,
        open_conflicts: openConflicts,
        pending_swaps: (log.pending_swaps || 0),
        swaps_to_review: (log.swaps_to_review || 0),
      } : null,
      unread_notices: world.notices.filter((row) => row.coach_id === coachId && !row.read_at && row.client_id === clientId).length,
    };
  });
  return okResult({
    session: { id: session.id, title: session.title, revision: session.revision, status: session.status },
    participants,
    server_time: iso(world.nowMs),
  });
}

export function readLog(world, coachId, logId) {
  const log = world.logs[logId];
  if (!log || !canAccessClient(world, coachId, log.client_id)) return fail(404, 'Workout log not found');
  return okResult(clone(log));
}
