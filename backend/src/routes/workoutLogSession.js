// pt-session-events/v1 routes on the workout-log router (L12 conductor +
// PT-Sub; L12/CONTRACT.md). Registered by routes/workoutLogs.js, which passes
// its own access helpers so authorization stays exactly the log router's.
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireCoach, requireClient } = require('../middleware/auth');
const {
  isUuid, setEventEnvelope, substitutionRequest, substitutionPolicy, rankSuggestions, triggerLabel, cleanText,
} = require('../lib/sessionEvents');

const isCoachRole = (user) => user?.role === 'coach' || user?.role === 'admin';

// Session extras for one log: retained conflicts, substitutions, coach-approved
// backups per exercise and the server clock for freshness labels. Built only
// from rows the log's own client may see; never Coach Notes or coach-only
// prescription notes.
async function sessionExtras(log) {
  const sourceIds = [...new Set(log.exercises.map((exercise) => exercise.source_workout_exercise_id).filter(Boolean))];
  const [conflicts, substitutions, backups] = await Promise.all([
    supabaseAdmin.from('workout_set_conflicts').select('*').eq('workout_log_id', log.id).order('created_at'),
    supabaseAdmin.from('workout_log_substitutions').select('*').eq('workout_log_id', log.id).order('created_at'),
    sourceIds.length
      ? supabaseAdmin.from('workout_exercise_backups')
        .select('id, workout_exercise_id, backup_exercise_library_id, target_sets, target_reps, target_load_value, target_load_unit, client_note, library:exercise_library(id, name, equipment, review_status, hidden, archived)')
        .in('workout_exercise_id', sourceIds).eq('archived', false)
      : Promise.resolve({ data: [] }),
  ]);
  for (const result of [conflicts, substitutions, backups]) if (result.error) throw result.error;
  const backupsBySource = new Map();
  for (const row of backups.data || []) {
    if (!row.library || row.library.archived || row.library.hidden || row.library.review_status !== 'approved') continue;
    const list = backupsBySource.get(row.workout_exercise_id) || [];
    list.push({
      id: row.id, exercise_library_id: row.backup_exercise_library_id, name: row.library.name, equipment: row.library.equipment,
      targets: { sets: row.target_sets, reps: row.target_reps, load_value: row.target_load_value == null ? null : Number(row.target_load_value), load_unit: row.target_load_unit },
      client_note: row.client_note,
    });
    backupsBySource.set(row.workout_exercise_id, list);
  }
  return {
    ...log,
    exercises: log.exercises.map((exercise) => ({ ...exercise, backups: backupsBySource.get(exercise.source_workout_exercise_id) || [] })),
    conflicts: conflicts.data || [],
    substitutions: substitutions.data || [],
    server_time: new Date().toISOString(),
  };
}

async function raiseCoachNotice({ log, kind, dedupeKey, refId, summary }) {
  const coachId = log.client?.coach_id;
  if (!coachId) return;
  const { error } = await supabaseAdmin.from('coach_notices').upsert({
    coach_id: coachId, client_id: log.client_id, kind, dedupe_key: dedupeKey, workout_log_id: log.id, ref_id: refId,
    summary: summary.slice(0, 300),
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) throw error;
}

function registerSessionRoutes(router, deps) {
  const {
    workoutLogWithDetails, requireWritableActiveLog, canWriteLog, canReadLog, actorStamp, workoutSetUpdatePayload, validLoad,
  } = deps;

  async function detailedLogResponse(logId) {
    const log = await workoutLogWithDetails(logId);
    return log ? sessionExtras(log) : null;
  }

  async function writableLogAnyStatus(req, res) {
    const log = await workoutLogWithDetails(req.params.id, { media: false });
    if (!canWriteLog(req.user, log)) {
      res.status(404).json({ error: 'Workout log not found' });
      return null;
    }
    return log;
  }

  function originalExerciseOrFail(res, log, exerciseId) {
    const exercise = log.exercises.find((row) => row.id === exerciseId);
    if (!exercise) { res.status(404).json({ error: 'Workout exercise not found' }); return null; }
    if (exercise.substitutes_log_exercise_id) { res.status(409).json({ error: 'This is already a substitute.' }); return null; }
    return exercise;
  }

  // Contract set write (called from the PATCH set route when event_id is sent).
  async function applySetEvent(req, res, set, exercise, envelope) {
    let payload;
    try {
      payload = workoutSetUpdatePayload(envelope.fields, set, new Date().toISOString(), exercise);
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      throw error;
    }
    const stamp = actorStamp(req.user);
    const { data, error } = await supabaseAdmin.rpc('apply_workout_set_event', {
      p_set_id: set.id,
      p_event_id: envelope.eventId,
      p_actor_role: stamp.entered_by,
      p_actor_coach_id: stamp.entered_by_coach_id,
      p_base_revision: envelope.baseRevision,
      p_local_seq: envelope.localSeq,
      p_offline: envelope.offline,
      p_plan_revision_seen: envelope.planRevisionSeen,
      p_payload: payload,
    });
    if (error) {
      if (/event_id_reused/.test(error.message || '')) return res.status(409).json({ error: 'That event id belongs to another set' });
      throw error;
    }
    return res.json({ ...data.set, event: { id: envelope.eventId, outcome: data.outcome, original_outcome: data.original_outcome || null, conflict_id: data.conflict_id || null } });
  }

  // Coach edit of UNFINISHED work: the log exercise prescription and the
  // defaults of sets nobody has touched. Completed sets never change.
  router.patch('/:id/exercises/:exerciseId/plan', requireCoach, async (req, res) => {
    try {
      const log = await requireWritableActiveLog(req, res);
      if (!log) return undefined;
      const exercise = log.exercises.find((row) => row.id === req.params.exerciseId);
      if (!exercise) return res.status(404).json({ error: 'Workout exercise not found' });
      const body = req.body || {};
      if (!isUuid(body.event_id) || !Number.isInteger(body.base_plan_revision)) return res.status(400).json({ error: 'event_id and base_plan_revision are required' });
      const patch = {};
      if (Object.hasOwn(body, 'prescribed_reps')) patch.prescribed_reps = cleanText(body.prescribed_reps == null ? null : String(body.prescribed_reps), 20, 'Reps');
      if (Object.hasOwn(body, 'prescribed_load_value')) {
        const value = body.prescribed_load_value === '' || body.prescribed_load_value == null ? null : Number(body.prescribed_load_value);
        const unit = value == null ? null : (body.prescribed_load_unit || exercise.prescribed_load_unit || 'lb');
        if (!validLoad(value, unit)) return res.status(400).json({ error: 'Enter a valid weight and unit' });
        patch.prescribed_load_value = value;
        patch.prescribed_load_unit = unit;
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
      const { data: updated, error } = await supabaseAdmin.from('workout_log_exercises')
        .update({ ...patch, plan_revision: exercise.plan_revision + 1, updated_at: new Date().toISOString() })
        .eq('id', exercise.id).eq('plan_revision', body.base_plan_revision).select().maybeSingle();
      if (error) throw error;
      if (!updated) return res.status(409).json({ error: 'The plan changed since you opened it. Review the current plan and try again.', current: exercise });
      if (Object.hasOwn(patch, 'prescribed_load_value')) {
        const { error: setError } = await supabaseAdmin.from('workout_log_sets')
          .update({ actual_load_value: patch.prescribed_load_value, actual_load_unit: patch.prescribed_load_unit, updated_at: new Date().toISOString() })
          .eq('workout_log_exercise_id', exercise.id).eq('status', 'pending').eq('revision', 0).eq('archived', false);
        if (setError) throw setError;
      }
      return res.json(await detailedLogResponse(log.id));
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      logError('plan edit error', error);
      return res.status(500).json({ error: 'Failed to update the plan' });
    }
  });

  router.post('/:id/sets/:setId/conflicts/:conflictId/resolve', requireCoach, async (req, res) => {
    try {
      const log = await writableLogAnyStatus(req, res);
      if (!log) return undefined;
      const body = req.body || {};
      if (!isUuid(body.event_id) || !['current', 'incoming', 'custom'].includes(body.choice)) return res.status(400).json({ error: 'Choose which value to keep' });
      const { data: conflict } = await supabaseAdmin.from('workout_set_conflicts').select('*')
        .eq('id', req.params.conflictId).eq('workout_log_id', log.id).eq('workout_log_set_id', req.params.setId).maybeSingle();
      if (!conflict) return res.status(404).json({ error: 'Conflict not found' });
      let value = null;
      if (body.choice === 'custom') {
        const set = log.exercises.flatMap((exercise) => exercise.sets).find((row) => row.id === conflict.workout_log_set_id);
        const exercise = log.exercises.find((row) => row.id === set?.workout_log_exercise_id);
        if (!set) return res.status(404).json({ error: 'Workout set not found' });
        const payload = workoutSetUpdatePayload(body.value || {}, set, new Date().toISOString(), exercise);
        delete payload.completed_at;
        delete payload.updated_at;
        value = payload;
      }
      const { data, error } = await supabaseAdmin.rpc('resolve_workout_set_conflict', {
        p_conflict_id: conflict.id, p_event_id: body.event_id.toLowerCase(), p_choice: body.choice, p_value: value, p_coach_id: req.user.coach.id,
      });
      if (error) {
        if (/already resolved/i.test(error.message || '')) return res.status(409).json({ error: 'This disagreement was already resolved.' });
        throw error;
      }
      return res.json({ outcome: data.outcome, log: await detailedLogResponse(log.id) });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      logError('conflict resolve error', error);
      return res.status(500).json({ error: 'Failed to resolve' });
    }
  });

  router.post('/:id/sets/:setId/conflicts/:conflictId/note', requireClient, async (req, res) => {
    try {
      const log = await writableLogAnyStatus(req, res);
      if (!log) return undefined;
      let note;
      try { note = cleanText(req.body?.note, 500, 'Note'); } catch (error) { return res.status(400).json({ error: error.message }); }
      if (!note) return res.status(400).json({ error: 'Write a short note' });
      const { data, error } = await supabaseAdmin.from('workout_set_conflicts')
        .update({ client_note: note, client_note_at: new Date().toISOString() })
        .eq('id', req.params.conflictId).eq('workout_log_id', log.id).eq('workout_log_set_id', req.params.setId).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Conflict not found' });
      return res.json(data);
    } catch (error) {
      logError('conflict note error', error);
      return res.status(500).json({ error: 'Failed to save the note' });
    }
  });

  // ---------- PT-Sub ----------
  router.get('/:id/exercises/:exerciseId/substitution-options', async (req, res) => {
    try {
      const log = await workoutLogWithDetails(req.params.id, { media: false });
      if (!canReadLog(req.user, log) || log.status !== 'active') return res.status(404).json({ error: 'Workout log not found' });
      const exercise = originalExerciseOrFail(res, log, req.params.exerciseId);
      if (!exercise) return undefined;
      const extras = await sessionExtras(log);
      const backups = extras.exercises.find((row) => row.id === exercise.id)?.backups || [];
      const { data: catalog, error } = await supabaseAdmin.from('exercise_library')
        .select('id, name, category, equipment, primary_muscle, review_status, hidden, archived').eq('archived', false).eq('hidden', false).limit(2000);
      if (error) throw error;
      const original = (catalog || []).find((row) => row.id === exercise.exercise_library_id) || null;
      const available = String(req.query.equipment || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
      const suggestions = original ? rankSuggestions({ original, catalog, excludeIds: backups.map((row) => row.exercise_library_id), availableEquipment: available }) : [];
      return res.json({
        exercise_id: exercise.id,
        original: { name: exercise.exercise_name, exercise_library_id: exercise.exercise_library_id },
        backups,
        suggestions,
        catalog_reason: original ? null : 'This exercise is not in the catalog, so there are no suggestions.',
        server_time: new Date().toISOString(),
      });
    } catch (error) {
      logError('substitution options error', error);
      return res.status(500).json({ error: 'Failed to load options' });
    }
  });

  router.post('/:id/exercises/:exerciseId/substitutions', async (req, res) => {
    try {
      let request;
      try { request = substitutionRequest(req.body || {}); } catch (error) { return res.status(400).json({ error: error.message }); }
      const { data: replayed } = await supabaseAdmin.from('workout_log_substitutions').select('*').eq('id', request.id).maybeSingle();
      if (replayed) {
        const owner = await workoutLogWithDetails(replayed.workout_log_id, { media: false });
        if (!canReadLog(req.user, owner) || replayed.workout_log_id !== req.params.id) return res.status(404).json({ error: 'Workout log not found' });
        return res.json({ outcome: 'replayed', substitution: replayed, log: await detailedLogResponse(owner.id) });
      }
      const log = await requireWritableActiveLog(req, res);
      if (!log) return undefined;
      const original = originalExerciseOrFail(res, log, req.params.exerciseId);
      if (!original) return undefined;
      const { data: library } = await supabaseAdmin.from('exercise_library')
        .select('id, name, review_status, hidden, archived').eq('id', request.exerciseLibraryId).maybeSingle();
      if (!library || library.archived || library.hidden || library.review_status !== 'approved') return res.status(422).json({ error: 'That exercise is not available as a substitute.' });
      if (library.id === original.exercise_library_id) return res.status(422).json({ error: 'Choose a different exercise.' });
      if (request.source === 'coach_backup') {
        const { data: backup } = await supabaseAdmin.from('workout_exercise_backups').select('id, workout_exercise_id, backup_exercise_library_id')
          .eq('id', request.backupId).eq('archived', false).maybeSingle();
        if (!backup || backup.workout_exercise_id !== original.source_workout_exercise_id || backup.backup_exercise_library_id !== library.id) {
          return res.status(422).json({ error: 'That backup is not planned for this exercise.' });
        }
      }
      const actorRole = isCoachRole(req.user) ? 'coach' : 'client';
      const policy = substitutionPolicy({ source: request.source, actorRole, offline: request.offline });
      const { data, error } = await supabaseAdmin.rpc('create_workout_substitution', {
        p_row: {
          id: request.id, workout_log_id: log.id, client_id: log.client_id, original_log_exercise_id: original.id,
          original_exercise_library_id: original.exercise_library_id, original_name: original.exercise_name,
          replacement_log_exercise_id: request.replacementLogExerciseId, replacement_exercise_library_id: library.id, replacement_name: library.name,
          source: request.source, backup_id: request.backupId, trigger: request.trigger, reason: request.reason, targets: request.targets,
          offline: request.offline, chosen_at: request.chosenAt, actor_role: actorRole,
          actor_coach_id: actorRole === 'coach' ? req.user.coach.id : null, coach_review_status: policy.reviewStatus,
        },
        p_activate: policy.activate,
      });
      if (error) {
        if (/substitution_exists|duplicate key/i.test(error.message || '')) return res.status(409).json({ error: 'This exercise already has a swap in progress.' });
        if (/cannot be changed/i.test(error.message || '')) return res.status(409).json({ error: 'Completed workouts cannot be changed' });
        throw error;
      }
      const substitution = data.substitution;
      if (policy.notice && data.outcome === 'created') {
        const status = policy.notice === 'substitution_request' ? 'Waiting for your OK.'
          : policy.notice === 'substitution_offline'
            ? (request.source === 'coach_backup' ? 'Used your planned backup while offline.' : 'Chosen offline without your approval; review it.')
            : 'Used your planned backup.';
        await raiseCoachNotice({
          log, kind: policy.notice, dedupeKey: `substitution:${substitution.id}`, refId: substitution.id,
          summary: `${log.client?.name || 'Client'}: ${original.exercise_name} → ${library.name} (${triggerLabel(request.trigger)}). ${status}`,
        });
      }
      return res.status(data.outcome === 'created' ? 201 : 200).json({ outcome: data.outcome, substitution, log: await detailedLogResponse(log.id) });
    } catch (error) {
      logError('substitution create error', error);
      return res.status(500).json({ error: 'Failed to record the swap' });
    }
  });

  router.post('/:id/substitutions/:subId/decision', requireCoach, async (req, res) => {
    try {
      const body = req.body || {};
      if (!isUuid(body.event_id) || !['approve', 'decline'].includes(body.decision)) return res.status(400).json({ error: 'Choose approve or decline' });
      const log = await workoutLogWithDetails(req.params.id, { media: false });
      if (!canWriteLog(req.user, log)) return res.status(404).json({ error: 'Workout log not found' });
      const { data: sub } = await supabaseAdmin.from('workout_log_substitutions').select('*').eq('id', req.params.subId).eq('workout_log_id', log.id).maybeSingle();
      if (!sub) return res.status(404).json({ error: 'Swap not found' });
      if (sub.decision_event_id === body.event_id.toLowerCase()) return res.json({ outcome: 'replayed', substitution: sub, log: await detailedLogResponse(log.id) });
      if (sub.status !== 'pending_confirmation') return res.status(409).json({ error: 'This swap was already decided.', substitution: sub });
      if (body.decision === 'approve') {
        if (log.status !== 'active') return res.status(409).json({ error: 'The workout is no longer active.' });
        const { error: activateError } = await supabaseAdmin.rpc('activate_workout_substitution', { p_sub_id: sub.id });
        if (activateError) throw activateError;
      }
      const { data: decided, error } = await supabaseAdmin.from('workout_log_substitutions').update({
        status: body.decision === 'approve' ? 'active' : 'declined', decided_by_coach_id: req.user.coach.id,
        decided_at: new Date().toISOString(), decision_event_id: body.event_id.toLowerCase(),
      }).eq('id', sub.id).eq('status', 'pending_confirmation').select().maybeSingle();
      if (error) throw error;
      if (!decided) return res.status(409).json({ error: 'This swap was already decided.' });
      return res.json({ outcome: body.decision, substitution: decided, log: await detailedLogResponse(log.id) });
    } catch (error) {
      logError('substitution decision error', error);
      return res.status(500).json({ error: 'Failed to record the decision' });
    }
  });

  router.post('/:id/substitutions/:subId/review', requireCoach, async (req, res) => {
    try {
      const body = req.body || {};
      if (!isUuid(body.event_id)) return res.status(400).json({ error: 'event_id is required' });
      const log = await workoutLogWithDetails(req.params.id, { media: false });
      if (!canWriteLog(req.user, log)) return res.status(404).json({ error: 'Workout log not found' });
      const { data: sub } = await supabaseAdmin.from('workout_log_substitutions').select('*').eq('id', req.params.subId).eq('workout_log_id', log.id).maybeSingle();
      if (!sub) return res.status(404).json({ error: 'Swap not found' });
      if (sub.review_event_id === body.event_id.toLowerCase() || sub.coach_review_status === 'reviewed') return res.json({ outcome: 'replayed', substitution: sub });
      const { data, error } = await supabaseAdmin.from('workout_log_substitutions').update({
        coach_review_status: 'reviewed', reviewed_by_coach_id: req.user.coach.id, reviewed_at: new Date().toISOString(), review_event_id: body.event_id.toLowerCase(),
      }).eq('id', sub.id).select().single();
      if (error) throw error;
      return res.json({ outcome: 'reviewed', substitution: data });
    } catch (error) {
      logError('substitution review error', error);
      return res.status(500).json({ error: 'Failed to mark reviewed' });
    }
  });

  return { applySetEvent, detailedLogResponse };
}

module.exports = { registerSessionRoutes, sessionExtras, raiseCoachNotice, setEventEnvelope };
