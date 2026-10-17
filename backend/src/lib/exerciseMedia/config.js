// Fail closed unless a local adapter or complete explicit private-photo opt-in
// is configured. Hosted opt-in never generates a secret and cannot enable video.
// Configuration code is local readiness, not hosted activation authority.
const path = require('node:path');
const { randomBytes } = require('node:crypto');

let generatedSecret = null;

function mediaConfig(env = process.env) {
  const root = env.EXERCISE_MEDIA_ROOT || '';
  const localEnabled = env.EXERCISE_MEDIA_STORE === 'local' && path.isAbsolute(root) && !env.VERCEL && env.NODE_ENV !== 'production';
  const bucket = env.EXERCISE_MEDIA_BUCKET || '';
  const hostedEnabled = env.EXERCISE_MEDIA_STORE === 'supabase'
    && env.EXERCISE_MEDIA_HOSTED_PHOTOS === 'enabled'
    && (!env.EXERCISE_MEDIA_MODE || env.EXERCISE_MEDIA_MODE === 'photos')
    && /^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket) && bucket !== 'resource-library'
    && (env.EXERCISE_MEDIA_LINK_SECRET || '').length >= 32;
  const enabled = localEnabled || hostedEnabled;
  let linkSecret = env.EXERCISE_MEDIA_LINK_SECRET || '';
  if (localEnabled && linkSecret.length < 32) {
    // Local only: an ephemeral per-process secret (links live <= 5 minutes).
    generatedSecret ||= randomBytes(32).toString('base64url');
    linkSecret = generatedSecret;
  }
  return {
    enabled,
    store: hostedEnabled ? 'supabase' : 'local',
    bucket: hostedEnabled ? bucket : null,
    // Every hosted byte response is below Vercel's 4.5 MB payload ceiling.
    maxContentBytes: hostedEnabled ? 1024 * 1024 : null,
    mode: env.EXERCISE_MEDIA_MODE === 'full' ? 'full' : 'photos',
    root: localEnabled ? path.resolve(root) : null,
    linkSecret: enabled ? linkSecret : null,
    processorImage: env.EXERCISE_MEDIA_PROCESSOR_IMAGE || null,
    hostedAdapter: env.EXERCISE_MEDIA_STORE === 'supabase' ? (hostedEnabled ? 'photos' : 'requires_separate_activation') : null,
  };
}

module.exports = { mediaConfig };
