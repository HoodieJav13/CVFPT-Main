// Look A routes on the workout-log router (local, 2026-11-14): exercise done,
// not set-tracked; skip the rest of an exercise; one strict Undo; Finish with
// an explicit mode. Registered by routes/workoutLogs.js, which passes its own
// access helpers so authorization stays exactly the log router's: the owning
// client, or a coach/admin authorized for the log's client. The actor is
// always derived from the authenticated user, never from the body.
//
// Every write carries a client event_id, so a retry (lost reply, offline
// queue, repeat click) replays the recorded answer instead of acting twice.
// The database decides every outcome (supabase/migrations/20261114120000).
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
const FINISH_MODES = new Set(['finish', 'not_set_tracked']);

function lookAError(error) {
  const message = error?.message || '';
  if (MISSING_FUNCTION.has(error?.code)) return { status: 503, error: 'This needs the latest database update.' };
  if (/event_id_reused/.test(message)) return { status: 409, error: 'That change id was already used for a different change.' };
  if (/Workout (log|exercise|set) not found/.test(message)) return { status: 404, error: message };
  if (/Workout log is not active/.test(message)) return { status: 409, error: 'This workout is no longer active.' };
  return null;
}

function completedAtFrom(body) {
  const raw = body?.completed_at_local;
  return typeof raw === 'string' && raw.length <= 40 && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

function registerLookARoutes(router, deps) {
  const {
    workoutLogWithDetails, canWriteLog, actorStamp, sessionExtras, completedWorkoutPush, markStartedNotificationsRead,
  } = deps;

  async function writableLog(req, res) {
    const log = await workoutLogWithDetails(req.params.id, { media: false });
    if (!canWriteLog(req.user, log)) {
      res.status(404).json({ error: 'Workout log not found' });
      return null;
    }
    return log;
  }

  function eventIdOrFail(req, res, key = 'event_id') {
    const value = req.body?.[key];
    if (typeof value !== 'string' || !UUID.test(value)) {
      res.status(400).json({ error: key === 'event_id' ? 'A valid change id is required' : 'Choose a change to undo' });
      return null;
    }
    return value.toLowerCase();
  }

  // The one Undo this actor may use right now, or null (reload / other device).
  async function currentUndo(logId, user) {
    const stamp = actorStamp(user);
    const { data, error } = await supabaseAdmin.rpc('workout_current_undo', {
      p_log_id: logId, p_actor_role: stamp.entered_by, p_actor_coach_id: stamp.entered_by_coach_id,
    });
    if (error) {
      if (MISSING_FUNCTION.has(error.code)) return null;
      throw error;
    }
    return data || null;
  }

  async function reply(req, res, logId, result, status = 200) {
    const log = await workoutLogWithDetails(logId);
    return res.status(status).json({
      result,
      log: log ? await sessionExtras(log) : null,
      undo: await currentUndo(logId, req.user),
    });
  }

  function fail(res, error, label, fallback) {
    const mapped = lookAError(error);
    if (mapped) return res.status(mapped.status).json({ error: mapped.error });
    logError(label, error);
    return res.status(500).json({ error: fallback });
  }

  router.get('/:id/undo', async (req, res) => {
    try {
      const log = await writableLog(req, res);
      if (!log) return undefined;
      return res.json({ undo: await currentUndo(log.id, req.user) });
    } catch (error) {
      return fail(res, error, 'current undo error', 'Could not check Undo');
    }
  });

  // Exercise done, not set-tracked: one flag; no set is written.
  router.post('/:id/exercises/:exerciseId/done', async (req, res) => {
    try {
      const eventId = eventIdOrFail(req, res);
      if (!eventId) return undefined;
      const log = await writableLog(req, res);
      if (!log) return undefined;
      if (!log.exercises.some((row) => row.id === req.params.exerciseId)) return res.status(404).json({ error: 'Workout exercise not found' });
      const stamp = actorStamp(req.user);
      const { data, error } = await supabaseAdmin.rpc('mark_workout_exercise_not_set_tracked', {
        p_log_id: log.id, p_exercise_id: req.params.exerciseId, p_event_id: eventId,
        p_actor_role: stamp.entered_by, p_actor_coach_id: stamp.entered_by_coach_id,
      });
      if (error) throw error;
      return await reply(req, res, log.id, data);
    } catch (error) {
      return fail(res, error, 'exercise done error', 'Could not mark the exercise done');
    }
  });

  // Skip the rest of an exercise: exactly the pending sets the person saw.
  router.post('/:id/exercises/:exerciseId/skip-rest', async (req, res) => {
    try {
      const eventId = eventIdOrFail(req, res);
      if (!eventId) return undefined;
      const sets = req.body?.sets;
      if (!Array.isArray(sets) || !sets.length || sets.length > 50
        || !sets.every((row) => row && UUID.test(String(row.id || '')) && Number.isInteger(row.revision) && row.revision >= 0)) {
        return res.status(400).json({ error: 'Choose the sets to skip' });
      }
      const log = await writableLog(req, res);
      if (!log) return undefined;
      if (!log.exercises.some((row) => row.id === req.params.exerciseId)) return res.status(404).json({ error: 'Workout exercise not found' });
      const stamp = actorStamp(req.user);
      const { data, error } = await supabaseAdmin.rpc('skip_workout_exercise_sets', {
        p_log_id: log.id, p_exercise_id: req.params.exerciseId, p_event_id: eventId,
        p_actor_role: stamp.entered_by, p_actor_coach_id: stamp.entered_by_coach_id,
        p_sets: sets.map((row) => ({ id: String(row.id).toLowerCase(), revision: row.revision })),
      });
      if (error) throw error;
      return await reply(req, res, log.id, data);
    } catch (error) {
      return fail(res, error, 'skip rest error', 'Could not skip the rest');
    }
  });

  // The one Undo. Its outcome (applied / refused with a reason) is the
  // server's; the page only shows it.
  router.post('/:id/undo', async (req, res) => {
    try {
      const eventId = eventIdOrFail(req, res);
      if (!eventId) return undefined;
      const targetId = eventIdOrFail(req, res, 'change_id');
      if (!targetId) return undefined;
      const log = await writableLog(req, res);
      if (!log) return undefined;
      const stamp = actorStamp(req.user);
      const { data, error } = await supabaseAdmin.rpc('undo_workout_material_change', {
        p_log_id: log.id, p_target_id: targetId, p_event_id: eventId,
        p_actor_role: stamp.entered_by, p_actor_coach_id: stamp.entered_by_coach_id,
      });
      if (error) throw error;
      return await reply(req, res, log.id, data);
    } catch (error) {
      return fail(res, error, 'undo error', 'Could not undo');
    }
  });

  // Finish with an explicit mode: 'finish' (the normal rule) or
  // 'not_set_tracked' (the whole workout done, no set written). The coach is
  // pushed only when this call created the completion notification.
  router.post('/:id/finish', async (req, res) => {
    try {
      const eventId = eventIdOrFail(req, res);
      if (!eventId) return undefined;
      const mode = req.body?.mode;
      if (!FINISH_MODES.has(mode)) return res.status(400).json({ error: 'Choose how to finish' });
      const log = await writableLog(req, res);
      if (!log) return undefined;
      const stamp = actorStamp(req.user);
      const { data, error } = await supabaseAdmin.rpc('finish_workout_log_v3', {
        p_log_id: log.id, p_client_id: log.client_id, p_event_id: eventId,
        p_actor_role: stamp.entered_by, p_actor_coach_id: stamp.entered_by_coach_id,
        p_mode: mode,
        p_notes: String(req.body?.notes || '').slice(0, 4000),
        p_feedback: String(req.body?.feedback || '').slice(0, 4000),
        p_completed_at: completedAtFrom(req.body),
      });
      if (error) throw error;
      if (data?.outcome === 'refused' && data.reason === 'complete_at_least_one_set') {
        return res.status(400).json({ error: 'Complete at least one set', result: data });
      }
      if (data?.outcome === 'applied') await markStartedNotificationsRead(log.id);
      const detail = await workoutLogWithDetails(log.id);
      if (data?.outcome === 'applied' && data.notified === true && detail) completedWorkoutPush(detail);
      return res.json({ result: data, log: detail ? await sessionExtras(detail) : null, undo: await currentUndo(log.id, req.user) });
    } catch (error) {
      return fail(res, error, 'finish workout error', 'Failed to finish workout');
    }
  });

  return { currentUndo };
}

module.exports = { registerLookARoutes, lookAError, completedAtFrom, FINISH_MODES };
