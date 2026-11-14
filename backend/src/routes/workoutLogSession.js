// pt-session-events/v1 routes on the workout-log router (L12 conductor +
// PT-Sub; L12/CONTRACT.md). Registered by routes/workoutLogs.js, which passes
// its own access helpers so authorization stays exactly the log router's.
const { randomUUID } = require('node:crypto');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireCoach, requireClient } = require('../middleware/auth');
const {
  isUuid, setEventEnvelope, substitutionRequest, substitutionPolicy, rankSuggestions, triggerLabel, cleanText,
  backupTargets,
} = require('../lib/sessionEvents');
const { lookAError } = require('./workoutLookA');

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
        .select('id, workout_exercise_id, backup_exercise_library_id, target_sets, target_reps, target_load_value, target_load_unit, target_load_max, target_per_side, client_note, library:exercise_library(id, name, equipment, review_status, hidden, archived)')
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
      targets: {
        sets: row.target_sets, reps: row.target_reps, load_value: row.target_load_value == null ? null : Number(row.target_load_value), load_unit: row.target_load_unit,
        load_max: row.target_load_max == null ? null : Number(row.target_load_max), per_side: row.target_per_side === true,
      },
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

// Error codes for a database that does not have the value-origin migration
// yet (no apply_workout_set_event_v2 / no value_origin columns).
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);

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
    const args = {
      p_set_id: set.id,
      p_event_id: envelope.eventId,
      p_actor_role: stamp.entered_by,
      p_actor_coach_id: stamp.entered_by_coach_id,
      p_base_revision: envelope.baseRevision,
      p_local_seq: envelope.localSeq,
      p_offline: envelope.offline,
      p_plan_revision_seen: envelope.planRevisionSeen,
      p_payload: payload,
    };
    // A declared origin uses v3 (v2's rule plus the workout's one Undo record,
    // Look A 20261114120000), then v2, then the unchanged v1 RPC on a database
    // that is not yet migrated, without the declaration: the set's meaning is
    // then unknown to new clients, never assumed.
    let { data, error } = envelope.valueOrigin
      ? await supabaseAdmin.rpc('apply_workout_set_event_v3', { ...args, p_value_origin: envelope.valueOrigin })
      : await supabaseAdmin.rpc('apply_workout_set_event', args);
    if (error && envelope.valueOrigin && MISSING_FUNCTION.has(error.code)) {
      ({ data, error } = await supabaseAdmin.rpc('apply_workout_set_event_v2', { ...args, p_value_origin: envelope.valueOrigin }));
    }
    if (error && envelope.valueOrigin && MISSING_FUNCTION.has(error.code)) {
      ({ data, error } = await supabaseAdmin.rpc('apply_workout_set_event', args));
    }
    if (error) {
      if (/event_id_reused/.test(error.message || '')) return res.status(409).json({ error: 'That event id belongs to another set' });
      // Look A client gate (20261114150000): retryable, so the queued write is kept.
      if (error.code === 'P0409') return res.status(503).json({ error: 'This workout is changing right now. Try again.' });
      throw error;
    }
    // change: this write's own Undo, as the database answers it now (null when
    // the write changed nothing material, or on a database without v3).
    return res.json({ ...data.set, event: { id: envelope.eventId, outcome: data.outcome, original_outcome: data.original_outcome || null, conflict_id: data.conflict_id || null, change: data.change || null } });
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
        // Untouched sets only: restored prefill, or legacy rows nobody has
        // written since the start. They stay prefill under a fresh nonce (the
        // database guard makes any undeclared value write unknown). A database
        // without the origin columns keeps the original revision-0 rule.
        const defaults = { actual_load_value: patch.prescribed_load_value, actual_load_unit: patch.prescribed_load_unit, updated_at: new Date().toISOString() };
        let { error: setError } = await supabaseAdmin.from('workout_log_sets')
          .update({ ...defaults, value_origin: 'prefill', value_origin_nonce: randomUUID() })
          .eq('workout_log_exercise_id', exercise.id).eq('status', 'pending').eq('archived', false)
          .or('value_origin.eq.prefill,and(value_origin.eq.legacy,revision.eq.0,last_actor_role.is.null)');
        if (setError && MISSING_COLUMN.has(setError.code)) {
          ({ error: setError } = await supabaseAdmin.from('workout_log_sets')
            .update(defaults)
            .eq('workout_log_exercise_id', exercise.id).eq('status', 'pending').eq('revision', 0).eq('archived', false));
        }
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

  // Look A swap (20261114170000): sent with expected_sets (the set count the
  // page showed) and, for a swap made now, set_ids (one per replacement set).
  // The database fixes a coach backup's count, binds the swap id to this exact
  // request, records it as the workout's one Undo, and answers every retry
  // with the recorded result. Older queued payloads (no expected_sets) keep
  // the unchanged path below.
  function lookASwapFields(body) {
    const expected = body.expected_sets;
    if (expected !== null && !(Number.isInteger(expected) && expected >= 1 && expected <= 10)) throw new Error('A valid set count is required');
    const ids = body.set_ids;
    if (ids !== undefined && ids !== null && !(Array.isArray(ids) && ids.length <= 10 && ids.every(isUuid))) throw new Error('Valid set ids are required');
    return { expectedSets: expected, setIds: Array.isArray(ids) ? ids.map((id) => id.toLowerCase()) : null };
  }

  async function currentUndoFor(logId, user) {
    const stamp = actorStamp(user);
    const { data, error } = await supabaseAdmin.rpc('workout_current_undo', {
      p_log_id: logId, p_actor_role: stamp.entered_by, p_actor_coach_id: stamp.entered_by_coach_id,
    });
    if (error) { if (MISSING_FUNCTION.has(error.code)) return null; throw error; }
    return data || null;
  }

  async function lookASwap(req, res, request) {
    let fields;
    try { fields = lookASwapFields(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    const actorRole = isCoachRole(req.user) ? 'coach' : 'client';
    const policy = substitutionPolicy({ source: request.source, actorRole, offline: request.offline });
    const clientTargets = request.targets;
    const row = {
      id: request.id, workout_log_id: req.params.id, original_log_exercise_id: req.params.exerciseId,
      replacement_log_exercise_id: request.replacementLogExerciseId, replacement_exercise_library_id: request.exerciseLibraryId,
      source: request.source, backup_id: request.backupId, trigger: request.trigger, reason: request.reason,
      targets: clientTargets, client_targets: clientTargets, offline: request.offline, chosen_at: request.chosenAt,
      actor_role: actorRole, actor_coach_id: actorRole === 'coach' ? req.user.coach.id : null, coach_review_status: policy.reviewStatus,
    };
    // A swap already recorded (applied or refused) replays through the
    // database's request check, never by id alone.
    const [{ data: priorSwap }, { data: priorChange }] = await Promise.all([
      supabaseAdmin.from('workout_log_substitutions').select('id, workout_log_id').eq('id', request.id).maybeSingle(),
      supabaseAdmin.from('workout_material_changes').select('id, workout_log_id').eq('id', request.id).maybeSingle(),
    ]);
    const prior = priorSwap || priorChange;
    let log;
    let original;
    let library;
    if (prior) {
      log = await workoutLogWithDetails(req.params.id, { media: false });
      if (!canReadLog(req.user, log) || prior.workout_log_id !== req.params.id) return res.status(404).json({ error: 'Workout log not found' });
      original = log.exercises.find((exercise) => exercise.id === req.params.exerciseId);
      if (!original) return res.status(404).json({ error: 'Workout exercise not found' });
    } else {
      log = await requireWritableActiveLog(req, res);
      if (!log) return undefined;
      original = originalExerciseOrFail(res, log, req.params.exerciseId);
      if (!original) return undefined;
      ({ data: library } = await supabaseAdmin.from('exercise_library')
        .select('id, name, review_status, hidden, archived').eq('id', request.exerciseLibraryId).maybeSingle());
      if (!library || library.archived || library.hidden || library.review_status !== 'approved') return res.status(422).json({ error: 'That exercise is not available as a substitute.' });
      if (library.id === original.exercise_library_id) return res.status(422).json({ error: 'Choose a different exercise.' });
      if (request.source === 'coach_backup') {
        const { data: backup } = await supabaseAdmin.from('workout_exercise_backups')
          .select('id, workout_exercise_id, backup_exercise_library_id, target_load_value, target_load_unit, target_load_max, target_per_side')
          .eq('id', request.backupId).eq('archived', false).maybeSingle();
        if (!backup || backup.workout_exercise_id !== original.source_workout_exercise_id || backup.backup_exercise_library_id !== library.id) {
          return res.status(422).json({ error: 'That backup is not planned for this exercise.' });
        }
        row.targets = backupTargets(backup, clientTargets, req.body?.targets || {});
      }
    }
    Object.assign(row, {
      client_id: log.client_id, original_exercise_library_id: original.exercise_library_id, original_name: original.exercise_name,
      replacement_name: library?.name || original.exercise_name,
    });
    const { data, error } = await supabaseAdmin.rpc('create_workout_substitution_v3', {
      p_row: row, p_activate: policy.activate, p_expected_sets: fields.expectedSets, p_set_ids: policy.activate ? fields.setIds : null,
    });
    if (error) {
      const mapped = lookAError(error);
      if (mapped) return res.status(mapped.status).json({ error: mapped.error });
      if (/substitution_exists|duplicate key/i.test(error.message || '')) return res.status(409).json({ error: 'This exercise already has a swap in progress.' });
      if (/cannot be changed/i.test(error.message || '')) return res.status(409).json({ error: 'Completed workouts cannot be changed' });
      if (/set ids|expected sets|targets must be/i.test(error.message || '')) return res.status(400).json({ error: 'The swap does not match its sets. Reload and try again.' });
      if (/Exercise not found/.test(error.message || '')) return res.status(404).json({ error: 'Workout exercise not found' });
      throw error;
    }
    const refused = data.outcome === 'refused' || data.original_outcome === 'refused';
    if (refused) {
      return res.status(409).json({ error: data.message || 'This swap was not saved.', reason: data.reason, sets: data.sets ?? null, outcome: data.outcome });
    }
    const substitution = data.substitution;
    if (policy.notice && data.outcome === 'created') {
      const status = policy.notice === 'substitution_request' ? 'Waiting for your OK.'
        : policy.notice === 'substitution_offline'
          ? (request.source === 'coach_backup' ? 'Used your planned backup while offline.' : 'Chosen offline without your approval; review it.')
          : 'Used your planned backup.';
      await raiseCoachNotice({
        log, kind: policy.notice, dedupeKey: `substitution:${substitution.id}`, refId: substitution.id,
        summary: `${log.client?.name || 'Client'}: ${original.exercise_name} → ${row.replacement_name} (${triggerLabel(request.trigger)}). ${status}`,
      });
    }
    return res.status(data.outcome === 'created' ? 201 : 200).json({
      outcome: data.outcome, substitution, sets: data.sets ?? null,
      change: { id: request.id, undoable: data.undoable === true },
      log: await detailedLogResponse(log.id), undo: await currentUndoFor(log.id, req.user),
    });
  }

  router.post('/:id/exercises/:exerciseId/substitutions', async (req, res) => {
    try {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'expected_sets')) {
        let lookARequest;
        try { lookARequest = substitutionRequest(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
        return await lookASwap(req, res, lookARequest);
      }
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
        const { data: backup } = await supabaseAdmin.from('workout_exercise_backups')
          .select('id, workout_exercise_id, backup_exercise_library_id, target_load_value, target_load_unit, target_load_max, target_per_side')
          .eq('id', request.backupId).eq('archived', false).maybeSingle();
        if (!backup || backup.workout_exercise_id !== original.source_workout_exercise_id || backup.backup_exercise_library_id !== library.id) {
          return res.status(422).json({ error: 'That backup is not planned for this exercise.' });
        }
        // Look A: keep the backup's saved range, per side and unit (review 4).
        request.targets = backupTargets(backup, request.targets, req.body?.targets || {});
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
          create_target_sets: request.createTargetSets,
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
      // One locked transaction (decide_workout_substitution): the first
      // decision wins, the same event replays, and an approval's activation
      // and its recorded decision commit or roll back together.
      const { data, error } = await supabaseAdmin.rpc('decide_workout_substitution', {
        p_log_id: log.id, p_sub_id: sub.id, p_decision: body.decision, p_event_id: body.event_id.toLowerCase(), p_coach_id: req.user.coach.id,
      });
      if (error) throw error;
      if (data.outcome === 'not_found') return res.status(404).json({ error: 'Swap not found' });
      if (data.outcome === 'replayed') return res.json({ outcome: 'replayed', substitution: data.substitution, log: await detailedLogResponse(log.id) });
      if (data.outcome === 'already_decided') {
        const error = data.substitution?.status === 'undone' ? 'The client took this swap back.' : 'This swap was already decided.';
        return res.status(409).json({ error, substitution: data.substitution });
      }
      if (data.outcome === 'log_not_active') return res.status(409).json({ error: 'The workout is no longer active.' });
      return res.json({ outcome: body.decision, substitution: data.substitution, log: await detailedLogResponse(log.id) });
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

  return { applySetEvent, detailedLogResponse, writableLogAnyStatus };
}

module.exports = { registerSessionRoutes, sessionExtras, raiseCoachNotice, setEventEnvelope };
