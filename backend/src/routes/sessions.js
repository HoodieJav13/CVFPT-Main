const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');
const { deductCredit, getBalance } = require('../utils/credits');

const router = express.Router();
router.use(requireAuth);

async function loadSessionForCoach(req, res) {
  const { data: session } = await supabaseAdmin.from('sessions').select('*').eq('id', req.params.id).maybeSingle();
  if (!session || (req.user.role !== 'admin' && session.coach_id !== req.user.coach.id)) {
    res.status(404).json({ error: 'Session not found' });
    return null;
  }
  return session;
}

// GET /api/sessions  (coach/admin) ?from=&to=&client_id=&status=
router.get('/', requireCoach, async (req, res) => {
  try {
    let q = supabaseAdmin.from('sessions')
      .select('*, client:clients(id, name), coach:coaches(id, name)')
      .eq('archived', false)
      .order('scheduled_at', { ascending: true });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    if (req.query.client_id) q = q.eq('client_id', req.query.client_id);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.from) q = q.gte('scheduled_at', req.query.from);
    if (req.query.to) q = q.lt('scheduled_at', req.query.to);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('list sessions error', e);
    return res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// POST /api/sessions  (coach)
router.post('/', requireCoach, async (req, res) => {
  try {
    const { client_id, scheduled_at, duration_minutes, location } = req.body || {};
    if (!client_id || !scheduled_at) return res.status(400).json({ error: 'Client and date/time are required' });
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', client_id).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const coachId = req.user.role === 'admin' ? clientRow.coach_id : req.user.coach.id;
    const { data, error } = await supabaseAdmin.from('sessions').insert({
      client_id,
      coach_id: coachId,
      scheduled_at,
      duration_minutes: duration_minutes || 60,
      location: location || null,
    }).select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('create session error', e);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// PUT /api/sessions/:id  (coach)
router.put('/:id', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    const allowed = ['scheduled_at', 'duration_minutes', 'location'];
    const updates = {};
    for (const k of allowed) if (k in (req.body || {})) updates[k] = req.body[k];
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('sessions').update(updates).eq('id', session.id)
      .select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('update session error', e);
    return res.status(500).json({ error: 'Failed to update session' });
  }
});

// PATCH /api/sessions/:id/cancel
router.patch('/:id/cancel', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    if (session.status === 'completed') return res.status(400).json({ error: 'Completed sessions cannot be cancelled' });
    const { data, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', session.id).select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('cancel session error', e);
    return res.status(500).json({ error: 'Failed to cancel session' });
  }
});

// PATCH /api/sessions/:id/complete  -> decrements one credit if available
router.patch('/:id/complete', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    if (session.status === 'completed') return res.status(400).json({ error: 'Session already completed' });
    if (session.status === 'cancelled') return res.status(400).json({ error: 'Cancelled sessions cannot be completed' });

    const newBalance = await deductCredit(session.client_id);
    const { data, error } = await supabaseAdmin.from('sessions')
      .update({ status: 'completed', credit_deducted: newBalance !== null, updated_at: new Date().toISOString() })
      .eq('id', session.id).select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.json({ session: data, credit_deducted: newBalance !== null, credits_remaining: newBalance !== null ? newBalance : await getBalance(session.client_id) });
  } catch (e) {
    console.error('complete session error', e);
    return res.status(500).json({ error: 'Failed to complete session' });
  }
});

// ---- Session notes ----
// GET /api/sessions/:id/notes  (coach)
router.get('/:id/notes', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    const { data, error } = await supabaseAdmin.from('session_notes').select('*')
      .eq('session_id', session.id).eq('archived', false).order('created_at');
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('get notes error', e);
    return res.status(500).json({ error: 'Failed to load notes' });
  }
});

// POST /api/sessions/:id/notes  { content, shared_with_client }
router.post('/:id/notes', requireCoach, async (req, res) => {
  try {
    const session = await loadSessionForCoach(req, res);
    if (!session) return;
    const { content, shared_with_client } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'Note content is required' });
    const { data, error } = await supabaseAdmin.from('session_notes').insert({
      session_id: session.id,
      coach_id: req.user.role === 'admin' ? session.coach_id : req.user.coach.id,
      content: String(content).trim(),
      shared_with_client: Boolean(shared_with_client),
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('create note error', e);
    return res.status(500).json({ error: 'Failed to save note' });
  }
});

// PUT /api/sessions/notes/:noteId  { content, shared_with_client }
router.put('/notes/:noteId', requireCoach, async (req, res) => {
  try {
    const { data: note } = await supabaseAdmin.from('session_notes').select('*, session:sessions(coach_id)').eq('id', req.params.noteId).maybeSingle();
    if (!note || (req.user.role !== 'admin' && note.session?.coach_id !== req.user.coach.id)) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const updates = { updated_at: new Date().toISOString() };
    if ('content' in req.body) updates.content = req.body.content;
    if ('shared_with_client' in req.body) updates.shared_with_client = Boolean(req.body.shared_with_client);
    const { data, error } = await supabaseAdmin.from('session_notes').update(updates).eq('id', note.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('update note error', e);
    return res.status(500).json({ error: 'Failed to update note' });
  }
});

// ---- Client-facing ----
// GET /api/sessions/mine  (client) -> own sessions + shared notes
router.get('/client/mine', requireClient, async (req, res) => {
  try {
    const clientId = req.user.client.id;
    const { data: sessions, error } = await supabaseAdmin.from('sessions')
      .select('*, coach:coaches(id, name)')
      .eq('client_id', clientId).eq('archived', false)
      .order('scheduled_at', { ascending: false });
    if (error) throw error;
    const ids = (sessions || []).map((s) => s.id);
    let notesBySession = {};
    if (ids.length) {
      const { data: notes } = await supabaseAdmin.from('session_notes').select('*')
        .in('session_id', ids).eq('shared_with_client', true).eq('archived', false).order('created_at');
      for (const n of notes || []) {
        notesBySession[n.session_id] = notesBySession[n.session_id] || [];
        notesBySession[n.session_id].push(n);
      }
    }
    return res.json((sessions || []).map((s) => ({ ...s, shared_notes: notesBySession[s.id] || [] })));
  } catch (e) {
    console.error('client sessions error', e);
    return res.status(500).json({ error: 'Failed to load your sessions' });
  }
});

module.exports = router;
