#!/usr/bin/env node
// Builds docs/exercise-media/visual-review/{manifest.json,index.html} from the
// paired capture's per-variant metric files. Every image is re-hashed and must
// match its capture record; an unreferenced or missing image fails the build.
//   node scripts/exercise-media/build-visual-review.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const METRICS = path.join(ROOT, '.exercise-media-local/evidence/visual-metrics');
const OUT = path.join(ROOT, 'docs/exercise-media/visual-review');
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const read = (variant) => JSON.parse(fs.readFileSync(path.join(METRICS, `${variant}.json`), 'utf8'));
const entries = [...read('baseline'), ...read('proposed')];
for (const entry of entries) {
  const file = path.join(OUT, entry.file);
  if (!fs.existsSync(file)) throw new Error(`missing image ${entry.file}`);
  if (sha256(file) !== entry.sha256) throw new Error(`hash mismatch for ${entry.file}`);
}
const referenced = new Set(entries.map((entry) => entry.file));
const onDisk = fs.readdirSync(path.join(OUT, 'images')).filter((name) => name.endsWith('.png')).map((name) => `images/${name}`);
const stray = onDisk.filter((file) => !referenced.has(file));
if (stray.length) throw new Error(`unreferenced images: ${stray.join(', ')}`);

const sourceOf = (variant) => {
  const sources = new Set(entries.filter((entry) => entry.variant === variant).map((entry) => JSON.stringify(entry.source)));
  if (sources.size !== 1) throw new Error(`${variant} captures span ${sources.size} source states`);
  return JSON.parse([...sources][0]);
};
const sources = { baseline: sourceOf('baseline'), proposed: sourceOf('proposed') };
const find = (state, variant, width, height) => entries.find((entry) => entry.state === state && entry.variant === variant && entry.viewport.width === width && (!height || entry.viewport.height === height));
const VIEWPORTS = [[320, 740], [390, 844], [1440, 900]];

// Directional variants (docs/design-principles.md): compact default vs the
// bold "Larger" probe, as exact measured deltas against the actual baseline.
const variants = VIEWPORTS.map(([width, height]) => {
  const base = find('tracker-top', 'baseline', width, height).metrics;
  const compact = find('tracker-top', 'proposed', width, height).metrics;
  const larger = find('tracker-larger', 'proposed', width, height).metrics;
  return {
    viewport: `${width}x${height}`,
    slot: { compact: [compact.slot.width, compact.slot.height], larger: [larger.slot.width, larger.slot.height] },
    first_set_input_top_px: { baseline: base.firstSetInput.y, compact: compact.firstSetInput.y, larger: larger.firstSetInput.y },
    first_set_input_shift_px: { compact: compact.firstSetInput.y - base.firstSetInput.y, larger: larger.firstSetInput.y - base.firstSetInput.y },
    control_dock_top_px: { baseline: base.dock.y, compact: compact.dock.y, larger: larger.dock.y },
    document_width_px: { baseline: base.scrollWidth, compact: compact.scrollWidth, larger: larger.scrollWidth },
  };
});

const SECTIONS = [
  { state: 'tracker-top', title: 'Active exercise in the workout tracker', paired: true },
  { state: 'tracker-larger', title: 'Bold probe: the Larger slot on the same card', paired: false, against: 'tracker-top' },
  { state: 'tracker-video-card', title: 'Video exercise card (deferred until requested)', paired: true },
  { state: 'tracker-instruction-dialog', title: 'Full instruction (separate surface)', paired: false },
  { state: 'tracker-poster-failed', title: 'Poster failure fallback', paired: true },
  { state: 'history-detail', title: 'Completed workout detail', paired: true },
  { state: 'coach-library', title: 'Coach exercise library', paired: true },
  { state: 'coach-edit-exercise', title: 'Coach exercise edit dialog', paired: true },
  { state: 'coach-media-review', title: 'Media editor: review a ready draft', paired: false },
  { state: 'coach-media-review-attest', title: 'Media editor: explicit review attestations', paired: false },
  { state: 'coach-media-crop', title: 'Media editor: image-only crop', paired: false },
  { state: 'coach-media-video', title: 'Media editor: video selection', paired: false },
  { state: 'refine-zoom200', title: 'Refinement check: 200% zoom', paired: false, single: true },
  { state: 'refine-keyboard-short', title: 'Refinement check: short keyboard viewport', paired: false, single: true },
  { state: 'refine-data-saver', title: 'Refinement check: data saver + reduced motion', paired: false, single: true },
];
const covered = new Set(SECTIONS.map((section) => section.state));
const uncovered = [...new Set(entries.map((entry) => entry.state))].filter((state) => !covered.has(state));
if (uncovered.length) throw new Error(`states without a section: ${uncovered.join(', ')}`);

const LIMITATIONS = [
  'Rendered by Playwright 1.61.1 with Chromium headless shell 149.0.7827.55 only. WebKit is not in the local browser cache, so Safari/iOS rendering is not verified.',
  'Both variants run against identical intercepted synthetic API responses (page.route). The derivative bytes (posters, preview, instruction, captions) were rendered by the real pinned processor from the synthetic fixtures. These captures prove rendered frontend behavior only; authorization, server validation, storage and processing are proven by the backend, SQL and real-local integration lanes.',
  'The dark arc drawn over the instruction video frame is Chromium\'s native media-controls loading indicator in headless capture. It was captured after networkState=IDLE, readyState=HAVE_ENOUGH_DATA and seeking=false; it is not product UI.',
  'New surfaces (Larger probe, full instruction, media editor, refinement checks) have no baseline equivalent; they are shown proposed-only and say so.',
  'All media is synthetic test pattern content labelled "SYNTHETIC TEST MEDIA — NOT INSTRUCTION". No exercise demonstration accuracy is shown or certified.',
  'Cold visibility, the default footprint choice (compact vs Larger) and actual instruction accuracy are not self-certified; they require owner review.',
  sources.proposed.tracked_changes.length
    ? `The proposed capture ran on commit ${sources.proposed.commit.slice(0, 7)} with uncommitted tracked changes limited to capture tooling (${sources.proposed.tracked_changes.join(', ')}); no product source differed.`
    : `The proposed capture ran on a clean commit ${sources.proposed.commit.slice(0, 7)}.`,
  'Cards are framed with the card top just below the app header; coach dialogs are scrolled to the named section. Bottom navigation and the workout control dock are kept in frame.',
];

const manifest = {
  schema_version: 1,
  generated_by: 'scripts/exercise-media/build-visual-review.mjs',
  capture: {
    tool: 'frontend/e2e/exercise-media-visual.capture.mjs via frontend/playwright.exercise-media-visual.config.mjs',
    browser: 'Chromium headless shell 149.0.7827.55 (Playwright 1.61.1)',
    emulation: 'reduced motion; app dark theme; device scale factor 1',
    data: 'identical intercepted synthetic responses for both variants; fictional actors only',
  },
  sources: {
    baseline: { ...sources.baseline, note: 'prepared released baseline, rendered from a disposable clone under the task folder' },
    proposed: sources.proposed,
  },
  directional_variants: {
    classification: 'Treated as a genuine visual-direction decision (new inline media footprint inside the workout tracker); resolved toward triggering the variant process.',
    baseline_compliant: 'Compact default: 96x54 px poster slot beside the cues; Larger is an opt-in per-card control.',
    bold_probe: 'Larger: bounded full-width 16:9 slot on the same card.',
    owner_decision: 'pending — the owner picks the default footprint',
    measurements: variants,
  },
  limitations: LIMITATIONS,
  images: entries.map(({ file, state, variant, viewport, sha256: hash, bytes, note, metrics }) => ({ file, state, variant, viewport, sha256: hash, bytes, note, metrics })),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const figure = (entry, label) => entry
  ? `<figure><figcaption>${esc(label)} · ${entry.viewport.width}×${entry.viewport.height}</figcaption><a href="${esc(entry.file)}"><img src="${esc(entry.file)}" alt="${esc(`${label}: ${entry.note}`)}" loading="lazy" width="${entry.viewport.width}" height="${entry.viewport.height}"></a><code>sha256 ${entry.sha256.slice(0, 16)}…</code></figure>`
  : `<figure class="none"><figcaption>${esc(label)}</figcaption><p>No equivalent surface in the baseline.</p></figure>`;

const sectionHtml = SECTIONS.map((section) => {
  const sample = entries.find((entry) => entry.state === section.state);
  const rows = section.single
    ? entries.filter((entry) => entry.state === section.state).map((entry) => `<div class="row single">${figure(entry, 'Proposed')}</div>`)
    : VIEWPORTS.map(([width, height]) => {
      const proposed = find(section.state, 'proposed', width, height);
      const baseline = section.paired ? find(section.state, 'baseline', width, height) : (section.against ? find(section.against, 'baseline', width, height) : null);
      const baseLabel = section.against ? 'Baseline (same card)' : 'Baseline';
      return `<div class="row${width > 1000 ? ' wide' : ''}">${figure(baseline, baseLabel)}${figure(proposed, 'Proposed')}</div>`;
    });
  return `<section id="${esc(section.state)}"><h2>${esc(section.title)}</h2><p>${esc(sample.note)}</p>${rows.join('')}</section>`;
}).join('\n');

const deltaRows = variants.map((v) => `<tr><td>${v.viewport}</td><td>${v.slot.compact.join('×')}</td><td>${v.slot.larger.join('×')}</td><td>${v.first_set_input_top_px.baseline}</td><td>${v.first_set_input_top_px.compact} (+${v.first_set_input_shift_px.compact})</td><td>${v.first_set_input_top_px.larger} (+${v.first_set_input_shift_px.larger})</td><td>${v.control_dock_top_px.baseline} / ${v.control_dock_top_px.compact} / ${v.control_dock_top_px.larger}</td><td>${v.document_width_px.baseline} / ${v.document_width_px.compact} / ${v.document_width_px.larger}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exercise media visual review</title>
<style>
:root{--bg:#f4f2ef;--surface:#ffffff;--text:#1f1b17;--muted:#5d554d;--line:#d9d2c9;--accent:#126477;--hold:#8a4b00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171513;--surface:#211e1b;--text:#f2efe9;--muted:#b3aa9f;--line:#3a342e;--accent:#5cc3d6;--hold:#e3a95b}}
:root[data-theme="dark"]{--bg:#171513;--surface:#211e1b;--text:#f2efe9;--muted:#b3aa9f;--line:#3a342e;--accent:#5cc3d6;--hold:#e3a95b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:0 0 4px}
p{margin:6px 0}.muted{color:var(--muted);font-size:13px}.hold{color:var(--hold);font-weight:600}
a{color:var(--accent)}code{font-size:11px;color:var(--muted);overflow-wrap:anywhere}
section{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;margin:18px 0}
.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px;align-items:start}
.row.single{grid-template-columns:minmax(0,1fr)}
figure{margin:0;display:flex;flex-direction:column;gap:6px;min-width:0}
figcaption{font-size:13px;font-weight:600}
figure img{display:block;width:auto;max-width:100%;height:auto;max-height:620px;object-fit:contain;object-position:left top;border:1px solid var(--line);border-radius:6px;background:#0f0d0c}
.row.wide figure img{max-height:none;width:100%}
figure.none p{border:1px dashed var(--line);border-radius:6px;padding:24px 12px;color:var(--muted);text-align:center;margin:0}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
nav ul{display:flex;flex-wrap:wrap;gap:6px 14px;padding:0;margin:8px 0;list-style:none;font-size:13px}
ul.limits li{margin:4px 0}
@media (max-width:640px){.row{grid-template-columns:minmax(0,1fr)}}
</style>
</head>
<body>
<main>
<h1>Exercise media — actual before and after</h1>
<p>Paired renders of the released baseline and the local exercise-media build under identical synthetic data, viewport and action state, at 320px and 390px phones plus a 1440px desktop sanity check.</p>
<p class="muted">Baseline <code>${esc(sources.baseline.commit)}</code> (tree <code>${esc(sources.baseline.tree)}</code>) · Proposed <code>${esc(sources.proposed.commit)}</code> (tree <code>${esc(sources.proposed.tree)}</code>) · ${esc(manifest.capture.browser)} · ${esc(manifest.capture.emulation)} · ${entries.length} images, hashes in <a href="manifest.json">manifest.json</a></p>
<p class="hold">LOCAL REVIEW ONLY — nothing pushed, published or deployed. The default footprint, cold visibility and instruction accuracy await owner review.</p>
<nav aria-label="Sections"><ul>${SECTIONS.map((section) => `<li><a href="#${esc(section.state)}">${esc(section.title)}</a></li>`).join('')}</ul></nav>
<section id="variants">
<h2>Directional variants: compact default vs Larger probe</h2>
<p>${esc(manifest.directional_variants.classification)}</p>
<p><strong>Baseline / compliant:</strong> ${esc(manifest.directional_variants.baseline_compliant)} <strong>Bold probe:</strong> ${esc(manifest.directional_variants.bold_probe)} Owner decision: ${esc(manifest.directional_variants.owner_decision)}.</p>
<div class="table-wrap"><table><thead><tr><th>Viewport</th><th>Compact slot (px)</th><th>Larger slot (px)</th><th>First set input top, baseline</th><th>Compact (shift)</th><th>Larger (shift)</th><th>Control dock top (base / compact / larger)</th><th>Document width (base / compact / larger)</th></tr></thead><tbody>${deltaRows}</tbody></table></div>
<p class="muted">Positions are CSS px from the viewport top at the same scroll position. The control dock does not move; no variant widens the document.</p>
</section>
${sectionHtml}
<section id="limitations"><h2>Known limitations</h2><ul class="limits">${LIMITATIONS.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></section>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`visual review: ${entries.length} images verified, manifest.json + index.html written`);
