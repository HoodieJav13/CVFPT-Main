const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, canAccessClient } = require('../middleware/auth');
const { configured } = require('../services/email');
const invites = require('../services/clientInvites');
const { UUID, normalizeClientCreate, hashClientCreate, clientRecoverySummary } = require('../lib/clientCreateRequest');
const { sendPasswordResetEmail } = require('../services/accountRecovery');
const { clientImportLimiter } = require('../middleware/rateLimits');

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
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Client name is required', ...(Object.hasOwn(req.body || {}, 'request_id') ? { no_write: true } : {}) });
    const identified = Object.hasOwn(req.body || {}, 'request_id');
    if (identified && (!UUID.test(req.body.request_id || '') || typeof name !== 'string'
      || (req.body.invite_now !== undefined && typeof req.body.invite_now !== 'boolean')
      || ['email', 'phone', 'goals', 'health_notes'].some(k => req.body[k] != null && typeof req.body[k] !== 'string')
      || (req.body.invite_now === true && !String(email || '').trim()))) {
      return res.status(400).json({ error: 'Valid request identity and invite email are required', no_write: true });
    }


    // Coaches always create under themselves; admin may assign any coach.
    const targetCoachId = req.user.role === 'admin' ? (coach_id || req.user.coach.id) : req.user.coach.id;
    if (req.user.role === 'admin') {
      const { data: targetCoach, error: targetError } = await supabaseAdmin.from('coaches').select('id')
        .eq('id', targetCoachId).eq('archived', false).maybeSingle();
      if (targetError) throw new Error('Coach lookup unavailable');
      if (!targetCoach) return res.status(404).json({ error: 'Coach not found' });
    }

    if (identified) {
      const normalized = normalizeClientCreate(req.body, targetCoachId);
      const body = normalized.invite_now ? invites.renderInviteBody({client: normalized, coachName: req.user.coach?.name || 'Your coach'}) : null;
      const result = await invites.rpc(supabaseAdmin, 'create_client_with_request', {
        p_actor: req.user.coach.id, p_request_id: req.body.request_id, p_hash: hashClientCreate(normalized), p_client: normalized, p_provider_body: body,
      });
      if (result.outcome === 'not_found') return res.status(404).json({error: 'Client not found'});
      if (result.outcome === 'request_mismatch') return res.status(409).json({code: 'request_mismatch', error: 'This request already created a client', ...(result.client ? {client: clientRecoverySummary(result.client)} : {})});
      const invite = result.attempt_id ? await invites.deliverInviteAttempt({actorId: req.user.coach.id, attemptId: result.attempt_id}) : null;
      return res.status(result.replayed ? 200 : 201).json({client: result.client, replayed: result.replayed, invite});
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

// POST /api/clients/import { rows: [{ name, email, phone, goals }] }
// D5 (2026-08-06): roster-only CSV import to soften My PT Hub re-entry.
// History import stays out of scope. Rows import under the calling coach.
router.post('/import', clientImportLimiter, async (req, res) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Provide at least one row to import' });
    }
    if (rows.length > 200) return res.status(400).json({ error: 'Import at most 200 clients at a time' });

    const skipped = [];
    const seenEmails = new Set();
    const candidates = [];
    for (const [index, row] of rows.entries()) {
      const name = String(row?.name || '').trim();
      const email = row?.email ? String(row.email).trim().toLowerCase() : null;
      if (!name) {
        skipped.push({ row: index + 1, name: name || null, email, reason: 'Name is required' });
        continue;
      }
      if (email && seenEmails.has(email)) {
        skipped.push({ row: index + 1, name, email, reason: 'Duplicate email in this file' });
        continue;
      }
      if (email) seenEmails.add(email);
      candidates.push({
        name,
        email,
        phone: row?.phone ? String(row.phone).trim() : null,
        goals: row?.goals ? String(row.goals).trim() : null,
      });
    }

    const emails = candidates.map((c) => c.email).filter(Boolean);
    const existing = new Set();
    if (emails.length) {
      const { data: existingRows, error: existingErr } = await supabaseAdmin
        .from('clients').select('email').in('email', emails).eq('archived', false);
      if (existingErr) throw existingErr;
      for (const rowFound of existingRows || []) existing.add(rowFound.email);
    }

    const toInsert = [];
    for (const candidate of candidates) {
      if (candidate.email && existing.has(candidate.email)) {
        skipped.push({ name: candidate.name, email: candidate.email, reason: 'A client with this email already exists' });
      } else {
        toInsert.push({ ...candidate, coach_id: req.user.coach.id });
      }
    }

    let imported = [];
    if (toInsert.length) {
      const { data, error } = await supabaseAdmin.from('clients').insert(toInsert).select('id, name, email');
      if (error) throw error;
      imported = data || [];
    }
    return res.status(201).json({ imported: imported.length, clients: imported, skipped });
  } catch (e) {
    logError('import clients error', e);
    return res.status(500).json({ error: 'Failed to import clients' });
  }
});

async function loadClientOr404(req, res, { includeArchived = false } = {}) {
  let query = supabaseAdmin.from('clients').select('*').eq('id', req.params.id);
  if (!includeArchived) query = query.eq('archived', false);
  const { data: clientRow, error: lookupError } = await query.maybeSingle();
  if (lookupError) throw new Error('Client lookup unavailable');
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return clientRow;
}

// A successful authorized absence is a 200 discriminant, never an HTTP error.
router.get('/create-requests/:request_id', async (req, res) => {
  if (!UUID.test(req.params.request_id)) return res.status(400).json({error: 'Invalid request identity'});
  try {
    const result = await invites.lookupCreateRequest({actorId: req.user.coach.id, requestId: req.params.request_id, user: req.user});
    if (result.status === 'blocked') return res.status(404).json({error: 'Client not found'});
    return res.json(result);
  } catch { return res.status(500).json({error: 'Could not recover client save'}); }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const clientRow = await loadClientOr404(req, res, {
      includeArchived: req.query.include_archived === 'true',
    });
    if (!clientRow) return;
    return res.json({...clientRow, invite: await invites.latestInvite(clientRow.id)});
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

// One tracked invite path for create, switch and resend; no background dispatch.
async function applyInvite(req, res, kind) {
  const body = req.body || {};
  if (!UUID.test(req.params.id) || !UUID.test(body.action_id || '')
    || (body.supersedes_attempt_id != null && !UUID.test(body.supersedes_attempt_id))
    || (body.confirm_duplicate_risk !== undefined && typeof body.confirm_duplicate_risk !== 'boolean')
    || (kind !== 'resend' && typeof body.invited !== 'boolean')) {
    return res.status(400).json({error: 'Valid invite command identity is required'});
  }
  try {
    const client = await loadClientOr404(req, res);
    if (!client) return;
    const result = await invites.rpc(supabaseAdmin, 'apply_invite_action', {
      p_actor: req.user.coach.id, p_client_id: client.id, p_action_id: body.action_id, p_kind: kind,
      p_supersedes_attempt_id: body.supersedes_attempt_id || null, p_confirm_duplicate_risk: body.confirm_duplicate_risk === true,
      p_provider_body: kind === 'switch_off' ? null : invites.renderInviteBody({client, coachName: req.user.coach?.name || 'Your coach'}),
    });
    if (result.outcome === 'not_found') return res.status(404).json({error: 'Client not found'});
    if (result.outcome === 'action_mismatch') return res.status(409).json({error: 'Invite command identity conflicts'});
    const invite = result.result?.outcome === 'selected' && result.attempt_id
      ? await invites.deliverInviteAttempt({actorId: req.user.coach.id, attemptId: result.attempt_id})
      : null;
    return res.json({action: {action_id: result.action_id, replayed: result.replayed, result: result.result}, invite});
  } catch { return res.status(500).json({error: 'Could not update invitation'}); }
}
router.patch('/:id/invite', (req, res) => applyInvite(req, res, req.body?.invited === true ? 'switch_on' : 'switch_off'));
router.post('/:id/invite/resend', (req, res) => applyInvite(req, res, 'resend'));

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
