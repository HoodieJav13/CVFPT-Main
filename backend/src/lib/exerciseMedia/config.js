// Exercise media is fail-closed: it runs only with the LOCAL adapter explicitly
// configured, and never on Vercel. Hosted storage/worker activation is a
// separate, owner-approved gate (docs/exercise-media/production-gates.md).
// While disabled, workout hydration makes no media query at all.
const path = require('node:path');
const { randomBytes } = require('node:crypto');

let generatedSecret = null;

function mediaConfig(env = process.env) {
  const root = env.EXERCISE_MEDIA_ROOT || '';
  const enabled = env.EXERCISE_MEDIA_STORE === 'local' && path.isAbsolute(root) && !env.VERCEL && env.NODE_ENV !== 'production';
  let linkSecret = env.EXERCISE_MEDIA_LINK_SECRET || '';
  if (enabled && linkSecret.length < 32) {
    // Local only: an ephemeral per-process secret (links live <= 5 minutes).
    generatedSecret ||= randomBytes(32).toString('base64url');
    linkSecret = generatedSecret;
  }
  return {
    enabled,
    root: enabled ? path.resolve(root) : null,
    linkSecret: enabled ? linkSecret : null,
    processorImage: env.EXERCISE_MEDIA_PROCESSOR_IMAGE || null,
  };
}

module.exports = { mediaConfig };
