const { Resend } = require('resend');
const { waitUntil } = require('@vercel/functions');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { dateInTz } = require('../utils/time');
const { fetchAllRows } = require('../lib/supabasePage');

const FROM = 'CVF PT <notifications@corevaluefitness.com>';
const DENVER = 'America/Denver';

function configured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.NOTIFY_REPLY_TO && env.FRONTEND_URL);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function sessionFacts(session, otherName) {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(session.scheduled_at));
  return [
    when,
    `${session.duration_minutes} minutes`,
    session.location || 'Location to be confirmed',
    otherName ? `With ${String(otherName).split(' ')[0]}` : null,
  ].filter(Boolean);
}

function renderEmail({ headline, intro, facts = [], actionLabel, actionUrl, footer, footerUrl, footerLabel = 'Manage email settings' }) {
  const factHtml = facts.map((fact) => `<li style="margin:6px 0">${escapeHtml(fact)}</li>`).join('');
  const text = [headline, intro, ...facts, `${actionLabel}: ${actionUrl}`, footer, footerUrl ? `${footerLabel}: ${footerUrl}` : null].filter(Boolean).join('\n\n');
  return {
    text,
    html: `<!doctype html><html><body style="margin:0;background:#f5f7f7;color:#172323;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:28px 18px"><div style="background:#173f3d;color:white;border-radius:14px 14px 0 0;padding:18px 22px;font-weight:700;letter-spacing:.04em">CVF PT</div><div style="background:white;border:1px solid #d9e1df;border-top:0;border-radius:0 0 14px 14px;padding:24px 22px"><h1 style="font-size:22px;margin:0 0 10px">${escapeHtml(headline)}</h1><p style="line-height:1.5;color:#52615f">${escapeHtml(intro)}</p>${facts.length ? `<ul style="padding-left:20px;line-height:1.45">${factHtml}</ul>` : ''}<a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:12px;background:#147d76;color:white;text-decoration:none;font-weight:700;border-radius:10px;padding:12px 16px">${escapeHtml(actionLabel)}</a>${footer ? `<p style="margin-top:22px;font-size:12px;color:#71807e">${escapeHtml(footer)}${footerUrl ? ` <a href="${escapeHtml(footerUrl)}" style="color:#147d76">${escapeHtml(footerLabel)}</a>` : ''}</p>` : ''}</div></div></body></html>`,
  };
}

async function sendEmail(message, idempotencyKey, env = process.env) {
  if (!configured(env)) return { skipped: 'unconfigured' };
  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: FROM,
    replyTo: env.NOTIFY_REPLY_TO,
    ...message,
  }, { idempotencyKey });
  if (error) {
    const sendError = new Error('email provider rejected send');
    sendError.name = 'EmailProviderError';
    sendError.code = error.name || error.statusCode;
    sendError.status = error.statusCode;
    throw sendError;
  }
  return data;
}

async function dispatchEmail(task, env = process.env) {
  if (!configured(env)) return { skipped: 'unconfigured' };
  const safeTask = Promise.resolve().then(task).catch((error) => {
    logError('email delivery error', error);
    return { failed: true };
  });
  if (env.VERCEL) {
    waitUntil(safeTask);
    return { queued: true };
  }
  return safeTask;
}

async function loadPeople(clientId, coachId) {
  const [{ data: client, error: clientError }, { data: coach, error: coachError }] = await Promise.all([
    supabaseAdmin.from('clients').select('id, name, email').eq('id', clientId).eq('archived', false).maybeSingle(),
    supabaseAdmin.from('coaches').select('id, name, email').eq('id', coachId).eq('archived', false).maybeSingle(),
  ]);
  if (clientError) throw clientError;
  if (coachError) throw coachError;
  return { client, coach };
}

async function notifyBookingEvent(event, { booking, session }, env = process.env) {
  if (!booking?.id) return { skipped: 'missing-booking' };
  const { client, coach } = await loadPeople(booking.client_id, booking.coach_id);
  if (!client || !coach) return { skipped: 'missing-recipient' };
  const frontend = env.FRONTEND_URL || '';
  const slot = session || {
    scheduled_at: booking.requested_time,
    duration_minutes: booking.duration_minutes,
    location: booking.location,
  };
  const definitions = {
    'booking-pending': [{ person: coach, headline: 'New booking request', intro: `${client.name} requested a session.`, path: '/coach/sessions', action: 'Review request', other: client.name }],
    'booking-auto-client': [{ person: client, headline: 'You’re booked', intro: 'Your session is confirmed and on the calendar.', path: '/client/sessions', action: 'View session', other: coach.name }],
    'booking-auto-coach': [{ person: coach, headline: 'A client booked instantly', intro: `${client.name} booked an open time.`, path: '/coach/sessions', action: 'View calendar', other: client.name }],
    'booking-approved': [{ person: client, headline: 'Your request was approved', intro: 'Your session is confirmed.', path: '/client/sessions', action: 'View session', other: coach.name }],
    'booking-declined': [{ person: client, headline: 'Your booking request was declined', intro: 'Open Sessions to choose another time or message your coach.', path: '/client/sessions', action: 'Choose another time', other: coach.name }],
  }[event] || [];
  return Promise.all(definitions.filter(({ person }) => person.email).map(({ person, headline, intro, path, action, other }) => {
    const rendered = renderEmail({ headline, intro, facts: sessionFacts(slot, other), actionLabel: action, actionUrl: `${frontend}${path}` });
    return sendEmail({ to: [person.email], subject: headline, ...rendered }, `${event}/${booking.id}/${person.id}`, env);
  }));
}

async function notifySessionCancelled(session, env = process.env) {
  if (!session?.id) return { skipped: 'missing-session' };
  const { client, coach } = await loadPeople(session.client_id, session.coach_id);
  if (!client?.email || !coach) return { skipped: 'missing-recipient' };
  const headline = 'Your session was cancelled';
  const actionUrl = `${env.FRONTEND_URL || ''}/client/sessions`;
  const rendered = renderEmail({
    headline,
    intro: 'This session is no longer on the calendar. Message your coach if you need another time.',
    facts: sessionFacts(session, coach.name),
    actionLabel: 'View sessions',
    actionUrl,
  });
  return sendEmail({ to: [client.email], subject: headline, ...rendered }, `session-cancelled/${session.id}/${client.id}`, env);
}

async function sendDailyDigests(now = new Date(), env = process.env) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const pendingBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [coachesResult, clientsResult, messagesResult, programsResult, workoutsResult, bookingsResult] = await Promise.all([
    fetchAllRows((from, to) => supabaseAdmin.from('coaches').select('id, name, email').eq('archived', false).eq('digest_opt_out', false).order('id').range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from('clients').select('id, name, email, coach_id').eq('archived', false).eq('digest_opt_out', false).order('id').range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from('messages').select('id, client_id, coach_id, sender_role').eq('archived', false).eq('read_by_recipient', false).order('id').range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from('program_assignments').select('id, client_id').eq('archived', false).gte('created_at', since).order('id').range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from('workout_assignments').select('id, client_id').eq('archived', false).gte('created_at', since).order('id').range(from, to)),
    fetchAllRows((from, to) => supabaseAdmin.from('booking_requests').select('id, coach_id').eq('archived', false).eq('status', 'pending').lt('created_at', pendingBefore).order('id').range(from, to)),
  ]);
  for (const result of [coachesResult, clientsResult, messagesResult, programsResult, workoutsResult, bookingsResult]) {
    if (!result.complete) throw new Error('daily digest source exceeded the safe paging ceiling');
  }
  const coaches = coachesResult.rows;
  const clients = clientsResult.rows;
  const messages = messagesResult.rows;
  const programs = programsResult.rows;
  const workouts = workoutsResult.rows;
  const bookings = bookingsResult.rows;

  const clientCounts = new Map();
  const coachCounts = new Map();
  const bump = (map, id, key) => {
    const row = map.get(id) || { unread: 0, assignments: 0, pending: 0 };
    row[key] += 1;
    map.set(id, row);
  };
  for (const message of messages) {
    bump(message.sender_role === 'coach' ? clientCounts : coachCounts, message.sender_role === 'coach' ? message.client_id : message.coach_id, 'unread');
  }
  for (const assignment of [...programs, ...workouts]) bump(clientCounts, assignment.client_id, 'assignments');
  for (const booking of bookings) bump(coachCounts, booking.coach_id, 'pending');

  const recipients = [
    ...clients.map((person) => ({ person, counts: clientCounts.get(person.id), path: '/client', type: 'client' })),
    ...coaches.map((person) => ({ person, counts: coachCounts.get(person.id), path: '/coach', type: 'coach' })),
  ].filter(({ person, counts }) => person.email && counts && Object.values(counts).some(Boolean));

  const digestDate = dateInTz(now.getTime());
  await Promise.all(recipients.map(({ person, counts, path, type }) => {
    const facts = [];
    if (counts.unread) facts.push(`${counts.unread} unread ${counts.unread === 1 ? 'message' : 'messages'}`);
    if (type === 'client' && counts.assignments) facts.push(`${counts.assignments} new training ${counts.assignments === 1 ? 'assignment' : 'assignments'}`);
    if (type === 'coach' && counts.pending) facts.push(`${counts.pending} booking ${counts.pending === 1 ? 'request has' : 'requests have'} waited more than 24 hours`);
    const rendered = renderEmail({
      headline: 'Your CVF PT daily update',
      intro: `Good morning, ${String(person.name || '').split(' ')[0] || 'there'}. Here is what is waiting in the app.`,
      facts,
      actionLabel: 'Open CVF PT',
      actionUrl: `${env.FRONTEND_URL || ''}${path}`,
      footer: 'You can turn off daily digests from Email notifications in your account menu. Transactional booking emails remain on.',
      footerUrl: `${env.FRONTEND_URL || ''}${path}?email-settings=1`,
    });
    return sendEmail({ to: [person.email], subject: 'Your CVF PT daily update', ...rendered }, `digest/${person.id}/${digestDate}`, env);
  }));
  return { recipients: recipients.length };
}

module.exports = {
  configured, dispatchEmail, notifyBookingEvent, notifySessionCancelled,
  renderEmail, sendDailyDigests, sendEmail, sessionFacts,
};
