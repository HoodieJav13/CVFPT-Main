const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

async function programWithDetails(programId) {
  const { data: program } = await supabaseAdmin.from('programs').select('*').eq('id', programId).maybeSingle();
  if (!program) return null;
  const { data: exercises } = await supabaseAdmin.from('program_exercises').select('*')
    .eq('program_id', programId).eq('archived', false).order('position');
  const { data: assignments } = await supabaseAdmin.from('program_assignments')
    .select('*, client:clients(id, name)').eq('program_id', programId).eq('archived', false);
  return { ...program, exercises: exercises || [], assignments: assignments || [] };
}

function canAccessProgram(user, program) {
  if (!program) return false;
  if (user.role === 'admin') return true;
  return program.coach_id === user.coach.id;
}

// GET /api/programs (coach)
router.get('/', requireCoach, async (req, res) => {
  try {
    let q = supabaseAdmin.from('programs').select('*, exercises:program_exercises(id), assignments:program_assignments(id, archived, client:clients(id, name))')
      .eq('archived', false).order('created_at', { ascending: false });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    const { data, error } = await q;
    if (error) throw error;
    const shaped = (data || []).map((p) => ({
      ...p,
      exercise_count: (p.exercises || []).length,
      active_assignments: (p.assignments || []).filter((a) => !a.archived),
    }));
    return res.json(shaped);
  } catch (e) {
    console.error('list programs error', e);
    return res.status(500).json({ error: 'Failed to load programs' });
  }
});

// POST /api/programs { name, description, exercises: [...] }
router.post('/', requireCoach, async (req, res) => {
  try {
    const { name, description, exercises } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Program name is required' });
    const { data: program, error } = await supabaseAdmin.from('programs').insert({
      coach_id: req.user.coach.id,
      name: String(name).trim(),
      description: description || null,
    }).select().single();
    if (error) throw error;
    if (Array.isArray(exercises) && exercises.length) {
      const rows = exercises.filter((ex) => ex.name && String(ex.name).trim()).map((ex, i) => ({
        program_id: program.id,
        name: String(ex.name).trim(),
        sets: ex.sets || null,
        reps: ex.reps || null,
        notes: ex.notes || null,
        video_url: ex.video_url || null,
        position: i,
      }));
      if (rows.length) {
        const { error: exErr } = await supabaseAdmin.from('program_exercises').insert(rows);
        if (exErr) throw exErr;
      }
    }
    return res.status(201).json(await programWithDetails(program.id));
  } catch (e) {
    console.error('create program error', e);
    return res.status(500).json({ error: 'Failed to create program' });
  }
});

// GET /api/programs/:id
router.get('/:id', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    return res.json(program);
  } catch (e) {
    console.error('get program error', e);
    return res.status(500).json({ error: 'Failed to load program' });
  }
});

// PUT /api/programs/:id  { name, description, exercises: [...] } - replaces exercise list
router.put('/:id', requireCoach, async (req, res) => {
  try {
    const { data: program } = await supabaseAdmin.from('programs').select('*').eq('id', req.params.id).maybeSingle();
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const updates = {};
    if ('name' in req.body) updates.name = req.body.name;
    if ('description' in req.body) updates.description = req.body.description;
    if (Object.keys(updates).length) {
      const { error } = await supabaseAdmin.from('programs').update(updates).eq('id', program.id);
      if (error) throw error;
    }
    if (Array.isArray(req.body.exercises)) {
      // soft-archive old, insert fresh ordered list
      await supabaseAdmin.from('program_exercises').update({ archived: true }).eq('program_id', program.id);
      const rows = req.body.exercises.filter((ex) => ex.name && String(ex.name).trim()).map((ex, i) => ({
        program_id: program.id,
        name: String(ex.name).trim(),
        sets: ex.sets || null,
        reps: ex.reps || null,
        notes: ex.notes || null,
        video_url: ex.video_url || null,
        position: i,
      }));
      if (rows.length) {
        const { error: exErr } = await supabaseAdmin.from('program_exercises').insert(rows);
        if (exErr) throw exErr;
      }
    }
    return res.json(await programWithDetails(program.id));
  } catch (e) {
    console.error('update program error', e);
    return res.status(500).json({ error: 'Failed to update program' });
  }
});

// PATCH /api/programs/:id/archive
router.patch('/:id/archive', requireCoach, async (req, res) => {
  try {
    const { data: program } = await supabaseAdmin.from('programs').select('*').eq('id', req.params.id).maybeSingle();
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const { data, error } = await supabaseAdmin.from('programs').update({ archived: true }).eq('id', program.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive program error', e);
    return res.status(500).json({ error: 'Failed to archive program' });
  }
});

// POST /api/programs/:id/assign { client_id, notes }
router.post('/:id/assign', requireCoach, async (req, res) => {
  try {
    const { data: program } = await supabaseAdmin.from('programs').select('*').eq('id', req.params.id).maybeSingle();
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

// PATCH /api/programs/assignments/:assignmentId/archive (unassign)
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

// GET /api/programs/client/assigned (client)
router.get('/client/assigned', requireClient, async (req, res) => {
  try {
    const { data: assignments, error } = await supabaseAdmin.from('program_assignments')
      .select('*, program:programs(*)').eq('client_id', req.user.client.id).eq('archived', false);
    if (error) throw error;
    const active = (assignments || []).filter((a) => a.program && !a.program.archived);
    const result = [];
    for (const a of active) {
      const { data: exercises } = await supabaseAdmin.from('program_exercises').select('*')
        .eq('program_id', a.program.id).eq('archived', false).order('position');
      result.push({ ...a, program: { ...a.program, exercises: exercises || [] } });
    }
    return res.json(result);
  } catch (e) {
    console.error('client programs error', e);
    return res.status(500).json({ error: 'Failed to load your programs' });
  }
});

module.exports = router;
