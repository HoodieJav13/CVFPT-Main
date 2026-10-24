// FfmpegMediaProcessor: the real local processor for exercise media.
// Every tool call is a subprocess argument array (shell false) built only from
// server-side values. Inputs are explicit local files mounted read-only;
// protocols are restricted to `file`; demuxers are named explicitly so no
// format probing reaches playlists or network protocols. The default runner
// executes the task-built, digest-pinned container with no network, a
// read-only root, no capabilities, an unprivileged user and CPU/memory/PID
// limits, plus an in-container kill timer and a host-side `docker kill`.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { LIMITS, MediaError, normalizeProbe } = require('../../lib/exerciseMedia/validation');

const PROCESSOR_IMAGE = process.env.EXERCISE_MEDIA_PROCESSOR_IMAGE || 'cvfpt-media-ffmpeg:6.1.2-r2-a322';
const PROCESSOR_VERSION = 'ffmpeg 6.1.2 (alpine 3.22 ffmpeg=6.1.2-r2, image cvfpt-media-ffmpeg:6.1.2-r2-a322)';
const OWNER_LABEL = 'com.cvfpt.owner=cvfpt-media-processor';
const MAX_STDOUT = 2 * 1024 * 1024;
const MAX_STDERR = 8 * 1024;
const TIMEOUTS = { probe: 20_000, verify: 20_000, image: 30_000, frame: 30_000, preview: 90_000, instruction: 240_000 };

let availability = null;
function processorAvailable({ refresh = false } = {}) {
  if (availability && !refresh && Date.now() - availability.at < 30_000) return availability;
  try {
    execFileSync('docker', ['image', 'inspect', PROCESSOR_IMAGE, '--format', '{{.Id}}'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
    availability = { ok: true, reason: null, at: Date.now() };
  } catch {
    availability = { ok: false, reason: `docker image ${PROCESSOR_IMAGE} not available (build scripts/exercise-media/ffmpeg.Dockerfile)`, at: Date.now() };
  }
  return availability;
}

function collect(stream, limit, keepTail) {
  const parts = [];
  let size = 0;
  stream.on('data', (chunk) => {
    if (keepTail) {
      parts.push(chunk); size += chunk.length;
      while (size > limit && parts.length > 1) size -= parts.shift().length;
    } else if (size < limit) {
      parts.push(chunk.subarray(0, limit - size)); size += chunk.length;
    } else { size += chunk.length; }
  });
  return () => ({ text: Buffer.concat(parts).toString('utf8'), overflow: !keepTail && size > limit });
}

function runProcess(command, args, { timeoutMs, onTimeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = collect(child.stdout, MAX_STDOUT, false);
    const err = collect(child.stderr, MAX_STDERR, true);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { onTimeout?.(); } catch { /* best effort */ }
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); reject(new MediaError('processor_unavailable', 503)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const stdout = out(); const stderr = err();
      if (timedOut) return reject(new MediaError('processor_timeout', 422));
      if (stdout.overflow) return reject(new MediaError('processor_output_too_large', 422));
      if (code !== 0) {
        const error = new MediaError(code === 137 || signal === 'SIGKILL' ? 'processor_timeout' : 'processor_failed', 422);
        error.detail = stderr.text; // never returned to clients or logged raw
        return reject(error);
      }
      return resolve({ stdout: stdout.text, stderr: stderr.text });
    });
  });
}

class DockerToolRunner {
  constructor({ image = PROCESSOR_IMAGE, docker = 'docker', memory = '1g', cpus = '2', pids = 128 } = {}) {
    this.image = image; this.docker = docker; this.memory = memory; this.cpus = cpus; this.pids = pids;
  }

  // inputs: host file paths that may appear verbatim in args; each is mounted
  // read-only at /in/<n><ext>. outputDir is mounted at /out.
  async run(tool, args, { inputs = [], outputDir = null, timeoutMs = 60_000 } = {}) {
    if (!['ffmpeg', 'ffprobe'].includes(tool)) throw new Error('unknown tool');
    const name = `cvfpt-media-${randomUUID()}`;
    const mounts = new Map();
    inputs.forEach((host, index) => {
      if (!path.isAbsolute(host)) throw new Error('inputs must be absolute paths');
      mounts.set(host, `/in/${index}${path.extname(host).toLowerCase().replace(/[^.a-z0-9]/g, '')}`);
    });
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const dockerArgs = [
      'run', '--rm', '--name', name, '--label', OWNER_LABEL, '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', this.memory, '--memory-swap', this.memory,
      '--cpus', this.cpus, '--pids-limit', String(this.pids), '--user', '10001:10001',
      '--tmpfs', '/tmp:rw,size=64m,mode=1777',
    ];
    for (const [host, logical] of mounts) dockerArgs.push('-v', `${host}:${logical}:ro`);
    if (outputDir) {
      if (!path.isAbsolute(outputDir)) throw new Error('outputDir must be absolute');
      dockerArgs.push('-v', `${outputDir}:/out:rw`);
    }
    dockerArgs.push(this.image, 'timeout', '-s', 'KILL', String(seconds), tool, ...args.map((arg) => mounts.get(arg) || arg));
    return runProcess(this.docker, dockerArgs, {
      timeoutMs: timeoutMs + 5000,
      onTimeout: () => spawn(this.docker, ['kill', name], { shell: false, stdio: 'ignore' }),
    }).catch((error) => {
      if (error.code === 'processor_failed' && /Unable to find image|No such image|Cannot connect to the Docker daemon/i.test(error.detail || '')) {
        throw new MediaError('processor_unavailable', 503);
      }
      throw error;
    });
  }
}

// For hosts that provide pinned binaries directly (a later production gate).
class NativeToolRunner {
  constructor({ ffmpegPath, ffprobePath }) {
    if (!path.isAbsolute(ffmpegPath || '') || !path.isAbsolute(ffprobePath || '')) throw new Error('Absolute tool paths required');
    this.paths = { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
  }

  async run(tool, args, { inputs = [], outputDir = null, timeoutMs = 60_000 } = {}) {
    if (!this.paths[tool]) throw new Error('unknown tool');
    const allowed = new Set(inputs);
    const mapped = args.map((arg) => {
      if (allowed.has(arg)) return arg;
      if (outputDir && typeof arg === 'string' && arg.startsWith('/out/')) return path.join(outputDir, path.basename(arg));
      return arg;
    });
    return runProcess(this.paths[tool], mapped, { timeoutMs });
  }
}

const IMAGE_DEMUXERS = { jpeg: 'jpeg_pipe', png: 'png_pipe', webp: 'webp_pipe' };
const VIDEO_DEMUXERS = { mp4: 'mov', mov: 'mov', webm: 'matroska' };
// EXIF orientation -> explicit filters (images run with -noautorotate).
const ORIENT_FILTERS = { 1: [], 2: ['hflip'], 3: ['hflip', 'vflip'], 4: ['vflip'], 5: ['transpose=0'], 6: ['transpose=1'], 7: ['transpose=3'], 8: ['transpose=2'] };

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
function cropPixels(crop, width, height) {
  const w = even(Math.min(width, Math.round(crop.width * width)));
  const h = even(Math.min(height, Math.round(crop.height * height)));
  const x = Math.min(Math.max(0, Math.round(crop.x * width)), width - w);
  const y = Math.min(Math.max(0, Math.round(crop.y * height)), height - h);
  return `crop=${w}:${h}:${x}:${y}`;
}
function centeredCrop(width, height) {
  const aspect = LIMITS.crop.aspect;
  if (width / height > aspect) { const w = (height * aspect) / width; return { x: (1 - w) / 2, y: 0, width: w, height: 1 }; }
  const h = (width / aspect) / height;
  return { x: 0, y: (1 - h) / 2, width: 1, height: h };
}
const seconds = (ms) => (ms / 1000).toFixed(3);
// Encoder/filter threads are bounded explicitly: the container sees every host
// core, and unbounded x264 threading would exceed the PID limit.
const SAFE_OUT = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-threads', '2', '-filter_threads', '1'];

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// moov must precede mdat for progressive playback.
async function isFastStart(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    let offset = 0;
    for (let i = 0; i < 64 && offset + 8 <= size; i += 1) {
      const header = Buffer.alloc(16);
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
      if (boxSize === 0 || boxSize < 8) return false;
      offset += boxSize;
    }
    return false;
  } finally { await handle.close(); }
}

class FfmpegMediaProcessor {
  constructor({ runner = new DockerToolRunner(), version = PROCESSOR_VERSION } = {}) {
    this.runner = runner;
    this.version = version;
  }

  async #probeJson(sourcePath, demuxer, timeoutMs = TIMEOUTS.probe) {
    let result;
    try {
      result = await this.runner.run('ffprobe', ['-v', 'error', '-hide_banner', '-protocol_whitelist', 'file', '-f', demuxer,
        '-show_format', '-show_streams', '-print_format', 'json', sourcePath], { inputs: [sourcePath], timeoutMs });
    } catch (error) {
      if (error.code === 'processor_failed') return null;
      throw error;
    }
    try { return JSON.parse(result.stdout); } catch { return null; }
  }

  async probe({ sourcePath, container }) {
    const demuxer = VIDEO_DEMUXERS[container];
    if (!demuxer) throw new MediaError('unsupported_video_container');
    const json = await this.#probeJson(sourcePath, demuxer);
    if (!json) throw new MediaError('corrupt_video');
    const facts = normalizeProbe(json, container);
    // A full decode pass of the first second proves the stream is decodable by
    // this processor (e.g. an HEVC profile it cannot read is refused here).
    try {
      await this.runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file', '-f', demuxer,
        '-t', '1', '-i', sourcePath, '-map', '0:v:0', '-f', 'null', '-'], { inputs: [sourcePath], timeoutMs: TIMEOUTS.verify });
    } catch (error) {
      if (error.code === 'processor_failed') throw new MediaError('video_not_decodable');
      throw error;
    }
    return facts;
  }

  async verifyImage({ sourcePath, facts }) {
    const demuxer = IMAGE_DEMUXERS[facts.format];
    if (!demuxer) throw new MediaError('unsupported_image_type');
    const json = await this.#probeJson(sourcePath, demuxer, TIMEOUTS.verify);
    const stream = json?.streams?.find((s) => s.codec_type === 'video');
    const stored = facts.orientation >= 5 ? { width: facts.height, height: facts.width } : { width: facts.width, height: facts.height };
    if (!stream || stream.width !== stored.width || stream.height !== stored.height) throw new MediaError('corrupt_image');
    try {
      await this.runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-noautorotate',
        '-protocol_whitelist', 'file', '-f', demuxer, '-i', sourcePath, '-frames:v', '1', '-f', 'null', '-'], { inputs: [sourcePath], timeoutMs: TIMEOUTS.verify });
    } catch (error) {
      if (error.code === 'processor_failed') throw new MediaError('corrupt_image');
      throw error;
    }
    return true;
  }

  async #jpegLadder({ inputArgs, inputs, filters, outputPath, timeoutMs }) {
    const outputDir = path.dirname(outputPath);
    const logical = `/out/${path.basename(outputPath)}`;
    for (const quality of [3, 5, 8, 12, 18]) {
      await fsp.rm(outputPath, { force: true });
      await this.runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...inputArgs, '-frames:v', '1',
        '-vf', filters.join(','), '-c:v', 'mjpeg', '-q:v', String(quality), ...SAFE_OUT, '-f', 'image2', logical], { inputs, outputDir, timeoutMs });
      const stat = await fsp.stat(outputPath).catch(() => null);
      if (!stat) return null;
      if (stat.size <= LIMITS.poster.maxBytes) return stat.size;
    }
    throw new MediaError('poster_too_large');
  }

  async renderImage({ sourcePath, facts, crop, outputPath }) {
    const demuxer = IMAGE_DEMUXERS[facts.format];
    const filters = [...ORIENT_FILTERS[facts.orientation || 1], cropPixels(crop, facts.width, facts.height),
      `scale=${LIMITS.poster.width}:${LIMITS.poster.height}:flags=lanczos`, 'format=yuvj420p'];
    const bytes = await this.#jpegLadder({ inputArgs: ['-noautorotate', '-protocol_whitelist', 'file', '-f', demuxer, '-i', sourcePath], inputs: [sourcePath], filters, outputPath, timeoutMs: TIMEOUTS.image });
    if (!bytes) throw new MediaError('missing_output');
    return { width: LIMITS.poster.width, height: LIMITS.poster.height, bytes, mime_type: 'image/jpeg', sha256: await sha256File(outputPath) };
  }

  async #frame({ sourcePath, demuxer, facts, timeMs, crop, outputPath }) {
    const filters = [cropPixels(crop, facts.width, facts.height), `scale=${LIMITS.poster.width}:${LIMITS.poster.height}:flags=lanczos`, 'format=yuvj420p'];
    const base = ['-protocol_whitelist', 'file', '-f', demuxer];
    let bytes = await this.#jpegLadder({ inputArgs: ['-ss', seconds(timeMs), ...base, '-i', sourcePath], inputs: [sourcePath], filters, outputPath, timeoutMs: TIMEOUTS.frame });
    if (!bytes) {
      // Near EOF an exact seek can land past the last decodable frame: take the
      // last frame of the preceding half second instead.
      const start = Math.max(0, timeMs - 500);
      bytes = await this.#jpegLadder({ inputArgs: ['-ss', seconds(start), '-t', '0.6', ...base, '-i', sourcePath, '-update', '1'], inputs: [sourcePath], filters, outputPath, timeoutMs: TIMEOUTS.frame });
    }
    if (!bytes) throw new MediaError('frame_unavailable');
    return { width: LIMITS.poster.width, height: LIMITS.poster.height, bytes, mime_type: 'image/jpeg', sha256: await sha256File(outputPath) };
  }

  async #describeVideo(file, role) {
    const json = await this.#probeJson(file, 'mov');
    const video = json?.streams?.find((s) => s.codec_type === 'video');
    if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p') throw new MediaError('invalid_output');
    const stat = await fsp.stat(file);
    return {
      role, path: file, mime_type: 'video/mp4', width: video.width, height: video.height,
      duration_ms: Math.round(Number(json.format.duration) * 1000),
      has_audio: Boolean(json.streams.find((s) => s.codec_type === 'audio')),
      bytes: stat.size, sha256: await sha256File(file), fast_start: await isFastStart(file),
    };
  }

  async #encodeLadder({ args, inputs, outputPath, rungs, maxBytes, timeoutMs, tooLarge }) {
    for (const [crf, maxrate] of rungs) {
      await fsp.rm(outputPath, { force: true });
      await this.runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args(crf, maxrate), `/out/${path.basename(outputPath)}`],
        { inputs, outputDir: path.dirname(outputPath), timeoutMs });
      const stat = await fsp.stat(outputPath).catch(() => null);
      if (!stat) throw new MediaError('missing_output');
      if (stat.size <= maxBytes) return;
    }
    throw new MediaError(tooLarge);
  }

  async renderPreview({ sourcePath, demuxer, facts, startMs, endMs, crop, outputPath }) {
    const cropFilter = cropPixels(crop, facts.width, facts.height);
    const cropWidth = Math.round(crop.width * facts.width);
    const width = even(Math.min(LIMITS.preview.maxLongEdge, cropWidth));
    const height = even(width * 9 / 16);
    const filters = [cropFilter, `scale=${width}:${height}:flags=bicubic`, ...(facts.fps > LIMITS.preview.maxFps ? [`fps=${LIMITS.preview.maxFps}`] : []), 'format=yuv420p'];
    await this.#encodeLadder({
      args: (crf, maxrate) => ['-ss', seconds(startMs), '-t', seconds(endMs - startMs), '-protocol_whitelist', 'file', '-f', demuxer, '-i', sourcePath,
        '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main',
        '-crf', String(crf), '-maxrate', maxrate, '-bufsize', '3000k', '-movflags', '+faststart', ...SAFE_OUT, '-f', 'mp4'],
      inputs: [sourcePath], outputPath, rungs: [[28, '1500k'], [32, '1000k'], [36, '600k']], maxBytes: LIMITS.preview.maxBytes,
      timeoutMs: TIMEOUTS.preview, tooLarge: 'preview_too_large',
    });
    return this.#describeVideo(outputPath, 'preview');
  }

  async renderInstruction({ sourcePath, demuxer, facts, outputPath }) {
    const scale = Math.min(1, LIMITS.instruction.maxLongEdge / Math.max(facts.width, facts.height));
    const width = even(facts.width * scale);
    const height = even(facts.height * scale);
    const filters = [`scale=${width}:${height}:flags=bicubic`, ...(facts.fps > LIMITS.instruction.maxFps ? [`fps=${LIMITS.instruction.maxFps}`] : []), 'format=yuv420p'];
    const audio = facts.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2'] : ['-an'];
    await this.#encodeLadder({
      args: (crf, maxrate) => ['-protocol_whitelist', 'file', '-f', demuxer, '-i', sourcePath, '-map', '0:v:0', ...audio, '-sn', '-dn',
        '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-crf', String(crf),
        '-maxrate', maxrate, '-bufsize', '3000k', '-movflags', '+faststart', ...SAFE_OUT, '-f', 'mp4'],
      inputs: [sourcePath], outputPath, rungs: [[26, '1500k'], [30, '1000k'], [34, '700k']], maxBytes: LIMITS.instruction.maxBytes,
      timeoutMs: TIMEOUTS.instruction, tooLarge: 'instruction_too_large',
    });
    return this.#describeVideo(outputPath, 'instruction');
  }

  // Renders every video-derived output the recipe asks for.
  async renderVideo({ sourcePath, facts, outputDir, recipe, container = 'mp4' }) {
    const demuxer = VIDEO_DEMUXERS[container] || 'mov';
    const outputs = [];
    const posterCrop = recipe.poster_crop || centeredCrop(facts.width, facts.height);
    if (recipe.poster_mode === 'video_frame') {
      const file = path.join(outputDir, 'poster.jpg');
      outputs.push({ role: 'poster', path: file, ...(await this.#frame({ sourcePath, demuxer, facts, timeMs: recipe.poster_frame_ms, crop: posterCrop, outputPath: file })) });
    }
    if (recipe.end_frame_ms !== null && recipe.end_frame_ms !== undefined) {
      const file = path.join(outputDir, 'end_frame.jpg');
      outputs.push({ role: 'end_frame', path: file, ...(await this.#frame({ sourcePath, demuxer, facts, timeMs: recipe.end_frame_ms, crop: recipe.end_frame_crop || posterCrop, outputPath: file })) });
    }
    if (recipe.preview_start_ms !== null && recipe.preview_start_ms !== undefined) {
      const crop = recipe.preview_crop || (recipe.poster_mode === 'video_frame' ? posterCrop : centeredCrop(facts.width, facts.height));
      outputs.push(await this.renderPreview({ sourcePath, demuxer, facts, startMs: recipe.preview_start_ms, endMs: recipe.preview_end_ms, crop, outputPath: path.join(outputDir, 'preview.mp4') }));
    }
    if (recipe.include_instruction) {
      outputs.push(await this.renderInstruction({ sourcePath, demuxer, facts, outputPath: path.join(outputDir, 'instruction.mp4') }));
    }
    return outputs;
  }

  // Coach scrubbing fallback when a browser cannot decode the source (e.g.
  // HEVC): one full-frame still at the requested time, never stored.
  async renderFramePreview({ sourcePath, facts, timeMs, outputPath, container = 'mp4' }) {
    const demuxer = VIDEO_DEMUXERS[container] || 'mov';
    const full = { x: 0, y: 0, width: 1, height: 1 };
    const filters = [cropPixels(full, facts.width, facts.height), `scale=w=640:h=640:force_original_aspect_ratio=decrease`, 'format=yuvj420p'];
    const bytes = await this.#jpegLadder({ inputArgs: ['-ss', seconds(timeMs), '-protocol_whitelist', 'file', '-f', demuxer, '-i', sourcePath], inputs: [sourcePath], filters, outputPath, timeoutMs: TIMEOUTS.frame });
    if (!bytes) throw new MediaError('frame_unavailable');
    return { bytes };
  }
}

module.exports = {
  FfmpegMediaProcessor, DockerToolRunner, NativeToolRunner, PROCESSOR_IMAGE, PROCESSOR_VERSION, processorAvailable,
  cropPixels, centeredCrop, isFastStart,
};
