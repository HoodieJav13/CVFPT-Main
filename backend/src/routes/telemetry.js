const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth } = require('../middleware/auth');
const { telemetryLimiter } = require('../middleware/rateLimits');
const { logError } = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Set([
  'workout_started', 'workout_completed', 'workout_abandoned',
  'booking_requested', 'booking_outcome_viewed', 'message_replied',
  'check_in_submitted', 'check_in_reviewed', 'pwa_install_requested',
  'pwa_install_accepted', 'frontend_error', 'training_plan_viewed',
]);
const PROPERTY_KEYS = new Set(['route', 'outcome', 'source', 'offline', 'assignment_kind']);
const PROPERTY_VALUES = {
  outcome: new Set(['approved', 'declined', 'pending', 'auto_booked']),
  source: new Set([
    'appinstalled', 'client_detail', 'client_home', 'client_messages', 'client_tracker',
    'coach_messages', 'coach_tracker', 'free_picker', 'native_prompt', 'offered_slot',
    'training_page',
  ]),
  assignment_kind: new Set(['program', 'standalone']),
};
const SAFE_ROUTES = new Set([
  '/admin', '/client', '/client/messages', '/client/programs', '/client/progress',
  '/client/resources', '/client/sessions', '/client/waiver', '/client/workouts',
  '/coach', '/coach/analytics', '/coach/calendar', '/coach/clients', '/coach/messages',
  '/coach/programs', '/coach/resources', '/coach/sessions',
]);

function safeRoute(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  const segments = value.split('/').filter(Boolean);
  const top = segments[0] === 'admin' ? '/admin' : `/${segments.slice(0, 2).join('/')}`;
  return SAFE_ROUTES.has(top) ? top : null;
}

function safeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!PROPERTY_KEYS.has(key)) continue;
    if (key === 'offline' && typeof raw === 'boolean') result[key] = raw;
    else if (key === 'route') {
      const route = safeRoute(raw);
      if (route) result[key] = route;
    } else if (typeof raw === 'string' && PROPERTY_VALUES[key]?.has(raw)) result[key] = raw;
  }
  return result;
}

router.post('/events', telemetryLimiter, async (req, res) => {
  const eventId = String(req.body?.event_id || '');
  const eventName = String(req.body?.event_name || '');
  const occurredAt = new Date(req.body?.occurred_at || '');
  const now = Date.now();
  if (!UUID_RE.test(eventId)) return res.status(400).json({ error: 'A valid event ID is required' });
  if (!ALLOWED.has(eventName)) return res.status(400).json({ error: 'Unknown telemetry event' });
  if (!Number.isFinite(occurredAt.getTime())
    || occurredAt.getTime() < now - 30 * 24 * 60 * 60 * 1000
    || occurredAt.getTime() > now + 5 * 60 * 1000) {
    return res.status(400).json({ error: 'Event time is outside the accepted window' });
  }
  try {
    const payload = {
      event_id: eventId,
      event_name: eventName,
      actor_role: req.user.role,
      coach_id: req.user.role === 'client' ? req.user.client.coach_id : req.user.coach.id,
      client_id: req.user.role === 'client' ? req.user.client.id : null,
      occurred_at: occurredAt.toISOString(),
      properties: safeProperties(req.body?.properties),
    };
    const { error } = await supabaseAdmin.from('product_events').insert(payload);
    if (error?.code === '23505') return res.json({ accepted: true, duplicate: true });
    if (error) throw error;
    return res.status(202).json({ accepted: true, duplicate: false });
  } catch (error) {
    logError('product telemetry insert error', error);
    return res.status(500).json({ error: 'Failed to record product event' });
  }
});

module.exports = { router, safeProperties, safeRoute, ALLOWED };
