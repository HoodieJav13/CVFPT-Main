// ImageOnlyProcessor: the default exercise-photo pipeline (docs/exercise-guides/
// design.md). An in-process, pinned decoder (sharp 0.35.5 / libvips) replaces the
// FFmpeg worker for photos, so ordinary photo authoring needs no Docker image,
// container or background worker. Video work is unavailable in this mode; the
// owned FFmpeg pipeline stays in services/exerciseMedia/ffmpegProcessor.js for the
// explicit full-local mode.
//
// Inputs are server-held bytes only (never user paths, URLs or shell commands).
// The byte sniff (lib/exerciseMedia/validation.js) decides the format first; here
// the decoder must agree with it, fully decode every pixel with warnings treated
// as errors, stay within the existing pixel/byte limits and reject animation or
// multiple pages. Output is a metadata-free 8-bit sRGB 640x360 JPEG poster that
// fits the existing 160 KiB budget, rendered from the ORIENTED source with the
// coach's normalized 16:9 crop. One decode at a time per instance, a bounded
// waiting queue and hard deadlines keep a hostile or huge input from starving
// the API process. Decoder unlimited/pixel-limit overrides are never enabled.
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { LIMITS, MediaError, validCropShape, cropMatchesAspect } = require('../../lib/exerciseMedia/validation');

const PHOTO_LIMITS = Object.freeze({
  maxBytes: LIMITS.image.maxBytes,
  maxInputPixels: LIMITS.image.maxPixels,
  poster: Object.freeze({ ...LIMITS.poster }),
  concurrency: 1,
  maxQueue: 4,
  decodeTimeoutMs: 10_000,
  totalTimeoutMs: 15_000,
  // Bounded quality attempts; the first usually lands near ~80 KB for a photo.
  qualities: Object.freeze([82, 74, 66, 58, 50, 42, 34]),
});

// Bounded libvips operation cache and thread pool for this process.
sharp.cache({ memory: 64, files: 0, items: 32 });
sharp.concurrency(2);

const SHARP_FORMAT = { jpeg: 'jpeg', png: 'png', webp: 'webp' };

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

class ImageOnlyProcessor {
  constructor({
    sharpLib = sharp,
    decodeTimeoutMs = PHOTO_LIMITS.decodeTimeoutMs,
    totalTimeoutMs = PHOTO_LIMITS.totalTimeoutMs,
    maxQueue = PHOTO_LIMITS.maxQueue,
    posterMaxBytes = PHOTO_LIMITS.poster.maxBytes,
  } = {}) {
    this.sharp = sharpLib;
    this.decodeTimeoutMs = decodeTimeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.maxQueue = maxQueue;
    this.posterMaxBytes = posterMaxBytes;
    this.version = `sharp ${sharpLib.versions.sharp} / libvips ${sharpLib.versions.vips}`;
    this.running = 0;
    this.waiting = [];
  }

  // Runs `task` with at most one decode in flight; up to maxQueue callers wait.
  // A waiter past its total deadline, or a task past its decode deadline, fails
  // with a retryable processor_timeout. The slot is released only when the task
  // itself settles (libvips' own timeout guarantees that), so a slow decode can
  // never overlap the next one.
  schedule(task) {
    const deadline = Date.now() + this.totalTimeoutMs;
    if (this.running >= PHOTO_LIMITS.concurrency && this.waiting.length >= this.maxQueue) {
      return Promise.reject(new MediaError('processor_busy'));
    }
    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, deadline, timer: null };
      if (this.running < PHOTO_LIMITS.concurrency) { this.#start(entry); return; }
      entry.timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new MediaError('processor_timeout'));
      }, Math.max(0, deadline - Date.now()));
      this.waiting.push(entry);
    });
  }

  #start(entry) {
    clearTimeout(entry.timer);
    this.running += 1;
    let settled = false;
    const budget = Math.max(1, Math.min(this.decodeTimeoutMs, entry.deadline - Date.now()));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      entry.reject(new MediaError('processor_timeout'));
    }, budget);
    Promise.resolve().then(() => entry.task({ timeoutMs: budget })).then((value) => {
      if (!settled) { settled = true; entry.resolve(value); }
    }, (error) => {
      if (!settled) { settled = true; entry.reject(error); }
    }).finally(() => {
      clearTimeout(timer);
      this.running -= 1;
      this.#next();
    });
  }

  #next() {
    while (this.waiting.length && this.running < PHOTO_LIMITS.concurrency) {
      const entry = this.waiting.shift();
      if (Date.now() >= entry.deadline) { clearTimeout(entry.timer); entry.reject(new MediaError('processor_timeout')); continue; }
      this.#start(entry);
    }
  }

  async #bytes({ buffer, sourcePath }) {
    let bytes = buffer;
    if (!bytes && sourcePath) {
      const stat = await fsp.stat(sourcePath);
      if (stat.size > PHOTO_LIMITS.maxBytes) throw new MediaError('file_too_large');
      bytes = await fsp.readFile(sourcePath);
    }
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new MediaError('empty_file', 400);
    if (bytes.length > PHOTO_LIMITS.maxBytes) throw new MediaError('file_too_large');
    return bytes;
  }

  #input(bytes, timeoutMs) {
    // Strict: warnings are errors; never unlimited; first page only.
    return this.sharp(bytes, { failOn: 'warning', limitInputPixels: PHOTO_LIMITS.maxInputPixels, sequentialRead: true, animated: false })
      .timeout({ seconds: Math.max(1, Math.ceil(timeoutMs / 1000)) });
  }

  async #checkDecodes(bytes, facts, timeoutMs) {
    let meta;
    try { meta = await this.#input(bytes, timeoutMs).metadata(); } catch { throw new MediaError('corrupt_image'); }
    if (!facts || meta.format !== SHARP_FORMAT[facts.format]) throw new MediaError('corrupt_image');
    if ((meta.pages || 1) > 1 || facts.animated) throw new MediaError('animated_image_not_supported', 415);
    const stored = facts.orientation >= 5 ? { width: facts.height, height: facts.width } : { width: facts.width, height: facts.height };
    if (meta.width !== stored.width || meta.height !== stored.height) throw new MediaError('corrupt_image');
    // A full decode of every pixel (no shrink-on-load), streamed through a tiny
    // box-filtered output so memory stays bounded; truncation fails strictly.
    try {
      await this.#input(bytes, timeoutMs).resize(16, 16, { fit: 'fill', fastShrinkOnLoad: false }).raw().toBuffer();
    } catch (error) {
      if (/timeout/i.test(String(error?.message))) throw new MediaError('processor_timeout');
      throw new MediaError('corrupt_image');
    }
    return meta;
  }

  async verifyImage({ buffer = null, sourcePath = null, facts }) {
    const bytes = await this.#bytes({ buffer, sourcePath });
    await this.schedule(({ timeoutMs }) => this.#checkDecodes(bytes, facts, timeoutMs));
    return true;
  }

  // crop: normalized {x,y,width,height} in ORIENTED source coordinates, 16:9.
  async renderImage({ buffer = null, sourcePath = null, facts, crop, outputPath = null }) {
    const bytes = await this.#bytes({ buffer, sourcePath });
    if (!validCropShape(crop)) throw new MediaError('invalid_crop');
    if (!cropMatchesAspect(crop, facts)) throw new MediaError('crop_aspect_mismatch');
    const result = await this.schedule(async ({ timeoutMs }) => {
      await this.#checkDecodes(bytes, facts, timeoutMs);
      const left = Math.min(Math.max(0, Math.round(crop.x * facts.width)), facts.width - 1);
      const top = Math.min(Math.max(0, Math.round(crop.y * facts.height)), facts.height - 1);
      const width = Math.max(1, Math.min(facts.width - left, Math.round(crop.width * facts.width)));
      const height = Math.max(1, Math.min(facts.height - top, Math.round(crop.height * facts.height)));
      const { width: outWidth, height: outHeight } = PHOTO_LIMITS.poster;
      for (const quality of PHOTO_LIMITS.qualities) {
        let output;
        try {
          output = await this.#input(bytes, timeoutMs)
            .autoOrient()
            .extract({ left, top, width, height })
            .resize(outWidth, outHeight, { fit: 'fill', kernel: 'lanczos3' })
            .toColourspace('srgb')
            .jpeg({ quality, chromaSubsampling: '4:2:0', progressive: false })
            .toBuffer({ resolveWithObject: true });
        } catch (error) {
          if (/timeout/i.test(String(error?.message))) throw new MediaError('processor_timeout');
          throw new MediaError('corrupt_image');
        }
        if (output.info.width !== outWidth || output.info.height !== outHeight || output.info.format !== 'jpeg') throw new MediaError('missing_output', 500);
        if (output.data.length <= this.posterMaxBytes) return output.data;
      }
      throw new MediaError('poster_too_large');
    });
    if (outputPath) await fsp.writeFile(outputPath, result, { mode: 0o600 });
    return {
      width: PHOTO_LIMITS.poster.width, height: PHOTO_LIMITS.poster.height, mime_type: 'image/jpeg',
      bytes: result.length, sha256: sha256(result), buffer: result,
    };
  }

  async probe() { throw new MediaError('video_processing_unavailable'); }

  async renderVideo() { throw new MediaError('video_processing_unavailable'); }

  async renderFramePreview() { throw new MediaError('video_processing_unavailable'); }
}

module.exports = { ImageOnlyProcessor, PHOTO_LIMITS };
