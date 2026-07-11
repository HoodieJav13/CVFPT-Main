const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');
const { todayDateInTz } = require('../utils/time');

const router = express.Router();
router.use(requireAuth);

const CHECK_FIELDS = ['energy', 'soreness', 'sleep_quality', 'stress'];
const TEXT_FIELDS = ['body_notes', 'training_notes', 'general_notes'];

function actor(user) {
  if (user.role === 'client') return { role: 'client', id: user.client.id };
  if (user.role === 'admin') return { role: 'admin', id: user.coach.id };
  return { role: 'coach', id: user.coach.id };
}

function sanitizePayload(body = {}, user) {
  const updates = {};
  for (const field of CHECK_FIELDS) {
    if (field in body) {
      const value = body[field];
      updates[field] = value === '' || value === null || value === undefined ? null : Number(value);
      if (updates[field] !== null && (!Number.isInteger(updates[field]) || updates[field] < 1 || updates[field] > 5)) {
        const label = field.replace('_', ' ');
        const err = new Error(`${label} must be between 1 and 5`);
        err.status = 400;
        throw err;
      }
    }
  }
  for (const field of TEXT_FIELDS) {
    if (field in body) updates[field] = body[field] ? String(body[field]).trim() : null;
  }
  if ('coach_notes' in body && user.role !== 'client') updates.coach_notes = body.coach_notes ? String(body.coach_notes).trim() : null;
  if ('check_in_date' in body || 'date' in body) {
    updates.check_in_date = String(body.check_in_date || body.date);
  }
  if ('review_status' in body && user.role !== 'client') {
    if (!['needs_review', 'reviewed'].includes(body.review_status)) {
      const err = new Error('Invalid review status');
      err.status = 400;
      throw err;
    }
    updates.review_status = body.review_status;
  }
  return updates;
}

async function loadClientForCoach(req, res) {
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
    .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return clientRow;
}

async function loadCheckInForUser(req, res) {
  const { data: checkIn } = await supabaseAdmin
    .from('check_ins')
    .select('*, client:clients(*)')
    .eq('id', req.params.id)
    .eq('archived', false)
    .maybeSingle();
  if (!checkIn || checkIn.client?.archived) {
    res.status(404).json({ error: 'Check-in not found' });
    return null;
  }
  if (req.user.role === 'client' && checkIn.client_id !== req.user.client.id) {
    res.status(404).json({ error: 'Check-in not found' });
    return null;
  }
  if (req.user.role !== 'client' && !canAccessClient(req.user, checkIn.client)) {
    res.status(404).json({ error: 'Check-in not found' });
    return null;
  }
  return checkIn;
}

async function saveCheckIn(clientRow, user, payload) {
  const who = actor(user);
  const checkInDate = payload.check_in_date || todayDateInTz();
  const reviewStatus = user.role === 'client' ? 'needs_review' : (payload.review_status || 'reviewed');

  const { data: existing, error: findErr } = await supabaseAdmin
    .from('check_ins')
    .select('*')
    .eq('client_id', clientRow.id)
    .eq('check_in_date', checkInDate)
    .eq('archived', false)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const updates = {
      ...payload,
      check_in_date: checkInDate,
      review_status: user.role === 'client' ? 'needs_review' : reviewStatus,
      updated_by_role: who.role,
      updated_by_id: who.id,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from('check_ins').update(updates).eq('id', existing.id).select().single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabaseAdmin.from('check_ins').insert({
    ...payload,
    client_id: clientRow.id,
    coach_id: clientRow.coach_id,
    check_in_date: checkInDate,
    review_status: reviewStatus,
    created_by_role: who.role,
    created_by_id: who.id,
    updated_by_role: who.role,
    updated_by_id: who.id,
  }).select().single();
  if (error) throw error;
  return data;
}

// GET /api/check-ins/mine?limit=30
router.get('/mine', requireClient, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { data, error } = await supabaseAdmin.from('check_ins').select('*')
      .eq('client_id', req.user.client.id).eq('archived', false)
      .order('check_in_date', { ascending: false }).limit(limit);
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('client check-ins error', e);
    return res.status(500).json({ error: 'Failed to load check-ins' });
  }
});

// POST /api/check-ins/mine
router.post('/mine', requireClient, async (req, res) => {
  try {
    const payload = sanitizePayload(req.body, req.user);
    const data = await saveCheckIn(req.user.client, req.user, payload);
    return res.status(201).json(data);
  } catch (e) {
    logError('save client check-in error', e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save check-in' });
  }
});

// GET /api/check-ins/clients/:clientId?limit=30
router.get('/clients/:clientId', requireCoach, async (req, res) => {
  try {
    const clientRow = await loadClientForCoach(req, res);
    if (!clientRow) return;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { data, error } = await supabaseAdmin.from('check_ins').select('*')
      .eq('client_id', clientRow.id).eq('archived', false)
      .order('check_in_date', { ascending: false }).limit(limit);
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('coach check-ins error', e);
    return res.status(500).json({ error: 'Failed to load check-ins' });
  }
});

// POST /api/check-ins/clients/:clientId
router.post('/clients/:clientId', requireCoach, async (req, res) => {
  try {
    const clientRow = await loadClientForCoach(req, res);
    if (!clientRow) return;
    const payload = sanitizePayload(req.body, req.user);
    const data = await saveCheckIn(clientRow, req.user, payload);
    return res.status(201).json(data);
  } catch (e) {
    logError('save coach check-in error', e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to save check-in' });
  }
});

// PUT /api/check-ins/:id
router.put('/:id', async (req, res) => {
  try {
    const checkIn = await loadCheckInForUser(req, res);
    if (!checkIn) return;
    const who = actor(req.user);
    const payload = sanitizePayload(req.body, req.user);
    const updates = {
      ...payload,
      review_status: req.user.role === 'client' ? 'needs_review' : (payload.review_status || checkIn.review_status),
      updated_by_role: who.role,
      updated_by_id: who.id,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from('check_ins').update(updates).eq('id', checkIn.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('update check-in error', e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Failed to update check-in' });
  }
});

// PATCH /api/check-ins/:id/archive
router.patch('/:id/archive', async (req, res) => {
  try {
    const checkIn = await loadCheckInForUser(req, res);
    if (!checkIn) return;
    const who = actor(req.user);
    const { data, error } = await supabaseAdmin.from('check_ins').update({
      archived: true,
      updated_by_role: who.role,
      updated_by_id: who.id,
      updated_at: new Date().toISOString(),
    }).eq('id', checkIn.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive check-in error', e);
    return res.status(500).json({ error: 'Failed to archive check-in' });
  }
});

module.exports = router;
