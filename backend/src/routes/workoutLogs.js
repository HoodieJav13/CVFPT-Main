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
    const body = req.body || {};
    const status = body.status === 'completed' ? 'completed' : body.status === 'pending' ? 'pending' : set.status;
    const loadValue = Object.hasOwn(body, 'actual_load_value') ? body.actual_load_value : set.actual_load_value;
    const loadUnit = Object.hasOwn(body, 'actual_load_unit') ? body.actual_load_unit : set.actual_load_unit;
    if (!validLoad(loadValue, loadUnit)) return res.status(400).json({ error: 'Enter a valid weight and unit' });
    const { data, error } = await supabaseAdmin.from('workout_log_sets').update({
      status,
      actual_load_value: loadValue === '' || loadValue === null ? null : Number(loadValue),
      actual_load_unit: loadValue === '' || loadValue === null ? null : loadUnit,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', set.id).eq('archived', false).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
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
