// Short-lived, unguessable read capabilities for exercise media bytes. A token
// names one asset plus the principal and workout context it was issued for;
// the content route re-checks current permission/version on EVERY access, so a
// token is never authority on its own. Tokens are not durable metadata: never
// store them in DTOs, logs, the workout outbox or any cache keyed by URL.
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { LIMITS, isUuid } = require('../../lib/exerciseMedia/validation');

const MAX_TTL_SECONDS = LIMITS.links.instructionTtlSeconds;

function createCapabilitySigner({ secret, now = Date.now }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Capability secret must be at least 32 characters');
  const mac = (body) => createHmac('sha256', secret).update(body).digest('base64url');

  function issue({ assetId, revisionId, principal, context, ttlSeconds }) {
    if (!isUuid(assetId) || !isUuid(revisionId) || !principal || !isUuid(principal.id)) throw new Error('Capability needs asset, revision and principal ids');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) throw new Error('Capability ttl out of range');
    const expiresMs = now() + ttlSeconds * 1000;
    const payload = { v: 1, a: assetId, r: revisionId, p: { k: principal.kind, id: principal.id }, c: context, e: Math.floor(expiresMs / 1000), n: randomBytes(12).toString('base64url') };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${body}.${mac(body)}`, expiresAt: new Date(payload.e * 1000).toISOString() };
  }

  function verify(token) {
    if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'invalid' };
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return { ok: false, reason: 'invalid' };
    const expected = Buffer.from(mac(parts[0]));
    const given = Buffer.from(parts[1]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'invalid' }; }
    if (!payload || payload.v !== 1 || !isUuid(payload.a) || !isUuid(payload.r) || !payload.p || !isUuid(payload.p.id) || !Number.isInteger(payload.e)) {
      return { ok: false, reason: 'invalid' };
    }
    if (payload.e * 1000 <= now()) return { ok: false, reason: 'expired' };
    return { ok: true, payload };
  }

  return { issue, verify };
}

module.exports = { createCapabilitySigner };
