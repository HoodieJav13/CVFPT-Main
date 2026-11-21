const REASON_TARGETS = {
  unanswered_message: (clientId) => ({ href: `/coach/messages/${clientId}`, action: 'Reply' }),
  pending_request: () => ({ href: '/coach/sessions', action: 'Review' }),
  low_adherence: (clientId) => ({ href: `/coach/clients/${clientId}?tab=programs`, action: 'View training' }),
  no_check_in: (clientId) => ({ href: `/coach/clients/${clientId}?tab=check-ins`, action: 'Check in' }),
  session_gap: (clientId) => ({ href: `/coach/clients/${clientId}?tab=sessions`, action: 'View sessions' }),
};

export const QUEUE_LIMIT = 12;

export function buildCoachActionQueue(dashboard = {}, attention = []) {
  return allCoachActions(dashboard, attention).slice(0, QUEUE_LIMIT);
}

// Look A coach queue groups, from real facts only (LOOK-A-COACH-DATA-GUIDE):
// - missed: attention rows whose reasons include low_adherence (past-due
//   dated workouts over the analytics window, only with >= 3 eligible). Its
//   own reason text is kept.
// - needsLook: every other action (sessions, bookings, messages, check-ins
//   and the other attention reasons), in the existing priority order.
// - onTrack is never derived: there is no measure that proves a client is on
//   track, and missing data must not read as on track.
// Counts are items shown, not clients (a client can appear under two kinds);
// `total` is before the 12-item cut so the page can say some are not shown.
export function buildCoachQueueGroups(dashboard = {}, attention = []) {
  const all = allCoachActions(dashboard, attention);
  const shown = all.slice(0, QUEUE_LIMIT);
  const isMissed = (row) => row.kind === 'attention' && row.reasons.some((reason) => reason.code === 'low_adherence');
  const missed = shown.filter(isMissed).map((row) => ({
    ...row,
    // The missed reason leads; the other reasons follow unchanged.
    reasons: [...row.reasons.filter((reason) => reason.code === 'low_adherence'), ...row.reasons.filter((reason) => reason.code !== 'low_adherence')],
  }));
  return { needsLook: shown.filter((row) => !isMissed(row)), missed, onTrack: null, shown: shown.length, total: all.length };
}

function allCoachActions(dashboard = {}, attention = []) {
  const rows = [];
  const bookingClients = new Set();
  const unreadClients = new Set();

  for (const session of dashboard.stale_sessions || []) {
    rows.push({
      key: `stale-${session.id}`,
      kind: 'stale_session',
      priority: 0,
      title: `${session.client?.name || 'Client'} · session still open`,
      detail: session,
    });
  }

  for (const booking of dashboard.pending_bookings || []) {
    bookingClients.add(booking.client_id);
    rows.push({
      key: `booking-${booking.id}`,
      kind: 'booking',
      priority: 1,
      title: `${booking.client?.name || 'Client'} · booking request`,
      detail: booking,
    });
  }

  for (const message of dashboard.recent_messages || []) {
    if (message.sender_role !== 'client' || message.read_by_recipient) continue;
    if (unreadClients.has(message.client_id)) continue;
    unreadClients.add(message.client_id);
    rows.push({
      key: `message-${message.client_id}`,
      kind: 'message',
      priority: 2,
      title: `${message.client?.name || 'Client'} · message`,
      detail: message,
      href: `/coach/messages/${message.client_id}`,
      action: 'Reply',
    });
  }

  for (const checkIn of dashboard.recent_check_ins || []) {
    rows.push({
      key: `check-in-${checkIn.id}`,
      kind: 'check_in',
      priority: 3,
      title: `${checkIn.client?.name || 'Client'} · check-in`,
      detail: checkIn,
      href: `/coach/clients/${checkIn.client_id}?tab=check-ins`,
      action: 'Review',
    });
  }

  for (const client of attention || []) {
    const reasons = (client.reasons || []).filter((reason) => (
      !(reason.code === 'pending_request' && bookingClients.has(client.client_id))
      && !(reason.code === 'unanswered_message' && unreadClients.has(client.client_id))
    ));
    if (!reasons.length) continue;
    const target = REASON_TARGETS[reasons[0].code]?.(client.client_id)
      || { href: `/coach/clients/${client.client_id}`, action: 'Open client' };
    rows.push({
      key: `attention-${client.client_id}`,
      kind: 'attention',
      priority: 4,
      title: client.client_name,
      reasons,
      ...target,
    });
  }

  return rows.sort((a, b) => a.priority - b.priority);
}
