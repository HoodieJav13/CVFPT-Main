const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient } = require('../middleware/auth');
const { validateUuid } = require('../validation/business');
const { validateWindow, validateTimeOff, validateSlotQuery } = require('../lib/availability');

const router = express.Router();
router.use(requireAuth);

// GET /api/availability/session-types (any authenticated role)
router.get('/session-types', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('session_types')
      .select('*').order('duration_minutes').order('key');
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('session types error', e);
    return res.status(500).json({ error: 'Failed to load session types' });
  }
});

// GET /api/availability/impact?starts_at=&ends_at= (coach): booked
// sessions of the calling coach that overlap a prospective or existing
// time-off span. Time off never auto-cancels sessions (A2) — this list
// is what makes resolving them an explicit, visible step.
router.get('/impact', requireCoach, async (req, res) => {
  try {
    const result = validateTimeOff(req.query || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    const { starts_at, ends_at } = result.value;
    // Sessions run at most 240 minutes, so every overlapping session
    // starts after (span start - 240min) and before the span end; the
    // exact tail check happens below.
    const windowStart = new Date(new Date(starts_at).getTime() - 240 * 60000).toISOString();
    const { data, error } = await supabaseAdmin.from('sessions')
      .select('id, scheduled_at, duration_minutes, location, status, client:clients(id, name)')
      .eq('coach_id', req.user.coach.id)
      .neq('status', 'cancelled')
      .eq('archived', false)
      .gte('scheduled_at', windowStart)
      .lt('scheduled_at', ends_at)
      .order('scheduled_at');
    if (error) throw error;
    const startMs = new Date(starts_at).getTime();
    const sessions = (data || []).filter((s) => new Date(s.scheduled_at).getTime() + (s.duration_minutes * 60000) > startMs);
    return res.json({ sessions });
  } catch (e) {
    logError('time off impact error', e);
    return res.status(500).json({ error: 'Failed to check affected sessions' });
  }
});

// GET /api/availability/mine (coach): template + overrides + time off
router.get('/mine', requireCoach, async (req, res) => {
  try {
    const coachId = req.user.coach.id;
    const [windows, overrides, timeOff, coachRow] = await Promise.all([
      supabaseAdmin.from('coach_availability').select('*').eq('coach_id', coachId).eq('archived', false).order('weekday').order('start_time'),
      supabaseAdmin.from('coach_availability_overrides').select('*').eq('coach_id', coachId).eq('archived', false).order('on_date').order('start_time'),
      supabaseAdmin.from('coach_time_off').select('*').eq('coach_id', coachId).eq('archived', false).order('span'),
      supabaseAdmin.from('coaches').select('auto_book').eq('id', coachId).maybeSingle(),
    ]);
    const failed = [windows, overrides, timeOff, coachRow].find((r) => r.error);
    if (failed) throw failed.error;
    return res.json({
      windows: windows.data,
      overrides: overrides.data,
      time_off: timeOff.data,
      auto_book: Boolean(coachRow.data?.auto_book),
    });
  } catch (e) {
    logError('availability mine error', e);
    return res.status(500).json({ error: 'Failed to load availability' });
  }
});

// PATCH /api/availability/auto-book { enabled } (coach, own flag only).
// D3: each coach controls their own toggle; the UI confirms before
// enabling because published hours become instantly bookable.
router.patch('/auto-book', requireCoach, async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    const { data, error } = await supabaseAdmin.from('coaches')
      .update({ auto_book: enabled }).eq('id', req.user.coach.id).select('auto_book').single();
    if (error) throw error;
    return res.json({ auto_book: data.auto_book });
  } catch (e) {
    logError('auto-book toggle error', e);
    return res.status(500).json({ error: 'Failed to update instant booking' });
  }
});

// PUT /api/availability/windows (coach): replace own weekly template
router.put('/windows', requireCoach, async (req, res) => {
  try {
    const coachId = req.user.coach.id;
    const rows = Array.isArray(req.body?.windows) ? req.body.windows : null;
    if (!rows) return res.status(400).json({ error: 'windows must be an array' });
    if (rows.length > 40) return res.status(400).json({ error: 'Too many windows' });
    const validated = [];
    for (const row of rows) {
      const result = validateWindow(row);
      if (!result.ok) return res.status(400).json({ error: result.error });
      validated.push(result.value);
    }
    // Atomic archive-and-insert: a failed insert can never erase the
    // coach's existing template (soft-delete-only invariant included).
    const { data, error } = await supabaseAdmin.rpc('replace_coach_availability', {
      p_coach_id: coachId,
      p_windows: validated,
    });
    if (error) throw error;
    return res.json({ windows: data || [] });
  } catch (e) {
    logError('availability windows error', e);
    return res.status(500).json({ error: 'Failed to save availability' });
  }
});

// POST /api/availability/overrides (coach)
router.post('/overrides', requireCoach, async (req, res) => {
  try {
    const result = validateWindow(req.body || {}, { requireDate: true });
    if (!result.ok) return res.status(400).json({ error: result.error });
    const { data, error } = await supabaseAdmin.from('coach_availability_overrides')
      .insert({ ...result.value, coach_id: req.user.coach.id }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('availability override error', e);
    return res.status(500).json({ error: 'Failed to add override' });
  }
});

// DELETE /api/availability/overrides/:id (coach, own rows only)
router.delete('/overrides/:id', requireCoach, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Override');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data, error } = await supabaseAdmin.from('coach_availability_overrides')
      .update({ archived: true }).eq('id', req.params.id).eq('coach_id', req.user.coach.id).eq('archived', false).select();
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Override not found' });
    return res.json({ ok: true });
  } catch (e) {
    logError('availability override delete error', e);
    return res.status(500).json({ error: 'Failed to remove override' });
  }
});

// POST /api/availability/time-off (coach)
router.post('/time-off', requireCoach, async (req, res) => {
  try {
    const result = validateTimeOff(req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    const { data, error } = await supabaseAdmin.from('coach_time_off').insert({
      coach_id: req.user.coach.id,
      span: `[${result.value.starts_at},${result.value.ends_at})`,
      reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('time off error', e);
    return res.status(500).json({ error: 'Failed to add time off' });
  }
});

// DELETE /api/availability/time-off/:id (coach, own rows only)
router.delete('/time-off/:id', requireCoach, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Time off');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data, error } = await supabaseAdmin.from('coach_time_off')
      .update({ archived: true }).eq('id', req.params.id).eq('coach_id', req.user.coach.id).eq('archived', false).select();
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Time off not found' });
    return res.json({ ok: true });
  } catch (e) {
    logError('time off delete error', e);
    return res.status(500).json({ error: 'Failed to remove time off' });
  }
});

// GET /api/availability/slots?duration=&from=&to= (client, own coach only).
// Open slots come from the service-role RPC; the request -> approve flow
// and its transactional conflict checks are unchanged (A4).
router.get('/slots', requireClient, async (req, res) => {
  try {
    const queryValidation = validateSlotQuery(req.query || {});
    if (!queryValidation.ok) return res.status(400).json({ error: queryValidation.error });
    const { duration, from, to } = queryValidation.value;
    const [slotsResult, coachRow] = await Promise.all([
      supabaseAdmin.rpc('get_open_slots', {
        p_coach_id: req.user.client.coach_id,
        p_duration_minutes: duration,
        p_from: from,
        p_to: to,
      }),
      supabaseAdmin.from('coaches').select('auto_book').eq('id', req.user.client.coach_id).maybeSingle(),
    ]);
    if (slotsResult.error) throw slotsResult.error;
    if (coachRow.error) throw coachRow.error;
    const seen = new Set();
    const slots = (slotsResult.data || []).filter((slot) => {
      if (seen.has(slot.starts_at)) return false;
      seen.add(slot.starts_at);
      return true;
    });
    // The picker's copy depends on this: instant booking vs request.
    return res.json({ slots, auto_book: Boolean(coachRow.data?.auto_book) });
  } catch (e) {
    logError('open slots error', e);
    return res.status(500).json({ error: 'Failed to load open times' });
  }
});

module.exports = router;
