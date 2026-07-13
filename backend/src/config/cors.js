const LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function normalizeOrigin(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '*') return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== trimmed) return null;
  return parsed.origin;
}

function corsConfiguration(env = process.env) {
  const raw = String(env.CORS_ORIGINS || '').trim();
  const values = raw
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : (env.NODE_ENV === 'production' ? [] : LOCAL_ORIGINS);
  const origins = values.map(normalizeOrigin);
  if (origins.some((origin) => !origin)) {
    throw new Error('CORS_ORIGINS must contain only explicit HTTP(S) origins without paths or wildcards');
  }
  return { origins: [...new Set(origins)], credentials: false };
}

function createCorsOriginCheck(origins) {
  const allowed = new Set(origins);
  return (origin, callback) => {
    if (!origin || allowed.has(origin)) return callback(null, true);
    return callback(null, false);
  };
}

module.exports = { LOCAL_ORIGINS, corsConfiguration, createCorsOriginCheck, normalizeOrigin };
