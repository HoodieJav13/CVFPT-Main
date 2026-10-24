#!/usr/bin/env node
// Renders the derivative set used by the paired visual review with the REAL
// pinned processor from the synthetic fixtures (no server, no database):
// posters/end still (640x360 JPEG), a 2 s silent preview, a full instruction
// MP4 and escaped WebVTT captions. Output + sha256 manifest go to the
// gitignored .exercise-media-local/visual-assets directory.
//   node backend/scripts/render-exercise-media-visual-assets.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { FfmpegMediaProcessor, DockerToolRunner, PROCESSOR_IMAGE, PROCESSOR_VERSION } = require('../src/services/exerciseMedia/ffmpegProcessor');
const { sniffImage, captionsToWebVtt } = require('../src/lib/exerciseMedia/validation');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, '.exercise-media-local/fixtures');
const OUT = path.join(ROOT, '.exercise-media-local/visual-assets');
const full = { x: 0, y: 0, width: 1, height: 1 };

async function main() {
  if (!fs.existsSync(path.join(FIXTURES, 'fixtures-manifest.json'))) {
    const generated = spawnSync(process.execPath, [path.join(__dirname, 'generate-exercise-media-fixtures.cjs'), FIXTURES], { stdio: 'inherit' });
    if (generated.status !== 0) throw new Error('fixture generation failed');
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const processor = new FfmpegMediaProcessor({ runner: new DockerToolRunner({ image: PROCESSOR_IMAGE }) });
  const image = async (name, file, crop) => {
    const source = path.join(FIXTURES, file);
    const facts = sniffImage(fs.readFileSync(source));
    await processor.renderImage({ sourcePath: source, facts, crop, outputPath: path.join(OUT, name) });
  };
  await image('goblet-poster.jpg', 'goblet-squat-photo.jpg', full);
  await image('split-poster.jpg', 'split-squat-portrait.jpg', { x: 0, y: 0.1, width: 1, height: (1080 * 9 / 16) / 1350 });
  await image('row-poster.jpg', 'band-row-thumbnail.png', full);
  const row = path.join(FIXTURES, 'band-row.mp4');
  const rowFacts = await processor.probe({ sourcePath: row, container: 'mp4' });
  const rowDir = fs.mkdtempSync(path.join(OUT, '.row-'));
  const rowOut = await processor.renderVideo({ sourcePath: row, facts: rowFacts, outputDir: rowDir, recipe: { poster_mode: 'uploaded_image', preview_start_ms: 1000, preview_end_ms: 3000, preview_crop: full, include_instruction: true } });
  for (const output of rowOut) fs.renameSync(output.path, path.join(OUT, `row-${output.role}.mp4`));
  fs.rmSync(rowDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, 'row-captions.vtt'), captionsToWebVtt([{ start_ms: 0, end_ms: 2500, text: 'Synthetic caption one' }, { start_ms: 2500, end_ms: 5500, text: 'Synthetic caption two' }], 'en'));
  const plank = path.join(FIXTURES, 'plank.webm');
  const plankFacts = await processor.probe({ sourcePath: plank, container: 'webm' });
  const plankDir = fs.mkdtempSync(path.join(OUT, '.plank-'));
  const plankOut = await processor.renderVideo({ sourcePath: plank, facts: plankFacts, outputDir: plankDir, container: 'webm', recipe: { poster_mode: 'video_frame', poster_frame_ms: 300, poster_crop: full, end_frame_ms: 4900, end_frame_crop: full } });
  for (const output of plankOut) fs.renameSync(output.path, path.join(OUT, `plank-${output.role === 'end_frame' ? 'end' : output.role}.jpg`));
  fs.rmSync(plankDir, { recursive: true, force: true });
  const files = fs.readdirSync(OUT).filter((name) => !name.startsWith('.')).sort().map((name) => {
    const bytes = fs.readFileSync(path.join(OUT, name));
    return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  fs.writeFileSync(path.join(OUT, 'visual-assets-manifest.json'), `${JSON.stringify({ schema_version: 1, processor: { image: PROCESSOR_IMAGE, version: PROCESSOR_VERSION }, source: 'synthetic fixtures (fixtures-manifest.json)', files }, null, 2)}\n`);
  console.log(`rendered ${files.length} visual assets into ${path.relative(ROOT, OUT)}`);
}

main().catch((error) => { console.error('visual asset rendering failed', error.code || error.message); process.exitCode = 1; });
