// Program 012: web push. Inert without the three VAPID env vars (owner
// generates them — see DEPLOYMENT.md). Delivery is best-effort: failures
// log and swallow, expired endpoints (404/410) self-archive, and a push
// can never fail the domain write that triggered it.
const webPush = require('web-push');
const { waitUntil } = require('@vercel/functions');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');

function pushConfigured(env = process.env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

let vapidApplied = false;
function applyVapid(env = process.env) {
  if (vapidApplied) return;
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidApplied = true;
}

async function sendToUser(authUserId, payload, env = process.env) {
  if (!pushConfigured(env) || !authUserId) return { skipped: 'unconfigured' };
  applyVapid(env);
  const { data: subscriptions, error } = await supabaseAdmin.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('auth_user_id', authUserId).eq('archived', false);
  if (error) throw error;
  const body = JSON.stringify(payload);
  await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, body);
    } catch (sendError) {
      if (sendError?.statusCode === 404 || sendError?.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions')
          .update({ archived: true, updated_at: new Date().toISOString() })
          .eq('id', subscription.id);
      } else {
        logError('push send error', sendError);
      }
    }
  }));
  return { sent: (subscriptions || []).length };
}

async function sendToCoaches(coachIds, payload, env = process.env) {
  if (!pushConfigured(env) || !coachIds?.length) return { skipped: 'unconfigured' };
  const { data: coaches, error } = await supabaseAdmin.from('coaches')
    .select('auth_user_id').in('id', coachIds).eq('archived', false);
  if (error) throw error;
  await Promise.all((coaches || [])
    .filter((coach) => coach.auth_user_id)
    .map((coach) => sendToUser(coach.auth_user_id, payload, env)));
  return { ok: true };
}

async function sendToClient(clientId, payload, env = process.env) {
  if (!pushConfigured(env) || !clientId) return { skipped: 'unconfigured' };
  const { data: client, error } = await supabaseAdmin.from('clients')
    .select('auth_user_id').eq('id', clientId).eq('archived', false).maybeSingle();
  if (error) throw error;
  if (!client?.auth_user_id) return { skipped: 'unclaimed' };
  return sendToUser(client.auth_user_id, payload, env);
}

// Fire-and-forget wrapper mirroring dispatchEmail: survives the response
// on Vercel via waitUntil, never throws into the request path.
function dispatchPush(task, env = process.env) {
  if (!pushConfigured(env)) return { skipped: 'unconfigured' };
  const safeTask = Promise.resolve().then(task).catch((error) => {
    logError('push dispatch error', error);
    return { failed: true };
  });
  if (env.VERCEL) {
    waitUntil(safeTask);
    return { queued: true };
  }
  return safeTask;
}

module.exports = { dispatchPush, pushConfigured, sendToClient, sendToCoaches, sendToUser };
