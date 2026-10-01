const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireCoach, canAccessClient } = require('../middleware/auth');
const { validateUuid } = require('../validation/business');
const {
  parseRule, expandSeriesRule, horizonBounds, validateSlotShapes, slotHorizonError, isRealDate,
} = require('../lib/sessionSeries/rule');
const {
  candidateTimes, chunk, MAX_ALTERNATIVES_PER_CALL, MAX_SUGGESTIONS_PER_ROW,
} = require('../lib/sessionSeries/alternatives');
const { denverWallClockToUtc, formatDenverDisplay, todayDateInTz } = require('../utils/time');

const router = express.Router();

// ---- shared helpers ----

async function resolveClient(req, res, rawClientId) {
  const id = validateUuid(rawClientId, 'Client ID');
  if (!id.ok) { res.status(400).json({ error: id.error }); return null; }
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
    .eq('id', id.value).eq('archived', false).maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return { clientRow, coachId: req.user.role === 'admin' ? clientRow.coach_id : req.user.coach.id };
}

function durationError(value) {
  return Number.isInteger(value) && value >= 15 && value <= 240 ? null : 'Duration must be a whole number between 15 and 240 minutes';
}

function withUtc(slots) {
  return slots.map((slot) => ({ ...slot, scheduled_at: denverWallClockToUtc(slot.date, slot.time) }));
}

function pastError(slots, now) {
  return slots.some((slot) => !slot.scheduled_at || new Date(slot.scheduled_at).getTime() <= now)
    ? 'Sessions cannot be in the past' : null;
}

async function rpcCheck({ coachId, clientId, durationMinutes, slots, alternatives }) {
  const { data, error } = await supabaseAdmin.rpc('check_session_slots', {
    p_coach_id: coachId,
    p_client_id: clientId,
    p_duration_minutes: durationMinutes,
    p_slots: slots.map(({ key, scheduled_at }) => ({ key, scheduled_at })),
    p_alternatives: alternatives,
  });
  if (error) throw error;
  return data;
}

// Checks the whole selection, then — only for conflicting rows — evaluates up to 24
// same-day candidates each as INDEPENDENT alternatives (never compared with one
// another), in chunks of at most MAX_ALTERNATIVES_PER_CALL with every selected row
// passed as a blocker in every call.
async function checkRows({ coachId, clientId, durationMinutes, slots, startDate, today, now }) {
  const base = await rpcCheck({ coachId, clientId, durationMinutes, slots, alternatives: null });
  const byKey = new Map((base.slots || []).map((row) => [row.key, row]));
  const bounds = horizonBounds(startDate, today);

  const candidates = [];
  for (const slot of slots) {
    if (!byKey.get(slot.key)?.conflict) continue;
    for (const candidate of candidateTimes(slot)) {
      const scheduledAt = denverWallClockToUtc(candidate.date, candidate.time);
      if (!scheduledAt || candidate.date < bounds.min || candidate.date > bounds.max) continue;
      if (new Date(scheduledAt).getTime() <= now) continue;
      candidates.push({ key: `${slot.key}@${candidate.time}`, for_key: slot.key, date: candidate.date, time: candidate.time, scheduled_at: scheduledAt });
    }
  }

  const free = new Set();
  for (const part of chunk(candidates, MAX_ALTERNATIVES_PER_CALL)) {
    const result = await rpcCheck({
      coachId, clientId, durationMinutes, slots,
      alternatives: part.map(({ key, for_key, scheduled_at }) => ({ key, for_key, scheduled_at })),
    });
    for (const alt of result.alternatives || []) if (alt.free) free.add(alt.key);
  }

  const suggestions = new Map();
  for (const candidate of candidates) {
    if (!free.has(candidate.key)) continue;
    const list = suggestions.get(candidate.for_key) || [];
    if (list.length >= MAX_SUGGESTIONS_PER_ROW) continue;
    list.push({ date: candidate.date, time: candidate.time, scheduled_at: candidate.scheduled_at, display: formatDenverDisplay(candidate.scheduled_at) });
    suggestions.set(candidate.for_key, list);
  }

  return slots.map((slot) => {
    const row = byKey.get(slot.key);
    const conflict = row?.conflict
      ? { ...row.conflict, display: row.conflict.session?.scheduled_at ? formatDenverDisplay(row.conflict.session.scheduled_at) : null }
      : null;
    return {
      key: slot.key, date: slot.date, time: slot.time, scheduled_at: slot.scheduled_at,
      display: formatDenverDisplay(slot.scheduled_at), conflict, suggestions: suggestions.get(slot.key) || [],
    };
  });
}

// ---- POST /api/sessions/series/preview ----
router.post('/preview', requireCoach, async (req, res) => {
  try {
    const body = req.body || {};
    const resolved = await resolveClient(req, res, body.client_id);
    if (!resolved) return;
    const today = todayDateInTz();
    const parsed = parseRule(body, { today });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const expanded = expandSeriesRule(parsed.value);
    if (expanded.exceededMax) return res.status(400).json({ error: 'A series can have at most 52 sessions' });
    if (expanded.exceededHorizon) {
      return res.status(400).json({ error: 'That schedule runs past one year from the start date — reduce the count or choose an end date' });
    }
    const slots = withUtc(expanded.slots);
    const now = Date.now();
    const past = pastError(slots, now);
    if (past) return res.status(400).json({ error: past });
    const rowsOut = await checkRows({
      coachId: resolved.coachId, clientId: resolved.clientRow.id, durationMinutes: parsed.value.duration_minutes,
      slots, startDate: parsed.value.start_date, today, now,
    });
    return res.json({ slots: rowsOut });
  } catch (e) {
    logError('series preview error', e);
    return res.status(500).json({ error: 'Failed to preview the series' });
  }
});

// ---- POST /api/sessions/series/check ----
router.post('/check', requireCoach, async (req, res) => {
  try {
    const body = req.body || {};
    const resolved = await resolveClient(req, res, body.client_id);
    if (!resolved) return;
    const durationMessage = durationError(body.duration_minutes);
    if (durationMessage) return res.status(400).json({ error: durationMessage });
    if (!isRealDate(body.start_date)) return res.status(400).json({ error: 'Start date must be a valid date' });
    const shapes = validateSlotShapes(body.slots);
    if (!shapes.ok) return res.status(400).json({ error: shapes.error });
    const today = todayDateInTz();
    const horizon = slotHorizonError(shapes.value, body.start_date, today);
    if (horizon) return res.status(400).json({ error: horizon });
    const slots = withUtc(shapes.value);
    const now = Date.now();
    const past = pastError(slots, now);
    if (past) return res.status(400).json({ error: past });
    const rowsOut = await checkRows({
      coachId: resolved.coachId, clientId: resolved.clientRow.id, durationMinutes: body.duration_minutes,
      slots, startDate: body.start_date, today, now,
    });
    const seq = Number.isInteger(body.seq) ? body.seq : null;
    return res.json({ seq, slots: rowsOut });
  } catch (e) {
    logError('series check error', e);
    return res.status(500).json({ error: 'Failed to check the schedule' });
  }
});

module.exports = router;
module.exports.helpers = { resolveClient, withUtc, pastError };
