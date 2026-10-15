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
const { randomUUID, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { MediaError } = require('../../lib/exerciseMedia/validation');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp(`^(sources/${UUID}\\.(jpg|png|webp|mp4|mov|webm)|derivatives/${UUID}/[0-9]{1,6}-(poster|end_frame|preview|instruction|captions)\\.(jpg|mp4|vtt))$`);
const STAGED_RE = new RegExp(`^${UUID}\\.part$`);
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
  constructor({ root }) {
    if (!root || !path.isAbsolute(root)) throw new Error('LocalMediaStore needs an absolute root');
    this.root = path.resolve(root);
    this.objects = path.join(this.root, 'objects');
    this.quarantine = path.join(this.root, 'quarantine');
    this.work = path.join(this.root, 'work');
    for (const dir of [this.root, this.objects, this.quarantine, this.work]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
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

  async commitUpload(uploadId, key) { await this.#install(this.stagedPath(uploadId), key); }

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
}

module.exports = { LocalMediaStore, KEY_RE };
