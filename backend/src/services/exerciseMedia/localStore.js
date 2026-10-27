// LocalMediaStore: the working LOCAL storage adapter for exercise media.
// Files live outside any web root under a task-owned directory; keys are
// server-generated shapes only (validated here and by a DB CHECK); writes are
// staged in quarantine and atomically renamed; reads refuse symlinks. Bytes
// reach browsers only through /api/exercise-media/content/:capability.
// This is not a claim that Vercel can host it unchanged: hosted storage is a
// separate, owner-approved gate (docs/exercise-media/production-gates.md).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { MediaError, LIMITS } = require('../../lib/exerciseMedia/validation');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp(`^(sources/${UUID}\\.(jpg|png|webp|mp4|mov|webm)|derivatives/${UUID}/[0-9]{1,6}-(poster|end_frame|preview|instruction|captions)\\.(jpg|mp4|vtt))$`);
const STAGED_RE = new RegExp(`^${UUID}\\.part$`);
// Direct-upload staging objects (photo transport): app-issued keys only.
const STAGING_KEY_RE = new RegExp(`^staging/(${UUID})$`);
const DERIVATIVE_RE = new RegExp(`^derivatives/${UUID}/[0-9]{1,6}-(poster|end_frame|preview|instruction|captions)\\.(jpg|mp4|vtt)$`);
// Local stand-in for a provider signed upload. Not the 60 s read capability.
const LOCAL_GRANT_TTL_SECONDS = 15 * 60;
const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', vtt: 'text/vtt; charset=utf-8' };

function invalidKey() { return new MediaError('invalid_storage_key', 400); }
function notFound() { const e = new MediaError('not_found', 404); return e; }

function byteLimiter(maxBytes, onExceeded) {
  let total = 0;
  const hash = createHash('sha256');
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) { onExceeded(); callback(new MediaError('file_too_large')); return; }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  transform.result = () => ({ bytes: total, sha256: hash.digest('hex') });
  return transform;
}

class LocalMediaStore {
  constructor({ root, grantSecret = null, now = Date.now }) {
    if (!root || !path.isAbsolute(root)) throw new Error('LocalMediaStore needs an absolute root');
    this.root = path.resolve(root);
    this.objects = path.join(this.root, 'objects');
    this.quarantine = path.join(this.root, 'quarantine');
    this.work = path.join(this.root, 'work');
    this.staging = path.join(this.root, 'staging');
    this.grantSecret = grantSecret;
    this.now = now;
    for (const dir of [this.root, this.objects, this.quarantine, this.work, this.staging]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  static isKey(key) { return typeof key === 'string' && KEY_RE.test(key); }

  static contentType(key) { return CONTENT_TYPES[path.extname(key).slice(1)] || 'application/octet-stream'; }

  pathFor(key) {
    if (!LocalMediaStore.isKey(key)) throw invalidKey();
    const full = path.resolve(this.objects, key);
    if (!full.startsWith(this.objects + path.sep)) throw invalidKey();
    return full;
  }

  async #writeStream(stream, target, maxBytes) {
    const limiter = byteLimiter(maxBytes, () => stream.destroy?.());
    try {
      // 'wx': exclusive create, never overwriting or following an existing path.
      await pipeline(stream, limiter, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      const handle = await fsp.open(target, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
    } catch (error) {
      await fsp.rm(target, { force: true });
      if (error instanceof MediaError) throw error;
      throw new MediaError('upload_interrupted', 400);
    }
    const result = limiter.result();
    if (!result.bytes) { await fsp.rm(target, { force: true }); throw new MediaError('empty_file', 400); }
    return result;
  }

  async #install(staged, key) {
    const target = this.pathFor(key);
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fsp.rename(staged, target);
  }

  // put({key, stream, maxBytes}) -> {bytes, sha256}; atomic via quarantine.
  async put({ key, stream, maxBytes }) {
    this.pathFor(key);
    const staged = path.join(this.quarantine, `${randomUUID()}.part`);
    const result = await this.#writeStream(stream, staged, maxBytes);
    await this.#install(staged, key);
    return result;
  }

  // Multipart uploads: bytes land in quarantine first; the route validates them
  // and records the asset row before commitUpload renames them into place.
  async stageUpload({ stream, maxBytes }) {
    const uploadId = randomUUID();
    const target = path.join(this.quarantine, `${uploadId}.part`);
    const result = await this.#writeStream(stream, target, maxBytes);
    return { uploadId, path: target, ...result };
  }

  stagedPath(uploadId) {
    const name = `${uploadId}.part`;
    if (!STAGED_RE.test(name)) throw invalidKey();
    return path.join(this.quarantine, name);
  }

  // 'missing' | 'match' | 'mismatch' for a file against an expected
  // {bytes, sha256} (no expectation: any regular file matches). Never follows
  // a symlink; a symlink or non-file is a mismatch.
  async #check(file, expected) {
    let stat;
    try { stat = await fsp.lstat(file); } catch (error) {
      if (error.code === 'ENOENT') return 'missing';
      throw error;
    }
    if (!stat.isFile()) return 'mismatch';
    if (!expected) return 'match';
    if (stat.size !== Number(expected.bytes)) return 'mismatch';
    const hash = createHash('sha256');
    await pipeline(fs.createReadStream(file, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW }), hash);
    return hash.digest('hex') === expected.sha256 ? 'match' : 'mismatch';
  }

  // Installs a staged upload at its recorded key and never overwrites an
  // object already there: a present object must match `expected`
  // ({bytes, sha256}), and the staged bytes are verified before they are
  // linked into place. The staged copy is removed only after the object is in
  // place, so a failure leaves it recoverable. Returns { installed } (false
  // when a matching object was already present).
  async commitUpload(uploadId, key, expected = null) {
    const staged = this.stagedPath(uploadId);
    const target = this.pathFor(key);
    const present = await this.#check(target, expected);
    if (present === 'mismatch') throw new MediaError('stored_source_mismatch', 500);
    if (present === 'missing') {
      if (expected && (await this.#check(staged, expected)) !== 'match') throw new MediaError('staged_source_mismatch', 500);
      await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      try {
        await fsp.link(staged, target);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if ((await this.#check(target, expected)) !== 'match') throw new MediaError('stored_source_mismatch', 500);
      }
    }
    await fsp.rm(staged, { force: true });
    return { installed: present === 'missing' };
  }

  async checkStaged(uploadId, expected) { return this.#check(this.stagedPath(uploadId), expected); }

  // Re-files a staged copy under another upload id (e.g. a same-request retry
  // becoming the recoverable copy of the recorded asset); never overwrites.
  async adoptStaged(fromId, toId) {
    const from = this.stagedPath(fromId);
    await fsp.link(from, this.stagedPath(toId));
    await fsp.rm(from, { force: true });
  }

  async discardUpload(uploadId) { await fsp.rm(this.stagedPath(uploadId), { force: true }); }

  async readHead(filePath, bytes) {
    const handle = await fsp.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }

  // Moves a finished worker output into its derivative key (same filesystem).
  async putFile({ key, sourcePath, maxBytes }) {
    const stat = await fsp.lstat(sourcePath);
    if (!stat.isFile()) throw new MediaError('missing_output', 500);
    if (stat.size > maxBytes || stat.size === 0) throw new MediaError('output_too_large', 422);
    const hash = createHash('sha256');
    await pipeline(fs.createReadStream(sourcePath), hash);
    await this.#install(sourcePath, key);
    return { bytes: stat.size, sha256: hash.digest('hex') };
  }

  async stat(key) {
    const full = this.pathFor(key);
    let stat;
    try { stat = await fsp.lstat(full); } catch { throw notFound(); }
    if (stat.isSymbolicLink() || !stat.isFile()) throw notFound();
    return { size: stat.size };
  }

  // open({key, range}) -> {stream, size, contentType}; never follows symlinks.
  async open({ key, range = null }) {
    const full = this.pathFor(key);
    let handle;
    try { handle = await fsp.open(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch { throw notFound(); }
    const stat = await handle.stat();
    if (!stat.isFile()) { await handle.close(); throw notFound(); }
    const stream = handle.createReadStream(range ? { start: range.start, end: range.end } : {});
    return { stream, size: stat.size, contentType: LocalMediaStore.contentType(key) };
  }

  workDir(name) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name)) throw invalidKey();
    const dir = path.join(this.work, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  async removeWorkDir(dir) {
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(this.work + path.sep)) return;
    await fsp.rm(resolved, { recursive: true, force: true });
  }

  // Bounded cleanup: only expired uncommitted quarantine parts and stale
  // worker scratch directories. Committed objects are never removed here.
  async removeTemporary({ olderThanMs, keep = new Set() }) {
    const cutoff = Date.now() - olderThanMs;
    const removed = { quarantine: 0, work: 0 };
    for (const name of await fsp.readdir(this.quarantine)) {
      if (!STAGED_RE.test(name) && !name.endsWith('.part')) continue;
      if (keep.has(name.replace(/\.part$/, ''))) continue;
      const full = path.join(this.quarantine, name);
      const stat = await fsp.lstat(full).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) { await fsp.rm(full, { force: true }); removed.quarantine += 1; }
    }
    for (const name of await fsp.readdir(this.work)) {
      const full = path.join(this.work, name);
      const stat = await fsp.lstat(full).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) { await fsp.rm(full, { recursive: true, force: true }); removed.work += 1; }
    }
    return removed;
  }

  async listStagedUploads() {
    return (await fsp.readdir(this.quarantine)).filter((name) => STAGED_RE.test(name)).map((name) => name.replace(/\.part$/, ''));
  }

  async exists(key) {
    try { await this.stat(key); return true; } catch { return false; }
  }

  // ----- Photo transport (docs/exercise-guides/design.md) -----------------------
  // The same contract as services/exerciseMedia/supabaseImageStore.js: the
  // browser PUTs bytes straight to an app-issued staging key under a short-lived
  // grant (here a signed loopback URL handled by the media router), then the
  // server re-reads, re-verifies and installs them. Staged copies are never
  // overwritten or automatically purged.
  static isStagingKey(key) { return typeof key === 'string' && STAGING_KEY_RE.test(key); }

  stagingPath(key) {
    const match = typeof key === 'string' ? STAGING_KEY_RE.exec(key) : null;
    if (!match) throw invalidKey();
    return path.join(this.staging, `${match[1]}.bin`);
  }

  #mac(body) { return createHmac('sha256', this.grantSecret).update(`staging-grant.${body}`).digest('base64url'); }

  createUploadGrant({ key, contentType }) {
    this.stagingPath(key);
    if (typeof this.grantSecret !== 'string' || this.grantSecret.length < 32) throw new Error('Upload grants need a configured secret');
    const maxBytes = LIMITS.image.maxBytes;
    const expires = Math.floor(this.now() / 1000) + LOCAL_GRANT_TTL_SECONDS;
    const body = Buffer.from(JSON.stringify({ v: 1, k: key, ct: contentType, m: maxBytes, e: expires })).toString('base64url');
    return {
      method: 'PUT', url: `/api/exercise-media/staging/${body}.${this.#mac(body)}`,
      headers: { 'content-type': contentType }, expires_at: new Date(expires * 1000).toISOString(), max_bytes: maxBytes,
    };
  }

  verifyUploadGrant(token) {
    const invalid = () => new MediaError('invalid_grant', 404);
    if (typeof token !== 'string' || token.length > 1024 || !this.grantSecret) throw invalid();
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(mac)) throw invalid();
    const expected = Buffer.from(this.#mac(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw invalid(); }
    if (payload?.v !== 1 || !LocalMediaStore.isStagingKey(payload.k) || !Number.isInteger(payload.m) || !Number.isInteger(payload.e)) throw invalid();
    if (payload.e * 1000 <= this.now()) throw new MediaError('grant_expired', 403);
    return { key: payload.k, contentType: payload.ct, maxBytes: payload.m };
  }

  // -> {status: 'stored'|'exists', bytes, sha256}. An identical retry is
  // idempotent; different bytes for an existing staged key are refused.
  async receiveStaged({ key, stream, maxBytes }) {
    const target = this.stagingPath(key);
    const temp = path.join(this.staging, `tmp-${randomUUID()}.part`);
    const result = await this.#writeStream(stream, temp, maxBytes);
    try {
      const present = await this.#check(target, result);
      if (present === 'match') return { status: 'exists', ...result };
      if (present === 'mismatch') throw new MediaError('staging_conflict', 409);
      try {
        await fsp.link(temp, target);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if ((await this.#check(target, result)) !== 'match') throw new MediaError('staging_conflict', 409);
        return { status: 'exists', ...result };
      }
      return { status: 'stored', ...result };
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  async #readBounded(file, maxBytes) {
    let stat;
    try { stat = await fsp.lstat(file); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile()) throw new MediaError('staged_source_mismatch', 500);
    if (stat.size > maxBytes) throw new MediaError('file_too_large');
    const handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { return await handle.readFile(); } finally { await handle.close(); }
  }

  async readStaged(key, { maxBytes }) { return this.#readBounded(this.stagingPath(key), maxBytes); }

  // Copies (never links or moves) verified staged bytes to the immutable source
  // key. A present source must already match; the staged copy is kept.
  async installStagedSource(stagingKey, finalKey, expected) {
    const staged = this.stagingPath(stagingKey);
    if (!/^sources\//.test(finalKey)) throw invalidKey();
    const target = this.pathFor(finalKey);
    const present = await this.#check(target, expected);
    if (present === 'mismatch') throw new MediaError('stored_source_mismatch', 500);
    if (present === 'match') return { installed: false };
    if ((await this.#check(staged, expected)) !== 'match') throw new MediaError('staged_source_mismatch', 500);
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await fsp.copyFile(staged, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if ((await this.#check(target, expected)) !== 'match') throw new MediaError('stored_source_mismatch', 500);
    return { installed: true };
  }

  // Generated derivative bytes (unreferenced until the database records them).
  async putObject({ key, buffer, maxBytes }) {
    if (typeof key !== 'string' || !DERIVATIVE_RE.test(key)) throw invalidKey();
    this.pathFor(key);
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw new MediaError('output_too_large', 422);
    const temp = path.join(this.quarantine, `${randomUUID()}.part`);
    await fsp.writeFile(temp, buffer, { flag: 'wx', mode: 0o600 });
    await this.#install(temp, key);
    return { bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
  }

  async readObject(key, { maxBytes }) { return this.#readBounded(this.pathFor(key), maxBytes); }
}

module.exports = { LocalMediaStore, KEY_RE, STAGING_KEY_RE, DERIVATIVE_RE, LOCAL_GRANT_TTL_SECONDS };
