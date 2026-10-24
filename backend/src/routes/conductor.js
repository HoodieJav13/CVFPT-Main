// pt-session-events/v1 coach-only routes (L12/CONTRACT.md §3–5): in-app coach
// notices, the group conductor record (off the single coach device), coach
// backups and the explicit "apply to remaining program" review. Trainees have
// no route here; every target client is checked with canAccessClient.
const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, canAccessClient } = require('../middleware/auth');
const { isUuid, normalizeTargets, cleanText } = require('../lib/sessionEvents');
const { todayDateInTz } = require('../utils/time');

async function accessibleClients(user, ids) {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin.from('clients').select('*').in('id', ids).eq('archived', false);
  if (error) throw error;
  return (data || []).filter((row) => canAccessClient(user, row));
}

// ---------- Coach notices ----------
const notices = express.Router();
notices.use(requireAuth, requireCoach);

notices.get('/', async (req, res) => {
  try {
    let query = supabaseAdmin.from('coach_notices').select('id, client_id, kind, workout_log_id, ref_id, summary, created_at, read_at')
      .eq('coach_id', req.user.coach.id).order('created_at', { ascending: false }).limit(100);
    if (req.query.status !== 'all') query = query.is('read_at', null);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ notices: data || [], server_time: new Date().toISOString() });
  } catch (error) {
    logError('coach notices error', error);
    return res.status(500).json({ error: 'Failed to load notices' });
  }
});

notices.patch('/:id/read', async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Notice not found' });
    const { data, error } = await supabaseAdmin.from('coach_notices').update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('coach_id', req.user.coach.id).is('read_at', null).select().maybeSingle();
    if (error) throw error;
    return res.json(data || { id: req.params.id, already_read: true });
  } catch (error) {
    logError('coach notice read error', error);
    return res.status(500).json({ error: 'Failed to update the notice' });
  }
});

// ---------- Group conductor record ----------
const groups = express.Router();
groups.use(requireAuth, requireCoach);

function participantIds(session) {
  return (session.participants || []).filter((row) => !row.left_at).map((row) => row.client_id);
}

async function ownSession(req, res) {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Session not found' }); return null; }
  const { data, error } = await supabaseAdmin.from('group_sessions').select('*').eq('id', req.params.id).eq('coach_id', req.user.coach.id).maybeSingle();
  if (error) throw error;
  if (!data) { res.status(404).json({ error: 'Session not found' }); return null; }
  return data;
}

groups.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    if (!isUuid(body.id)) return res.status(400).json({ error: 'A session id is required' });
    const { data: existing } = await supabaseAdmin.from('group_sessions').select('*').eq('id', body.id).maybeSingle();
    if (existing) {
      if (existing.coach_id !== req.user.coach.id) return res.status(404).json({ error: 'Session not found' });
      return res.json({ outcome: 'replayed', session: existing });
    }
    let title;
    try { title = cleanText(body.title, 80, 'Title'); } catch (error) { return res.status(400).json({ error: error.message }); }
    const mode = body.mode === 'stations' ? 'stations' : 'participants';
    const ids = [...new Set(Array.isArray(body.participant_ids) ? body.participant_ids : [])];
    if (ids.length < 2 || ids.length > 6 || !ids.every(isUuid)) return res.status(400).json({ error: 'Choose 2 to 6 trainees' });
    const allowed = await accessibleClients(req.user, ids);
    if (allowed.length !== ids.length) return res.status(404).json({ error: 'Client not found' });
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('group_sessions').insert({
      id: body.id, coach_id: req.user.coach.id, title: title || `Small group · ${todayDateInTz()}`, session_date: todayDateInTz(), mode,
      participants: ids.map((clientId) => ({ client_id: clientId, joined_at: now, left_at: null })),
      station_state: mode === 'stations' && body.station_state ? body.station_state : null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json({ outcome: 'created', session: data });
  } catch (error) {
    logError('group session create error', error);
    return res.status(500).json({ error: 'Failed to start the session' });
  }
});

groups.get('/open', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('group_sessions').select('*')
      .eq('coach_id', req.user.coach.id).eq('status', 'open').order('updated_at', { ascending: false }).limit(10);
    if (error) throw error;
    return res.json({ sessions: data || [], server_time: new Date().toISOString() });
  } catch (error) {
    logError('group session list error', error);
    return res.status(500).json({ error: 'Failed to load sessions' });
  }
});

groups.get('/:id', async (req, res) => {
  try {
    const session = await ownSession(req, res);
    if (!session) return undefined;
    return res.json({ session, server_time: new Date().toISOString() });
  } catch (error) {
    logError('group session read error', error);
    return res.status(500).json({ error: 'Failed to load the session' });
  }
});

// Compact group view: one row per participant from their own active log.
groups.get('/:id/overview', async (req, res) => {
  try {
    const session = await ownSession(req, res);
    if (!session) return undefined;
    const ids = participantIds(session);
    const clients = await accessibleClients(req.user, ids);
    const { data: logs, error } = clients.length
      ? await supabaseAdmin.from('workout_logs').select('id, client_id, status, workout_name, started_at, completed_at, updated_at')
        .in('client_id', clients.map((row) => row.id)).eq('archived', false)
        .gte('started_at', `${session.session_date}T00:00:00Z`).order('started_at', { ascending: false })
      : { data: [] };
    if (error) throw error;
    const latest = new Map();
    for (const log of logs || []) {
      const current = latest.get(log.client_id);
      if (!current || (current.status !== 'active' && log.status === 'active')) latest.set(log.client_id, log);
    }
    const logIds = [...latest.values()].map((row) => row.id);
    const [exercises, conflicts, subs, unread] = await Promise.all([
      logIds.length ? supabaseAdmin.from('workout_log_exercises').select('id, workout_log_id').in('workout_log_id', logIds).eq('archived', false) : { data: [] },
      logIds.length ? supabaseAdmin.from('workout_set_conflicts').select('workout_log_id').in('workout_log_id', logIds).eq('status', 'open') : { data: [] },
      logIds.length ? supabaseAdmin.from('workout_log_substitutions').select('workout_log_id, status, coach_review_status').in('workout_log_id', logIds) : { data: [] },
      ids.length ? supabaseAdmin.from('coach_notices').select('id, client_id').eq('coach_id', req.user.coach.id).is('read_at', null).in('client_id', ids) : { data: [] },
    ]);
    for (const result of [exercises, conflicts, subs, unread]) if (result.error) throw result.error;
    const logOfExercise = new Map((exercises.data || []).map((row) => [row.id, row.workout_log_id]));
    const { data: sets, error: setError } = logOfExercise.size
      ? await supabaseAdmin.from('workout_log_sets').select('workout_log_exercise_id, status, updated_at, last_actor_role').in('workout_log_exercise_id', [...logOfExercise.keys()]).eq('archived', false)
      : { data: [] };
    if (setError) throw setError;
    const stats = new Map();
    for (const set of sets || []) {
      const logId = logOfExercise.get(set.workout_log_exercise_id);
      const row = stats.get(logId) || { done: 0, total: 0, lastWriteAt: null, lastActor: null };
      row.total += 1;
      if (set.status === 'completed') row.done += 1;
      if (set.last_actor_role && (!row.lastWriteAt || set.updated_at > row.lastWriteAt)) { row.lastWriteAt = set.updated_at; row.lastActor = set.last_actor_role; }
      stats.set(logId, row);
    }
    const count = (rows, logId, predicate = () => true) => (rows || []).filter((row) => row.workout_log_id === logId && predicate(row)).length;
    const participants = ids.map((clientId) => {
      const client = clients.find((row) => row.id === clientId);
      const log = latest.get(clientId) || null;
      const stat = log ? stats.get(log.id) || { done: 0, total: 0 } : null;
      return {
        client_id: clientId,
        name: client?.name || 'Unavailable',
        log: log ? {
          id: log.id, status: log.status, workout_name: log.workout_name, done: stat.done, total: stat.total,
          last_write_at: stat.lastWriteAt, last_actor_role: stat.lastActor,
          open_conflicts: count(conflicts.data, log.id),
          pending_swaps: count(subs.data, log.id, (row) => row.status === 'pending_confirmation'),
          swaps_to_review: count(subs.data, log.id, (row) => row.coach_review_status === 'pending'),
        } : null,
        unread_notices: (unread.data || []).filter((row) => row.client_id === clientId).length,
      };
    });
    return res.json({ session: { id: session.id, title: session.title, revision: session.revision, status: session.status }, participants, server_time: new Date().toISOString() });
  } catch (error) {
    logError('group overview error', error);
    return res.status(500).json({ error: 'Failed to load the group' });
  }
});

groups.patch('/:id', async (req, res) => {
  try {
    const session = await ownSession(req, res);
    if (!session) return undefined;
    const body = req.body || {};
    if (!Number.isInteger(body.base_revision)) return res.status(400).json({ error: 'base_revision is required' });
    const patch = { revision: session.revision + 1, updated_at: new Date().toISOString() };
    if (Array.isArray(body.participant_ids)) {
      const ids = [...new Set(body.participant_ids)];
      if (ids.length < 1 || ids.length > 6 || !ids.every(isUuid)) return res.status(400).json({ error: 'Choose up to 6 trainees' });
      if ((await accessibleClients(req.user, ids)).length !== ids.length) return res.status(404).json({ error: 'Client not found' });
      const now = new Date().toISOString();
      const kept = (session.participants || []).map((row) => (ids.includes(row.client_id) || row.left_at ? row : { ...row, left_at: now }));
      for (const id of ids) if (!kept.some((row) => row.client_id === id && !row.left_at)) kept.push({ client_id: id, joined_at: now, left_at: null });
      patch.participants = kept;
    }
    if (Object.hasOwn(body, 'station_state')) patch.station_state = body.station_state;
    if (body.status === 'finished') patch.status = 'finished';
    const { data, error } = await supabaseAdmin.from('group_sessions').update(patch)
      .eq('id', session.id).eq('revision', body.base_revision).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'This session changed on another device.', session });
    return res.json({ session: data });
  } catch (error) {
    logError('group session update error', error);
    return res.status(500).json({ error: 'Failed to update the session' });
  }
});

// ---------- PT-Sub: coach backups and program application ----------
// Mounted on /api/programs ahead of the programs router: authentication runs
// only on these paths, so every other programs route is untouched.
const programSub = express.Router();

async function workoutExerciseForCoach(req, res) {
  if (!isUuid(req.params.workoutExerciseId)) { res.status(404).json({ error: 'Exercise not found' }); return null; }
  const { data, error } = await supabaseAdmin.from('workout_exercises')
    .select('id, workout_id, exercise_library_id, archived, workout:workouts(id, coach_id, client_id, is_template, archived)')
    .eq('id', req.params.workoutExerciseId).maybeSingle();
  if (error) throw error;
  const workout = data?.workout;
  let allowed = Boolean(data && !data.archived && workout && !workout.archived);
  if (allowed && workout.client_id) {
    const [client] = await accessibleClients(req.user, [workout.client_id]);
    allowed = Boolean(client);
  } else if (allowed) {
    allowed = req.user.role === 'admin' || workout.coach_id === req.user.coach.id;
  }
  if (!allowed) { res.status(404).json({ error: 'Exercise not found' }); return null; }
  return data;
}

programSub.get('/workout-exercises/:workoutExerciseId/backups', requireAuth, requireCoach, async (req, res) => {
  try {
    const row = await workoutExerciseForCoach(req, res);
    if (!row) return undefined;
    const { data, error } = await supabaseAdmin.from('workout_exercise_backups')
      .select('*, library:exercise_library(id, name, equipment, review_status)').eq('workout_exercise_id', row.id).eq('archived', false).order('created_at');
    if (error) throw error;
    return res.json({ backups: data || [] });
  } catch (error) {
    logError('backups list error', error);
    return res.status(500).json({ error: 'Failed to load backups' });
  }
});

programSub.post('/workout-exercises/:workoutExerciseId/backups', requireAuth, requireCoach, async (req, res) => {
  try {
    const row = await workoutExerciseForCoach(req, res);
    if (!row) return undefined;
    const body = req.body || {};
    if (!isUuid(body.exercise_library_id)) return res.status(400).json({ error: 'Choose a backup exercise' });
    let targets;
    let note;
    try { targets = normalizeTargets(body.targets || {}); note = cleanText(body.client_note, 300, 'Note'); } catch (error) { return res.status(400).json({ error: error.message }); }
    const { data: library } = await supabaseAdmin.from('exercise_library').select('id, review_status, hidden, archived').eq('id', body.exercise_library_id).maybeSingle();
    if (!library || library.archived || library.hidden || library.review_status !== 'approved') return res.status(422).json({ error: 'That exercise cannot be a backup.' });
    if (library.id === row.exercise_library_id) return res.status(422).json({ error: 'A backup must be a different exercise.' });
    const { data, error } = await supabaseAdmin.from('workout_exercise_backups').insert({
      workout_exercise_id: row.id, backup_exercise_library_id: library.id, target_sets: targets.sets ?? null, target_reps: targets.reps ?? null,
      target_load_value: targets.load_value ?? null, target_load_unit: targets.load_unit ?? null, client_note: note, created_by_coach_id: req.user.coach.id,
    }).select().single();
    if (error?.code === '23505') return res.status(409).json({ error: 'That backup is already planned.' });
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    logError('backup create error', error);
    return res.status(500).json({ error: 'Failed to save the backup' });
  }
});

programSub.patch('/workout-exercises/:workoutExerciseId/backups/:backupId/archive', requireAuth, requireCoach, async (req, res) => {
  try {
    const row = await workoutExerciseForCoach(req, res);
    if (!row) return undefined;
    const { data, error } = await supabaseAdmin.from('workout_exercise_backups').update({ archived: true })
      .eq('id', req.params.backupId).eq('workout_exercise_id', row.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Backup not found' });
    return res.json(data);
  } catch (error) {
    logError('backup archive error', error);
    return res.status(500).json({ error: 'Failed to remove the backup' });
  }
});

async function assignmentAndSubstitution(req, res, substitutionId) {
  if (!isUuid(req.params.assignmentId) || !isUuid(substitutionId)) { res.status(404).json({ error: 'Not found' }); return null; }
  const { data: assignment, error } = await supabaseAdmin.from('program_assignments')
    .select('id, client_id, program_id, archived, program:programs(id, name, is_template, client_id)').eq('id', req.params.assignmentId).maybeSingle();
  if (error) throw error;
  if (!assignment || assignment.archived || !(await accessibleClients(req.user, [assignment.client_id])).length) { res.status(404).json({ error: 'Program not found' }); return null; }
  const { data: sub } = await supabaseAdmin.from('workout_log_substitutions').select('*').eq('id', substitutionId).eq('client_id', assignment.client_id).maybeSingle();
  if (!sub || sub.status !== 'active') { res.status(404).json({ error: 'Swap not found' }); return null; }
  return { assignment, sub };
}

programSub.get('/assignments/:assignmentId/substitution-preview', requireAuth, requireCoach, async (req, res) => {
  try {
    const found = await assignmentAndSubstitution(req, res, req.query.substitution_id);
    if (!found) return undefined;
    const { assignment, sub } = found;
    const shared = assignment.program?.is_template || assignment.program?.client_id !== assignment.client_id;
    const { data: items, error } = await supabaseAdmin.rpc('program_substitution_targets', {
      p_assignment_id: assignment.id, p_original_library_id: sub.original_exercise_library_id, p_original_name: sub.original_name,
    });
    if (error) throw error;
    return res.json({
      program: { id: assignment.program_id, name: assignment.program?.name, shared },
      from: sub.original_name, to: sub.replacement_name,
      items: (items || []).map((row) => ({
        workout_exercise_id: row.workout_exercise_id, day_number: row.day_number, workout_name: row.workout_name,
        current: { sets: row.sets, reps: row.reps, load_value: row.default_load_value == null ? null : Number(row.default_load_value), load_unit: row.default_load_unit },
      })),
      completed_history: 'Workouts already logged keep exactly what was done; only the program plan for future workouts changes.',
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    logError('substitution preview error', error);
    return res.status(500).json({ error: 'Failed to build the preview' });
  }
});

programSub.post('/assignments/:assignmentId/apply-substitution', requireAuth, requireCoach, async (req, res) => {
  try {
    const body = req.body || {};
    if (!isUuid(body.event_id) || !Array.isArray(body.expected_item_ids) || !body.expected_item_ids.every(isUuid)) return res.status(400).json({ error: 'Preview the change first' });
    let targets;
    try { targets = normalizeTargets(body.targets || {}); } catch (error) { return res.status(400).json({ error: error.message }); }
    const found = await assignmentAndSubstitution(req, res, body.substitution_id);
    if (!found) return undefined;
    const { data, error } = await supabaseAdmin.rpc('apply_program_substitution', {
      p_application_id: body.event_id, p_assignment_id: found.assignment.id, p_substitution_id: found.sub.id,
      p_coach_id: req.user.coach.id, p_expected_ids: body.expected_item_ids, p_targets: targets,
    });
    if (error) {
      if (/preview_mismatch/.test(error.message || '')) return res.status(409).json({ error: 'The program changed since the preview. Preview again.' });
      if (/shared_program/.test(error.message || '')) return res.status(409).json({ error: 'This program still uses shared template workouts. Change it in the program builder instead.' });
      throw error;
    }
    return res.json(data);
  } catch (error) {
    logError('apply substitution error', error);
    return res.status(500).json({ error: 'Failed to update the program' });
  }
});

module.exports = { notices, groups, programSub };
