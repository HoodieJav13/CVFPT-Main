const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');
const {
  validateOptionalText,
  validateSchedulePayload,
  validateSessionListQuery,
  validateSessionNotePayload,
  validateTimestamp,
  validateUuid,
} = require('../validation/business');
const {
  dispatchEmail, notifySessionCancelRequested, notifySessionCancelled,
  notifySessionCancelledByClient, notifySessionRescheduled, notifySessionScheduled,
} = require('../services/email');
const { buildSessionIcs } = require('../lib/ics');
const { dispatchPush, sendToClient, sendToCoaches } = require('../services/push');
const { formatDenver } = require('../services/email');
const { dateInTz, todayDateInTz } = require('../utils/time');

// D1b (2026-08-06): clients may self-cancel up to this long before start.
const CLIENT_CANCEL_CUTOFF_MS = 24 * 60 * 60 * 1000;

// Program 011 B: a session may carry the workout the coach plans to run.
// The attachment must be the acting coach's own (admins may attach the
// session coach's workouts), unarchived. Returns { ok, value | error }.
async function validateWorkoutAttachment(workoutId, coachId) {
  if (workoutId === null) return { ok: true, value: null };
  const idValidation = validateUuid(workoutId, 'Workout ID');
  if (!idValidation.ok) return { ok: false, error: idValidation.error };
  const { data: workout } = await supabaseAdmin.from('workouts').select('id, coach_id')
    .eq('id', idValidation.value).eq('archived', false).maybeSingle();
  if (!workout || workout.coach_id !== coachId) return { ok: false, error: 'Workout not found' };
  return { ok: true, value: workout.id };
}

async function attachWorkout(sessionId, workoutId) {
  const { error } = await supabaseAdmin.from('sessions')
    .update({ workout_id: workoutId, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
}

// Live workout state for scheduled sessions: the tracker links its log to
// the session (see workout-logs /start), and the coach list surfaces that
// state so "in the gym" / "workout done" is visible without opening the
// notifications feed. Completed/cancelled sessions carry their own status.
async function attachLinkedLogs(sessions) {
  const scheduledIds = (sessions || []).filter((s) => s.status === 'scheduled').map((s) => s.id);
  if (!scheduledIds.length) return (sessions || []).map((s) => ({ ...s, linked_workout_log: null }));
  const { data: logs, error } = await supabaseAdmin.from('workout_logs')
    .select('id, session_id, status, started_at, completed_at, quick_completed')
    .in('session_id', scheduledIds).eq('archived', false)
    .in('status', ['active', 'completed'])
    .order('started_at', { ascending: false });
  if (error) throw error;
  const bySession = new Map();
  for (const log of logs || []) {
    const current = bySession.get(log.session_id);
    // An active log (client mid-workout) beats any completed one; within a
    // status the newest start wins because rows arrive newest-first.
    if (!current || (log.status === 'active' && current.status !== 'active')) bySession.set(log.session_id, log);
  }
  return sessions.map((s) => ({ ...s, linked_workout_log: bySession.get(s.id) || null }));
}

// Shared plan expansion for the session detail surfaces (client + coach).
async function workoutPlanExercises(workoutId) {
  if (!workoutId) return [];
  const { data: exercises } = await supabaseAdmin.from('workout_exercises')
    .select('id, custom_name, sets, reps, rest, client_notes, position, library_exercise:exercise_library(name)')
    .eq('workout_id', workoutId).eq('archived', false).order('position');
  return (exercises || []).map((exercise) => ({
    id: exercise.id,
    name: exercise.library_exercise?.name || exercise.custom_name || 'Exercise',
    sets: exercise.sets,
    reps: exercise.reps,
    rest: exercise.rest,
    client_notes: exercise.client_notes,
  }));
}

// Sessions a client has asked to cancel (011 D signal rows) — surfaced so
// the "asked" state survives a reload instead of living in component state.
async function cancelRequestedSessionIds(sessionIds) {
  if (!sessionIds.length) return new Set();
  const { data, error } = await supabaseAdmin.from('notifications')
    .select('session_id').eq('event_type', 'cancel_requested')
    .in('session_id', sessionIds).eq('archived', false);
  if (error) throw error;
  return new Set((data || []).map((row) => row.session_id));
}

const router = express.Router();
router.use(requireAuth);

function conflictResponse(result) {
  const conflict = result.conflict_session || {};
  const when = conflict.scheduled_at ? new Date(conflict.scheduled_at).toLocaleString('en-US', { timeZone: 'America/Denver' }) : 'another time';
  return {
    error: result.outcome === 'client_conflict'
      ? `This client already has a session at ${when}.`
      : `You already have a session at ${when}.`,
    conflict: { scope: result.outcome === 'client_conflict' ? 'client' : 'coach', session: conflict },
  };
}

async function loadSessionForCoach(req, res) {
  const idValidation = validateUuid(req.params.id, 'Session ID');
  if (!idValidation.ok) {
    res.status(400).json({ error: idValidation.error });
    return null;
  }
  const { data: session } = await supabaseAdmin.from('sessions').select('*')
    .eq('id', idValidation.value).eq('archived', false).maybeSingle();
  if (!session || (req.user.role !== 'admin' && session.coach_id !== req.user.coach.id)) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return session;
}

// GET /api/sessions  (coach/admin) ?from=&to=&client_id=&status=
router.get('/', requireCoach, async (req, res) => {
  try {
    const validation = validateSessionListQuery(req.query);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    let q = supabaseAdmin.from('sessions')
      .select('*, client:clients(id, name), coach:coaches(id, name), workout:workouts(id, name)')
      .eq('archived', false)
      .order('scheduled_at', { ascending: true });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    if (validation.value.client_id) q = q.eq('client_id', validation.value.client_id);
    if (validation.value.status) q = q.eq('status', validation.value.status);
    if (validation.value.from) q = q.gte('scheduled_at', validation.value.from);
    if (validation.value.to) q = q.lt('scheduled_at', validation.value.to);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(await attachLinkedLogs(data));
  } catch (e) {
    logError('list sessions error', e);
    return res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// GET /api/sessions/studio (coach): every coach's schedule for the
// shared studio calendar, privacy-scoped per roadmap-v3 D1 — coach,
// time, duration, location, and status are visible to all coaches;
// client identity is stripped server-side unless the viewer is that
// client's coach or an admin. Registered before any '/:id' routes.
router.get('/studio', requireCoach, async (req, res) => {
  try {
    // The grid shows one week at a time; an unbounded query would ship
    // the studio's entire history on every load. Both bounds required.
    const from = validateTimestamp(req.query?.from, 'From');
    const to = validateTimestamp(req.query?.to, 'To');
    if (!from.ok || !to.ok) {
      return res.status(400).json({ error: 'from and to date-times are required' });
    }
    const spanMs = new Date(to.value).getTime() - new Date(from.value).getTime();
    if (spanMs <= 0 || spanMs > 31 * 24 * 3600 * 1000) {
      return res.status(400).json({ error: 'Range must be positive and at most 31 days' });
    }
    const { data, error } = await supabaseAdmin.from('sessions')
      .select('id, coach_id, scheduled_at, duration_minutes, location, status, coach:coaches(id, name), client:clients(id, name, coach_id)')
      .eq('archived', false)
      .gte('scheduled_at', from.value)
      .lt('scheduled_at', to.value)
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    const viewerCoachId = req.user.coach.id;
    const isAdmin = req.user.role === 'admin';
    const sessions = (data || []).map((session) => {
      const own = isAdmin || session.client?.coach_id === viewerCoachId;
      return {
        id: session.id,
        coach_id: session.coach_id,
        scheduled_at: session.scheduled_at,
        duration_minutes: session.duration_minutes,
        location: session.location,
        status: session.status,
        coach: session.coach ? { id: session.coach.id, name: session.coach.name } : null,
        client: own && session.client ? { id: session.client.id, name: session.client.name } : null,
        masked: !own,
      };
    });
    return res.json(sessions);
  } catch (e) {
    logError('studio sessions error', e);
    return res.status(500).json({ error: 'Failed to load the studio calendar' });
  }
});

// POST /api/sessions  (coach)
router.post('/', requireCoach, async (req, res) => {
  try {
    const { client_id, scheduled_at, duration_minutes, location } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'Client and date/time are required' });
    const clientIdValidation = validateUuid(client_id, 'Client ID');
    if (!clientIdValidation.ok) return res.status(400).json({ error: clientIdValidation.error });
    const validation = validateSchedulePayload({ scheduled_at, duration_minutes }, { requireDate: true });
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const locationValidation = validateOptionalText(location, 'Location');
    if (!locationValidation.ok) return res.status(400).json({ error: locationValidation.error });
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', clientIdValidation.value).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const coachId = req.user.role === 'admin' ? clientRow.coach_id : req.user.coach.id;
    const { data, error } = await supabaseAdmin.rpc('schedule_session', {
      p_session_id: null,
      p_client_id: clientIdValidation.value,
      p_coach_id: coachId,
      p_scheduled_at: validation.value.scheduled_at,
      p_duration_minutes: validation.value.duration_minutes,
      p_location: locationValidation.value,
      p_set_location: true,
    });
    if (error) throw error;
    if (data.outcome !== 'scheduled') return res.status(409).json(conflictResponse(data));
    if (Object.hasOwn(req.body || {}, 'workout_id') && req.body.workout_id !== null) {
      const attachment = await validateWorkoutAttachment(req.body.workout_id, coachId);
      if (!attachment.ok) return res.status(400).json({ error: attachment.error });
      await attachWorkout(data.session.id, attachment.value);
    }
    const { data: created, error: readError } = await supabaseAdmin.from('sessions')
      .select('*, client:clients(id, name), workout:workouts(id, name)').eq('id', data.session.id).single();
    if (readError) throw readError;
    await dispatchEmail(() => notifySessionScheduled(created));
    dispatchPush(() => sendToClient(created.client_id, {
      title: 'New session scheduled',
      body: `${formatDenver(created.scheduled_at)} with your coach.`,
      url: `/client/sessions/${created.id}`,
    }));
    return res.status(201).json({ ...created, location_overlaps: data.location_overlaps || 0 });
  } catch (e) {
    logError('create session error', e);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// PUT /api/sessions/:id  (coach)
router.put('/:id', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    const validation = validateSchedulePayload(req.body || {});
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const updates = { ...validation.value };
    if (Object.hasOwn(req.body || {}, 'location')) {
      const locationValidation = validateOptionalText(req.body.location, 'Location');
      if (!locationValidation.ok) return res.status(400).json({ error: locationValidation.error });
      updates.location = locationValidation.value;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide a session field to update' });
    const { data, error } = await supabaseAdmin.rpc('schedule_session', {
      p_session_id: session.id,
      p_client_id: session.client_id,
      p_coach_id: session.coach_id,
      p_scheduled_at: updates.scheduled_at || session.scheduled_at,
      p_duration_minutes: updates.duration_minutes || session.duration_minutes,
      p_location: Object.hasOwn(updates, 'location') ? updates.location : session.location,
      p_set_location: Object.hasOwn(updates, 'location'),
    });
    if (error) throw error;
    if (data.outcome !== 'scheduled') return res.status(409).json(conflictResponse(data));
    if (Object.hasOwn(req.body || {}, 'workout_id')) {
      const attachment = await validateWorkoutAttachment(req.body.workout_id, session.coach_id);
      if (!attachment.ok) return res.status(400).json({ error: attachment.error });
      await attachWorkout(session.id, attachment.value);
    }
    const { data: updated, error: readError } = await supabaseAdmin.from('sessions')
      .select('*, client:clients(id, name), workout:workouts(id, name)').eq('id', session.id).single();
    if (readError) throw readError;
    // Only a real change to when/how-long/where warrants an email — a
    // no-op resave must not tell the client their session moved.
    const meaningfullyChanged = new Date(updated.scheduled_at).getTime() !== new Date(session.scheduled_at).getTime()
      || updated.duration_minutes !== session.duration_minutes
      || (updated.location || null) !== (session.location || null);
    if (meaningfullyChanged && updated.status === 'scheduled') {
      await dispatchEmail(() => notifySessionRescheduled(updated, session));
      dispatchPush(() => sendToClient(updated.client_id, {
        title: 'Your session changed',
        body: `Now ${formatDenver(updated.scheduled_at)}.`,
        url: `/client/sessions/${updated.id}`,
      }));
    }
    return res.json({ ...updated, location_overlaps: data.location_overlaps || 0 });
  } catch (e) {
    logError('update session error', e);
    return res.status(500).json({ error: 'Failed to update session' });
  }
});

// PATCH /api/sessions/:id/cancel
router.patch('/:id/cancel', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    if (session.status === 'completed') return res.status(400).json({ error: 'Completed sessions cannot be cancelled' });
    const { data, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', session.id).select('*, client:clients(id, name)').single();
    if (error) throw error;
    await dispatchEmail(() => notifySessionCancelled(data));
    dispatchPush(() => sendToClient(data.client_id, {
      title: 'Session cancelled',
      body: `${formatDenver(data.scheduled_at)} is off the calendar.`,
      url: '/client/sessions',
    }));
    return res.json(data);
  } catch (e) {
    logError('cancel session error', e);
    return res.status(500).json({ error: 'Failed to cancel session' });
  }
});

// PATCH /api/sessions/:id/no-show  (coach) — D2a: honest status for a
// session that started and the client never came; analytics counts it
// against adherence instead of corrupting completed/cancelled.
router.patch('/:id/no-show', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    if (session.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled sessions can be marked as a no-show' });
    }
    if (new Date(session.scheduled_at).getTime() > Date.now()) {
      return res.status(400).json({ error: 'This session has not started yet' });
    }
    const { data, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'no_show', updated_at: new Date().toISOString() })
      .eq('id', session.id).select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('no-show session error', e);
    return res.status(500).json({ error: 'Failed to update session' });
  }
});

// PATCH /api/sessions/:id/client-cancel  (client, own session, >=24h out)
router.patch('/:id/client-cancel', requireClient, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Session ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: session } = await supabaseAdmin.from('sessions').select('*')
      .eq('id', idValidation.value).eq('client_id', req.user.client.id)
      .eq('archived', false).maybeSingle();
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled sessions can be cancelled' });
    }
    if (new Date(session.scheduled_at).getTime() - Date.now() < CLIENT_CANCEL_CUTOFF_MS) {
      return res.status(400).json({
        error: 'Sessions can be cancelled up to 24 hours before they start. Message your coach instead.',
      });
    }
    const { data, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', session.id).select('*, coach:coaches(id, name)').single();
    if (error) throw error;
    await dispatchEmail(() => notifySessionCancelledByClient(data));
    return res.json(data);
  } catch (e) {
    logError('client cancel session error', e);
    return res.status(500).json({ error: 'Failed to cancel the session' });
  }
});

// PATCH /api/sessions/:id/ask-cancel  (client) — 011 D: inside the 24h
// cutoff a client can't self-cancel, but the request must not dead-end.
// It becomes an in-app notification for the coach (+ admins) and an email;
// the coach cancels from it. Idempotent per recipient via the partial
// unique index — asking twice is one signal.
router.patch('/:id/ask-cancel', requireClient, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Session ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: session } = await supabaseAdmin.from('sessions').select('*')
      .eq('id', idValidation.value).eq('client_id', req.user.client.id)
      .eq('archived', false).maybeSingle();
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled sessions can be cancelled' });
    }
    const { data: coaches, error: coachErr } = await supabaseAdmin.from('coaches')
      .select('id').eq('archived', false)
      .or(`id.eq.${session.coach_id},is_admin.eq.true`);
    if (coachErr) throw coachErr;
    for (const coach of coaches || []) {
      const { error: insertErr } = await supabaseAdmin.from('notifications').insert({
        recipient_coach_id: coach.id, event_type: 'cancel_requested', session_id: session.id,
      });
      // 23505 = already asked — idempotent by design.
      if (insertErr && insertErr.code !== '23505') throw insertErr;
    }
    await dispatchEmail(() => notifySessionCancelRequested(session));
    dispatchPush(() => sendToCoaches((coaches || []).map((coach) => coach.id), {
      title: 'Cancel request',
      body: `A client asked to cancel the ${formatDenver(session.scheduled_at)} session.`,
      url: '/coach/notifications',
    }));
    return res.json({ ok: true });
  } catch (e) {
    logError('ask cancel session error', e);
    return res.status(500).json({ error: 'Could not send the request. Please try again.' });
  }
});

// GET /api/sessions/:id/ics — calendar file for a scheduled session.
router.get('/:id/ics', async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Session ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: session } = await supabaseAdmin.from('sessions')
      .select('*, coach:coaches(id, name), client:clients(id, name)')
      .eq('id', idValidation.value).eq('archived', false).maybeSingle();
    const ownClient = req.user.role === 'client' && session?.client_id === req.user.client.id;
    const ownCoach = (req.user.role === 'coach' && session?.coach_id === req.user.coach?.id) || req.user.role === 'admin';
    if (!session || (!ownClient && !ownCoach)) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'scheduled') return res.status(400).json({ error: 'Only scheduled sessions can be added to a calendar' });
    const otherName = req.user.role === 'client' ? session.coach?.name : session.client?.name;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cvf-session-${session.id.slice(0, 8)}.ics"`);
    return res.send(buildSessionIcs(session, { otherName }));
  } catch (e) {
    logError('session ics error', e);
    return res.status(500).json({ error: 'Failed to build the calendar file' });
  }
});

// PATCH /api/sessions/:id/complete
router.patch('/:id/complete', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    if (session.status === 'completed') return res.status(400).json({ error: 'Session already completed' });
    if (session.status === 'cancelled') return res.status(400).json({ error: 'Cancelled sessions cannot be completed' });
    // Same-day early completion is fine (a session can run ahead of the
    // clock); completing a future day's session is always a mis-tap.
    if (dateInTz(session.scheduled_at) > todayDateInTz()) {
      return res.status(400).json({ error: 'This session is scheduled for a future day' });
    }

    const { data, error } = await supabaseAdmin.rpc('complete_session', { p_session_id: session.id });
    if (error) throw error;
    if (!data) return res.status(400).json({ error: 'Session was already handled' });
    return res.json(data);
  } catch (e) {
    logError('complete session error', e);
    return res.status(500).json({ error: 'Failed to complete session' });
  }
});

// ---- Session notes ----
// GET /api/sessions/:id/notes  (coach)
router.get('/:id/notes', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    const { data, error } = await supabaseAdmin.from('session_notes').select('*')
      .eq('session_id', session.id).eq('archived', false).order('created_at');
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('get notes error', e);
    return res.status(500).json({ error: 'Failed to load notes' });
  }
});

// POST /api/sessions/:id/notes  { content, shared_with_client }
router.post('/:id/notes', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    const validation = validateSessionNotePayload(req.body || {});
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const { data, error } = await supabaseAdmin.from('session_notes').insert({
      session_id: session.id,
      coach_id: req.user.role === 'admin' ? session.coach_id : req.user.coach.id,
      ...validation.value,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('create note error', e);
    return res.status(500).json({ error: 'Failed to save note' });
  }
});

// PUT /api/sessions/notes/:noteId  { content, shared_with_client }
router.put('/notes/:noteId', requireCoach, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.noteId, 'Note ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: note } = await supabaseAdmin.from('session_notes')
      .select('*, session:sessions(coach_id, archived)')
      .eq('id', idValidation.value).eq('archived', false).maybeSingle();
    if (!note || note.session?.archived || (req.user.role !== 'admin' && note.session?.coach_id !== req.user.coach.id)) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const validation = validateSessionNotePayload(req.body || {}, { partial: true });
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const updates = { ...validation.value, updated_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from('session_notes').update(updates).eq('id', note.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('update note error', e);
    return res.status(500).json({ error: 'Failed to update note' });
  }
});

// GET /api/sessions/:id/coach-detail — one session, everything the coach
// works from: client and plan, every note (private and shared), and the
// workout logs linked to this session (live or finished).
router.get('/:id/coach-detail', requireCoach, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Session ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: session } = await supabaseAdmin.from('sessions')
      .select('*, client:clients(id, name), coach:coaches(id, name), workout:workouts(id, name, description, goal)')
      .eq('id', idValidation.value).eq('archived', false).maybeSingle();
    if (!session || (req.user.role !== 'admin' && session.coach_id !== req.user.coach.id)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const { data: notes, error: notesError } = await supabaseAdmin.from('session_notes').select('*')
      .eq('session_id', session.id).eq('archived', false).order('created_at');
    if (notesError) throw notesError;
    const { data: logs, error: logsError } = await supabaseAdmin.from('workout_logs')
      .select('id, status, workout_name, started_at, completed_at, quick_completed')
      .eq('session_id', session.id).eq('archived', false)
      .in('status', ['active', 'completed'])
      .order('started_at', { ascending: false });
    if (logsError) throw logsError;
    const workoutExercises = await workoutPlanExercises(session.workout_id);
    return res.json({
      ...session,
      notes: notes || [],
      linked_workout_logs: logs || [],
      workout: session.workout ? { ...session.workout, exercises: workoutExercises } : null,
    });
  } catch (e) {
    logError('coach session detail error', e);
    return res.status(500).json({ error: 'Failed to load the session' });
  }
});

// ---- Client-facing ----
// GET /api/sessions/:id/client-detail — one session, everything a client
// may see: coach identity, shared notes only, and the attached workout
// plan when the coach set one (011 B "what we'll do").
router.get('/:id/client-detail', requireClient, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Session ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: session } = await supabaseAdmin.from('sessions')
      .select('*, coach:coaches(id, name), workout:workouts(id, name, description, goal)')
      .eq('id', idValidation.value).eq('client_id', req.user.client.id)
      .eq('archived', false).maybeSingle();
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { data: notes } = await supabaseAdmin.from('session_notes').select('*')
      .eq('session_id', session.id).eq('shared_with_client', true).eq('archived', false)
      .order('created_at');
    const workoutExercises = await workoutPlanExercises(session.workout_id);
    const asked = await cancelRequestedSessionIds([session.id]);
    return res.json({
      ...session,
      shared_notes: notes || [],
      cancel_requested: asked.has(session.id),
      workout: session.workout ? { ...session.workout, exercises: workoutExercises } : null,
    });
  } catch (e) {
    logError('client session detail error', e);
    return res.status(500).json({ error: 'Failed to load the session' });
  }
});

// GET /api/sessions/mine  (client) -> own sessions + shared notes
router.get('/client/mine', requireClient, async (req, res) => {
  try {
    const clientId = req.user.client.id;
    const { data: sessions, error } = await supabaseAdmin.from('sessions')
      .select('*, coach:coaches(id, name), workout:workouts(id, name)')
      .eq('client_id', clientId).eq('archived', false)
      .order('scheduled_at', { ascending: false });
    if (error) throw error;
    const ids = (sessions || []).map((s) => s.id);
    let notesBySession = {};
    if (ids.length) {
      const { data: notes } = await supabaseAdmin.from('session_notes').select('*')
        .in('session_id', ids).eq('shared_with_client', true).eq('archived', false).order('created_at');
      for (const n of notes || []) {
        notesBySession[n.session_id] = notesBySession[n.session_id] || [];
        notesBySession[n.session_id].push(n);
      }
    }
    const asked = await cancelRequestedSessionIds(
      (sessions || []).filter((s) => s.status === 'scheduled').map((s) => s.id),
    );
    return res.json((sessions || []).map((s) => ({
      ...s, shared_notes: notesBySession[s.id] || [], cancel_requested: asked.has(s.id),
    })));
  } catch (e) {
    logError('client sessions error', e);
    return res.status(500).json({ error: 'Failed to load your sessions' });
  }
});

module.exports = router;
