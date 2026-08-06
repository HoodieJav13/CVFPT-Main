const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { configured } = require('../services/email');
const { sendPasswordResetEmail } = require('../services/accountRecovery');

const router = express.Router();
router.use(requireAuth, requireAdmin);

async function loadCoachOr404(req, res) {
  const { data: coach } = await supabaseAdmin.from('coaches').select('*')
    .eq('id', req.params.id).maybeSingle();
  if (!coach) {
    res.status(404).json({ error: 'Coach not found' });
    return null;
  }
  return coach;
}

async function otherActiveAdminExists(excludeCoachId) {
  const { count } = await supabaseAdmin.from('coaches')
    .select('id', { count: 'exact', head: true })
    .eq('is_admin', true).eq('archived', false).neq('id', excludeCoachId);
  return (count || 0) > 0;
}

// GET /api/admin/coaches?include_archived=true
router.get('/coaches', async (req, res) => {
  try {
    let q = supabaseAdmin.from('coaches').select('*').order('name');
    if (req.query.include_archived !== 'true') q = q.eq('archived', false);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('list coaches error', e);
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
    logError('create coach error', e);
    return res.status(500).json({ error: 'Failed to create coach' });
  }
});

// PATCH /api/admin/coaches/:id { name?, email?, phone? }
router.patch('/coaches/:id', async (req, res) => {
  try {
    const coach = await loadCoachOr404(req, res);
    if (!coach) return;
    const updates = {};
    if ('name' in (req.body || {})) {
      if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Coach name is required' });
      updates.name = String(req.body.name).trim();
    }
    if ('phone' in (req.body || {})) updates.phone = req.body.phone || null;
    if ('email' in (req.body || {})) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Coach email is required' });
      if (email !== coach.email && coach.auth_user_id) {
        // Login email follows the profile email, same as claimed clients.
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
          coach.auth_user_id,
          { email, email_confirm: true },
        );
        if (authErr) {
          if (String(authErr.message || '').toLowerCase().includes('already')) {
            return res.status(409).json({ error: 'That email is already used by another account' });
          }
          throw authErr;
        }
      }
      updates.email = email;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide a coach field to update' });
    const { data, error } = await supabaseAdmin.from('coaches')
      .update(updates).eq('id', coach.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('update coach error', e);
    return res.status(500).json({ error: 'Failed to update coach' });
  }
});

// PATCH /api/admin/coaches/:id/archive { archived }
// Deactivation blocks login via resolveProfile's archived filter. Guards:
// never yourself, never the last active admin, never while clients are
// still assigned (reassign first so nobody is stranded).
router.patch('/coaches/:id/archive', async (req, res) => {
  try {
    const coach = await loadCoachOr404(req, res);
    if (!coach) return;
    const archived = Boolean(req.body?.archived);
    if (archived) {
      if (coach.id === req.user.coach.id) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }
      if (coach.is_admin && !(await otherActiveAdminExists(coach.id))) {
        return res.status(400).json({ error: 'At least one active admin is required' });
      }
      const { count: assigned } = await supabaseAdmin.from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', coach.id).eq('archived', false);
      if ((assigned || 0) > 0) {
        return res.status(400).json({ error: `Reassign this coach's ${assigned} active ${assigned === 1 ? 'client' : 'clients'} first` });
      }
    }
    const { data, error } = await supabaseAdmin.from('coaches')
      .update({ archived, updated_at: new Date().toISOString() })
      .eq('id', coach.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive coach error', e);
    return res.status(500).json({ error: 'Failed to update coach status' });
  }
});

// PATCH /api/admin/coaches/:id/admin { is_admin }
router.patch('/coaches/:id/admin', async (req, res) => {
  try {
    const coach = await loadCoachOr404(req, res);
    if (!coach) return;
    if (typeof req.body?.is_admin !== 'boolean') {
      return res.status(400).json({ error: 'is_admin must be true or false' });
    }
    if (!req.body.is_admin && coach.is_admin && !(await otherActiveAdminExists(coach.id))) {
      return res.status(400).json({ error: 'At least one active admin is required' });
    }
    const { data, error } = await supabaseAdmin.from('coaches')
      .update({ is_admin: req.body.is_admin, updated_at: new Date().toISOString() })
      .eq('id', coach.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('coach admin toggle error', e);
    return res.status(500).json({ error: 'Failed to update admin role' });
  }
});

// POST /api/admin/coaches/:id/send-password-reset
router.post('/coaches/:id/send-password-reset', async (req, res) => {
  try {
    const coach = await loadCoachOr404(req, res);
    if (!coach) return;
    if (coach.archived) return res.status(400).json({ error: 'Reactivate this coach first' });
    if (!coach.email) return res.status(400).json({ error: 'This coach has no email on file' });
    if (!configured()) return res.status(503).json({ error: 'Email delivery is not set up yet' });
    await sendPasswordResetEmail({ email: coach.email, name: coach.name });
    return res.json({ ok: true });
  } catch (e) {
    logError('coach password reset error', e);
    return res.status(500).json({ error: 'Could not send the reset email. Please try again.' });
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
    logError('reassign error', e);
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
    logError('overview error', e);
    return res.status(500).json({ error: 'Failed to load overview' });
  }
});

module.exports = router;
