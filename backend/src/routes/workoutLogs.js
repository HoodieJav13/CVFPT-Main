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

async function workoutLogWithDetails(id) {
  const { data: log, error } = await supabaseAdmin.from('workout_logs')
    .select('*, client:clients(id, name, coach_id, archived)')
    .eq('id', id).eq('archived', false).maybeSingle();
  if (error) throw error;
  if (!log) return null;
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
  return {
    ...log,
    exercises: (exercises || []).map((exercise) => ({
      ...exercise,
      sets: setsByExercise.get(exercise.id) || [],
    })),
  };
}

async function clientActiveLog(clientId) {
  const { data, error } = await supabaseAdmin.from('workout_logs')
    .select('id').eq('client_id', clientId).eq('status', 'active').eq('archived', false).maybeSingle();
  if (error) throw error;
  return data?.id ? workoutLogWithDetails(data.id) : null;
}

async function requireOwnedActiveLog(req, res) {
  const log = await workoutLogWithDetails(req.params.id);
  if (!log || req.user.role !== 'client' || log.client_id !== req.user.client.id) {
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
      if (!log || req.user.role !== 'client' || log.client_id !== req.user.client?.id
        || log.status !== 'active' || log.archived) {
        return res.status(404).json({ error: 'Workout log not found' });
      }
      const exercise = log.exercises.find((row) => row.id === req.params.exerciseId && !row.archived);
      if (!exercise) return res.status(404).json({ error: 'Workout exercise not found' });

      const { data, error } = await runHistory({
        p_client_id: req.user.client.id,
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

router.post('/start', requireClient, async (req, res) => {
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
    const { data, error } = await supabaseAdmin.rpc('start_workout_log', {
      p_client_id: req.user.client.id,
      p_program_assignment_id: programAssignmentId,
      p_program_day_id: programDayId,
      p_workout_assignment_id: workoutAssignmentId,
    });
    if (error) throw error;
    const log = await workoutLogWithDetails(data.workout_log_id);
    if (data.outcome === 'conflict') {
      return res.status(409).json({ error: 'Finish or abandon your active workout first', active_workout: log });
    }
    if (data.outcome === 'already_completed') {
      return res.status(409).json({ error: 'This dated workout has already been completed', workout_log: log });
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
    const result = [];
    for (const row of data || []) result.push(await workoutLogWithDetails(row.id));
    return res.json(result);
  } catch (error) {
    logError('client workout history error', error);
    return res.status(500).json({ error: 'Failed to load workout history' });
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
    const result = [];
    for (const row of data || []) result.push(await workoutLogWithDetails(row.id));
    return res.json(result);
  } catch (error) {
    logError('coach workout history error', error);
    return res.status(500).json({ error: 'Failed to load workout history' });
  }
});

router.get('/:id/exercises/:exerciseId/history', requireClient, createExerciseHistoryHandler());

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

router.patch('/:id/sets/:setId', requireClient, async (req, res) => {
  try {
    const log = await requireOwnedActiveLog(req, res);
    if (!log) return undefined;
    const exerciseIds = new Set(log.exercises.map((exercise) => exercise.id));
    const set = log.exercises.flatMap((exercise) => exercise.sets).find((row) => row.id === req.params.setId);
    if (!set || !exerciseIds.has(set.workout_log_exercise_id)) return res.status(404).json({ error: 'Workout set not found' });
    const { data, error } = await updateSetAtHandlerBoundary({
      body: req.body || {}, set,
      mutate: (payload) => supabaseAdmin.from('workout_log_sets').update(payload)
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

router.post('/:id/exercises/:exerciseId/sets', requireClient, async (req, res) => {
  try {
    const log = await requireOwnedActiveLog(req, res);
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

router.patch('/:id/sets/:setId/archive', requireClient, async (req, res) => {
  try {
    const log = await requireOwnedActiveLog(req, res);
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

router.patch('/:id/exercises/:exerciseId/notes', requireClient, async (req, res) => {
  try {
    const log = await requireOwnedActiveLog(req, res);
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

router.post('/:id/complete-all', requireClient, async (req, res) => {
  try {
    const log = await requireOwnedActiveLog(req, res);
    if (!log) return undefined;
    const { error } = await supabaseAdmin.rpc('complete_all_workout_sets', {
      p_workout_log_id: log.id, p_client_id: req.user.client.id,
    });
    if (error) throw error;
    return res.json(await workoutLogWithDetails(log.id));
  } catch (error) {
    logError('complete all workout sets error', error);
    return res.status(500).json({ error: 'Failed to complete remaining sets' });
  }
});

router.post('/:id/abandon', requireClient, async (req, res) => {
  try {
    const log = await requireOwnedActiveLog(req, res);
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

router.post('/:id/complete', requireClient, async (req, res) => {
  try {
    const log = await workoutLogWithDetails(req.params.id);
    if (!log || log.client_id !== req.user.client.id) return res.status(404).json({ error: 'Workout log not found' });
    const { error } = await supabaseAdmin.rpc('complete_workout_log', {
      p_workout_log_id: log.id,
      p_client_id: req.user.client.id,
      p_notes: String(req.body?.notes || '').slice(0, 4000),
      p_feedback: String(req.body?.feedback || '').slice(0, 4000),
    });
    if (error) {
      if (/Complete at least one set/i.test(error.message || '')) return res.status(400).json({ error: 'Complete at least one set' });
      throw error;
    }
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
module.exports.workoutRpcStatus = workoutRpcStatus;
module.exports.validPerformedReps = validPerformedReps;
module.exports.validPerformedRpe = validPerformedRpe;
module.exports.decodeHistoryCursor = decodeHistoryCursor;
module.exports.workoutSetUpdatePayload = workoutSetUpdatePayload;
module.exports.updateSetAtHandlerBoundary = updateSetAtHandlerBoundary;
module.exports.createExerciseHistoryHandler = createExerciseHistoryHandler;
