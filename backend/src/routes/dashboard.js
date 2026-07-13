const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient } = require('../middleware/auth');
const { getBalance } = require('../utils/credits');
const { todayRangeInTz, todayDateInTz } = require('../utils/time');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard/coach
router.get('/coach', requireCoach, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const coachId = req.user.coach.id;
    const [todayStart, todayEnd] = todayRangeInTz();

    let sessionsQ = supabaseAdmin.from('sessions').select('*, client:clients(id, name)')
      .eq('archived', false).gte('scheduled_at', todayStart).lt('scheduled_at', todayEnd)
      .order('scheduled_at');
    if (!isAdmin) sessionsQ = sessionsQ.eq('coach_id', coachId);

    let upcomingQ = supabaseAdmin.from('sessions').select('*, client:clients(id, name)')
      .eq('archived', false).eq('status', 'scheduled').gte('scheduled_at', todayEnd)
      .order('scheduled_at').limit(5);
    if (!isAdmin) upcomingQ = upcomingQ.eq('coach_id', coachId);

    let bookingsQ = supabaseAdmin.from('booking_requests').select('*, client:clients(id, name)')
      .eq('archived', false).eq('status', 'pending').order('created_at', { ascending: false });
    if (!isAdmin) bookingsQ = bookingsQ.eq('coach_id', coachId);

    let clientsQ = supabaseAdmin.from('clients').select('id', { count: 'exact', head: true }).eq('archived', false);
    if (!isAdmin) clientsQ = clientsQ.eq('coach_id', coachId);

    const [{ data: todaySessions }, { data: upcoming }, { data: pendingBookings }, { count: clientCount }] = await Promise.all([
      sessionsQ, upcomingQ, bookingsQ, clientsQ,
    ]);

    // unread messages from clients
    let clientIdsQ = supabaseAdmin.from('clients').select('id').eq('archived', false);
    if (!isAdmin) clientIdsQ = clientIdsQ.eq('coach_id', coachId);
    const { data: ownClients } = await clientIdsQ;
    let unread = 0;
    let recentMessages = [];
    let recentCheckIns = [];
    const ids = (ownClients || []).map((c) => c.id);
    if (ids.length) {
      const { count } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
        .in('client_id', ids).eq('sender_role', 'client').eq('read_by_recipient', false).eq('archived', false);
      unread = count || 0;
      const { data: recents } = await supabaseAdmin.from('messages').select('*, client:clients(id, name)')
        .in('client_id', ids).eq('archived', false).order('created_at', { ascending: false }).limit(5);
      recentMessages = recents || [];

      const { data: checkIns } = await supabaseAdmin.from('check_ins').select('*, client:clients(id, name)')
        .in('client_id', ids).eq('archived', false).eq('review_status', 'needs_review')
        .order('check_in_date', { ascending: false }).limit(5);
      recentCheckIns = checkIns || [];
    }

    return res.json({
      today_sessions: todaySessions || [],
      upcoming_sessions: upcoming || [],
      pending_bookings: pendingBookings || [],
      client_count: clientCount || 0,
      unread_messages: unread,
      recent_messages: recentMessages,
      recent_check_ins: recentCheckIns,
    });
  } catch (e) {
    logError('coach dashboard error', e);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/client
router.get('/client', requireClient, async (req, res) => {
  try {
    const clientId = req.user.client.id;
    const nowIso = new Date().toISOString();
    const today = todayDateInTz();

    const [{ data: nextSessions }, { data: recentMessages }, { count: unreadMessages }, balance, { data: coach }] = await Promise.all([
      supabaseAdmin.from('sessions').select('*, coach:coaches(id, name)')
        .eq('client_id', clientId).eq('archived', false).eq('status', 'scheduled')
        .gte('scheduled_at', nowIso).order('scheduled_at').limit(3),
      supabaseAdmin.from('messages').select('*')
        .eq('client_id', clientId).eq('archived', false).order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('sender_role', 'coach').eq('read_by_recipient', false).eq('archived', false),
      getBalance(clientId),
      supabaseAdmin.from('coaches').select('name')
        .eq('id', req.user.client.coach_id).eq('archived', false).maybeSingle(),
    ]);

    const [{ data: todayCheckIn }, { data: latestCheckIns }, { data: metrics }] = await Promise.all([
      supabaseAdmin.from('check_ins').select('*')
        .eq('client_id', clientId).eq('check_in_date', today).eq('archived', false).maybeSingle(),
      supabaseAdmin.from('check_ins').select('*')
        .eq('client_id', clientId).eq('archived', false).order('check_in_date', { ascending: false }).limit(1),
      supabaseAdmin.from('metrics').select('id, name, unit')
        .eq('client_id', clientId).eq('archived', false),
    ]);

    let recentProgress = [];
    const metricIds = (metrics || []).map((m) => m.id);
    const metricsById = Object.fromEntries((metrics || []).map((m) => [m.id, m]));
    if (metricIds.length) {
      const { data: entries } = await supabaseAdmin.from('metric_entries').select('*')
        .in('metric_id', metricIds).eq('archived', false)
        .order('recorded_on', { ascending: false }).order('created_at', { ascending: false }).limit(5);
      recentProgress = (entries || []).map((entry) => ({
        ...entry,
        metric: metricsById[entry.metric_id] || null,
      }));
    }

    // waiver status
    const { data: latestArr } = await supabaseAdmin.from('waiver_versions').select('id, version_number')
      .order('version_number', { ascending: false }).limit(1);
    const latest = latestArr?.[0] || null;
    let signedLatest = false;
    if (latest) {
      const { data: sig } = await supabaseAdmin.from('waiver_signatures').select('id')
        .eq('client_id', clientId).eq('waiver_version_id', latest.id).limit(1);
      signedLatest = Boolean(sig && sig.length);
    }

    const { count: programCount } = await supabaseAdmin.from('program_assignments')
      .select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('archived', false);

    return res.json({
      next_session: nextSessions?.[0] || null,
      upcoming_sessions: nextSessions || [],
      recent_messages: recentMessages || [],
      unread_messages: unreadMessages || 0,
      today_check_in: todayCheckIn || null,
      latest_check_in: latestCheckIns?.[0] || null,
      recent_progress: recentProgress,
      credits: balance,
      waiver: { has_version: Boolean(latest), signed_latest: signedLatest },
      program_count: programCount || 0,
      coach_name: coach?.name || null,
    });
  } catch (e) {
    logError('client dashboard error', e);
    return res.status(500).json({ error: 'Failed to load your home' });
  }
});

module.exports = router;
