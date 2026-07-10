const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/coaches
router.get('/coaches', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('coaches').select('*').eq('archived', false).order('name');
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('list coaches error', e);
    return res.status(500).json({ error: 'Failed to load coaches' });
  }
});

// POST /api/admin/coaches { name, email, phone, password, is_admin }
router.post('/coaches', async (req, res) => {
  try {
    const { name, email, phone, password, is_admin } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const normalized = String(email).trim().toLowerCase();
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalized, password, email_confirm: true,
    });
    if (createErr) {
      if (String(createErr.message || '').toLowerCase().includes('already')) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      throw createErr;
    }
    const { data, error } = await supabaseAdmin.from('coaches').insert({
      name: String(name).trim(),
      email: normalized,
      phone: phone || null,
      is_admin: Boolean(is_admin),
      auth_user_id: created.user.id,
    }).select().single();
    if (error) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw error;
    }
    return res.status(201).json(data);
  } catch (e) {
    console.error('create coach error', e);
    return res.status(500).json({ error: 'Failed to create coach' });
  }
});

// PATCH /api/admin/clients/:id/reassign { coach_id }
router.patch('/clients/:id/reassign', async (req, res) => {
  try {
    const { coach_id } = req.body || {};
    if (!coach_id) return res.status(400).json({ error: 'coach_id is required' });
    const { data: coach } = await supabaseAdmin.from('coaches').select('id').eq('id', coach_id).eq('archived', false).maybeSingle();
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    const { data, error } = await supabaseAdmin.from('clients')
      .update({ coach_id, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('archived', false).select('*, coach:coaches(id, name)').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Client not found' });
    return res.json(data);
  } catch (e) {
    console.error('reassign error', e);
    return res.status(500).json({ error: 'Failed to reassign client' });
  }
});

// GET /api/admin/overview
router.get('/overview', async (_req, res) => {
  try {
    const [{ count: coaches }, { count: clients }, { count: upcoming }, { count: pendingBookings }] = await Promise.all([
      supabaseAdmin.from('coaches').select('id', { count: 'exact', head: true }).eq('archived', false),
      supabaseAdmin.from('clients').select('id', { count: 'exact', head: true }).eq('archived', false),
      supabaseAdmin.from('sessions').select('id', { count: 'exact', head: true }).eq('archived', false).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()),
      supabaseAdmin.from('booking_requests').select('id', { count: 'exact', head: true }).eq('archived', false).eq('status', 'pending'),
    ]);
    return res.json({ coaches: coaches || 0, clients: clients || 0, upcoming_sessions: upcoming || 0, pending_bookings: pendingBookings || 0 });
  } catch (e) {
    console.error('overview error', e);
    return res.status(500).json({ error: 'Failed to load overview' });
  }
});

module.exports = router;
