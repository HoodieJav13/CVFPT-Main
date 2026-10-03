const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireCoach, canAccessClient } = require('../middleware/auth');
const { validateUuid, validateNotifyFlag } = require('../validation/business');
const { parseCreateRequest } = require('../lib/sessionSeries/createRequest');
const { validateWorkoutIds } = require('../lib/sessionWorkouts');
const { canAccessProgram, canAssignTemplate, isTemplate } = require('../security/access');
const { dispatchEmail, notifySeriesScheduled, notifySeriesCancelled } = require('../services/email');
const { dispatchPush, sendToClient } = require('../services/push');
const {
  parseRule, expandSeriesRule, horizonBounds, validateSlotShapes, slotHorizonError, isRealDate, requestHash,
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
  // A failed lookup is an operational error (500, retryable) — never "not found".
  const { data: clientRow, error: clientError } = await supabaseAdmin.from('clients').select('*')
    .eq('id', id.value).eq('archived', false).maybeSingle();
  if (clientError) throw clientError;
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

const MISMATCH = { error: 'This save was already used with different content — nothing was changed.', code: 'request_mismatch' };

function decorateConflicts(conflicts) {
  return (conflicts || []).map((conflict) => ({
    ...conflict,
    display: conflict.session?.scheduled_at ? formatDenverDisplay(conflict.session.scheduled_at) : null,
  }));
}

// ---- POST /api/sessions/series ----
// Order matters so a successful save is always recoverable:
//   1. shape validation only; 2. authorized replay lookup (skips every time- and
//   record-sensitive check); 3. eligibility checks for NEW operations; 4. the
//   transactional RPC, which re-resolves replays under the scheduling lock.
router.post('/', requireCoach, async (req, res) => {
  try {
    const parsed = parseCreateRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const request = parsed.value;
    const hash = requestHash(parsed.normalized);

    // If this lookup fails we cannot know whether an earlier save committed, so it must surface as a
    // retryable server error — falling through would turn an unknown outcome into a definitive 400/404
    // and make the browser discard the pending request.
    const { data: existing, error: replayError } = await supabaseAdmin.from('session_series').select('*')
      .eq('request_id', request.request_id).eq('client_id', request.client_id).maybeSingle();
    if (replayError) throw replayError;
    if (existing) {
      if (req.user.role !== 'admin' && existing.coach_id !== req.user.coach.id) return res.status(404).json({ error: 'Not found' });
      if (existing.request_hash !== hash) return res.status(409).json(MISMATCH);
      return res.status(200).json({ series: existing, receipt: existing.receipt, replayed: true });
    }

    const resolved = await resolveClient(req, res, request.client_id);
    if (!resolved) return;
    const { coachId } = resolved;
    const today = todayDateInTz();
    if (request.rule.start_date < today) return res.status(400).json({ error: 'A series cannot start in the past' });
    const horizon = slotHorizonError(request.slots, request.rule.start_date, today);
    if (horizon) return res.status(400).json({ error: horizon });
    const slots = withUtc(request.slots);
    const past = pastError(slots, Date.now());
    if (past) return res.status(400).json({ error: past });

    if (request.program_id) {
      const { data: program, error: programError } = await supabaseAdmin.from('programs')
        .select('id, coach_id, archived, is_template, hidden, client_id, client_owner:clients!client_id(coach_id)')
        .eq('id', request.program_id).eq('archived', false).maybeSingle();
      if (programError) throw programError;
      // A client's private program is usable only for that same client's series.
      if (!program || !canAccessProgram(req.user, program)
        || (!isTemplate(program) && program.client_id !== resolved.clientRow.id)) {
        return res.status(404).json({ error: 'Program not found' });
      }
      if (request.assign_program && !canAssignTemplate(program)) {
        return res.status(409).json({ error: 'This program cannot be assigned. Choose an unhidden template.' });
      }
    }
    const workouts = await validateWorkoutIds(request.slots.map((slot) => slot.workout_id), {
      user: req.user, coachId, clientId: resolved.clientRow.id,
    });
    if (!workouts.ok) return res.status(400).json({ error: workouts.error });

    const { data, error } = await supabaseAdmin.rpc('schedule_session_series', {
      p_request_id: request.request_id,
      p_request_hash: hash,
      p_coach_id: coachId,
      p_client_id: request.client_id,
      p_duration_minutes: request.duration_minutes,
      p_location: request.location,
      p_rule: request.rule,
      p_program_id: request.program_id,
      p_assign_program: request.assign_program,
      p_slots: slots.map((slot) => ({ key: slot.key, scheduled_at: slot.scheduled_at, workout_id: slot.workout_id })),
    });
    if (error) throw error;

    if (data.outcome === 'request_mismatch') return res.status(409).json(MISMATCH);
    if (data.outcome === 'conflicts') {
      return res.status(409).json({ error: 'Some dates are no longer available', conflicts: decorateConflicts(data.conflicts) });
    }

    const replayed = Boolean(data.replayed);
    // Notify only for a NEW save, decided on the database function's result — never
    // on the route's early lookup, which two simultaneous requests can both miss.
    if (!replayed && request.notify) {
      const dates = (data.receipt?.slots || []).map((slot) => slot.scheduled_at);
      await dispatchEmail(() => notifySeriesScheduled({ seriesId: data.series.id, clientId: request.client_id, coachId, dates }));
      dispatchPush(() => sendToClient(request.client_id, {
        title: 'New sessions scheduled',
        body: `${dates.length} session${dates.length === 1 ? '' : 's'} starting ${formatDenverDisplay(dates[0])}.`,
        url: '/client/sessions',
      }));
    }
    return res.status(replayed ? 200 : 201).json({ series: data.series, receipt: data.receipt, replayed });
  } catch (e) {
    logError('series create error', e);
    return res.status(500).json({ error: 'Failed to create the series' });
  }
});

// ---- PATCH /api/sessions/series/:seriesId/cancel ----
// Cancels the anchor session and every LATER scheduled session of the same series.
// Completed, no-show and already-cancelled sessions are never touched. Nothing is
// deleted. Notifies only when rows actually changed (a retry that changes zero rows
// is silent).
router.patch('/:seriesId/cancel', requireCoach, async (req, res) => {
  try {
    const seriesId = validateUuid(req.params.seriesId, 'Series ID');
    if (!seriesId.ok) return res.status(400).json({ error: seriesId.error });
    const anchorId = validateUuid((req.body || {}).from_session_id, 'Session ID');
    if (!anchorId.ok) return res.status(400).json({ error: anchorId.error });
    const notify = validateNotifyFlag(req.body);
    if (!notify.ok) return res.status(400).json({ error: notify.error });

    const { data: series, error: seriesError } = await supabaseAdmin.from('session_series').select('*')
      .eq('id', seriesId.value).eq('archived', false).maybeSingle();
    if (seriesError) throw seriesError;
    if (!series || (req.user.role !== 'admin' && series.coach_id !== req.user.coach.id)) {
      return res.status(404).json({ error: 'Series not found' });
    }
    const { data: anchor, error: anchorError } = await supabaseAdmin.from('sessions').select('id, series_id, client_id, scheduled_at')
      .eq('id', anchorId.value).eq('archived', false).maybeSingle();
    if (anchorError) throw anchorError;
    if (!anchor || anchor.series_id !== series.id || anchor.client_id !== series.client_id) {
      return res.status(404).json({ error: 'Session not found in this series' });
    }

    const { data: changed, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('series_id', series.id).eq('status', 'scheduled').eq('archived', false)
      .gte('scheduled_at', anchor.scheduled_at)
      .select('id, scheduled_at');
    if (error) throw error;
    const cancelled = [...(changed || [])].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

    if (notify.value && cancelled.length) {
      await dispatchEmail(() => notifySeriesCancelled({ seriesId: series.id, clientId: series.client_id, coachId: series.coach_id, cancelled }));
      dispatchPush(() => sendToClient(series.client_id, {
        title: cancelled.length === 1 ? 'Session cancelled' : 'Sessions cancelled',
        body: `${cancelled.length} session${cancelled.length === 1 ? '' : 's'} starting ${formatDenverDisplay(cancelled[0].scheduled_at)} ${cancelled.length === 1 ? 'was' : 'were'} cancelled.`,
        url: '/client/sessions',
      }));
    }
    return res.json({ cancelled });
  } catch (e) {
    logError('series cancel error', e);
    return res.status(500).json({ error: 'Failed to cancel the sessions' });
  }
});

module.exports = router;
module.exports.helpers = { resolveClient, withUtc, pastError };
