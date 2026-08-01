const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient } = require('../middleware/auth');
const {
  validateBookingListQuery,
  validateOptionalText,
  validateSchedulePayload,
  validateUuid,
} = require('../validation/business');
const { dispatchEmail, notifyBookingEvent } = require('../services/email');

const router = express.Router();
router.use(requireAuth);

// POST /api/bookings (client request)
router.post('/', requireClient, async (req, res) => {
  try {
    const { requested_time, duration_minutes, location, note } = req.body || {};
    const validation = validateSchedulePayload(
      { scheduled_at: requested_time, duration_minutes },
      { requireDate: true },
    );
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const locationValidation = validateOptionalText(location, 'Location');
    if (!locationValidation.ok) return res.status(400).json({ error: locationValidation.error });
    const noteValidation = validateOptionalText(note, 'Note');
    if (!noteValidation.ok) return res.status(400).json({ error: noteValidation.error });
    if (new Date(validation.value.scheduled_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Requested time must be in the future' });
    }
    // A3 (availability docket): clients may request only the
    // client-requestable session lengths. Fails closed — an empty
    // session_types table rejects everything rather than allowing
    // anything.
    const { data: requestableTypes, error: typesError } = await supabaseAdmin
      .from('session_types').select('duration_minutes').eq('client_requestable', true);
    if (typesError) throw typesError;
    const requestable = new Set((requestableTypes || []).map((t) => t.duration_minutes));
    if (!requestable.has(validation.value.duration_minutes)) {
      return res.status(400).json({ error: 'That session length is scheduled by your coach directly — ask them about it' });
    }
    // A4/A5: when the coach has published hours, the requested time must
    // be one of the offered slots — the same derivation the picker uses,
    // so hours, time off, the 12-hour lead, and the 21-day horizon can't
    // be bypassed by calling the API directly. Coaches with no active
    // hours keep the documented free-picker fallback.
    const coachId = req.user.client.coach_id;
    const [templateCount, overrideCount, coachRow] = await Promise.all([
      supabaseAdmin.from('coach_availability').select('id', { count: 'exact', head: true }).eq('coach_id', coachId).eq('archived', false),
      supabaseAdmin.from('coach_availability_overrides').select('id', { count: 'exact', head: true }).eq('coach_id', coachId).eq('archived', false),
      supabaseAdmin.from('coaches').select('auto_book').eq('id', coachId).maybeSingle(),
    ]);
    if (templateCount.error) throw templateCount.error;
    if (overrideCount.error) throw overrideCount.error;
    if (coachRow.error) throw coachRow.error;
    let offeredSlot = false;
    if ((templateCount.count || 0) + (overrideCount.count || 0) > 0) {
      const requestedMs = new Date(validation.value.scheduled_at).getTime();
      const requestedDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' })
        .format(new Date(requestedMs));
      const { data: openSlots, error: slotsError } = await supabaseAdmin.rpc('get_open_slots', {
        p_coach_id: coachId,
        p_duration_minutes: validation.value.duration_minutes,
        p_from: requestedDay,
        p_to: requestedDay,
      });
      if (slotsError) throw slotsError;
      const offered = (openSlots || []).some((slot) => new Date(slot.starts_at).getTime() === requestedMs);
      if (!offered) {
        return res.status(400).json({ error: "That time isn't one of your coach's open slots — pick from the open times" });
      }
      offeredSlot = true;
    }
    // D3 auto-book: creation and optional auto-approval run in ONE
    // transaction (request_booking). If approval errors, the insert
    // rolls back with it — a retry can never duplicate, and "failed"
    // never hides a pending row. Only an explicit 'auto_booked' outcome
    // reports success; a lost race or anything unexpected leaves the
    // request pending for the coach.
    const { data: result, error } = await supabaseAdmin.rpc('request_booking', {
      p_client_id: req.user.client.id,
      p_coach_id: req.user.client.coach_id,
      p_requested_time: validation.value.scheduled_at,
      p_duration_minutes: validation.value.duration_minutes,
      p_location: locationValidation.value,
      p_note: noteValidation.value,
      p_auto_book: offeredSlot && Boolean(coachRow.data?.auto_book),
    });
    if (error) throw error;
    if (result?.outcome === 'auto_booked') {
      await dispatchEmail(() => Promise.all([
        notifyBookingEvent('booking-auto-client', { booking: result.request, session: result.session }),
        notifyBookingEvent('booking-auto-coach', { booking: result.request, session: result.session }),
      ]));
      return res.status(201).json({ ...result.request, auto_booked: true, session: result.session || null });
    }
    if (result?.outcome === 'pending') {
      await dispatchEmail(() => notifyBookingEvent('booking-pending', { booking: result.request, session: null }));
      return res.status(201).json({ ...result.request, auto_booked: false });
    }
    throw new Error(`unexpected request_booking outcome: ${result?.outcome ?? 'null'}`);
  } catch (e) {
    logError('create booking error', e);
    return res.status(500).json({ error: 'Failed to send booking request' });
  }
});

// GET /api/bookings/mine (client)
router.get('/mine', requireClient, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('booking_requests').select('*')
      .eq('client_id', req.user.client.id).eq('archived', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('client bookings error', e);
    return res.status(500).json({ error: 'Failed to load your requests' });
  }
});

// GET /api/bookings (coach) ?status=pending
router.get('/', requireCoach, async (req, res) => {
  try {
    const validation = validateBookingListQuery(req.query);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    let q = supabaseAdmin.from('booking_requests').select('*, client:clients(id, name)')
      .eq('archived', false).order('created_at', { ascending: false });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    if (validation.value.status) q = q.eq('status', validation.value.status);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('list bookings error', e);
    return res.status(500).json({ error: 'Failed to load booking requests' });
  }
});

async function loadBookingForCoach(req, res) {
  const idValidation = validateUuid(req.params.id, 'Booking request ID');
  if (!idValidation.ok) {
    res.status(400).json({ error: idValidation.error });
    return null;
  }
  const { data: booking } = await supabaseAdmin.from('booking_requests').select('*')
    .eq('id', idValidation.value).eq('archived', false).maybeSingle();
  if (!booking || (req.user.role !== 'admin' && booking.coach_id !== req.user.coach.id)) {
    res.status(404).json({ error: 'Booking request not found' });
    return null;
  }
  return booking;
}

// PATCH /api/bookings/:id/approve -> creates a session
router.patch('/:id/approve', requireCoach, async (req, res) => {
  try {
    const booking = await loadBookingForCoach(req, res);
    if (!booking) return;
    if (booking.status !== 'pending') return res.status(400).json({ error: 'This request was already handled' });
    const { data, error } = await supabaseAdmin.rpc('approve_booking', { p_booking_id: booking.id });
    if (error) throw error;
    if (!data) return res.status(400).json({ error: 'This request was already handled' });
    if (data.outcome === 'coach_conflict' || data.outcome === 'client_conflict') {
      const conflict = data.conflict_session || {};
      const when = conflict.scheduled_at ? new Date(conflict.scheduled_at).toLocaleString('en-US', { timeZone: 'America/Denver' }) : 'another time';
      return res.status(409).json({
        error: data.outcome === 'client_conflict'
          ? `Cannot approve: this client already has a session at ${when}. The request stays pending.`
          : `Cannot approve: you already have a session at ${when}. The request stays pending.`,
        conflict: { scope: data.outcome === 'client_conflict' ? 'client' : 'coach', session: conflict },
      });
    }
    await dispatchEmail(() => notifyBookingEvent('booking-approved', { booking, session: data.session || null }));
    return res.json(data);
  } catch (e) {
    logError('approve booking error', e);
    return res.status(500).json({ error: 'Failed to approve request' });
  }
});

// PATCH /api/bookings/:id/decline
router.patch('/:id/decline', requireCoach, async (req, res) => {
  try {
    const booking = await loadBookingForCoach(req, res);
    if (!booking) return;
    if (booking.status !== 'pending') return res.status(400).json({ error: 'This request was already handled' });
    const { data, error } = await supabaseAdmin.from('booking_requests')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', booking.id).eq('status', 'pending').eq('archived', false)
      .select('*, client:clients(id, name)').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(400).json({ error: 'This request was already handled' });
    await dispatchEmail(() => notifyBookingEvent('booking-declined', { booking: data, session: null }));
    return res.json(data);
  } catch (e) {
    logError('decline booking error', e);
    return res.status(500).json({ error: 'Failed to decline request' });
  }
});

module.exports = router;
