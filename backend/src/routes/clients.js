const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, canAccessClient } = require('../middleware/auth');
const { configured, dispatchEmail } = require('../services/email');
const { sendInviteEmail, sendPasswordResetEmail } = require('../services/accountRecovery');

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
    logError('list clients error', e);
    return res.status(500).json({ error: 'Failed to load clients' });
  }
});

// POST /api/clients
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, goals, health_notes, coach_id } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Client name is required' });

    // Coaches always create under themselves; admin may assign any coach.
    const targetCoachId = req.user.role === 'admin' ? (coach_id || req.user.coach.id) : req.user.coach.id;
    if (req.user.role === 'admin') {
      const { data: targetCoach } = await supabaseAdmin.from('coaches').select('id')
        .eq('id', targetCoachId).eq('archived', false).maybeSingle();
      if (!targetCoach) return res.status(404).json({ error: 'Coach not found' });
    }

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
    logError('create client error', e);
    return res.status(500).json({ error: 'Failed to create client' });
  }
});

async function loadClientOr404(req, res, { includeArchived = false } = {}) {
  let query = supabaseAdmin.from('clients').select('*').eq('id', req.params.id);
  if (!includeArchived) query = query.eq('archived', false);
  const { data: clientRow } = await query.maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return clientRow;
}

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res, {
      includeArchived: req.query.include_archived === 'true',
    });
    if (!clientRow) return;
    return res.json(clientRow);
  } catch (e) {
    logError('get client error', e);
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
    // A claimed client's login email must follow the profile email, or the
    // two silently diverge and password recovery stops working.
    if (updates.email && clientRow.auth_user_id && updates.email !== clientRow.email) {
      const { error: authEmailErr } = await supabaseAdmin.auth.admin.updateUserById(
        clientRow.auth_user_id,
        { email: updates.email, email_confirm: true },
      );
      if (authEmailErr) {
        if (String(authEmailErr.message || '').toLowerCase().includes('already')) {
          return res.status(409).json({ error: 'That email is already used by another account' });
        }
        throw authEmailErr;
      }
    }
    if (req.user.role === 'admin' && req.body.coach_id) {
      const { data: targetCoach } = await supabaseAdmin.from('coaches').select('id')
        .eq('id', req.body.coach_id).eq('archived', false).maybeSingle();
      if (!targetCoach) return res.status(404).json({ error: 'Coach not found' });
      updates.coach_id = req.body.coach_id;
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('clients').update(updates).eq('id', clientRow.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('update client error', e);
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
    let inviteEmail = null;
    if (invited && data.email) {
      if (configured()) {
        const coachName = req.user.coach?.name || 'Your coach';
        await dispatchEmail(() => sendInviteEmail({ client: data, coachName }));
        inviteEmail = 'sent';
      } else {
        inviteEmail = 'unconfigured';
      }
    }
    return res.json({ ...data, invite_email: inviteEmail });
  } catch (e) {
    logError('invite client error', e);
    return res.status(500).json({ error: 'Failed to update invite status' });
  }
});

// POST /api/clients/:id/send-password-reset
// Rescue path for a claimed client who is locked out.
router.post('/:id/send-password-reset', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res);
    if (!clientRow) return;
    if (!clientRow.auth_user_id) {
      return res.status(400).json({ error: 'This client has not claimed their account yet — use the invite instead' });
    }
    if (!clientRow.email) return res.status(400).json({ error: 'Add an email to this client profile first' });
    if (!configured()) {
      return res.status(503).json({ error: 'Email delivery is not set up yet' });
    }
    await sendPasswordResetEmail({ email: clientRow.email, name: clientRow.name });
    return res.json({ ok: true });
  } catch (e) {
    logError('client password reset error', e);
    return res.status(500).json({ error: 'Could not send the reset email. Please try again.' });
  }
});

// PATCH /api/clients/:id/archive { archived: boolean }  (soft delete only)
router.patch('/:id/archive', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res, { includeArchived: true });
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
    logError('archive client error', e);
    return res.status(500).json({ error: 'Failed to archive client' });
  }
});

module.exports = router;
