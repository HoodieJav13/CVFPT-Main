const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireCoach);

// GET /api/clients?include_archived=true
router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin.from('clients').select('*, coach:coaches(id, name)').order('name');
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    if (req.query.include_archived !== 'true') q = q.eq('archived', false);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('list clients error', e);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
});

// POST /api/clients
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, goals, health_notes, coach_id } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Client name is required' });

    // Coaches always create under themselves; admin may assign any coach.
    let targetCoachId = req.user.role === 'admin' ? (coach_id || req.user.coach.id) : req.user.coach.id;

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({
        name: String(name).trim(),
        email: email ? String(email).trim().toLowerCase() : null,
        phone: phone || null,
        goals: goals || null,
        health_notes: health_notes || null,
        coach_id: targetCoachId,
      })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('create client error', e);
    return res.status(500).json({ error: 'Failed to create client' });
  }
});

async function loadClientOr404(req, res) {
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.params.id).maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return clientRow;
}

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res);
    if (!clientRow) return;
    return res.json(clientRow);
  } catch (e) {
    console.error('get client error', e);
    return res.status(500).json({ error: 'Failed to load client' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res);
    if (!clientRow) return;
    const allowed = ['name', 'email', 'phone', 'goals', 'health_notes'];
    const updates = {};
    for (const k of allowed) if (k in (req.body || {})) updates[k] = req.body[k];
    if (updates.email) updates.email = String(updates.email).trim().toLowerCase();
    if (req.user.role === 'admin' && req.body.coach_id) updates.coach_id = req.body.coach_id;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('clients').update(updates).eq('id', clientRow.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('update client error', e);
    return res.status(500).json({ error: 'Failed to update client' });
  }
});

// PATCH /api/clients/:id/invite { invited: boolean }
router.patch('/:id/invite', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res);
    if (!clientRow) return;
    if (clientRow.auth_user_id) return res.status(400).json({ error: 'This client has already claimed their account' });
    if (req.body.invited && !clientRow.email) {
      return res.status(400).json({ error: 'Add an email to this client profile before inviting them' });
    }
    const invited = Boolean(req.body.invited);
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update({ invited, updated_at: new Date().toISOString() })
      .eq('id', clientRow.id)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('invite client error', e);
    return res.status(500).json({ error: 'Failed to update invite status' });
  }
});

// PATCH /api/clients/:id/archive { archived: boolean }  (soft delete only)
router.patch('/:id/archive', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res);
    if (!clientRow) return;
    const archived = Boolean(req.body.archived);
    const { data, error } = await supabaseAdmin
      .from('clients')
      .update({ archived, updated_at: new Date().toISOString() })
      .eq('id', clientRow.id)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive client error', e);
    return res.status(500).json({ error: 'Failed to archive client' });
  }
});

module.exports = router;
