// Whole week: outside-activity ledger, role-separated context preferences and
// the week read. HTTP role checks only refuse obviously wrong callers early; the
// service-only RPCs re-resolve the actor and current ownership inside their own
// transaction (client row locked first), so they remain the authority.
const express = require('express');
const { logError } = require('../utils/logger');
const lib = require('../lib/outsideActivities');

// Probed by the browser before every guarded send/retry. An older backend has
// no such route (404), so the new UI never sends a guarded body to it.
const CAPABILITY = Object.freeze({
  feature: 'whole_week', contract: 1, outside_activity_writes: 'guarded', preference_writes: 'guarded',
});

function createWholeWeekRouters({ db, auth, now = () => new Date(), writeLimiter } = {}) {
  db ||= require('../supabase').supabaseAdmin;
  auth ||= require('../middleware/auth');
  if (!writeLimiter) {
    const { createRateLimiter } = require('../middleware/rateLimits');
    writeLimiter = createRateLimiter({ identifier: 'whole-week-writes', windowMs: 15 * 60 * 1000, limit: 120 });
  }

  function failure(res, error, verb) {
    const status = lib.wholeWeekErrorStatus(error);
    if (status >= 500) logError(`whole week ${verb} error`, error);
    const code = lib.wholeWeekErrorCode(error);
    const message = status === 503 ? 'Whole week is unavailable until its database migration is applied.'
      : status === 500 ? (verb === 'load' ? 'Could not load this week. Try again.' : 'Could not confirm whether this save finished. Retry the same save.')
        : error.message;
    return res.status(status).json({ error: message, ...(code ? { code } : {}) });
  }

  function tooLarge(body) {
    try { return Buffer.byteLength(JSON.stringify(body ?? {})) > lib.LIMITS.bodyBytes; } catch { return true; }
  }

  async function readWeek(req, res, clientId) {
    const today = lib.denverToday(now());
    let weekStart;
    let cursor;
    try {
      weekStart = lib.parseWeekStart(req.query.week_start, today);
      cursor = lib.parseActivityCursor(req.query.cursor, clientId, weekStart);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    let week;
    try {
      const { data, error } = await db.rpc('read_whole_week', {
        p_auth_user_id: req.user.authUserId, p_client_id: clientId, p_week_start: weekStart, p_cursor: cursor,
      });
      if (error) throw error;
      week = data;
    } catch (error) {
      return failure(res, error, 'load');
    }
    return res.json({
      contract: CAPABILITY.contract,
      timezone: 'America/Denver',
      today,
      current_week_start: lib.mondayOf(today),
      days: Array.from({ length: 7 }, (_, index) => lib.addDays(weekStart, index)),
      ...week,
    });
  }

  async function mutate(req, res, { clientId = null, activityId = null, build }) {
    if (tooLarge(req.body)) return res.status(413).json({ error: 'Request body is too large' });
    let request;
    try {
      request = build(req.body, lib.denverToday(now()));
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    try {
      const { data, error } = await db.rpc('mutate_outside_activity', {
        p_auth_user_id: req.user.authUserId, p_client_id: clientId, p_activity_id: activityId, p_request: request,
      });
      if (error) throw error;
      return res.status(data?.action === 'create' && !data.replayed ? 201 : 200).json(data);
    } catch (error) {
      return failure(res, error, 'save');
    }
  }

  async function savePreferences(req, res, clientId) {
    if (tooLarge(req.body)) return res.status(413).json({ error: 'Request body is too large' });
    let request;
    try {
      request = lib.preferenceRequest(req.body, req.user.role);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    try {
      const { data, error } = await db.rpc('save_context_preferences', {
        p_auth_user_id: req.user.authUserId, p_client_id: clientId, p_request: request,
      });
      if (error) throw error;
      return res.json(data);
    } catch (error) {
      return failure(res, error, 'save');
    }
  }

  const validClientParam = (req, res, next) => (lib.UUID.test(req.params.clientId || '')
    ? next() : res.status(404).json({ error: 'Client week not found' }));
  const validActivityParam = (req, res, next) => (lib.UUID.test(req.params.id || '')
    ? next() : res.status(404).json({ error: 'Activity not found' }));

  const week = express.Router();
  week.use(auth.requireAuth);
  week.get('/capability', (_req, res) => res.json(CAPABILITY));
  // Clients reach only their own linked profile: the id comes from requireAuth,
  // never from the URL, and the RPC re-checks the auth link.
  week.get('/mine', auth.requireClient, (req, res) => readWeek(req, res, req.user.client.id));
  week.get('/clients/:clientId', auth.requireCoach, validClientParam, (req, res) => readWeek(req, res, req.params.clientId));

  const activities = express.Router();
  activities.use(auth.requireAuth);
  activities.post('/mine', auth.requireClient, writeLimiter,
    (req, res) => mutate(req, res, { clientId: req.user.client.id, build: lib.createRequest }));
  activities.post('/clients/:clientId', auth.requireCoach, validClientParam, writeLimiter,
    (req, res) => mutate(req, res, { clientId: req.params.clientId, build: lib.createRequest }));
  activities.patch('/:id/archive', validActivityParam, writeLimiter,
    (req, res) => mutate(req, res, { activityId: req.params.id, build: lib.archiveRequest }));
  activities.patch('/:id', validActivityParam, writeLimiter,
    (req, res) => mutate(req, res, { activityId: req.params.id, build: lib.updateRequest }));

  const preferences = express.Router();
  preferences.use(auth.requireAuth);
  preferences.patch('/mine', auth.requireClient, writeLimiter, (req, res) => savePreferences(req, res, req.user.client.id));
  preferences.patch('/clients/:clientId', auth.requireCoach, validClientParam, writeLimiter,
    (req, res) => savePreferences(req, res, req.params.clientId));

  return { week, activities, preferences };
}

module.exports = { createWholeWeekRouters, CAPABILITY };
