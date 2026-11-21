// Pure cockpit model: turns the existing conductor responses (GET
// /group-sessions/:id, /overview, /coach-notices; or the same bodies from a
// fictional replay) into a roster heat map, a ranked attention queue and
// station queues, plus the keyboard triage state machine.
//
// Time rule: every age, pace and freshness figure is computed against the
// response's server_time. The coach device clock is never compared with a
// server timestamp (unlike the older ParticipantConductor self-logging check),
// so a laptop that runs fast or slow cannot change what the board says.

import {
  ATTENTION_WEIGHTS, COCKPIT_COACH_UNDO_MS, IDLE_AFTER_MS, JUST_ARRIVED_MS, PACE_TOLERANCE, PLANNED_SESSION_MINUTES,
} from './config.js';
import { stationIndexFor } from '../groupSession.js';

const ms = (value) => {
  const parsed = value == null ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function minutesText(durationMs) {
  const minutes = Math.max(0, Math.round(durationMs / 60_000));
  if (minutes < 1) return 'under a minute';
  return minutes === 1 ? '1 min' : `${minutes} min`;
}

// ---------- Normalize ----------
// session: GET /group-sessions/:id body.session (joined_at/left_at); overview:
// GET /group-sessions/:id/overview body; notes: local cockpit notes.
export function buildRoster({ session, overview, notes = [] }) {
  const serverNowMs = ms(overview?.server_time);
  const joined = new Map((session?.participants || []).filter((row) => !row.left_at).map((row) => [row.client_id, ms(row.joined_at)]));
  const rows = (overview?.participants || []).map((row) => {
    const log = row.log ? {
      id: row.log.id,
      status: row.log.status,
      workoutName: row.log.workout_name,
      done: row.log.done || 0,
      total: row.log.total || 0,
      lastWriteAtMs: ms(row.log.last_write_at),
      lastActorRole: row.log.last_actor_role || null,
      openConflicts: row.log.open_conflicts || 0,
      pendingSwaps: row.log.pending_swaps || 0,
      swapsToReview: row.log.swaps_to_review || 0,
    } : null;
    const clientNotes = notes.filter((entry) => entry.clientId === row.client_id);
    return {
      clientId: row.client_id,
      name: row.name,
      joinedAtMs: joined.get(row.client_id) ?? null,
      log,
      unreadNotices: row.unread_notices || 0,
      openPain: clientNotes.filter((entry) => entry.kind === 'pain' && !entry.resolved),
      notes: clientNotes,
    };
  });
  return { serverNowMs, rows };
}

// ---------- Heat ----------
export function paceOf(row, serverNowMs) {
  if (!row.log || !row.log.total || serverNowMs == null) return null;
  const startMs = row.joinedAtMs ?? null;
  if (startMs == null) return null;
  const elapsed = Math.max(0, serverNowMs - startMs);
  const expected = Math.min(1, elapsed / (PLANNED_SESSION_MINUTES * 60_000));
  const actual = row.log.done / row.log.total;
  return { expected, actual, gapSets: Math.max(0, Math.round((expected - actual) * row.log.total)) };
}

export function idleMs(row, serverNowMs) {
  if (!row.log || row.log.status !== 'active' || serverNowMs == null) return null;
  const since = row.log.lastWriteAtMs ?? row.joinedAtMs;
  return since == null ? null : Math.max(0, serverNowMs - since);
}

export function classifyHeat(row, serverNowMs) {
  if (!row.log) return 'not_started';
  if (row.log.status === 'completed' || (row.log.total > 0 && row.log.done >= row.log.total)) return 'done';
  if (row.log.openConflicts || row.log.pendingSwaps || row.log.swapsToReview || row.unreadNotices || row.openPain.length) return 'needs_cue';
  const pace = paceOf(row, serverNowMs);
  const idle = idleMs(row, serverNowMs);
  if ((pace && pace.actual + PACE_TOLERANCE < pace.expected) || (idle != null && idle > IDLE_AFTER_MS)) return 'behind';
  return 'on_pace';
}

// ---------- Attention ----------
const NOTICE_KIND_TO_ITEM = { set_conflict: 'conflict', substitution_request: 'swap_waiting', substitution_used: 'swap_review', substitution_offline: 'swap_review' };

// Ranked list of what needs the coach, each with a plain reason. Item keys
// are stable for the same underlying state and change when it grows (a
// second conflict is a new item), so clearing hides exactly what was seen.
export function attentionItems({ rows, serverNowMs, notices = [] }) {
  const items = [];
  const noticesByClient = new Map();
  for (const notice of notices) {
    const list = noticesByClient.get(notice.client_id) || [];
    list.push(notice);
    noticesByClient.set(notice.client_id, list);
  }
  const push = (row, kind, reason, sinceMs, extra = {}) => items.push({
    key: `${row.clientId}:${kind}:${extra.keyPart ?? ''}`,
    clientId: row.clientId,
    name: row.name,
    kind,
    weight: ATTENTION_WEIGHTS[kind],
    reason,
    sinceMs: sinceMs ?? serverNowMs,
    noticeIds: extra.noticeIds || [],
    noteId: extra.noteId || null,
  });
  for (const row of rows) {
    const clientNotices = noticesByClient.get(row.clientId) || [];
    const take = (itemKind) => clientNotices.filter((notice) => NOTICE_KIND_TO_ITEM[notice.kind] === itemKind);
    const log = row.log;
    if (log?.openConflicts) {
      const linked = take('conflict');
      push(row, 'conflict', log.openConflicts === 1 ? 'Two different values for one set. Both are kept; choose the final one.' : `${log.openConflicts} sets have two different values. Choose the final ones.`,
        linked.length ? Math.min(...linked.map((notice) => ms(notice.created_at))) : log.lastWriteAtMs, { keyPart: log.openConflicts, noticeIds: linked.map((notice) => notice.id) });
    }
    if (log?.pendingSwaps) {
      const linked = take('swap_waiting');
      push(row, 'swap_waiting', linked[0]?.summary?.replace(/^[^:]+:\s*/, '') || 'A swap is waiting for your OK.',
        linked.length ? Math.min(...linked.map((notice) => ms(notice.created_at))) : null, { keyPart: log.pendingSwaps, noticeIds: linked.map((notice) => notice.id) });
    }
    for (const pain of row.openPain) push(row, 'pain', `Pain flag: ${pain.text}`, pain.createdAtMs, { keyPart: pain.id, noteId: pain.id });
    if (log?.swapsToReview) {
      const linked = take('swap_review');
      push(row, 'swap_review', 'A swap was used without your OK. Review it.', linked.length ? ms(linked[0].created_at) : null, { keyPart: log.swapsToReview, noticeIds: linked.map((notice) => notice.id) });
    }
    const claimed = new Set(items.flatMap((item) => item.noticeIds));
    for (const notice of clientNotices) {
      if (claimed.has(notice.id)) continue;
      push(row, 'notice', notice.summary.replace(/^[^:]+:\s*/, ''), ms(notice.created_at), { keyPart: notice.id, noticeIds: [notice.id] });
    }
    const idle = idleMs(row, serverNowMs);
    const heat = classifyHeat(row, serverNowMs);
    if (log && log.status === 'active' && idle != null && idle > IDLE_AFTER_MS) {
      push(row, 'idle', `No set recorded for ${minutesText(idle)}.`, serverNowMs - idle, { keyPart: Math.floor(idle / IDLE_AFTER_MS) });
    } else if (heat === 'behind') {
      const pace = paceOf(row, serverNowMs);
      push(row, 'behind', `${log.done} of ${log.total} sets, about ${pace.gapSets} behind pace.`, row.joinedAtMs, { keyPart: pace.gapSets });
    }
    if (!log || (log.done === 0 && log.status === 'active')) {
      if (row.joinedAtMs != null && serverNowMs != null && serverNowMs - row.joinedAtMs <= JUST_ARRIVED_MS) {
        push(row, 'arrived', `Just arrived ${minutesText(serverNowMs - row.joinedAtMs)} ago. First set not started.`, row.joinedAtMs, { keyPart: row.joinedAtMs });
      }
    }
  }
  return items.sort((a, b) => b.weight - a.weight || (a.sinceMs ?? 0) - (b.sinceMs ?? 0) || a.name.localeCompare(b.name));
}

// ---------- Stations ----------
// stations: [{ id, label, capacity }]; entries: [{ clientId, name, stationId,
// sinceMs }] where sinceMs is when they reached the station (server time).
// The first `capacity` arrivals are working; the rest wait in arrival order.
export function stationQueues(stations, entries) {
  return stations.map((station) => {
    const here = entries.filter((entry) => entry.stationId === station.id)
      .sort((a, b) => (a.sinceMs ?? 0) - (b.sinceMs ?? 0) || a.name.localeCompare(b.name));
    const capacity = station.capacity ?? 1;
    return { ...station, working: here.slice(0, capacity), waiting: here.slice(capacity) };
  });
}

// Live station-mode sessions: the existing conductor record
// (group_sessions.station_state, the groupSession.js model) rotates every
// slot one station per round. Who is at each station now, and who comes next
// round, follow from that rotation rule; arrival times are not recorded there.
export function conductorStationQueues(stationState) {
  if (!stationState || !Array.isArray(stationState.stations) || !stationState.stations.length || !Array.isArray(stationState.slots)) return [];
  const round = Number.isInteger(stationState.round) ? stationState.round : 0;
  const roundCount = Number.isInteger(stationState.roundCount) ? stationState.roundCount : stationState.stations.length;
  const occupantsAt = (slot, atRound) => (slot.occupants || [])
    .filter((occupant) => (occupant.fromRound ?? 0) <= atRound && (occupant.toRound == null || occupant.toRound >= atRound))
    .map((occupant) => ({ clientId: occupant.traineeId, name: occupant.name }));
  const at = (stationIndex, atRound) => stationState.slots
    .filter((slot) => stationIndexFor(stationState, slot.index, atRound) === stationIndex)
    .flatMap((slot) => occupantsAt(slot, atRound));
  return stationState.stations.map((station, stationIndex) => ({
    id: station.id,
    label: station.plan?.name ? `${station.label} · ${station.plan.name}` : station.label,
    capacity: null,
    working: at(stationIndex, round),
    waiting: round + 1 < roundCount ? at(stationIndex, round + 1) : [],
  }));
}

// Replay detail (or a drill-in workout log): where each active participant
// is now. The station of their next set, reached when their previous
// exercise's last set was recorded (or when they started).
export function stationEntries(rows, logsByClient) {
  const entries = [];
  for (const row of rows) {
    const log = logsByClient[row.clientId];
    if (!log || log.status !== 'active') continue;
    const index = log.exercises.findIndex((exercise) => exercise.sets.some((set) => set.status !== 'completed'));
    if (index < 0) continue;
    const exercise = log.exercises[index];
    if (!exercise.station) continue;
    const previous = index > 0 ? log.exercises[index - 1] : null;
    const reachedAt = previous ? Math.max(...previous.sets.map((set) => ms(set.updated_at) ?? 0)) : ms(log.started_at);
    const started = exercise.sets.some((set) => set.status === 'completed');
    entries.push({ clientId: row.clientId, name: row.name, stationId: exercise.station, sinceMs: started ? (reachedAt ?? 0) - 1 : reachedAt, exercise: exercise.exercise_name });
  }
  return entries;
}

// ---------- Client view ----------
// What the client's phone shows: the next set, its load, the rest timer and
// the coach note pinned to that set (notes are pinned to the set that was
// next when the coach wrote them: "it shows on their next set").
export function clientNextView(log, notes = [], serverNowMs = null) {
  if (!log) return null;
  const flat = log.exercises.flatMap((exercise, exerciseIndex) => exercise.sets.map((set) => ({ exercise, exerciseIndex, set })));
  const nextIndex = flat.findIndex(({ set }) => set.status !== 'completed');
  const lastDone = flat.filter(({ set }) => set.status === 'completed')
    .sort((a, b) => (ms(a.set.updated_at) ?? 0) - (ms(b.set.updated_at) ?? 0)).at(-1) || null;
  const next = nextIndex >= 0 ? flat[nextIndex] : null;
  let rest = null;
  if (next && lastDone) {
    const startedMs = ms(lastDone.set.completed_at || lastDone.set.updated_at);
    const seconds = lastDone.exercise.rest_seconds ?? 90;
    rest = { seconds, endsAtMs: startedMs + seconds * 1000, remainingMs: serverNowMs == null ? null : Math.max(0, startedMs + seconds * 1000 - serverNowMs) };
  }
  const pinned = next ? notes.filter((entry) => entry.setRef?.setId === next.set.id && !entry.resolved) : [];
  const unpinned = notes.filter((entry) => !entry.setRef && !entry.resolved);
  return {
    done: log.status === 'completed' || !next,
    workoutName: log.workout_name,
    setsDone: flat.filter(({ set }) => set.status === 'completed').length,
    setsTotal: flat.length,
    next: next ? {
      exerciseName: next.exercise.exercise_name,
      setId: next.set.id,
      setNumber: next.set.set_number,
      setCount: next.exercise.sets.length,
      reps: next.exercise.prescribed_reps,
      loadValue: next.exercise.prescribed_load_value,
      loadUnit: next.exercise.prescribed_load_unit,
      upNext: flat.slice(nextIndex + 1).find(({ exerciseIndex }) => exerciseIndex !== next.exerciseIndex)?.exercise.exercise_name || null,
    } : null,
    rest,
    notes: [...pinned, ...unpinned],
  };
}

// The set a note made now should be pinned to: the client's next set.
export function noteTargetFor(log) {
  if (!log) return null;
  for (const exercise of log.exercises) {
    const set = exercise.sets.find((row) => row.status !== 'completed');
    if (set) return { logId: log.id, setId: set.id, label: `${exercise.exercise_name} · set ${set.set_number}` };
  }
  return null;
}

// ---------- Keyboard triage ----------
// Keys: ↑/↓ or K/J move through the attention queue, ←/→ move across the
// roster, C clears the selected item (one key), U undoes the last clear within
// ten seconds, N writes a note, P flags pain, Space or Enter jumps to the next
// uncleared item ("next"), ? toggles the key guide, Escape closes panels.
const KEYMAP = {
  ArrowDown: 'down', j: 'down', J: 'down',
  ArrowUp: 'up', k: 'up', K: 'up',
  ArrowRight: 'right', ArrowLeft: 'left',
  c: 'clear', C: 'clear', Delete: 'clear', Backspace: 'clear',
  u: 'undo', U: 'undo',
  n: 'note', N: 'note',
  p: 'pain', P: 'pain',
  ' ': 'next', Enter: 'next',
  '?': 'help',
  Escape: 'escape',
};

export function keyAction(event) {
  if (!event) return null;
  const target = event.target;
  const tag = target?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
  // While typing, every key (including Ctrl/Cmd-Z) belongs to the field.
  if (typing) return event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey ? 'escape' : null;
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return (event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey ? 'undo' : null;
  }
  // Space/Enter on a focused button or link activate that control instead.
  if ((event.key === ' ' || event.key === 'Enter') && (tag === 'BUTTON' || tag === 'A')) return null;
  return KEYMAP[event.key] || null;
}

// pending: every clear still inside its own ten-second Undo window, oldest
// first. Each keeps its full window; a later clear never shortens an earlier
// one. Undo restores the most recent clear that is still open.
export function createTriageState() {
  return { selectedKey: null, cleared: {}, pending: [] };
}

// `cleared` is keyed by item key; presence (not the timestamp's truthiness)
// decides, so a clear at time 0 still hides its item.
export function isCleared(state, key) {
  return Object.hasOwn(state.cleared, key);
}

export function visibleItems(items, state) {
  return items.filter((item) => !isCleared(state, item.key));
}

export function latestPending(state, nowMs) {
  for (let index = state.pending.length - 1; index >= 0; index -= 1) {
    if (nowMs < state.pending[index].untilMs) return state.pending[index];
  }
  return null;
}

// One pure step. Returns { state, effects }; effects are what the page must do
// (send the deferred notice reads). Clearing is local first: a notice read is
// only sent after its Undo window, because the server has no "mark unread"
// (conductor.js notices PATCH only sets read_at).
export function triageReducer(state, action, { items, nowMs }) {
  const visible = visibleItems(items, state);
  const index = Math.max(0, visible.findIndex((item) => item.key === state.selectedKey));
  const effects = [];
  const select = (item) => ({ ...state, selectedKey: item?.key ?? null });
  switch (action.type) {
    case 'select':
      return { state: { ...state, selectedKey: action.key }, effects };
    case 'down':
      return { state: select(visible[Math.min(visible.length - 1, index + (state.selectedKey ? 1 : 0))]), effects };
    case 'up':
      return { state: select(visible[Math.max(0, index - 1)]), effects };
    case 'next':
      return { state: select(visible[0]), effects };
    case 'clear': {
      const item = visible.find((row) => row.key === (action.key ?? state.selectedKey)) || visible[0];
      if (!item) return { state, effects };
      const rest = visible.filter((row) => row.key !== item.key);
      const position = visible.indexOf(item);
      return {
        state: {
          selectedKey: (rest[Math.min(position, rest.length - 1)] || null)?.key ?? null,
          cleared: { ...state.cleared, [item.key]: nowMs },
          pending: [...state.pending, { item, untilMs: nowMs + COCKPIT_COACH_UNDO_MS }],
        },
        effects,
      };
    }
    case 'undo': {
      const open = latestPending(state, nowMs);
      if (!open) return { state, effects };
      const cleared = { ...state.cleared };
      delete cleared[open.item.key];
      return { state: { selectedKey: open.item.key, cleared, pending: state.pending.filter((entry) => entry !== open) }, effects };
    }
    case 'tick': {
      const expired = state.pending.filter((entry) => nowMs >= entry.untilMs);
      if (!expired.length) return { state, effects };
      for (const entry of expired) effects.push({ type: 'commit', item: entry.item });
      return { state: { ...state, pending: state.pending.filter((entry) => nowMs < entry.untilMs) }, effects };
    }
    case 'restore': {
      // A committed clear whose server write failed comes back, visibly.
      const cleared = { ...state.cleared };
      delete cleared[action.key];
      return { state: { ...state, cleared }, effects };
    }
    default:
      return { state, effects };
  }
}

// A cleared item whose key no longer exists has been resolved elsewhere: drop
// it, so the cleared map does not grow for the length of a session.
export function pruneCleared(state, items) {
  const keys = new Set(items.map((item) => item.key));
  const pendingKeys = new Set(state.pending.map((entry) => entry.item.key));
  const cleared = Object.fromEntries(Object.entries(state.cleared).filter(([key]) => keys.has(key) || pendingKeys.has(key)));
  return Object.keys(cleared).length === Object.keys(state.cleared).length ? state : { ...state, cleared };
}

export function heatCounts(rows, serverNowMs) {
  const counts = { needs_cue: 0, behind: 0, on_pace: 0, done: 0, not_started: 0 };
  for (const row of rows) counts[classifyHeat(row, serverNowMs)] += 1;
  return counts;
}

// Freshness from the server's own clock: how old the newest server answer is
// relative to when it was received, never device-now minus server timestamp.
export function freshness(receivedAtDeviceMs, deviceNowMs) {
  if (receivedAtDeviceMs == null) return 'Not loaded yet';
  const age = Math.max(0, deviceNowMs - receivedAtDeviceMs);
  return age < 2_000 ? 'Updated just now' : `Updated ${Math.round(age / 1000)} s ago`;
}
