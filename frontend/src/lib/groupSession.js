// Small-group session conductor: the pure, serializable session model.
//
// Two kinds of state are kept strictly apart:
//   * The SHARED conductor record (stations, rotation, roster changes,
//     equipment amendments, timeline). It lives only on the coach's device
//     (see groupSessionStore.js) and is never sent to a client.
//   * Each trainee's OWN work. A "visit" is one trainee at one station in one
//     round; its sets are written only to that trainee's own Quick Session
//     workout log (groupSessionSync.js). A visit is bound to exactly one
//     trainee for life, so no entry can move to another person.
//
// Prescriptions are never edited in place: an equipment amendment is a new,
// timestamped record that applies to visits created after it, and visits
// keep the exercise snapshot they started with.

export const GROUP_SESSION_VERSION = 1;
export const MIN_TRAINEES = 2;
export const MAX_TRAINEES = 6;
export const MIN_STATIONS = 2;
export const MAX_STATIONS = 4;
export const MAX_EXTRA_SETS = 5;

const STATION_LETTERS = ['A', 'B', 'C', 'D'];

export function stationLabel(index) {
  return `Station ${STATION_LETTERS[index] || index + 1}`;
}

function cleanText(value, limit = 120) {
  return String(value ?? '').trim().slice(0, limit);
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

// An exercise prescription as the conductor stores it.
export function normalizePrescription(input = {}) {
  const load = input.default_load_value;
  const hasLoad = load !== '' && load !== null && load !== undefined && Number.isFinite(Number(load)) && Number(load) >= 0;
  return {
    exercise_library_id: input.exercise_library_id || null,
    name: cleanText(input.name || input.custom_name, 200),
    sets: Math.min(positiveInt(input.sets, 3), 10),
    reps: cleanText(input.reps, 20) || '10',
    default_load_value: hasLoad ? Number(load) : null,
    default_load_unit: hasLoad ? (input.default_load_unit === 'kg' ? 'kg' : 'lb') : null,
  };
}

export function validateSetup({ trainees = [], stations = [] }) {
  const errors = [];
  if (trainees.length < MIN_TRAINEES || trainees.length > MAX_TRAINEES) {
    errors.push(`Choose ${MIN_TRAINEES} to ${MAX_TRAINEES} trainees.`);
  }
  if (new Set(trainees.map((row) => row.id)).size !== trainees.length) errors.push('Each trainee can join only once.');
  if (stations.length < MIN_STATIONS || stations.length > MAX_STATIONS) {
    errors.push(`Set up ${MIN_STATIONS} to ${MAX_STATIONS} stations.`);
  }
  stations.forEach((station, index) => {
    if (!cleanText(station.name)) errors.push(`${stationLabel(index)} needs an exercise.`);
  });
  return errors;
}

export function createGroupSession({ id, environment, coachId, date, title, trainees, stations, now = new Date().toISOString() }) {
  const errors = validateSetup({ trainees, stations });
  if (errors.length) throw Object.assign(new Error(errors[0]), { errors });
  const normalizedStations = stations.map((station, index) => ({
    id: STATION_LETTERS[index],
    label: stationLabel(index),
    plan: normalizePrescription(station),
  }));
  return {
    version: GROUP_SESSION_VERSION,
    id,
    environment,
    coachId,
    date,
    title: cleanText(title) || `Small group · ${date}`,
    createdAt: now,
    status: 'running',
    round: 0,
    roundCount: normalizedStations.length,
    stations: normalizedStations,
    amendments: [],
    slots: trainees.map((trainee, index) => ({
      index,
      occupants: [{ traineeId: trainee.id, name: cleanText(trainee.name), fromRound: 0, toRound: null, joinedAt: now, reason: null }],
    })),
    visits: {},
    events: [{ at: now, type: 'start', text: `Session started with ${trainees.length} trainees and ${normalizedStations.length} stations.` }],
  };
}

// Rotation: every slot advances one station per round, so with more trainees
// than stations, slots i and i + stations share a station.
export function stationIndexFor(session, slotIndex, round) {
  return (slotIndex + round) % session.stations.length;
}

export function stationFor(session, slotIndex, round) {
  return session.stations[stationIndexFor(session, slotIndex, round)];
}

// The exercise a NEW visit at this station would use now: the original plan,
// or the latest equipment amendment (a restore returns to the plan).
export function effectiveExercise(session, stationId) {
  const station = session.stations.find((row) => row.id === stationId);
  const latest = [...session.amendments].reverse().find((row) => row.stationId === stationId);
  if (!latest || latest.kind === 'restore') return { ...station.plan, amended: false };
  return { ...latest.exercise, amended: true, amendmentId: latest.id, replaces: station.plan.name, reason: latest.reason };
}

export function occupantsFor(session, slotIndex, round) {
  const slot = session.slots[slotIndex];
  return slot.occupants.filter((row) => row.fromRound <= round && (row.toRound === null || row.toRound > round));
}

// The person who takes new sets in this slot this round (the latest arrival).
export function activeOccupant(session, slotIndex, round) {
  const rows = occupantsFor(session, slotIndex, round);
  return rows.length ? rows[rows.length - 1] : null;
}

export function inSessionTraineeIds(session) {
  return new Set(session.slots.flatMap((slot) => slot.occupants.map((row) => row.traineeId)));
}

export function visitKey(round, slotIndex, traineeId) {
  return `${round}:${slotIndex}:${traineeId}`;
}

export function getVisit(session, round, slotIndex, traineeId) {
  return session.visits[visitKey(round, slotIndex, traineeId)] || null;
}

// A visit is created (locally) the first time a set is entered for this
// trainee here. It freezes the exercise and the Quick Session request body,
// so a replay after a lost reply sends byte-identical data.
export function openVisit(session, { round, slotIndex, traineeId, requestId, now = new Date().toISOString() }) {
  const key = visitKey(round, slotIndex, traineeId);
  if (session.visits[key]) return session;
  const occupant = occupantsFor(session, slotIndex, round).find((row) => row.traineeId === traineeId);
  if (!occupant) throw new Error('That trainee is not in this slot this round.');
  const station = stationFor(session, slotIndex, round);
  const exercise = effectiveExercise(session, station.id);
  const visit = {
    key,
    round,
    slotIndex,
    traineeId,
    traineeName: occupant.name,
    stationId: station.id,
    stationLabel: station.label,
    exercise,
    requestId,
    body: {
      request_id: requestId,
      client_id: traineeId,
      assigned_for: session.date,
      name: `${session.title} · ${station.label} · ${exercise.name}`.slice(0, 120),
      // The trainee can read their own workout, so this names only their own
      // work: never other trainees, and never the coach's free-text reason.
      notes: exercise.amended
        ? `Small-group session, round ${round + 1}. Equipment change: ${exercise.name} replaces ${exercise.replaces}.`
        : `Small-group session, round ${round + 1}.`,
      exercises: [{
        ...(exercise.exercise_library_id ? { exercise_library_id: exercise.exercise_library_id } : { custom_name: exercise.name }),
        sets: String(exercise.sets),
        reps: exercise.reps,
        ...(exercise.default_load_value != null ? { default_load_value: exercise.default_load_value, default_load_unit: exercise.default_load_unit } : {}),
      }],
    },
    assignmentId: null,
    logId: null,
    logExerciseId: null,
    status: 'open',
    error: null,
    createdAt: now,
    sets: Array.from({ length: exercise.sets }, (_, index) => ({
      key: `p${index + 1}`,
      setNumber: index + 1,
      origin: 'prescribed',
      setId: null,
      operationId: null,
      entry: null,
      state: 'empty',
      error: null,
    })),
  };
  return { ...session, visits: { ...session.visits, [key]: visit } };
}

export function updateVisit(session, key, updater) {
  const visit = session.visits[key];
  if (!visit) return session;
  return { ...session, visits: { ...session.visits, [key]: updater(visit) } };
}

export function updateVisitSet(session, key, setKey, updater) {
  return updateVisit(session, key, (visit) => ({
    ...visit,
    sets: visit.sets.map((set) => (set.key === setKey ? updater(set) : set)),
  }));
}

export function normalizeEntry(entry = {}, fallbackUnit = 'lb') {
  const reps = entry.reps === '' || entry.reps == null ? null : Number(entry.reps);
  const load = entry.load === '' || entry.load == null ? null : Number(entry.load);
  if (reps !== null && (!Number.isInteger(reps) || reps < 0 || reps > 999)) throw new Error('Reps must be a whole number.');
  if (load !== null && (!Number.isFinite(load) || load < 0 || load > 2000)) throw new Error('Weight must be zero or more.');
  if (reps === null && load === null) throw new Error('Enter reps or weight.');
  return { reps, load, unit: load === null ? null : (entry.unit === 'kg' ? 'kg' : fallbackUnit) };
}

// Values the coach entered are recorded locally first (write-ahead); the
// sync layer then saves them to the trainee's own log.
export function recordEntry(session, key, setKey, entry) {
  const visit = session.visits[key];
  if (!visit) throw new Error('This entry is no longer part of the session.');
  if (['completed', 'abandoned', 'missing'].includes(visit.status)) throw new Error(`${visit.traineeName}'s ${visit.stationLabel} work is already closed.`);
  const unit = visit.exercise.default_load_unit || 'lb';
  const normalized = normalizeEntry(entry, unit);
  return updateVisitSet(session, key, setKey, (set) => ({ ...set, entry: normalized, state: 'pending', error: null }));
}

export function addExtraSet(session, key, operationId) {
  const visit = session.visits[key];
  if (!visit) throw new Error('This entry is no longer part of the session.');
  const extras = visit.sets.filter((set) => set.origin === 'extra').length;
  if (extras >= MAX_EXTRA_SETS) throw new Error('That is the most extra sets for one station.');
  const setNumber = Math.max(0, ...visit.sets.map((set) => set.setNumber)) + 1;
  return updateVisit(session, key, (row) => ({
    ...row,
    sets: [...row.sets, { key: `x${operationId}`, setNumber, origin: 'extra', setId: null, operationId, entry: null, state: 'empty', error: null }],
  }));
}

export function addEvent(session, type, text, now = new Date().toISOString()) {
  return { ...session, events: [...session.events, { at: now, type, text }] };
}

export function amendStation(session, { id, stationId, exercise, reason, now = new Date().toISOString() }) {
  const station = session.stations.find((row) => row.id === stationId);
  if (!station) throw new Error('Unknown station.');
  const prescription = normalizePrescription(exercise);
  if (!prescription.name) throw new Error('Choose the replacement exercise.');
  const amendment = { id, stationId, kind: 'substitute', exercise: prescription, reason: cleanText(reason, 160) || null, round: session.round, at: now };
  return addEvent({ ...session, amendments: [...session.amendments, amendment] }, 'equipment',
    `${station.label}: ${prescription.name} replaces ${station.plan.name}${amendment.reason ? ` (${amendment.reason})` : ''}.`, now);
}

export function restoreStation(session, { id, stationId, now = new Date().toISOString() }) {
  const station = session.stations.find((row) => row.id === stationId);
  if (!station) throw new Error('Unknown station.');
  if (!effectiveExercise(session, stationId).amended) return session;
  return addEvent({ ...session, amendments: [...session.amendments, { id, stationId, kind: 'restore', exercise: null, reason: null, round: session.round, at: now }] },
    'equipment', `${station.label}: equipment back, ${station.plan.name} restored for new work.`, now);
}

// A substitute takes over a slot's rotation from the current round. The
// departing trainee's recorded work stays theirs and stays visible.
export function substituteTrainee(session, { slotIndex, substitute, reason, now = new Date().toISOString() }) {
  const round = session.round;
  const slot = session.slots[slotIndex];
  const leaving = activeOccupant(session, slotIndex, round);
  if (!leaving) throw new Error('Nobody to replace in that slot.');
  if (inSessionTraineeIds(session).has(substitute.id)) throw new Error(`${substitute.name} is already in this session.`);
  const leavingVisit = getVisit(session, round, slotIndex, leaving.traineeId);
  const keepsRound = Boolean(leavingVisit && leavingVisit.sets.some((set) => set.entry));
  const occupants = slot.occupants.map((row) => (row === leaving ? { ...row, toRound: keepsRound ? round + 1 : round, leftRound: round, leftAt: now, reason: cleanText(reason, 160) || null } : row));
  occupants.push({ traineeId: substitute.id, name: cleanText(substitute.name), fromRound: round, toRound: null, joinedAt: now, reason: cleanText(reason, 160) || null, replaces: leaving.traineeId });
  const next = { ...session, slots: session.slots.map((row) => (row.index === slotIndex ? { ...row, occupants } : row)) };
  return addEvent(next, 'substitution', `${substitute.name} replaces ${leaving.name} from round ${round + 1}${reason ? ` (${cleanText(reason, 160)})` : ''}.`, now);
}

export function visitsForRound(session, round) {
  return Object.values(session.visits).filter((visit) => visit.round === round);
}

export function unsyncedSets(session) {
  return Object.values(session.visits).flatMap((visit) => visit.sets
    .filter((set) => set.entry && set.state !== 'saved')
    .map((set) => ({ visit, set })));
}

// A round can advance once every visit with recorded work is closed on the
// server and nothing is waiting to sync.
export function roundBlockers(session, round = session.round) {
  const blockers = [];
  for (const visit of visitsForRound(session, round)) {
    if (visit.sets.some((set) => set.entry && set.state !== 'saved')) blockers.push(`${visit.traineeName}: sets still saving at ${visit.stationLabel}.`);
    else if (!['completed', 'abandoned', 'missing'].includes(visit.status)) blockers.push(`${visit.traineeName}: ${visit.stationLabel} not closed yet.`);
  }
  return blockers;
}

export function advanceRound(session, now = new Date().toISOString()) {
  if (session.status !== 'running') return session;
  if (roundBlockers(session).length) throw new Error('Finish saving this round first.');
  if (session.round + 1 >= session.roundCount) {
    return addEvent({ ...session, status: 'finished', finishedAt: now }, 'finish', 'Session finished.', now);
  }
  return addEvent({ ...session, round: session.round + 1 }, 'rotate', `Rotated to round ${session.round + 2}.`, now);
}

function setVolume(set) {
  if (!set.entry || set.entry.reps == null || set.entry.load == null) return 0;
  return set.entry.reps * set.entry.load;
}

// Individual and group summaries come only from each trainee's own saved sets.
export function summarize(session) {
  const trainees = new Map();
  for (const slot of session.slots) {
    for (const occupant of slot.occupants) {
      if (!trainees.has(occupant.traineeId)) {
        trainees.set(occupant.traineeId, { traineeId: occupant.traineeId, name: occupant.name, joinedRound: occupant.fromRound, leftRound: occupant.leftRound ?? null, replaces: occupant.replaces || null, stations: [], setsDone: 0, setsPlanned: 0, volume: {}, unsynced: 0 });
      }
    }
  }
  const visits = Object.values(session.visits).sort((a, b) => a.round - b.round || a.slotIndex - b.slotIndex);
  for (const visit of visits) {
    const person = trainees.get(visit.traineeId);
    if (!person) continue;
    const saved = visit.sets.filter((set) => set.entry && set.state === 'saved');
    const planned = visit.sets.filter((set) => set.origin === 'prescribed').length;
    person.setsDone += saved.length;
    person.setsPlanned += planned;
    person.unsynced += visit.sets.filter((set) => set.entry && set.state !== 'saved').length;
    const unit = saved.find((set) => set.entry.unit)?.entry.unit || visit.exercise.default_load_unit || 'lb';
    person.volume[unit] = (person.volume[unit] || 0) + saved.reduce((sum, set) => sum + setVolume(set), 0);
    person.stations.push({
      round: visit.round, stationLabel: visit.stationLabel, exercise: visit.exercise.name, amended: visit.exercise.amended,
      replaces: visit.exercise.replaces || null, planned, status: visit.status,
      sets: saved.map((set) => ({ setNumber: set.setNumber, origin: set.origin, reps: set.entry.reps, load: set.entry.load, unit: set.entry.unit })),
    });
  }
  const stations = session.stations.map((station) => {
    const rows = visits.filter((visit) => visit.stationId === station.id);
    return {
      id: station.id,
      label: station.label,
      plan: station.plan.name,
      setsDone: rows.reduce((sum, visit) => sum + visit.sets.filter((set) => set.entry && set.state === 'saved').length, 0),
      visits: rows.length,
      amendments: session.amendments.filter((row) => row.stationId === station.id),
    };
  });
  const people = [...trainees.values()];
  return {
    title: session.title,
    date: session.date,
    status: session.status,
    roundsDone: session.status === 'finished' ? session.roundCount : session.round,
    roundCount: session.roundCount,
    totalSets: people.reduce((sum, row) => sum + row.setsDone, 0),
    unsynced: people.reduce((sum, row) => sum + row.unsynced, 0),
    substitutions: session.events.filter((row) => row.type === 'substitution').length,
    disruptions: session.amendments.filter((row) => row.kind === 'substitute').length,
    people,
    stations,
    events: session.events,
  };
}
