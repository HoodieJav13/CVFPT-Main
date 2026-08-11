// Program 012: push subscription lifecycle. Subscribing requires a login
// (coach or claimed client); each device endpoint is one row, owned by the
// authenticated user; unsubscribe archives own endpoints only.
const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const { pushConfigured } = require('../services/push');

const router = express.Router();
router.use(requireAuth);

// GET /api/push/public-key — null when push is unconfigured so the UI can
// show an honest "not set up yet" state instead of a broken toggle.
router.get('/public-key', (_req, res) => {
  return res.json({ public_key: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null });
});

// POST /api/push/subscribe { endpoint, keys: { p256dh, auth } }
router.post('/subscribe', async (req, res) => {
  try {
    if (!pushConfigured()) return res.status(503).json({ error: 'Push notifications are not set up yet' });
    const endpoint = String(req.body?.endpoint || '');
    const p256dh = String(req.body?.keys?.p256dh || '');
    const auth = String(req.body?.keys?.auth || '');
    if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !p256dh || !auth) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }
    const { error } = await supabaseAdmin.from('push_subscriptions').upsert({
      auth_user_id: req.user.authUserId,
      endpoint,
      p256dh,
      auth,
      archived: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (e) {
    logError('push subscribe error', e);
    return res.status(500).json({ error: 'Could not enable notifications' });
  }
});

// POST /api/push/unsubscribe { endpoint } — own endpoints only.
router.post('/unsubscribe', async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'Endpoint is required' });
    const { error } = await supabaseAdmin.from('push_subscriptions')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('endpoint', endpoint).eq('auth_user_id', req.user.authUserId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    logError('push unsubscribe error', e);
    return res.status(500).json({ error: 'Could not disable notifications' });
  }
});

module.exports = router;
