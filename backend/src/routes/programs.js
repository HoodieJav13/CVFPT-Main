const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function canAccessWorkout(user, workout) {
  if (!workout) return false;
  if (user.role === 'admin') return true;
  return !workout.coach_id || workout.coach_id === user.coach?.id;
}

function canAccessProgram(user, program) {
  if (!program) return false;
  if (user.role === 'admin') return true;
  return program.coach_id === user.coach?.id;
}

async function workoutWithDetails(workoutId) {
  const { data: workout } = await supabaseAdmin.from('workouts').select('*').eq('id', workoutId).maybeSingle();
  if (!workout) return null;
  const { data: exercises, error } = await supabaseAdmin
    .from('workout_exercises')
    .select('*, library_exercise:exercise_library(*)')
    .eq('workout_id', workoutId)
    .eq('archived', false)
    .order('position');
  if (error) throw error;
  return { ...workout, exercises: exercises || [], exercise_count: (exercises || []).length };
}

async function programWithDetails(programId) {
  const { data: program } = await supabaseAdmin.from('programs').select('*').eq('id', programId).maybeSingle();
  if (!program) return null;
  const { data: days, error } = await supabaseAdmin
    .from('program_days')
    .select('*, workout:workouts(*)')
    .eq('program_id', programId)
    .eq('archived', false)
    .order('day_number');
  if (error) throw error;
  const detailedDays = [];
  for (const day of days || []) {
    detailedDays.push({ ...day, workout: await workoutWithDetails(day.workout_id) });
  }
  const { data: assignments } = await supabaseAdmin
    .from('program_assignments')
    .select('*, client:clients(id, name)')
    .eq('program_id', programId)
    .eq('archived', false);
  return { ...program, days: detailedDays, assignments: assignments || [] };
}

async function listWorkouts(user) {
  let q = supabaseAdmin.from('workouts').select('*').eq('archived', false).order('created_at', { ascending: false });
  if (user.role !== 'admin') q = q.or(`coach_id.is.null,coach_id.eq.${user.coach.id}`);
  const { data, error } = await q;
  if (error) throw error;
  const result = [];
  for (const workout of data || []) result.push(await workoutWithDetails(workout.id));
  return result;
}

function cleanExerciseRows(workoutId, exercises = []) {
  return exercises
    .filter((ex) => ex.exercise_library_id || (ex.custom_name || ex.name || '').trim())
    .map((ex, position) => ({
      workout_id: workoutId,
      exercise_library_id: ex.exercise_library_id || null,
      custom_name: ex.custom_name || ex.name || null,
      sets: ex.sets || null,
      reps: ex.reps || null,
      rest: ex.rest || null,
      tempo: ex.tempo || null,
      notes: ex.notes || null,
      video_url: ex.video_url || null,
      position,
    }));
}

async function replaceWorkoutExercises(workoutId, exercises) {
  await supabaseAdmin.from('workout_exercises').update({ archived: true }).eq('workout_id', workoutId);
  const rows = cleanExerciseRows(workoutId, exercises);
  if (rows.length) {
    const { error } = await supabaseAdmin.from('workout_exercises').insert(rows);
    if (error) throw error;
  }
}

async function replaceProgramDays(programId, days = []) {
  await supabaseAdmin.from('program_days').update({ archived: true }).eq('program_id', programId);
  const rows = days
    .filter((day) => day.workout_id)
    .map((day, i) => ({
      program_id: programId,
      day_number: Number(day.day_number || i + 1),
      workout_id: day.workout_id,
      notes: day.notes || null,
      archived: false,
    }));
  if (rows.length) {
    const { error } = await supabaseAdmin.from('program_days').upsert(rows, { onConflict: 'program_id,day_number' });
    if (error) throw error;
  }
}

// ----- Exercise library -----
router.get('/exercise-library', requireCoach, async (req, res) => {
  try {
    let q = supabaseAdmin.from('exercise_library').select('*').eq('archived', false).order('name');
    if (req.query.q) q = q.ilike('name', `%${req.query.q}%`);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data || []);
  } catch (e) {
    console.error('exercise library error', e);
    return res.status(500).json({ error: 'Failed to load exercise library' });
  }
});

router.post('/exercise-library', requireCoach, async (req, res) => {
  try {
    const { name, category, equipment, primary_muscle, secondary_muscles, video_url, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Exercise name is required' });
    const { data, error } = await supabaseAdmin.from('exercise_library').insert({
      name: String(name).trim(), category: category || null, equipment: equipment || null,
      primary_muscle: primary_muscle || null, secondary_muscles: secondary_muscles || null,
      video_url: video_url || null, notes: notes || null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('create library exercise error', e);
    return res.status(500).json({ error: 'Failed to save exercise' });
  }
});

router.post('/exercise-library/import', requireCoach, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const cleaned = rows
      .filter((row) => row.name && String(row.name).trim())
      .map((row) => ({
        name: String(row.name).trim(),
        category: row.category || null,
        equipment: row.equipment || null,
        primary_muscle: row.primary_muscle || null,
        secondary_muscles: row.secondary_muscles || null,
        video_url: row.video_url || null,
        notes: row.notes || null,
      }));
    if (!cleaned.length) return res.status(400).json({ error: 'No valid exercises found in import' });
    const { data, error } = await supabaseAdmin.from('exercise_library').insert(cleaned).select();
    if (error) throw error;
    return res.status(201).json({ imported: data.length, exercises: data });
  } catch (e) {
    console.error('import library error', e);
    return res.status(500).json({ error: 'Failed to import exercises' });
  }
});

router.put('/exercise-library/:id', requireCoach, async (req, res) => {
  try {
    const allowed = ['name', 'category', 'equipment', 'primary_muscle', 'secondary_muscles', 'video_url', 'notes'];
    const updates = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in (req.body || {})) updates[k] = req.body[k] || null;
    if (updates.name !== undefined && !String(updates.name).trim()) return res.status(400).json({ error: 'Exercise name is required' });
    const { data, error } = await supabaseAdmin.from('exercise_library').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('update library exercise error', e);
    return res.status(500).json({ error: 'Failed to update exercise' });
  }
});

router.patch('/exercise-library/:id/archive', requireCoach, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('exercise_library').update({ archived: req.body?.archived !== false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive library exercise error', e);
    return res.status(500).json({ error: 'Failed to archive exercise' });
  }
});

// ----- Workout templates -----
router.get('/workouts', requireCoach, async (req, res) => {
  try {
    return res.json(await listWorkouts(req.user));
  } catch (e) {
    console.error('list workouts error', e);
    return res.status(500).json({ error: 'Failed to load workouts' });
  }
});

router.post('/workouts', requireCoach, async (req, res) => {
  try {
    const { name, description, goal, exercises } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Workout name is required' });
    const { data: workout, error } = await supabaseAdmin.from('workouts').insert({
      coach_id: req.user.role === 'admin' ? null : req.user.coach.id,
      name: String(name).trim(),
      description: description || null,
      goal: goal || null,
    }).select().single();
    if (error) throw error;
    await replaceWorkoutExercises(workout.id, exercises || []);
    return res.status(201).json(await workoutWithDetails(workout.id));
  } catch (e) {
    console.error('create workout error', e);
    return res.status(500).json({ error: 'Failed to create workout' });
  }
});

router.get('/workouts/:id', requireCoach, async (req, res) => {
  try {
    const workout = await workoutWithDetails(req.params.id);
    if (!canAccessWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    return res.json(workout);
  } catch (e) {
    console.error('get workout error', e);
    return res.status(500).json({ error: 'Failed to load workout' });
  }
});

router.put('/workouts/:id', requireCoach, async (req, res) => {
  try {
    const workout = await workoutWithDetails(req.params.id);
    if (!canAccessWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    const updates = { updated_at: new Date().toISOString() };
    for (const k of ['name', 'description', 'goal']) if (k in (req.body || {})) updates[k] = req.body[k] || null;
    if (updates.name !== undefined && !String(updates.name).trim()) return res.status(400).json({ error: 'Workout name is required' });
    const { error } = await supabaseAdmin.from('workouts').update(updates).eq('id', workout.id);
    if (error) throw error;
    if (Array.isArray(req.body.exercises)) await replaceWorkoutExercises(workout.id, req.body.exercises);
    return res.json(await workoutWithDetails(workout.id));
  } catch (e) {
    console.error('update workout error', e);
    return res.status(500).json({ error: 'Failed to update workout' });
  }
});

router.patch('/workouts/:id/archive', requireCoach, async (req, res) => {
  try {
    const workout = await workoutWithDetails(req.params.id);
    if (!canAccessWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    const { data, error } = await supabaseAdmin.from('workouts').update({ archived: true, updated_at: new Date().toISOString() }).eq('id', workout.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive workout error', e);
    return res.status(500).json({ error: 'Failed to archive workout' });
  }
});

// ----- Structured programs -----
router.get('/', requireCoach, async (req, res) => {
  try {
    let q = supabaseAdmin.from('programs').select('*, assignments:program_assignments(id, archived, client:clients(id, name))')
      .eq('archived', false)
      .not('frequency_days', 'is', null)
      .order('created_at', { ascending: false });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    const { data, error } = await q;
    if (error) throw error;
    const result = [];
    for (const program of data || []) {
      const detailed = await programWithDetails(program.id);
      result.push({
        ...program,
        days: detailed.days,
        day_count: detailed.days.length,
        exercise_count: detailed.days.reduce((sum, day) => sum + (day.workout?.exercise_count || 0), 0),
        active_assignments: (program.assignments || []).filter((a) => !a.archived),
      });
    }
    return res.json(result);
  } catch (e) {
    console.error('list programs error', e);
    return res.status(500).json({ error: 'Failed to load programs' });
  }
});

router.post('/', requireCoach, async (req, res) => {
  try {
    const { name, description, frequency_days, days } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Program name is required' });
    const frequency = Number(frequency_days);
    if (![3, 4, 5].includes(frequency)) return res.status(400).json({ error: 'Choose 3, 4, or 5 days per week' });
    const validDays = Array.isArray(days) ? days.filter((d) => d.workout_id) : [];
    if (validDays.length !== frequency) return res.status(400).json({ error: `Assign one workout to each of the ${frequency} days` });
    const { data: program, error } = await supabaseAdmin.from('programs').insert({
      coach_id: req.user.role === 'admin' ? req.user.coach.id : req.user.coach.id,
      name: String(name).trim(),
      description: description || null,
      frequency_days: frequency,
    }).select().single();
    if (error) throw error;
    await replaceProgramDays(program.id, validDays);
    return res.status(201).json(await programWithDetails(program.id));
  } catch (e) {
    console.error('create program error', e);
    return res.status(500).json({ error: e.message || 'Failed to create program' });
  }
});

router.get('/:id', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program) || program.archived) return res.status(404).json({ error: 'Program not found' });
    return res.json(program);
  } catch (e) {
    console.error('get program error', e);
    return res.status(500).json({ error: 'Failed to load program' });
  }
});

router.put('/:id', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const updates = {};
    if ('name' in req.body) updates.name = req.body.name;
    if ('description' in req.body) updates.description = req.body.description || null;
    if ('frequency_days' in req.body) {
      const frequency = Number(req.body.frequency_days);
      if (![3, 4, 5].includes(frequency)) return res.status(400).json({ error: 'Choose 3, 4, or 5 days per week' });
      updates.frequency_days = frequency;
    }
    if (Object.keys(updates).length) {
      const { error } = await supabaseAdmin.from('programs').update(updates).eq('id', program.id);
      if (error) throw error;
    }
    if (Array.isArray(req.body.days)) await replaceProgramDays(program.id, req.body.days);
    return res.json(await programWithDetails(program.id));
  } catch (e) {
    console.error('update program error', e);
    return res.status(500).json({ error: 'Failed to update program' });
  }
});

router.patch('/:id/archive', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const { data, error } = await supabaseAdmin.from('programs').update({ archived: true }).eq('id', program.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive program error', e);
    return res.status(500).json({ error: 'Failed to archive program' });
  }
});

router.post('/:id/assign', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.body.client_id).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data: existing } = await supabaseAdmin.from('program_assignments').select('id')
      .eq('program_id', program.id).eq('client_id', clientRow.id).eq('archived', false).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Program is already assigned to this client' });
    const { data, error } = await supabaseAdmin.from('program_assignments').insert({
      program_id: program.id, client_id: clientRow.id, notes: req.body.notes || null,
    }).select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('assign program error', e);
    return res.status(500).json({ error: 'Failed to assign program' });
  }
});

router.patch('/assignments/:assignmentId/archive', requireCoach, async (req, res) => {
  try {
    const { data: assignment } = await supabaseAdmin.from('program_assignments')
      .select('*, program:programs(*)').eq('id', req.params.assignmentId).maybeSingle();
    if (!assignment || !canAccessProgram(req.user, assignment.program)) return res.status(404).json({ error: 'Assignment not found' });
    const { data, error } = await supabaseAdmin.from('program_assignments').update({ archived: true }).eq('id', assignment.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('unassign error', e);
    return res.status(500).json({ error: 'Failed to unassign program' });
  }
});

// ----- Standalone workout assignments -----
router.get('/workout-assignments/client/:clientId', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.params.clientId).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.from('workout_assignments').select('*')
      .eq('client_id', clientRow.id).eq('archived', false).order('assigned_for', { ascending: true, nullsFirst: false });
    if (error) throw error;
    const result = [];
    for (const a of data || []) result.push({ ...a, workout: await workoutWithDetails(a.workout_id) });
    return res.json(result);
  } catch (e) {
    console.error('workout assignments error', e);
    return res.status(500).json({ error: 'Failed to load workout assignments' });
  }
});

router.post('/workout-assignments', requireCoach, async (req, res) => {
  try {
    const { client_id, workout_id, assignment_mode, assigned_for, notes } = req.body || {};
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', client_id).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const workout = await workoutWithDetails(workout_id);
    if (!canAccessWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    const mode = assignment_mode === 'dated' ? 'dated' : 'active';
    if (mode === 'dated' && !assigned_for) return res.status(400).json({ error: 'Choose a date for dated workouts' });
    const { data, error } = await supabaseAdmin.from('workout_assignments').insert({
      client_id: clientRow.id, workout_id: workout.id, assignment_mode: mode, assigned_for: mode === 'dated' ? assigned_for : null, notes: notes || null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json({ ...data, workout });
  } catch (e) {
    console.error('assign workout error', e);
    return res.status(500).json({ error: 'Failed to assign workout' });
  }
});

router.patch('/workout-assignments/:assignmentId/archive', requireCoach, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('workout_assignments').update({ archived: true }).eq('id', req.params.assignmentId).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive workout assignment error', e);
    return res.status(500).json({ error: 'Failed to remove workout assignment' });
  }
});

router.get('/client/assigned', requireClient, async (req, res) => {
  try {
    const { data: programAssignments, error } = await supabaseAdmin.from('program_assignments')
      .select('*, program:programs(*)').eq('client_id', req.user.client.id).eq('archived', false);
    if (error) throw error;
    const programs = [];
    for (const assignment of programAssignments || []) {
      if (assignment.program && !assignment.program.archived) programs.push({ ...assignment, program: await programWithDetails(assignment.program_id) });
    }
    const { data: workoutAssignments, error: waErr } = await supabaseAdmin.from('workout_assignments').select('*')
      .eq('client_id', req.user.client.id).eq('archived', false).order('assigned_for', { ascending: true, nullsFirst: false });
    if (waErr) throw waErr;
    const workouts = [];
    for (const assignment of workoutAssignments || []) workouts.push({ ...assignment, workout: await workoutWithDetails(assignment.workout_id) });
    return res.json({ programs, workouts });
  } catch (e) {
    console.error('client programs error', e);
    return res.status(500).json({ error: 'Failed to load your programs' });
  }
});

module.exports = router;
