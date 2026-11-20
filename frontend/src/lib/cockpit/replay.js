// Fictional session replays for the cockpit (preview only). Each replay is a
// deterministic script run against serverSim (the session-event contract in
// memory) by simulated devices that behave like the real outbox: a stable
// event id per write (workoutOutbox.js setEventEnvelope / enqueue), the
// revision the device last saw, a per-device sequence, FIFO flush, offline
// queueing and resend of an unanswered write with the SAME id.
//
// replayAt(id, step) rebuilds the world from scratch up to that step, so a
// replay can be scrubbed, reloaded or opened in another tab (the phone view)
// and always shows the same state. Every person here is fictional.

import { REPLAY_MAX_PARTICIPANTS } from './config.js';
import {
  applySetEvent, completeLog, createGroupSession, createWorld, findSet, getGroupSession, groupOverview,
  listNotices, patchGroupSession, raiseSubstitutionNotice, startLog,
} from './serverSim.js';

const MIN = 60_000;
// A fixed fictional Saturday, 09:00 in Denver (16:00 UTC).
export const REPLAY_START_MS = Date.UTC(2027, 1, 6, 16, 0, 0);
export const REPLAY_SESSION_DATE = '2027-02-06';
export const REPLAY_SESSION_ID = 'replay_session_1';

export const REPLAY_COACH = Object.freeze({ id: 'coach_ilse', name: 'Coach Ilse Moran', role: 'coach' });
// A second fictional coach, used by tests for denial checks only.
export const REPLAY_OTHER_COACH = Object.freeze({ id: 'coach_tavi', name: 'Coach Tavi Okoro', role: 'coach' });

export const REPLAY_CLIENTS = Object.freeze([
  ['juno', 'Juno Park'], ['ezra', 'Ezra Lind'], ['noor', 'Noor Abadi'], ['pell', 'Pell Rios'],
  ['quinn', 'Quinn Adair'], ['sol', 'Sol Varga'], ['ari', 'Ari Bell'], ['lio', 'Lio Kent'],
  ['mika', 'Mika Sato'], ['remy', 'Remy Duval'], ['tess', 'Tess Oyelaran'], ['lark', 'Lark Emery'],
].map(([key, name]) => Object.freeze({ id: `client_${key}`, key, name, coach_id: REPLAY_COACH.id })));

// Fictional floor. Capacity is how many people one station holds at once.
export const REPLAY_STATIONS = Object.freeze([
  Object.freeze({ id: 'A', label: 'Rack', capacity: 2 }),
  Object.freeze({ id: 'B', label: 'Bench', capacity: 2 }),
  Object.freeze({ id: 'C', label: 'Cable', capacity: 1 }),
  Object.freeze({ id: 'D', label: 'Bikes', capacity: 3 }),
]);

const EXERCISES = {
  A: { name: 'Back squat', station: 'A', sets: 3, reps: '5', load: 80, unit: 'kg', rest: 150 },
  B: { name: 'Dumbbell bench press', station: 'B', sets: 3, reps: '8', load: 24, unit: 'kg', rest: 90 },
  C: { name: 'Cable row', station: 'C', sets: 3, reps: '10', load: 35, unit: 'kg', rest: 75 },
  D: { name: 'Bike sprint', station: 'D', sets: 3, reps: '20 s', load: null, rest: 60 },
};
const ORDERS = ['ABC', 'BCA', 'CAB', 'DAB', 'ADC', 'BDA'];

function workoutFor(index) {
  return ORDERS[index % ORDERS.length].split('').map((letter) => EXERCISES[letter]);
}

// ---------- Simulated devices ----------
export function createDevice({ id, label, actorRole, clientId = null, coachId = null, skewMs = 0 }) {
  return { id, label, actor_role: actorRole, client_id: clientId, coach_id: coachId, skewMs, online: true, seq: 0, seen: {}, outbox: [], undelivered: [], dropNextReply: false, history: [] };
}

export function deviceClockMs(world, device) {
  return world.nowMs + device.skewMs;
}

function note(world, device, text) {
  device.history.push({ serverMs: world.nowMs, deviceMs: deviceClockMs(world, device), text });
}

export function flushDevice(world, device) {
  if (!device.online) return { sent: 0, stopped: 'offline' };
  let sent = 0;
  while (device.outbox.length) {
    const op = device.outbox[0];
    op.attempts += 1;
    const result = applySetEvent(world, { ...op, actor_role: device.actor_role, actor_coach_id: device.coach_id, device_id: device.id });
    sent += 1;
    if (device.dropNextReply) {
      // The server committed the write, but the answer never arrived. The
      // device keeps the write exactly as sent and resends it first.
      device.dropNextReply = false;
      note(world, device, `No answer for ${op.event_id}; kept for resend`);
      return { sent, stopped: 'reply_lost' };
    }
    if (result.status === 200) {
      device.outbox.shift();
      const outcome = result.body.event.outcome;
      if (outcome !== 'conflict') device.seen[op.set_id] = result.body.revision;
      note(world, device, `${op.event_id} → ${outcome}${outcome === 'replayed' ? ` (first: ${result.body.event.original_outcome})` : ''}`);
    } else if (result.status >= 400 && result.status < 500) {
      device.outbox.shift();
      device.undelivered.push({ ...op, error: result.body.error });
      note(world, device, `${op.event_id} refused: ${result.body.error}`);
    } else {
      return { sent, stopped: 'server_error' };
    }
  }
  return { sent, stopped: null };
}

export function deviceWrite(world, device, setId, payload) {
  device.seq += 1;
  const op = {
    event_id: `${device.id}:e${device.seq}`,
    set_id: setId,
    base_revision: device.seen[setId] ?? 0,
    local_seq: device.seq,
    offline: !device.online,
    payload,
    attempts: 0,
  };
  device.outbox.push(op);
  note(world, device, `${device.online ? 'Sent' : 'Queued offline'} ${op.event_id}`);
  return flushDevice(world, device);
}

// A coach device re-reads the logs it shows (the 5 s refresh): it learns the
// current revisions, so its next write is based on what the server holds.
export function refreshDevice(world, device, logIds) {
  for (const logId of logIds) {
    for (const exercise of world.logs[logId]?.exercises || []) for (const set of exercise.sets) device.seen[set.id] = set.revision;
  }
}

// ---------- Script helpers ----------
function clientByKey(key) {
  return REPLAY_CLIENTS.find((row) => row.key === key);
}

function logOf(ctx, key) {
  return ctx.world.logs[ctx.logs[key]];
}

// The first set not yet completed, skipping sets the device already holds
// unsent (an offline phone moves on to its next set, as the tracker does).
export function nextPendingSet(log, exclude = new Set()) {
  for (const exercise of log?.exercises || []) {
    const set = exercise.sets.find((row) => row.status !== 'completed' && !exclude.has(row.id));
    if (set) return { exercise, set };
  }
  return null;
}

function performedPayload(exercise, overrides = {}) {
  const reps = Number.parseInt(exercise.prescribed_reps, 10);
  return {
    status: 'completed',
    actual_reps: Number.isFinite(reps) ? reps : null,
    actual_load_value: exercise.prescribed_load_value,
    actual_load_unit: exercise.prescribed_load_unit,
    ...overrides,
  };
}

function phone(ctx, key) {
  return ctx.devices[`${key}_phone`];
}

// The client logs their next `count` sets on their phone at this step's
// server time.
function progress(ctx, key, count, overrides) {
  const device = phone(ctx, key);
  for (let index = 0; index < count; index += 1) {
    const next = nextPendingSet(logOf(ctx, key), new Set(device.outbox.map((op) => op.set_id)));
    if (!next) return;
    deviceWrite(ctx.world, device, next.set.id, performedPayload(next.exercise, overrides));
  }
}

function join(ctx, keys) {
  for (const key of keys) {
    const client = clientByKey(key);
    const index = REPLAY_CLIENTS.indexOf(client);
    ctx.devices[`${key}_phone`] = createDevice({ id: `${key}_phone`, label: `${client.name.split(' ')[0]}'s phone`, actorRole: 'client', clientId: client.id });
    ctx.logs[key] = startLog(ctx.world, { clientId: client.id, workoutName: 'Saturday strength', exercises: workoutFor(index) }).id;
  }
}

function openSession(ctx, keys) {
  const result = createGroupSession(ctx.world, REPLAY_COACH.id, {
    id: REPLAY_SESSION_ID, title: 'Saturday small group', session_date: REPLAY_SESSION_DATE, mode: 'participants',
    participant_ids: keys.map((key) => clientByKey(key).id),
  }, { limit: REPLAY_MAX_PARTICIPANTS });
  if (result.status >= 400) throw new Error(result.body.error);
  join(ctx, keys);
}

function arrive(ctx, keys) {
  const session = ctx.world.sessions[REPLAY_SESSION_ID];
  const current = session.participants.filter((row) => !row.left_at).map((row) => row.client_id);
  const result = patchGroupSession(ctx.world, REPLAY_COACH.id, REPLAY_SESSION_ID, {
    base_revision: session.revision,
    participant_ids: [...current, ...keys.map((key) => clientByKey(key).id)],
  }, { limit: REPLAY_MAX_PARTICIPANTS });
  if (result.status >= 400) throw new Error(result.body.error);
  join(ctx, keys);
}

function coachWrite(ctx, key, setPicker, overrides) {
  const coach = ctx.devices.coach_laptop;
  const log = logOf(ctx, key);
  const { exercise, set } = setPicker(log);
  return deviceWrite(ctx.world, coach, set.id, performedPayload(exercise, overrides));
}

const pendingAt = (offset) => (log) => {
  const all = log.exercises.flatMap((exercise) => exercise.sets.map((set) => ({ exercise, set })));
  const firstPending = all.findIndex(({ set }) => set.status !== 'completed');
  return all[firstPending + offset];
};

// ---------- Scenarios ----------
const SCENARIOS = {
  late: {
    id: 'late',
    title: 'Late arrivals',
    summary: 'Eight start on time; four arrive during the session, reaching the 12-participant maximum. Pace is measured from each person’s arrival, not the session start.',
    steps: [
      { minute: 0, label: 'Session opens with 8 on the floor', run: (ctx) => openSession(ctx, ['juno', 'ezra', 'noor', 'pell', 'quinn', 'sol', 'ari', 'lio']) },
      { minute: 7, label: 'First sets land', run: (ctx) => { for (const [key, n] of [['juno', 3], ['ezra', 3], ['noor', 2], ['pell', 2], ['quinn', 3], ['sol', 1], ['lio', 1]]) progress(ctx, key, n); } },
      { minute: 12, label: 'Mika arrives late', run: (ctx) => { arrive(ctx, ['mika']); progress(ctx, 'noor', 1); progress(ctx, 'sol', 1); } },
      { minute: 18, label: 'Remy and Tess arrive', run: (ctx) => { arrive(ctx, ['remy', 'tess']); for (const [key, n] of [['juno', 2], ['ezra', 2], ['quinn', 3], ['pell', 1], ['lio', 1], ['mika', 1]]) progress(ctx, key, n); } },
      { minute: 25, label: 'Lark arrives; coach and Sol record the same set differently', run: (ctx) => {
        arrive(ctx, ['lark']);
        refreshDevice(ctx.world, ctx.devices.coach_laptop, Object.values(ctx.logs));
        // Sol's phone records the set first; the coach laptop, which last read
        // the set before that, records a different value: a kept disagreement.
        progress(ctx, 'sol', 1, { actual_reps: 4 });
        const { set } = findSet(ctx.world, ctx.world.events['sol_phone:e3'].set_id);
        deviceWrite(ctx.world, ctx.devices.coach_laptop, set.id, { status: 'completed', actual_reps: 5, actual_load_value: 80, actual_load_unit: 'kg' });
        for (const [key, n] of [['remy', 1], ['tess', 2], ['juno', 1]]) progress(ctx, key, n);
      } },
      { minute: 34, label: 'Quinn finishes; Ari has not logged since the start', run: (ctx) => {
        progress(ctx, 'quinn', 9);
        completeLog(ctx.world, ctx.logs.quinn);
        raiseSubstitutionNotice(ctx.world, { clientId: clientByKey('pell').id, logId: ctx.logs.pell, kind: 'substitution_request', summary: 'Pell Rios: Cable row → Band row (equipment busy). Waiting for your OK.' });
        ctx.world.logs[ctx.logs.pell].pending_swaps = 1;
        for (const [key, n] of [['ezra', 2], ['noor', 2], ['lio', 2], ['mika', 1], ['remy', 2], ['tess', 2], ['lark', 2]]) progress(ctx, key, n);
      } },
      { minute: 42, label: 'Late arrivals settle in', run: (ctx) => { for (const [key, n] of [['juno', 2], ['remy', 2], ['tess', 1], ['lark', 2], ['sol', 2], ['lio', 1]]) progress(ctx, key, n); } },
    ],
  },
  drop: {
    id: 'drop',
    title: 'Device drops mid-set',
    summary: 'Pell’s phone loses signal mid-set and keeps logging offline. The coach records one of those sets meanwhile, and one reply is lost on reconnect. Nothing is counted twice; the differing value is kept for the coach to decide.',
    steps: [
      { minute: 0, label: 'Session opens with 5', run: (ctx) => openSession(ctx, ['juno', 'ezra', 'noor', 'pell', 'quinn']) },
      { minute: 8, label: 'Everyone logs two sets', run: (ctx) => { for (const key of ['juno', 'ezra', 'noor', 'pell', 'quinn']) progress(ctx, key, 2); } },
      { minute: 14, label: 'Pell’s phone drops; two sets queue offline', run: (ctx) => {
        phone(ctx, 'pell').online = false;
        progress(ctx, 'pell', 2, { actual_reps: 7 });
        for (const key of ['juno', 'ezra', 'quinn']) progress(ctx, key, 1);
      } },
      { minute: 18, label: 'Coach records Pell’s fourth set from the cockpit', run: (ctx) => {
        refreshDevice(ctx.world, ctx.devices.coach_laptop, [ctx.logs.pell]);
        coachWrite(ctx, 'pell', pendingAt(1), { actual_reps: 8 });
        progress(ctx, 'noor', 2);
      } },
      { minute: 22, label: 'Pell reconnects; the first reply is lost', run: (ctx) => {
        const device = phone(ctx, 'pell');
        device.online = true;
        device.dropNextReply = true;
        flushDevice(ctx.world, device);
      } },
      { minute: 23, label: 'Pell’s phone resends with the same ids', run: (ctx) => flushDevice(ctx.world, phone(ctx, 'pell')) },
      { minute: 30, label: 'The session carries on', run: (ctx) => { for (const [key, n] of [['juno', 2], ['ezra', 2], ['noor', 1], ['quinn', 3], ['pell', 1]]) progress(ctx, key, n); } },
    ],
  },
  skew: {
    id: 'skew',
    title: 'Two devices disagree on time',
    summary: 'Quinn’s phone runs 90 s fast and her tablet 4 min slow; the coach laptop is 10 min slow. The server’s clock orders every write, and the board reads server time only.',
    steps: [
      { minute: 0, label: 'Session opens with 4', run: (ctx) => {
        openSession(ctx, ['quinn', 'sol', 'lio', 'noor']);
        phone(ctx, 'quinn').skewMs = 90_000;
        ctx.devices.quinn_tablet = createDevice({ id: 'quinn_tablet', label: 'Quinn’s tablet', actorRole: 'client', clientId: clientByKey('quinn').id, skewMs: -4 * MIN });
        ctx.devices.coach_laptop.skewMs = -10 * MIN;
      } },
      { minute: 5, label: 'First sets', run: (ctx) => { for (const key of ['quinn', 'sol', 'lio', 'noor']) progress(ctx, key, 2); } },
      { minute: 9, label: 'Quinn’s phone (+1:30) records set 3', run: (ctx) => progress(ctx, 'quinn', 1, { actual_reps: 5 }) },
      { minute: 9.5, label: 'Quinn’s tablet (−4:00) records the same set', run: (ctx) => {
        const tablet = ctx.devices.quinn_tablet;
        const set = findSet(ctx.world, ctx.world.events['quinn_phone:e3'].set_id).set;
        // The tablet last read this set before the phone wrote it.
        deviceWrite(ctx.world, tablet, set.id, { status: 'completed', actual_reps: 4, actual_load_value: 80, actual_load_unit: 'kg' });
      } },
      { minute: 12, label: 'The coach laptop runs 10 minutes slow', run: (ctx) => { progress(ctx, 'sol', 2); progress(ctx, 'noor', 1); } },
      { minute: 20, label: 'Lio goes quiet', run: (ctx) => { for (const [key, n] of [['quinn', 2], ['sol', 2], ['noor', 3]]) progress(ctx, key, n); } },
    ],
  },
};

export const REPLAY_SCENARIOS = Object.freeze(Object.values(SCENARIOS).map(({ id, title, summary, steps }) => Object.freeze({
  id, title, summary, steps: steps.map(({ minute, label }) => ({ minute, label })),
})));

export function scenarioById(id) {
  return SCENARIOS[id] || null;
}

// Rebuild a replay up to and including `step`. Returns the same response
// bodies the live cockpit reads (session, overview, notices), plus replay-only
// detail: per-participant logs, devices and the event log.
export function replayAt(scenarioId, step) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) throw new Error(`Unknown replay: ${scenarioId}`);
  const last = Math.max(0, Math.min(scenario.steps.length - 1, Number.isInteger(step) ? step : scenario.steps.length - 1));
  const world = createWorld({ startMs: REPLAY_START_MS, coaches: [REPLAY_COACH, REPLAY_OTHER_COACH], clients: REPLAY_CLIENTS });
  const ctx = {
    world,
    logs: {},
    devices: { coach_laptop: createDevice({ id: 'coach_laptop', label: 'Coach laptop', actorRole: 'coach', coachId: REPLAY_COACH.id }) },
  };
  for (let index = 0; index <= last; index += 1) {
    const entry = scenario.steps[index];
    world.nowMs = Math.max(world.nowMs, REPLAY_START_MS + Math.round(entry.minute * MIN));
    entry.run(ctx);
  }
  const session = getGroupSession(world, REPLAY_COACH.id, REPLAY_SESSION_ID).body.session;
  return {
    scenario: { id: scenario.id, title: scenario.title, summary: scenario.summary, stepCount: scenario.steps.length },
    step: last,
    stepLabel: scenario.steps[last].label,
    timeline: scenario.steps.slice(0, last + 1).map((entry, index) => ({ index, label: entry.label, serverMs: REPLAY_START_MS + Math.round(entry.minute * MIN) })),
    coach: REPLAY_COACH,
    session,
    overview: groupOverview(world, REPLAY_COACH.id, REPLAY_SESSION_ID).body,
    notices: listNotices(world, REPLAY_COACH.id).body,
    logsByClient: Object.fromEntries(Object.entries(ctx.logs).map(([key, logId]) => [clientByKey(key).id, world.logs[logId]])),
    devices: Object.values(ctx.devices),
    events: Object.values(world.events),
    world,
  };
}
