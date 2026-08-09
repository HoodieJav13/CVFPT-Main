const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function validLoad(value, unit) {
  if (value === null || value === undefined || value === '') return unit === null || unit === undefined || unit === '';
  return Number.isFinite(Number(value)) && Number(value) >= 0 && ['lb', 'kg'].includes(unit);
}

function validPerformedReps(value) {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function validPerformedRpe(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value)
    && value >= 1 && value <= 10 && Number.isInteger(value * 2));
}

function decodeHistoryCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('invalid');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!parsed || Object.keys(parsed).sort().join(',') !== 'completed_at,id'
      || typeof parsed.completed_at !== 'string' || Number.isNaN(Date.parse(parsed.completed_at))
      || typeof parsed.id !== 'string' || !uuid.test(parsed.id)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('invalid');
  }
}

function encodeHistoryCursor(occurrence) {
  return Buffer.from(JSON.stringify({ completed_at: occurrence.completed_at, id: occurrence.workout_log_id })).toString('base64url');
}

function workoutSetUpdatePayload(body, set, now = new Date().toISOString()) {
  const status = body.status === 'completed' ? 'completed' : body.status === 'pending' ? 'pending' : set.status;
  const loadValue = Object.hasOwn(body, 'actual_load_value') ? body.actual_load_value : set.actual_load_value;
  const loadUnit = Object.hasOwn(body, 'actual_load_unit') ? body.actual_load_unit : set.actual_load_unit;
  if (!validLoad(loadValue, loadUnit)) throw Object.assign(new Error('Enter a valid weight and unit'), { status: 400 });
  const actualReps = Object.hasOwn(body, 'actual_reps') ? body.actual_reps : set.actual_reps;
  const actualRpe = Object.hasOwn(body, 'actual_rpe') ? body.actual_rpe : set.actual_rpe;
  if (!validPerformedReps(actualReps)) throw Object.assign(new Error('Reps must be a nonnegative whole number or null'), { status: 400 });
  if (!validPerformedRpe(actualRpe)) throw Object.assign(new Error('RPE must be 1 through 10 in 0.5 increments or null'), { status: 400 });
  return {
    status,
    actual_load_value: loadValue === '' || loadValue === null ? null : Number(loadValue),
    actual_load_unit: loadValue === '' || loadValue === null ? null : loadUnit,
    actual_reps: actualReps,
    actual_rpe: actualRpe,
    completed_at: status === 'completed' ? now : null,
    updated_at: now,
  };
}

async function updateSetAtHandlerBoundary({ body, set, mutate, now }) {
  const payload = workoutSetUpdatePayload(body, set, now);
  return mutate(payload);
}

function workoutRpcStatus(error) {
  const message = error?.message || '';
  if (/not found|Assigned workout/i.test(message)) return 404;
  if (/not active|cannot be changed/i.test(message)) return 409;
  if (/required|Complete at least one set/i.test(message)) return 400;
  return 500;
}

function canReadLog(user, log) {
  if (!user || !log || log.archived) return false;
  if (user.role === 'client') return log.client_id === user.client?.id;
  return canAccessClient(user, log.client);
}

/**
 * Write access to a workout log (roadmap D1/D2): the owning client, or a
 * coach/admin authorized for the log's client. Coaches cannot write for
 * archived clients.
 */
function canWriteLog(user, log) {
  if (!user || !log || log.archived) return false;
  if (user.role === 'client') return log.client_id === user.client?.id;
  return Boolean(log.client && !log.client.archived && canAccessClient(user, log.client));
}

/**
 * Attribution stamp derived ONLY from the authenticated actor — never from
 * the request body, so a client cannot claim coach-entered data (D5).
 */
function actorStamp(user) {
  if (user?.role === 'coach' || user?.role === 'admin') {
    return { entered_by: 'coach', entered_by_coach_id: user.coach.id };
  }
  return { entered_by: 'client', entered_by_coach_id: null };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Program 011 A: one in-app notification per workout event to the owning
// coach and every admin (mirrors the completion trigger's recipient set).
// Idempotent via the (recipient, event_type, workout_log_id) unique key.
async function notifyCoachesOfWorkoutEvent(eventType, log) {
  const { data: coaches, error } = await supabaseAdmin.from('coaches')
    .select('id').eq('archived', false)
    .or(`id.eq.${log.coach_id},is_admin.eq.true`);
  if (error) throw error;
  const rows = (coaches || []).map((coach) => ({
    recipient_coach_id: coach.id, event_type: eventType, workout_log_id: log.id,
  }));
  if (!rows.length) return;
  const { error: insertErr } = await supabaseAdmin.from('notifications')
    .upsert(rows, { onConflict: 'recipient_coach_id,event_type,workout_log_id', ignoreDuplicates: true });
  if (insertErr) throw insertErr;
}

// When a workout is finished, its "started" notifications become stale —
// mark them read so a coach never sees a started/finished pair one tap apart.
async function markStartedNotificationsRead(logId) {
  await supabaseAdmin.from('notifications')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('event_type', 'workout_started').eq('workout_log_id', logId).is('read_at', null);
}

function canAuthorCoachResponse(user, log) {
  return Boolean(
    (user?.role === 'coach' || user?.role === 'admin')
    && log?.client
    && !log.client.archived
    && canAccessClient(user, log.client),
  );
}

function validateCoachResponseContent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.content !== 'string') {
    return { ok: false, error: 'Coach response must be text' };
  }
  const content = body.content.trim();
  if (!content) return { ok: false, error: 'Coach response is required' };
  if (Array.from(content).length > 4000) return { ok: false, error: 'Coach response must be 4,000 characters or fewer' };
  return { ok: true, content };
}

function newestCoachResponseFirst(a, b) {
  const activityDelta = new Date(b.edited_at || b.created_at).getTime() - new Date(a.edited_at || a.created_at).getTime();
  return activityDelta || String(b.id).localeCompare(String(a.id));
}


/**
 * Log-level attribution derived from completed, non-archived sets only:
 * untouched prescribed sets carry the schema default and skipped sets were
 * never entered by anyone, so neither is evidence of who logged data. A log
 * with no completed sets falls back to who started it (D5, docs/roadmap.md).
 */
function computeLogAttribution(log) {
  const entries = new Set(
    (log.exercises || [])
      .flatMap((exercise) => exercise.sets || [])
      .filter((set) => !set.archived && set.status === 'completed')
      .map((set) => (set.entered_by === 'coach' ? 'coach' : 'client')),
  );
  if (entries.size === 0) return log.started_by === 'coach' ? 'coach' : 'client';
  if (entries.size === 1) return entries.values().next().value;
  return 'mixed';
}

async function workoutLogWithDetails(id) {
  const { data: log, error } = await supabaseAdmin.from('workout_logs')
    .select('*, client:clients(id, name, coach_id, archived)')
    .eq('id', id).eq('archived', false).maybeSingle();
  if (error) throw error;
  if (!log) return null;
  const { data: coachResponses, error: responseError } = await supabaseAdmin.from('workout_coach_responses')
    .select('*').eq('workout_log_id', id).eq('archived', false);
  if (responseError) throw responseError;
  const { data: exercises, error: exerciseError } = await supabaseAdmin.from('workout_log_exercises')
    .select('*').eq('workout_log_id', id).eq('archived', false).order('position');
  if (exerciseError) throw exerciseError;
  const exerciseIds = (exercises || []).map((exercise) => exercise.id);
  let sets = [];
  if (exerciseIds.length) {
    const { data, error: setError } = await supabaseAdmin.from('workout_log_sets')
      .select('*').in('workout_log_exercise_id', exerciseIds).eq('archived', false).order('set_number');
    if (setError) throw setError;
    sets = data || [];
  }
  const setsByExercise = new Map();
  sets.forEach((set) => {
    const rows = setsByExercise.get(set.workout_log_exercise_id) || [];
    rows.push(set);
    setsByExercise.set(set.workout_log_exercise_id, rows);
  });
  const detailed = {
    ...log,
    coach_responses: (coachResponses || []).sort(newestCoachResponseFirst),
    exercises: (exercises || []).map((exercise) => ({
      ...exercise,
      sets: setsByExercise.get(exercise.id) || [],
    })),
  };
  return { ...detailed, attribution: computeLogAttribution(detailed) };
}

/**
 * Bulk variant of workoutLogWithDetails for the history lists: a constant
 * four queries (logs, responses, exercises, sets) however many logs are
 * expanded — the sequential per-log loop was ~4 queries × 50 logs for a
 * single page view. Per-log shape is identical to the single builder, and
 * the input id order (completed_at desc) is preserved.
 */
async function workoutLogsWithDetailsBulk(ids) {
  if (!ids.length) return [];
  const { data: logs, error } = await supabaseAdmin.from('workout_logs')
    .select('*, client:clients(id, name, coach_id, archived)')
    .in('id', ids).eq('archived', false);
  if (error) throw error;
  const logIds = (logs || []).map((log) => log.id);
  if (!logIds.length) return [];
  const { data: coachResponses, error: responseError } = await supabaseAdmin.from('workout_coach_responses')
    .select('*').in('workout_log_id', logIds).eq('archived', false);
  if (responseError) throw responseError;
  const { data: exercises, error: exerciseError } = await supabaseAdmin.from('workout_log_exercises')
    .select('*').in('workout_log_id', logIds).eq('archived', false).order('position');
  if (exerciseError) throw exerciseError;
  const exerciseIds = (exercises || []).map((exercise) => exercise.id);
  let sets = [];
  if (exerciseIds.length) {
    const { data, error: setError } = await supabaseAdmin.from('workout_log_sets')
      .select('*').in('workout_log_exercise_id', exerciseIds).eq('archived', false).order('set_number');
    if (setError) throw setError;
    sets = data || [];
  }
  const setsByExercise = new Map();
  for (const set of sets) {
    const rows = setsByExercise.get(set.workout_log_exercise_id) || [];
    rows.push(set);
    setsByExercise.set(set.workout_log_exercise_id, rows);
  }
  const exercisesByLog = new Map();
  for (const exercise of exercises || []) {
    const rows = exercisesByLog.get(exercise.workout_log_id) || [];
    rows.push({ ...exercise, sets: setsByExercise.get(exercise.id) || [] });
    exercisesByLog.set(exercise.workout_log_id, rows);
  }
  const responsesByLog = new Map();
  for (const response of coachResponses || []) {
    const rows = responsesByLog.get(response.workout_log_id) || [];
    rows.push(response);
    responsesByLog.set(response.workout_log_id, rows);
  }
  const position = new Map(ids.map((id, index) => [id, index]));
  return (logs || [])
    .map((log) => {
      const detailed = {
        ...log,
        coach_responses: (responsesByLog.get(log.id) || []).sort(newestCoachResponseFirst),
        exercises: exercisesByLog.get(log.id) || [],
      };
      return { ...detailed, attribution: computeLogAttribution(detailed) };
    })
    .sort((a, b) => position.get(a.id) - position.get(b.id));
}

async function clientActiveLog(clientId) {
  const { data, error } = await supabaseAdmin.from('workout_logs')
    .select('id').eq('client_id', clientId).eq('status', 'active').eq('archived', false).maybeSingle();
  if (error) throw error;
  return data?.id ? workoutLogWithDetails(data.id) : null;
}

async function requireWritableActiveLog(req, res) {
  const log = await workoutLogWithDetails(req.params.id);
  if (!canWriteLog(req.user, log)) {
    res.status(404).json({ error: 'Workout log not found' });
    return null;
  }
  if (log.status !== 'active') {
    res.status(409).json({ error: 'Completed workouts cannot be changed' });
    return null;
  }
  return log;
}

function createExerciseHistoryHandler({
  findLog = workoutLogWithDetails,
  runHistory = (args) => supabaseAdmin.rpc('get_workout_exercise_history', args),
} = {}) {
  return async function exerciseHistoryHandler(req, res) {
    let cursor;
    try {
      cursor = decodeHistoryCursor(req.query.cursor);
    } catch {
      return res.status(400).json({ error: 'Invalid history cursor' });
    }
    try {
      const log = await findLog(req.params.id);
      // Client on their own active log, or coach/admin on an active log of a
      // client they own (matrix rows 1-4, docs/roadmap.md) — reads are scoped
      // exactly like writes, and archived clients stay off-limits.
      const allowed = Boolean(log) && !log.archived && log.status === 'active' && (
        (req.user.role === 'client' && log.client_id === req.user.client?.id)
        || ((req.user.role === 'coach' || req.user.role === 'admin')
          && log.client && !log.client.archived && canAccessClient(req.user, log.client))
      );
      if (!allowed) {
        return res.status(404).json({ error: 'Workout log not found' });
      }
      const exercise = log.exercises.find((row) => row.id === req.params.exerciseId && !row.archived);
      if (!exercise) return res.status(404).json({ error: 'Workout exercise not found' });

      const { data, error } = await runHistory({
        // Always the log's own client: history is the client's, whoever reads it.
        p_client_id: log.client_id,
        p_exercise_library_id: exercise.exercise_library_id || null,
        p_source_workout_exercise_id: exercise.source_workout_exercise_id || null,
        p_before_completed_at: cursor?.completed_at || null,
        p_before_log_id: cursor?.id || null,
        p_occurrence_limit: 11,
      });
      if (error) throw error;
      const grouped = new Map();
      for (const row of data || []) {
        if (!grouped.has(row.workout_log_id)) grouped.set(row.workout_log_id, {
          workout_log_id: row.workout_log_id,
          completed_at: row.completed_at,
          exercise_name: row.exercise_name,
          sets: [],
        });
        grouped.get(row.workout_log_id).sets.push({
          set_number: row.set_number,
          actual_load_value: row.actual_load_value,
          actual_load_unit: row.actual_load_unit,
          actual_reps: row.actual_reps,
          actual_rpe: row.actual_rpe,
        });
      }
      const allOccurrences = [...grouped.values()]
        .map((occurrence) => ({ ...occurrence, sets: occurrence.sets.sort((a, b) => a.set_number - b.set_number) }))
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)
          || b.workout_log_id.localeCompare(a.workout_log_id));
      const occurrences = allOccurrences.slice(0, 10);
      return res.json({
        occurrences,
        next_cursor: allOccurrences.length > 10 ? encodeHistoryCursor(occurrences[occurrences.length - 1]) : null,
      });
    } catch (error) {
      logError('exercise history error', error);
      return res.status(500).json({ error: 'Failed to load exercise history' });
    }
  };
}

router.post('/start', async (req, res) => {
  try {
    const body = req.body || {};
    const programAssignmentId = body.program_assignment_id || null;
    const programDayId = body.program_day_id || null;
    const workoutAssignmentId = body.workout_assignment_id || null;
    const programSource = Boolean(programAssignmentId || programDayId);
    if ((programSource && (!programAssignmentId || !programDayId || workoutAssignmentId))
      || (!programSource && !workoutAssignmentId)) {
      return res.status(400).json({ error: 'Choose one assigned workout' });
    }
    const sessionId = body.session_id || null;
    if (sessionId !== null && (typeof sessionId !== 'string' || !UUID_RE.test(sessionId))) {
      return res.status(400).json({ error: 'Invalid session' });
    }

    // Resolve which client this workout belongs to from the authenticated
    // actor — coaches name a client they own; clients are always themselves.
    let clientId;
    if (req.user.role === 'client') {
      clientId = req.user.client.id;
    } else {
      const targetClientId = body.client_id;
      if (typeof targetClientId !== 'string' || !UUID_RE.test(targetClientId)) {
        return res.status(400).json({ error: 'Choose a client' });
      }
      const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
        .eq('id', targetClientId).eq('archived', false).maybeSingle();
      if (!clientRow || !canAccessClient(req.user, clientRow)) {
        return res.status(404).json({ error: 'Client not found' });
      }
      clientId = clientRow.id;
    }

    const stamp = actorStamp(req.user);
    const { data, error } = await supabaseAdmin.rpc('start_workout_log_v2', {
      p_client_id: clientId,
      p_program_assignment_id: programAssignmentId,
      p_program_day_id: programDayId,
      p_workout_assignment_id: workoutAssignmentId,
      p_started_by: stamp.entered_by,
      p_started_by_coach_id: stamp.entered_by_coach_id,
      p_session_id: sessionId,
    });
    if (error) throw error;
    const log = await workoutLogWithDetails(data.workout_log_id);
    if (data.outcome === 'conflict') {
      return res.status(409).json({ error: 'Finish or abandon your active workout first', active_workout: log });
    }
    if (data.outcome === 'already_completed') {
      return res.status(409).json({ error: 'This dated workout has already been completed', workout_log: log });
    }
    // Client-started, fully-tracked workouts tell the coach "in the gym now".
    // One-tap quick-complete suppresses this (see /quick-complete) so the
    // coach never gets a started/finished pair a second apart.
    if (data.outcome === 'started' && req.user.role === 'client' && !body.suppress_start_notification) {
      try { await notifyCoachesOfWorkoutEvent('workout_started', log); } catch (e) { logError('workout started notify error', e); }
    }
    return res.status(data.outcome === 'started' ? 201 : 200).json({ outcome: data.outcome, workout_log: log });
  } catch (error) {
    logError('start workout log error', error);
    const status = workoutRpcStatus(error);
    return res.status(status).json({ error: status === 500 ? 'Failed to start workout' : error.message });
  }
});

router.get('/active', requireClient, async (req, res) => {
  try {
    return res.json(await clientActiveLog(req.user.client.id));
  } catch (error) {
    logError('active workout log error', error);
    return res.status(500).json({ error: 'Failed to load active workout' });
  }
});

router.get('/mine', requireClient, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('workout_logs')
      .select('id').eq('client_id', req.user.client.id).eq('status', 'completed').eq('archived', false)
      .order('completed_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json(await workoutLogsWithDetailsBulk((data || []).map((row) => row.id)));
  } catch (error) {
    logError('client workout history error', error);
    return res.status(500).json({ error: 'Failed to load workout history' });
  }
});

// Lightweight companion to /mine for the progress-chart markers: one query,
// dates only — never the full 50-log detail expansion.
router.get('/mine/completed-dates', requireClient, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('workout_logs')
      .select('completed_at').eq('client_id', req.user.client.id)
      .eq('status', 'completed').eq('archived', false)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }).limit(500);
    if (error) throw error;
    return res.json({ dates: (data || []).map((row) => row.completed_at) });
  } catch (error) {
    logError('client workout completed-dates error', error);
    return res.status(500).json({ error: 'Failed to load workout dates' });
  }
});

router.get('/coach-feedback/unread-count', requireClient, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('workout_coach_responses')
      .select('id').eq('client_id', req.user.client.id).eq('archived', false).is('read_at', null);
    if (error) throw error;
    return res.json({ unread: (data || []).length });
  } catch (error) {
    logError('coach feedback unread count error', error);
    return res.status(500).json({ error: 'Failed to load coach feedback count' });
  }
});

router.patch('/:id/coach-feedback/read', requireClient, async (req, res) => {
  try {
    const log = await workoutLogWithDetails(req.params.id);
    if (!log || log.client_id !== req.user.client.id) return res.status(404).json({ error: 'Workout log not found' });
    const unreadIds = (log.coach_responses || []).filter((response) => !response.read_at).map((response) => response.id);
    if (!unreadIds.length) return res.json({ updated: 0, read_at: null });
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('workout_coach_responses')
      .update({ read_at: now, updated_at: now })
      .in('id', unreadIds)
      .eq('workout_log_id', log.id)
      .eq('client_id', req.user.client.id)
      .eq('archived', false)
      .is('read_at', null)
      .select('id');
    if (error) throw error;
    return res.json({ updated: (data || []).length, read_at: now });
  } catch (error) {
    logError('mark coach feedback read error', error);
    return res.status(500).json({ error: 'Failed to mark coach feedback read' });
  }
});

router.get('/client/:clientId', requireCoach, async (req, res) => {
  try {
    const { data: client } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
    if (!client || !canAccessClient(req.user, client)) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.from('workout_logs').select('id')
      .eq('client_id', client.id).eq('status', 'completed').eq('archived', false)
      .order('completed_at', { ascending: false }).limit(50);
    if (error) throw error;
    return res.json(await workoutLogsWithDetailsBulk((data || []).map((row) => row.id)));
  } catch (error) {
    logError('coach workout history error', error);
    return res.status(500).json({ error: 'Failed to load workout history' });
  }
});

router.put('/:id/coach-response', requireCoach, async (req, res) => {
  const validation = validateCoachResponseContent(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  try {
    const log = await workoutLogWithDetails(req.params.id);
    if (!canAuthorCoachResponse(req.user, log)) return res.status(404).json({ error: 'Workout log not found' });
    if (log.status !== 'completed') return res.status(409).json({ error: 'Only completed workouts accept coach responses' });
    const { data, error } = await supabaseAdmin.rpc('save_workout_coach_response', {
      p_workout_log_id: log.id,
      p_author_coach_id: req.user.coach.id,
      p_content: validation.content,
    });
    if (error) throw error;
    return res.status(data?.outcome === 'created' ? 201 : 200).json(data);
  } catch (error) {
    logError('save coach response error', error);
    return res.status(500).json({ error: 'Failed to save coach response' });
  }
});

// Role logic lives in the handler: client on own log, coach/admin via ownership.
router.get('/:id/exercises/:exerciseId/history', createExerciseHistoryHandler());

router.get('/:id', async (req, res) => {
  try {
    const log = await workoutLogWithDetails(req.params.id);
    if (!canReadLog(req.user, log)) return res.status(404).json({ error: 'Workout log not found' });
    return res.json(log);
  } catch (error) {
    logError('workout log detail error', error);
    return res.status(500).json({ error: 'Failed to load workout' });
  }
});

router.patch('/:id/sets/:setId', async (req, res) => {
  try {
    const log = await requireWritableActiveLog(req, res);
    if (!log) return undefined;
    const exerciseIds = new Set(log.exercises.map((exercise) => exercise.id));
    const set = log.exercises.flatMap((exercise) => exercise.sets).find((row) => row.id === req.params.setId);
    if (!set || !exerciseIds.has(set.workout_log_exercise_id)) return res.status(404).json({ error: 'Workout set not found' });
    const { data, error } = await updateSetAtHandlerBoundary({
      body: req.body || {}, set,
      mutate: (payload) => supabaseAdmin.from('workout_log_sets').update({ ...payload, ...actorStamp(req.user) })
        .eq('id', set.id).eq('archived', false).select().single(),
    });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    logError('update workout set error', error);
    return res.status(500).json({ error: 'Failed to save set' });
  }
});

router.post('/:id/exercises/:exerciseId/sets', async (req, res) => {
  try {
    const log = await requireWritableActiveLog(req, res);
    if (!log) return undefined;
    const exercise = log.exercises.find((row) => row.id === req.params.exerciseId);
    if (!exercise) return res.status(404).json({ error: 'Workout exercise not found' });
    const operationId = String(req.body?.client_operation_id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      return res.status(400).json({ error: 'A valid operation ID is required' });
    }
    const { data: existing, error: existingError } = await supabaseAdmin.from('workout_log_sets').select('*')
      .eq('workout_log_exercise_id', exercise.id)
      .eq('client_operation_id', operationId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.json(existing);
    const nextNumber = Math.max(0, ...exercise.sets.map((set) => set.set_number)) + 1;
    if (nextNumber > 50) return res.status(400).json({ error: 'This exercise has reached the set limit' });
    const { data, error } = await supabaseAdmin.from('workout_log_sets').insert({
      workout_log_exercise_id: exercise.id,
      client_operation_id: operationId,
      set_number: nextNumber,
      set_origin: 'extra',
      actual_load_value: exercise.prescribed_load_value,
      actual_load_unit: exercise.prescribed_load_unit,
      ...actorStamp(req.user),
    }).select().single();
    if (error?.code === '23505') {
      const { data: duplicate, error: duplicateError } = await supabaseAdmin.from('workout_log_sets').select('*')
        .eq('workout_log_exercise_id', exercise.id)
        .eq('client_operation_id', operationId)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) return res.json(duplicate);
    }
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    logError('add workout set error', error);
    return res.status(500).json({ error: 'Failed to add set' });
  }
});

router.patch('/:id/sets/:setId/archive', async (req, res) => {
  try {
    const log = await requireWritableActiveLog(req, res);
    if (!log) return undefined;
    const set = log.exercises.flatMap((exercise) => exercise.sets).find((row) => row.id === req.params.setId);
    if (!set || set.set_origin !== 'extra') return res.status(404).json({ error: 'Extra set not found' });
    const { data, error } = await supabaseAdmin.from('workout_log_sets')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', set.id).eq('set_origin', 'extra').eq('archived', false).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    logError('archive workout set error', error);
    return res.status(500).json({ error: 'Failed to remove set' });
  }
});

router.patch('/:id/exercises/:exerciseId/notes', async (req, res) => {
  try {
    const log = await requireWritableActiveLog(req, res);
    if (!log) return undefined;
    const exercise = log.exercises.find((row) => row.id === req.params.exerciseId);
    if (!exercise) return res.status(404).json({ error: 'Workout exercise not found' });
    const notes = String(req.body?.client_notes || '').trim().slice(0, 2000);
    const { data, error } = await supabaseAdmin.from('workout_log_exercises')
      .update({ client_notes: notes || null, updated_at: new Date().toISOString() })
      .eq('id', exercise.id).eq('archived', false).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    logError('update workout exercise notes error', error);
    return res.status(500).json({ error: 'Failed to save notes' });
  }
});

router.post('/:id/complete-all', async (req, res) => {
  try {
    const log = await requireWritableActiveLog(req, res);
    if (!log) return undefined;
    const stamp = actorStamp(req.user);
    const { error } = await supabaseAdmin.rpc('complete_all_workout_sets_v2', {
      p_workout_log_id: log.id,
      p_client_id: log.client_id,
      p_entered_by: stamp.entered_by,
      p_entered_by_coach_id: stamp.entered_by_coach_id,
    });
    if (error) throw error;
    return res.json(await workoutLogWithDetails(log.id));
  } catch (error) {
    logError('complete all workout sets error', error);
    return res.status(500).json({ error: 'Failed to complete remaining sets' });
  }
});

// Program 011 A: one-tap "I did it" for clients who won't track sets.
// Open app → tap → done. Starts the assigned workout, marks every set
// completed WITHOUT set detail (actual load/reps stay null so exercise
// history is never polluted with phantom prescribed weights), flags the
// log quick_completed, and finishes it — counting toward adherence and
// notifying the coach with a single "completed (not tracked)" signal.
router.post('/quick-complete', requireClient, async (req, res) => {
  try {
    const body = req.body || {};
    const programAssignmentId = body.program_assignment_id || null;
    const programDayId = body.program_day_id || null;
    const workoutAssignmentId = body.workout_assignment_id || null;
    const programSource = Boolean(programAssignmentId || programDayId);
    if ((programSource && (!programAssignmentId || !programDayId || workoutAssignmentId))
      || (!programSource && !workoutAssignmentId)) {
      return res.status(400).json({ error: 'Choose one assigned workout' });
    }
    const clientId = req.user.client.id;

    const { data: started, error: startErr } = await supabaseAdmin.rpc('start_workout_log_v2', {
      p_client_id: clientId,
      p_program_assignment_id: programAssignmentId,
      p_program_day_id: programDayId,
      p_workout_assignment_id: workoutAssignmentId,
      p_started_by: 'client',
      p_started_by_coach_id: null,
      p_session_id: null,
    });
    if (startErr) throw startErr;
    if (started.outcome === 'conflict') {
      const active = await workoutLogWithDetails(started.workout_log_id);
      return res.status(409).json({ error: 'Finish or abandon your active workout first', active_workout: active });
    }
    if (started.outcome === 'already_completed') {
      return res.status(409).json({ error: 'This workout is already done for today' });
    }
    const logId = started.workout_log_id;

    // Sets → completed with values left null (honest "not tracked").
    const { error: allErr } = await supabaseAdmin.rpc('complete_all_workout_sets_v2', {
      p_workout_log_id: logId, p_client_id: clientId, p_entered_by: 'client', p_entered_by_coach_id: null,
    });
    if (allErr) throw allErr;
    // Flag while still active — the immutability trigger guards child sets,
    // not the parent log row.
    await supabaseAdmin.from('workout_logs').update({ quick_completed: true }).eq('id', logId);
    const { error: completeErr } = await supabaseAdmin.rpc('complete_workout_log_v2', {
      p_workout_log_id: logId, p_client_id: clientId, p_notes: '', p_feedback: '', p_completed_at: null,
    });
    if (completeErr) throw completeErr;

    return res.status(201).json(await workoutLogWithDetails(logId));
  } catch (error) {
    logError('quick complete workout error', error);
    const status = workoutRpcStatus(error);
    return res.status(status).json({ error: status === 500 ? 'Could not mark the workout done' : error.message });
  }
});

router.post('/:id/abandon', async (req, res) => {
  try {
    const log = await requireWritableActiveLog(req, res);
    if (!log) return undefined;
    const { data, error } = await supabaseAdmin.from('workout_logs')
      .update({ status: 'abandoned', updated_at: new Date().toISOString() })
      .eq('id', log.id).eq('status', 'active').select().single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    logError('abandon workout error', error);
    return res.status(500).json({ error: 'Failed to abandon workout' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const log = await workoutLogWithDetails(req.params.id);
    if (!canWriteLog(req.user, log)) return res.status(404).json({ error: 'Workout log not found' });
    // Performance-time completion (docs/offline-workout-completion.md):
    // a queued offline finish carries the locally-confirmed timestamp. Only
    // a parseable ISO string is forwarded; the RPC clamps to
    // (started_at, now()] and falls back to sync time otherwise.
    const rawCompletedAt = req.body?.completed_at_local;
    const completedAt = typeof rawCompletedAt === 'string' && rawCompletedAt.length <= 40
      && !Number.isNaN(Date.parse(rawCompletedAt))
      ? new Date(rawCompletedAt).toISOString() : null;
    const { error } = await supabaseAdmin.rpc('complete_workout_log_v2', {
      p_workout_log_id: log.id,
      p_client_id: log.client_id,
      p_notes: String(req.body?.notes || '').slice(0, 4000),
      p_feedback: String(req.body?.feedback || '').slice(0, 4000),
      p_completed_at: completedAt,
    });
    if (error) {
      if (/Complete at least one set/i.test(error.message || '')) return res.status(400).json({ error: 'Complete at least one set' });
      throw error;
    }
    await markStartedNotificationsRead(log.id);
    return res.json(await workoutLogWithDetails(log.id));
  } catch (error) {
    logError('complete workout error', error);
    const status = workoutRpcStatus(error);
    return res.status(status).json({ error: status === 500 ? 'Failed to finish workout' : error.message });
  }
});

module.exports = router;
module.exports.workoutLogWithDetails = workoutLogWithDetails;
module.exports.canReadLog = canReadLog;
module.exports.canWriteLog = canWriteLog;
module.exports.actorStamp = actorStamp;
module.exports.computeLogAttribution = computeLogAttribution;
module.exports.workoutRpcStatus = workoutRpcStatus;
module.exports.canAuthorCoachResponse = canAuthorCoachResponse;
module.exports.newestCoachResponseFirst = newestCoachResponseFirst;
module.exports.validateCoachResponseContent = validateCoachResponseContent;
module.exports.validPerformedReps = validPerformedReps;
module.exports.validPerformedRpe = validPerformedRpe;
module.exports.decodeHistoryCursor = decodeHistoryCursor;
module.exports.workoutSetUpdatePayload = workoutSetUpdatePayload;
module.exports.updateSetAtHandlerBoundary = updateSetAtHandlerBoundary;
module.exports.createExerciseHistoryHandler = createExerciseHistoryHandler;
