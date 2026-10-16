// SupabaseImageStore: the FUTURE hosted private-photo adapter
// (docs/exercise-guides/design.md, docs/exercise-guides/hosted-gates.md). It is
// implemented and contract-tested locally against a fake storage-js-shaped
// object client only. It is NOT wired to any configuration in this build:
// lib/exerciseMedia/config.js refuses EXERCISE_MEDIA_STORE=supabase until a
// separately authorized hosted activation (private bucket, limits, credentials
// handled by the owner, exact SQL on Development then Production).
//
// Contract (same as LocalMediaStore's photo transport):
//  - The browser receives a provider signed-upload grant for ONE app-issued
//    staging key (`staging/<uuid>`), never a service key or arbitrary path. The
//    provider documents signed upload URLs as valid for 2 hours (installed
//    @supabase/storage-js createSignedUploadUrl); that is the provider's upload
//    lifetime, not the app's 60 s read-capability TTL. Uploads bypass the
//    Vercel request-body ceiling.
//  - Finalize re-reads the staged bytes (bounded), and the service re-sniffs,
//    fully decodes and hashes them before recording; the source is then COPIED
//    to its immutable `sources/<uuid>.<ext>` key and verified. Staged objects are
//    never overwritten (upsert false) and never automatically purged.
//  - Derivatives are server-keyed uploads. Reads stream through the app's
//    capability route, which re-authorizes every GET/HEAD/Range; no signed object
//    URL is ever handed to a browser.
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { LIMITS, MediaError } = require('../../lib/exerciseMedia/validation');
const { KEY_RE, STAGING_KEY_RE, DERIVATIVE_RE } = require('./localStore');

// Provider-documented signed upload lifetime (2 hours). Not configurable here.
const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;
const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', vtt: 'text/vtt; charset=utf-8' };

const invalidKey = () => new MediaError('invalid_storage_key', 400);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const unavailable = () => new MediaError('storage_unavailable', 503);

// Thin mapping from storage-js responses to the adapter's object-client shape.
// Provider messages are used only to classify outcomes and never surfaced.
function supabaseObjectClient(supabase, bucket) {
  const api = () => supabase.storage.from(bucket);
  const status = (error) => String(error?.statusCode ?? error?.status ?? '');
  const isNotFound = (error) => status(error) === '404' || /not.?found/i.test(String(error?.message || ''));
  const isConflict = (error) => status(error) === '409' || /already exists|duplicate/i.test(String(error?.message || ''));
  return {
    async createSignedUploadUrl(key, options) {
      const { data, error } = await api().createSignedUploadUrl(key, options);
      if (error || !data?.signedUrl) throw unavailable();
      return data;
    },
    async download(key) {
      const { data, error } = await api().download(key);
      if (error) { if (isNotFound(error)) return null; throw unavailable(); }
      return Buffer.from(await data.arrayBuffer());
    },
    async info(key) {
      const { data, error } = await api().info(key);
      if (error) { if (isNotFound(error)) return null; throw unavailable(); }
      return { size: Number(data.size) };
    },
    async copy(from, to) {
      const { error } = await api().copy(from, to);
      if (!error) return 'copied';
      if (isConflict(error)) return 'exists';
      if (isNotFound(error)) return 'missing';
      throw unavailable();
    },
    async upload(key, body, options) {
      const { error } = await api().upload(key, body, options);
      if (error) throw unavailable();
    },
  };
}

class SupabaseImageStore {
  constructor({ client, now = Date.now }) {
    this.client = client;
    this.now = now;
  }

  static isStagingKey(key) { return typeof key === 'string' && STAGING_KEY_RE.test(key); }

  static contentType(key) { return CONTENT_TYPES[String(key).split('.').pop()] || 'application/octet-stream'; }

  async createUploadGrant({ key, contentType }) {
    if (!SupabaseImageStore.isStagingKey(key)) throw invalidKey();
    const data = await this.client.createSignedUploadUrl(key, { upsert: false });
    return {
      method: 'PUT', url: data.signedUrl,
      headers: { 'content-type': contentType, 'x-upsert': 'false' },
      expires_at: new Date(this.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      max_bytes: LIMITS.image.maxBytes,
    };
  }

  async #bounded(key, maxBytes) {
    const buffer = await this.client.download(key);
    if (!buffer) return null;
    if (buffer.length > maxBytes) throw new MediaError('file_too_large');
    return buffer;
  }

  async readStaged(key, { maxBytes }) {
    if (!SupabaseImageStore.isStagingKey(key)) throw invalidKey();
    return this.#bounded(key, maxBytes);
  }

  async installStagedSource(stagingKey, finalKey, expected) {
    if (!SupabaseImageStore.isStagingKey(stagingKey) || !KEY_RE.test(finalKey) || !finalKey.startsWith('sources/')) throw invalidKey();
    const copied = await this.client.copy(stagingKey, finalKey);
    if (copied === 'missing') throw new MediaError('staged_source_mismatch', 500);
    const stored = await this.#bounded(finalKey, LIMITS.image.maxBytes);
    if (!stored || stored.length !== Number(expected.bytes) || sha256(stored) !== expected.sha256) {
      throw new MediaError(copied === 'exists' ? 'stored_source_mismatch' : 'staged_source_mismatch', 500);
    }
    return { installed: copied === 'copied' };
  }

  async putObject({ key, buffer, contentType, maxBytes }) {
    if (typeof key !== 'string' || !DERIVATIVE_RE.test(key)) throw invalidKey();
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw new MediaError('output_too_large', 422);
    // Derivative keys are per revision + recipe version and unreferenced until
    // the database records them, so a retried render may replace one.
    await this.client.upload(key, buffer, { contentType, upsert: true, cacheControl: 'no-store' });
    return { bytes: buffer.length, sha256: sha256(buffer) };
  }

  async readObject(key, { maxBytes }) {
    if (!KEY_RE.test(String(key))) throw invalidKey();
    return this.#bounded(key, maxBytes);
  }

  async stat(key) {
    if (!KEY_RE.test(String(key))) throw invalidKey();
    const info = await this.client.info(key);
    if (!info) throw new MediaError('not_found', 404);
    return { size: info.size };
  }

  async exists(key) {
    try { await this.stat(key); return true; } catch { return false; }
  }

  // Bytes for the capability route only; never a URL.
  async open({ key, range = null }) {
    if (!KEY_RE.test(String(key))) throw invalidKey();
    const buffer = await this.client.download(key);
    if (!buffer) throw new MediaError('not_found', 404);
    const slice = range ? buffer.subarray(range.start, range.end + 1) : buffer;
    return { stream: Readable.from([slice]), size: buffer.length, contentType: SupabaseImageStore.contentType(key) };
  }
}

module.exports = { SupabaseImageStore, SIGNED_UPLOAD_TTL_SECONDS, supabaseObjectClient };
