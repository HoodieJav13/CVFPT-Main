// Exercise media is fail-closed: it runs only with the LOCAL adapter explicitly
// configured, and never on Vercel. Hosted storage/worker activation is a
// separate, owner-approved gate (docs/exercise-guides/hosted-gates.md,
// docs/exercise-media/production-gates.md). While disabled, workout hydration
// makes no media query at all.
//
// Modes (docs/exercise-guides/design.md):
//   photos (default) - image-only in-process processor, direct-upload grants,
//                      inline leased processing, no video sources or worker;
//   full             - the accepted owned FFmpeg video pipeline + background
//                      worker, explicit opt-in (EXERCISE_MEDIA_MODE=full).
// EXERCISE_MEDIA_STORE=supabase is recognized but NEVER activated here: the
// private-bucket adapter exists and is contract-tested locally only.
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
    mode: env.EXERCISE_MEDIA_MODE === 'full' ? 'full' : 'photos',
    root: enabled ? path.resolve(root) : null,
    linkSecret: enabled ? linkSecret : null,
    processorImage: env.EXERCISE_MEDIA_PROCESSOR_IMAGE || null,
    hostedAdapter: env.EXERCISE_MEDIA_STORE === 'supabase' ? 'requires_separate_activation' : null,
  };
}

module.exports = { mediaConfig };
