const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient } = require('../middleware/auth');
const { validateSchedulePayload } = require('../validation/business');

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
    if (new Date(validation.value.scheduled_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Requested time must be in the future' });
    }
    const { data, error } = await supabaseAdmin.from('booking_requests').insert({
      client_id: req.user.client.id,
      coach_id: req.user.client.coach_id,
      requested_time: validation.value.scheduled_at,
      duration_minutes: validation.value.duration_minutes,
      location: location || null,
      note: note || null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
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
    let q = supabaseAdmin.from('booking_requests').select('*, client:clients(id, name)')
      .eq('archived', false).order('created_at', { ascending: false });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('list bookings error', e);
    return res.status(500).json({ error: 'Failed to load booking requests' });
  }
});

async function loadBookingForCoach(req, res) {
  const { data: booking } = await supabaseAdmin.from('booking_requests').select('*')
    .eq('id', req.params.id).eq('archived', false).maybeSingle();
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
    return res.json(data);
  } catch (e) {
    logError('decline booking error', e);
    return res.status(500).json({ error: 'Failed to decline request' });
  }
});

module.exports = router;
