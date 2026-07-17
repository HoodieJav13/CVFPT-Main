const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireCoach);

async function visibleNotifications(user) {
  const { data, error } = await supabaseAdmin.from('notifications')
    .select('*, workout_log:workout_logs(*, client:clients(id, name, coach_id, archived))')
    .eq('recipient_coach_id', user.coach.id).eq('archived', false)
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).filter((notification) => (
    notification.workout_log && canAccessClient(user, notification.workout_log.client)
  ));
}

router.get('/unread-count', async (req, res) => {
  try {
    const rows = await visibleNotifications(req.user);
    return res.json({ unread: rows.filter((row) => !row.read_at).length });
  } catch (error) {
    logError('notification count error', error);
    return res.status(500).json({ error: 'Failed to load notification count' });
  }
});

router.get('/', async (req, res) => {
  try {
    return res.json(await visibleNotifications(req.user));
  } catch (error) {
    logError('notifications error', error);
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    const visible = await visibleNotifications(req.user);
    const ids = visible.filter((row) => !row.read_at).map((row) => row.id);
    if (ids.length) {
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin.from('notifications').update({ read_at: now, updated_at: now })
        .in('id', ids).eq('recipient_coach_id', req.user.coach.id).eq('archived', false);
      if (error) throw error;
    }
    return res.json({ updated: ids.length });
  } catch (error) {
    logError('read all notifications error', error);
    return res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const visible = await visibleNotifications(req.user);
    const notification = visible.find((row) => row.id === req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    const { data, error } = await supabaseAdmin.from('notifications')
      .update({ read_at: notification.read_at || new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', notification.id).eq('recipient_coach_id', req.user.coach.id).eq('archived', false)
      .select().single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    logError('read notification error', error);
    return res.status(500).json({ error: 'Failed to mark notification read' });
  }
});

module.exports = router;
