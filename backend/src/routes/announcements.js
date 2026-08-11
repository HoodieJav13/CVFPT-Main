// Program 011 Phase C: one-way coach announcements. Replies are impossible
// by design — there is no reply surface or route. Never emailed standalone;
// clients see them in-app and as a line in the conditional daily digest.
const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient } = require('../middleware/auth');
const { validateUuid } = require('../validation/business');

const router = express.Router();
router.use(requireAuth);

// POST /api/announcements { content, studio_wide? } (coach; studio_wide admin-only)
router.post('/', requireCoach, async (req, res) => {
  try {
    const content = String(req.body?.content || '').trim().slice(0, 2000);
    if (!content) return res.status(400).json({ error: 'Write the announcement first' });
    const studioWide = Boolean(req.body?.studio_wide);
    if (studioWide && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can announce to the whole studio' });
    }
    const { data, error } = await supabaseAdmin.from('announcements').insert({
      coach_id: req.user.coach.id,
      content,
      studio_wide: studioWide,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('create announcement error', e);
    return res.status(500).json({ error: 'Failed to post the announcement' });
  }
});

// GET /api/announcements (coach) — own announcements with seen counts.
router.get('/', requireCoach, async (req, res) => {
  try {
    const { data: announcements, error } = await supabaseAdmin.from('announcements')
      .select('*').eq('coach_id', req.user.coach.id).eq('archived', false)
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const ids = (announcements || []).map((a) => a.id);
    const readCounts = new Map();
    if (ids.length) {
      const { data: reads, error: readErr } = await supabaseAdmin.from('announcement_reads')
        .select('announcement_id').in('announcement_id', ids);
      if (readErr) throw readErr;
      for (const read of reads || []) {
        readCounts.set(read.announcement_id, (readCounts.get(read.announcement_id) || 0) + 1);
      }
    }
    const { count: ownClients } = await supabaseAdmin.from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('coach_id', req.user.coach.id).eq('archived', false);
    const { count: allClients } = await supabaseAdmin.from('clients')
      .select('id', { count: 'exact', head: true }).eq('archived', false);
    return res.json((announcements || []).map((announcement) => ({
      ...announcement,
      seen_count: readCounts.get(announcement.id) || 0,
      audience_count: announcement.studio_wide ? (allClients || 0) : (ownClients || 0),
    })));
  } catch (e) {
    logError('list announcements error', e);
    return res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// PATCH /api/announcements/:id/archive (author, or admin)
router.patch('/:id/archive', requireCoach, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Announcement ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: announcement } = await supabaseAdmin.from('announcements')
      .select('*').eq('id', idValidation.value).eq('archived', false).maybeSingle();
    if (!announcement || (req.user.role !== 'admin' && announcement.coach_id !== req.user.coach.id)) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    const { data, error } = await supabaseAdmin.from('announcements')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', announcement.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive announcement error', e);
    return res.status(500).json({ error: 'Failed to remove the announcement' });
  }
});

// GET /api/announcements/mine (client) — active announcements from your
// coach plus studio-wide ones, newest first, with your read state.
router.get('/mine', requireClient, async (req, res) => {
  try {
    const { data: announcements, error } = await supabaseAdmin.from('announcements')
      .select('id, content, studio_wide, created_at, coach:coaches(id, name)')
      .eq('archived', false)
      .or(`coach_id.eq.${req.user.client.coach_id},studio_wide.eq.true`)
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    const ids = (announcements || []).map((a) => a.id);
    let readIds = new Set();
    if (ids.length) {
      const { data: reads, error: readErr } = await supabaseAdmin.from('announcement_reads')
        .select('announcement_id').eq('client_id', req.user.client.id).in('announcement_id', ids);
      if (readErr) throw readErr;
      readIds = new Set((reads || []).map((r) => r.announcement_id));
    }
    return res.json((announcements || []).map((announcement) => ({
      ...announcement,
      read: readIds.has(announcement.id),
    })));
  } catch (e) {
    logError('client announcements error', e);
    return res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// PATCH /api/announcements/:id/read (client) — idempotent seen marker.
router.patch('/:id/read', requireClient, async (req, res) => {
  try {
    const idValidation = validateUuid(req.params.id, 'Announcement ID');
    if (!idValidation.ok) return res.status(400).json({ error: idValidation.error });
    const { data: announcement } = await supabaseAdmin.from('announcements')
      .select('id, coach_id, studio_wide').eq('id', idValidation.value).eq('archived', false).maybeSingle();
    if (!announcement || (!announcement.studio_wide && announcement.coach_id !== req.user.client.coach_id)) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    const { error } = await supabaseAdmin.from('announcement_reads')
      .upsert({ announcement_id: announcement.id, client_id: req.user.client.id }, {
        onConflict: 'announcement_id,client_id', ignoreDuplicates: true,
      });
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    logError('read announcement error', e);
    return res.status(500).json({ error: 'Failed to mark as seen' });
  }
});

module.exports = router;
