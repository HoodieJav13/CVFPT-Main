#!/usr/bin/env node
// Generates the LOCAL synthetic exercise-media fixtures: abstract geometric
// shapes plus a visible "SYNTHETIC TEST MEDIA — NOT INSTRUCTION" label. No
// people, no recordings, no third-party content and no exercise instruction;
// the exercise names are plumbing identities only. Deterministic for a given
// seed, font set and pinned processor image; hashes go in the manifest.
//   node backend/scripts/generate-exercise-media-fixtures.cjs <output-dir>
//   node backend/scripts/generate-exercise-media-fixtures.cjs <output-dir> --images-only
//     (photos mode: synthetic images only, no Docker/FFmpeg processor needed)
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { DockerToolRunner, PROCESSOR_IMAGE, PROCESSOR_VERSION } = require('../src/services/exerciseMedia/ffmpegProcessor');

const SEED = 20261015;
const LABEL = 'SYNTHETIC TEST MEDIA — NOT INSTRUCTION';
const RIGHTS = 'Generated locally by this script from geometric shapes and a synthetic label; owned by the project; no third-party content, no people, not exercise instruction.';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function scene(width, height, identity, { seed, tint }) {
  const random = rng(seed);
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#1d1a17'; g.fillRect(0, 0, width, height);
  for (let i = 0; i < 6; i += 1) {
    g.fillStyle = `hsla(${(tint + i * 23) % 360}, 45%, ${30 + random() * 25}%, 0.9)`;
    g.fillRect(random() * width * 0.8, random() * height * 0.8, width * (0.1 + random() * 0.2), height * (0.1 + random() * 0.2));
  }
  g.strokeStyle = '#f2efe9'; g.lineWidth = Math.max(4, width / 160);
  g.strokeRect(width * 0.04, height * 0.04, width * 0.92, height * 0.92);
  labelText(g, width, height, identity);
  return canvas;
}

function labelText(g, width, height, identity) {
  const size = Math.max(14, Math.round(Math.min(width, height) / 18));
  g.fillStyle = 'rgba(0,0,0,0.65)';
  g.fillRect(0, height - size * 3.2, width, size * 3.2);
  g.fillStyle = '#ffd166'; g.font = `bold ${size}px Helvetica`;
  g.fillText(LABEL, size * 0.6, height - size * 1.8, width - size * 1.2);
  g.fillStyle = '#ffffff'; g.font = `${Math.round(size * 0.8)}px Helvetica`;
  g.fillText(identity, size * 0.6, height - size * 0.6, width - size * 1.2);
}

function overlayLabel(width, height, identity) {
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.strokeStyle = '#f2efe9'; g.lineWidth = Math.max(4, width / 160);
  g.strokeRect(width * 0.04, height * 0.04, width * 0.92, height * 0.92);
  labelText(g, width, height, identity);
  return canvas.toBuffer('image/png');
}

function shape(size, color) {
  const canvas = createCanvas(size, size);
  const g = canvas.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1d1a17'; g.fillRect(size * 0.3, size * 0.45, size * 0.4, size * 0.1);
  return canvas.toBuffer('image/png');
}

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
// Big-endian EXIF APP1 with Orientation and a GPS IFD (latitude ref only) —
// lets the pipeline prove orientation handling and metadata stripping.
function withExif(jpeg, { orientation = 1, gps = false }) {
  const entries = [[0x0112, 3, 1, orientation << 16]];
  if (gps) entries.push([0x8825, 4, 1, 8 + 2 + 12 * 2 + 4]);
  const ifd = Buffer.concat([u16(entries.length), ...entries.map(([t, ty, c, v]) => Buffer.concat([u16(t), u16(ty), u32(c), u32(v)])), u32(0)]);
  const gpsIfd = gps ? Buffer.concat([u16(1), u16(0x0001), u16(2), u32(2), Buffer.from('N\0\0\0'), u32(0)]) : Buffer.alloc(0);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from('MM'), u16(42), u32(8), ifd, gpsIfd]);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), u16(payload.length + 2), payload, jpeg.subarray(2)]);
}

async function encode(runner, outDir, name, { width, height, seconds, identity, fps = 24, codec = 'libx264', audio = false, seed, tint, extraOut = [] }) {
  const scratch = fs.mkdtempSync(path.join(outDir, '.gen-'));
  try {
    const label = path.join(scratch, 'label.png');
    const dot = path.join(scratch, 'dot.png');
    fs.writeFileSync(label, overlayLabel(width, height, identity));
    const size = Math.round(Math.min(width, height) / 4);
    fs.writeFileSync(dot, shape(size, `hsl(${tint}, 70%, 60%)`));
    const random = rng(seed);
    const speed = (2 + random()).toFixed(3);
    const inputs = ['-f', 'lavfi', '-i', `color=c=0x1d1a17:s=${width}x${height}:r=${fps}:d=${seconds}`, '-loop', '1', '-i', dot, '-loop', '1', '-i', label];
    if (audio) inputs.push('-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${seconds}`);
    const x = `(W-w)/2+(W-w)/2.4*sin(2*PI*t/${speed})`;
    const y = `(H-h)/2+(H-h)/3*cos(2*PI*t/${speed})`;
    const filter = `[0:v][1:v]overlay=x='${x}':y='${y}':shortest=1[m];[m][2:v]overlay=0:0:shortest=1,format=yuv420p[v]`;
    const codecArgs = codec === 'libvpx-vp9' ? ['-c:v', 'libvpx-vp9', '-b:v', '600k', '-deadline', 'good', '-cpu-used', '4'] : ['-c:v', codec, '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p'];
    const audioArgs = audio ? ['-map', '3:a', '-c:a', 'aac', '-b:a', '96k'] : [];
    await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', ...audioArgs,
      ...codecArgs, '-t', String(seconds), '-r', String(fps), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-threads', '1', ...extraOut, `/out/${name}`],
    { inputs: [dot, label], outputDir: outDir, timeoutMs: 180_000 });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  return path.join(outDir, name);
}

async function main() {
  const outDir = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) { console.error('usage: generate-exercise-media-fixtures.cjs <output-dir> [--images-only]'); process.exit(2); }
  const imagesOnly = process.argv.includes('--images-only');
  fs.mkdirSync(outDir, { recursive: true });
  const runner = imagesOnly ? null : new DockerToolRunner({ image: PROCESSOR_IMAGE });
  const files = [];
  const record = (file, meta) => {
    const bytes = fs.readFileSync(file);
    files.push({ name: path.basename(file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), rights_origin: RIGHTS, ...meta });
  };

  // 1. Synthetic Goblet Squat — photo only (JPEG with EXIF GPS that must be stripped).
  const goblet = path.join(outDir, 'goblet-squat-photo.jpg');
  fs.writeFileSync(goblet, withExif(scene(1600, 900, 'Synthetic Goblet Squat', { seed: SEED + 1, tint: 28 }).toBuffer('image/jpeg', 88), { gps: true }));
  record(goblet, { identity: 'Synthetic Goblet Squat', scenario: 'photo-only', mime: 'image/jpeg', width: 1600, height: 900 });
  const gobletWebp = path.join(outDir, 'goblet-squat-photo.webp');
  fs.writeFileSync(gobletWebp, scene(1280, 720, 'Synthetic Goblet Squat', { seed: SEED + 1, tint: 28 }).toBuffer('image/webp', 85));
  record(gobletWebp, { identity: 'Synthetic Goblet Squat', scenario: 'replace photo (static WebP)', mime: 'image/webp', width: 1280, height: 720 });

  // 2. Synthetic Split Squat — a different variant: portrait photo stored
  //    landscape with EXIF orientation 6 (rotate 90° CW to display).
  const portrait = scene(1080, 1350, 'Synthetic Split Squat', { seed: SEED + 2, tint: 190 });
  const stored = createCanvas(1350, 1080);
  const sg = stored.getContext('2d');
  sg.translate(0, 1080); sg.rotate(-Math.PI / 2); sg.drawImage(portrait, 0, 0);
  const split = path.join(outDir, 'split-squat-portrait.jpg');
  fs.writeFileSync(split, withExif(stored.toBuffer('image/jpeg', 88), { orientation: 6 }));
  record(split, { identity: 'Synthetic Split Squat', scenario: 'photo-only, EXIF-rotated portrait', mime: 'image/jpeg', width: 1080, height: 1350, exif_orientation: 6 });

  // 3. Synthetic Band Row — MP4 video plus a separate custom thumbnail.
  if (!imagesOnly) record(await encode(runner, outDir, 'band-row.mp4', { width: 1280, height: 720, seconds: 6, identity: 'Synthetic Band Row', seed: SEED + 3, tint: 140 }),
    { identity: 'Synthetic Band Row', scenario: 'video + custom poster', mime: 'video/mp4', width: 1280, height: 720, duration_ms: 6000 });
  const thumb = path.join(outDir, 'band-row-thumbnail.png');
  fs.writeFileSync(thumb, scene(1280, 720, 'Synthetic Band Row — custom thumbnail', { seed: SEED + 33, tint: 140 }).toBuffer('image/png'));
  record(thumb, { identity: 'Synthetic Band Row', scenario: 'custom poster image', mime: 'image/png', width: 1280, height: 720 });

  // 4. Synthetic Plank — WebM (VP9) used for paired start/end stills.
  if (!imagesOnly) record(await encode(runner, outDir, 'plank.webm', { width: 960, height: 540, seconds: 5, identity: 'Synthetic Plank', codec: 'libvpx-vp9', seed: SEED + 4, tint: 260 }),
    { identity: 'Synthetic Plank', scenario: 'start/end stills from video', mime: 'video/webm', width: 960, height: 540, duration_ms: 5000 });

  // 5. Synthetic Shuttle Walk — portrait MOV with a tone track (not narration).
  if (!imagesOnly) record(await encode(runner, outDir, 'shuttle-walk.mov', { width: 720, height: 1280, seconds: 6, identity: 'Synthetic Shuttle Walk', audio: true, seed: SEED + 5, tint: 330, extraOut: ['-f', 'mov'] }),
    { identity: 'Synthetic Shuttle Walk', scenario: 'video-frame poster + preview + full instruction with audio', mime: 'video/quicktime', width: 720, height: 1280, duration_ms: 6000 });

  // Replacement clip for the image-only → video path on the Goblet Squat identity.
  if (!imagesOnly) record(await encode(runner, outDir, 'goblet-squat-replacement.mp4', { width: 1280, height: 720, seconds: 4, identity: 'Synthetic Goblet Squat — added video', seed: SEED + 6, tint: 28 }),
    { identity: 'Synthetic Goblet Squat', scenario: 'image-only → add video later', mime: 'video/mp4', width: 1280, height: 720, duration_ms: 4000 });

  const manifest = {
    schema_version: 1, kind: 'exercise-media-synthetic-fixtures', seed: SEED, label: LABEL,
    generator: 'node backend/scripts/generate-exercise-media-fixtures.cjs <output-dir>',
    processor: imagesOnly ? { image: null, version: 'not used (images only)' } : { image: PROCESSOR_IMAGE, version: PROCESSOR_VERSION },
    images_only: imagesOnly,
    note: 'Plumbing fixtures only. Identity names are test labels, not validated coaching instruction; nothing here may be presented as an exercise demonstration.',
    files,
  };
  fs.writeFileSync(path.join(outDir, 'fixtures-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`generated ${files.length} synthetic fixtures in ${outDir}`);
}

main().catch((error) => { console.error('fixture generation failed', error.code || error.message); process.exitCode = 1; });
