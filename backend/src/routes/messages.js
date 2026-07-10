const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/messages/threads
router.get('/threads', async (req, res) => {
  try {
    if (req.user.role === 'client') {
      const client = req.user.client;
      const { data: coach } = await supabaseAdmin.from('coaches').select('id, name').eq('id', client.coach_id).maybeSingle();
      const { data: last } = await supabaseAdmin.from('messages').select('*')
        .eq('client_id', client.id).eq('archived', false).order('created_at', { ascending: false }).limit(1);
      const { count } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
        .eq('client_id', client.id).eq('sender_role', 'coach').eq('read_by_recipient', false).eq('archived', false);
      return res.json([{ client_id: client.id, client_name: client.name, coach, last_message: last?.[0] || null, unread: count || 0 }]);
    }
    // coach/admin: one thread per owned client
    let cq = supabaseAdmin.from('clients').select('id, name, coach_id, coach:coaches(id, name)').eq('archived', false);
    if (req.user.role !== 'admin') cq = cq.eq('coach_id', req.user.coach.id);
    const { data: clients, error } = await cq;
    if (error) throw error;
    const ids = (clients || []).map((c) => c.id);
    let lastByClient = {}, unreadByClient = {};
    if (ids.length) {
      const { data: msgs } = await supabaseAdmin.from('messages').select('*')
        .in('client_id', ids).eq('archived', false).order('created_at', { ascending: false }).limit(500);
      for (const m of msgs || []) {
        if (!lastByClient[m.client_id]) lastByClient[m.client_id] = m;
        if (m.sender_role === 'client' && !m.read_by_recipient) {
          unreadByClient[m.client_id] = (unreadByClient[m.client_id] || 0) + 1;
        }
      }
    }
    const threads = (clients || []).map((c) => ({
      client_id: c.id,
      client_name: c.name,
      coach: c.coach,
      last_message: lastByClient[c.id] || null,
      unread: unreadByClient[c.id] || 0,
    })).sort((a, b) => {
      const ta = a.last_message ? new Date(a.last_message.created_at).getTime() : 0;
      const tb = b.last_message ? new Date(b.last_message.created_at).getTime() : 0;
      return tb - ta;
    });
    return res.json(threads);
  } catch (e) {
    console.error('threads error', e);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
});

// GET /api/messages/with/:clientId (coach) - marks client-sent as read
router.get('/with/:clientId', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.from('messages').select('*')
      .eq('client_id', clientRow.id).eq('archived', false).order('created_at');
    if (error) throw error;
    await supabaseAdmin.from('messages').update({ read_by_recipient: true })
      .eq('client_id', clientRow.id).eq('sender_role', 'client').eq('read_by_recipient', false).eq('archived', false);
    return res.json({ client: { id: clientRow.id, name: clientRow.name }, messages: data || [] });
  } catch (e) {
    console.error('get conversation error', e);
    return res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// POST /api/messages/with/:clientId (coach)
router.post('/with/:clientId', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const content = (req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message cannot be empty' });
    const { data, error } = await supabaseAdmin.from('messages').insert({
      client_id: clientRow.id,
      coach_id: clientRow.coach_id,
      sender_role: 'coach',
      content,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('send message error', e);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/messages/mine (client) - marks coach-sent as read
router.get('/mine', requireClient, async (req, res) => {
  try {
    const client = req.user.client;
    const { data: coach } = await supabaseAdmin.from('coaches').select('id, name').eq('id', client.coach_id).maybeSingle();
    const { data, error } = await supabaseAdmin.from('messages').select('*')
      .eq('client_id', client.id).eq('archived', false).order('created_at');
    if (error) throw error;
    await supabaseAdmin.from('messages').update({ read_by_recipient: true })
      .eq('client_id', client.id).eq('sender_role', 'coach').eq('read_by_recipient', false).eq('archived', false);
    return res.json({ coach, messages: data || [] });
  } catch (e) {
    console.error('client conversation error', e);
    return res.status(500).json({ error: 'Failed to load your messages' });
  }
});

// POST /api/messages/mine (client)
router.post('/mine', requireClient, async (req, res) => {
  try {
    const client = req.user.client;
    const content = (req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message cannot be empty' });
    const { data, error } = await supabaseAdmin.from('messages').insert({
      client_id: client.id,
      coach_id: client.coach_id,
      sender_role: 'client',
      content,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('client send error', e);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
