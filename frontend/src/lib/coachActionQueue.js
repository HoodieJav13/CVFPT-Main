const REASON_TARGETS = {
  unanswered_message: (clientId) => ({ href: `/coach/messages/${clientId}`, action: 'Reply' }),
  pending_request: () => ({ href: '/coach/sessions', action: 'Review' }),
  low_adherence: (clientId) => ({ href: `/coach/clients/${clientId}?tab=programs`, action: 'View training' }),
  no_check_in: (clientId) => ({ href: `/coach/clients/${clientId}?tab=check-ins`, action: 'Check in' }),
  session_gap: (clientId) => ({ href: `/coach/clients/${clientId}?tab=sessions`, action: 'View sessions' }),
};

export function buildCoachActionQueue(dashboard = {}, attention = []) {
  const rows = [];
  const bookingClients = new Set();
  const unreadClients = new Set();

  for (const session of dashboard.stale_sessions || []) {
    rows.push({
      key: `stale-${session.id}`,
      kind: 'stale_session',
      priority: 0,
      title: `${session.client?.name || 'Client'} has a past session still open`,
      detail: session,
    });
  }

  for (const booking of dashboard.pending_bookings || []) {
    bookingClients.add(booking.client_id);
    rows.push({
      key: `booking-${booking.id}`,
      kind: 'booking',
      priority: 1,
      title: `${booking.client?.name || 'Client'} is waiting for a booking decision`,
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
      title: `${message.client?.name || 'Client'} sent a message`,
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
      title: `${checkIn.client?.name || 'Client'} has a check-in to review`,
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
      title: `${client.client_name} needs attention`,
      reasons,
      ...target,
    });
  }

  return rows.sort((a, b) => a.priority - b.priority).slice(0, 12);
}
