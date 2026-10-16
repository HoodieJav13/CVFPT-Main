#!/usr/bin/env node
// Builds docs/exercise-guides/visual-review/{manifest.json,index.html} from the
// paired capture's per-variant metric files. Every image is re-hashed and must
// match its capture record; an unreferenced or missing image fails the build.
//   node scripts/exercise-guides/build-visual-review.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const METRICS = path.join(ROOT, '.exercise-media-local/evidence/guides-visual-metrics');
const ASSETS = path.join(ROOT, '.exercise-media-local/guides-visual-assets/manifest.json');
const OUT = path.join(ROOT, 'docs/exercise-guides/visual-review');
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const read = (variant) => JSON.parse(fs.readFileSync(path.join(METRICS, `${variant}.json`), 'utf8'));
const runs = { baseline: read('baseline'), proposed: read('proposed') };
const entries = [...runs.baseline.manifest, ...runs.proposed.manifest];
const unmocked = [...runs.baseline.unmocked, ...runs.proposed.unmocked];
if (unmocked.length) throw new Error(`capture hit unmocked requests: ${unmocked.join(', ')}`);
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

// The tracker card: same slot, no layout shift, nothing from the provider.
const layout = VIEWPORTS.map(([width, height]) => {
  const base = find('tracker-top', 'baseline', width, height).metrics;
  const next = find('tracker-top', 'proposed', width, height).metrics;
  return {
    viewport: `${width}x${height}`,
    first_set_input_top_px: { baseline: base.firstSetInput.y, proposed: next.firstSetInput.y },
    control_dock_top_px: { baseline: base.dock.y, proposed: next.dock.y },
    document_width_px: { baseline: base.scrollWidth, proposed: next.scrollWidth },
    provider_requests_before_play: next.providerRequests,
  };
});
const players = entries.filter((entry) => entry.metrics.player).map((entry) => ({ state: entry.state, viewport: `${entry.viewport.width}x${entry.viewport.height}`, player: [entry.metrics.player.width, entry.metrics.player.height], document_width: entry.metrics.scrollWidth }));

const SECTIONS = [
  { state: 'tracker-top', title: 'Active exercise in the workout tracker', paired: true },
  { state: 'tracker-demo-focus', title: 'Keyboard focus on View demo', paired: false, against: 'tracker-top' },
  { state: 'demo-dialog-facade', title: 'Demo dialog before Play (new surface)', paired: false },
  { state: 'demo-dialog-player', title: 'Demo dialog after Play (stub player)', paired: false },
  { state: 'tracker-external-card', title: 'Generic external link card', paired: true },
  { state: 'tracker-long-name', title: 'Long name, legacy YouTube link, no photo', paired: true },
  { state: 'demo-dialog-loading', title: 'Player state: slow to load', single: true },
  { state: 'demo-dialog-error-150', title: 'Player state: embedding refused (101/150)', single: true },
  { state: 'demo-dialog-limited', title: 'Player state: player script blocked', single: true },
  { state: 'demo-dialog-photo-unavailable', title: 'Player state: photo link expired', single: true },
  { state: 'history-detail', title: 'Completed workout detail', paired: true },
  { state: 'history-demo-dialog', title: 'History demo dialog (labelled current demo)', paired: false },
  { state: 'client-programs', title: 'Client plan view exercise list', paired: true },
  { state: 'client-programs-dialog', title: 'Demo dialog from the plan view', paired: false },
  { state: 'coach-workout-library-demo', title: 'Coach workout editor: library demo (inherit)', paired: true },
  { state: 'coach-workout-custom-demo', title: 'Coach workout editor: custom link (override)', paired: true },
  { state: 'coach-workout-legacy-demo', title: 'Coach workout editor: legacy link', paired: true },
  { state: 'coach-quick-demo', title: 'Coach Quick session: demo choice under More', paired: true },
  { state: 'coach-media-photos', title: 'Media editor: photo-first draft', paired: true },
  { state: 'coach-still-confirmed', title: 'Media editor: still from a local clip', paired: false },
  { state: 'refine-zoom200-player', title: 'Refinement check: 200% zoom player', single: true },
  { state: 'refine-keyboard-short', title: 'Refinement check: short keyboard viewport', single: true },
];
const covered = new Set(SECTIONS.map((section) => section.state));
const uncovered = [...new Set(entries.map((entry) => entry.state))].filter((state) => !covered.has(state));
if (uncovered.length) throw new Error(`states without a section: ${uncovered.join(', ')}`);
const assets = JSON.parse(fs.readFileSync(ASSETS, 'utf8'));

const LIMITATIONS = [
  'Rendered by Playwright 1.61.1 with Chromium headless shell 149.0.7827.55 only. WebKit is not in the local browser cache, so Safari/iOS rendering is not verified; no physical phone was used.',
  'Every YouTube host is routed to a deterministic stub. The "player" in these images is a labelled synthetic page ("Synthetic embed stub: not YouTube"), not Google\'s player; real provider behavior is covered separately by the headless provider proof and is not shown here.',
  'Both variants run against identical intercepted synthetic API responses (page.route). The posters were rendered by the real ImageOnlyProcessor from the synthetic photo fixtures. These captures prove rendered frontend behavior only; authorization, server validation, storage and processing are proven by the backend, SQL and real-local integration lanes.',
  'The baseline ignores the new `demo` and `video_link_mode` fields, so it renders every link as External video and copies the library link into workout rows, exactly as released code does.',
  'New surfaces (demo dialog states, still selection, refinement checks) have no baseline equivalent; they are shown proposed-only and say so.',
  'All media is synthetic test-pattern content labelled "SYNTHETIC TEST MEDIA — NOT INSTRUCTION"; YouTube ids are synthetic. No exercise demonstration accuracy is shown or certified.',
  'Cold visibility and visual/content acceptance are not self-certified; they await owner review.',
  'Two consecutive full captures at the final code head were 79/84 byte-identical; the other five differed by at most 767 pixels, confined to decoded media (poster downscaling, a video frame) and a one-pixel focus-ring row. No layout differed.',
  sources.proposed.tracked_changes.length
    ? `The proposed capture ran on commit ${sources.proposed.commit.slice(0, 7)} with uncommitted tracked changes limited to capture tooling (${sources.proposed.tracked_changes.join(', ')}); no product source differed.`
    : `The proposed capture ran on clean commit ${sources.proposed.commit.slice(0, 7)}; the capture spec/config were not yet committed and are product-neutral test tooling.`,
];

const manifest = {
  schema_version: 1,
  generated_by: 'scripts/exercise-guides/build-visual-review.mjs',
  capture: {
    tool: 'frontend/e2e/exercise-guides-visual.capture.mjs via frontend/playwright.exercise-guides-visual.config.mjs',
    browser: 'Chromium headless shell 149.0.7827.55 (Playwright 1.61.1)',
    emulation: 'reduced motion; app dark theme; device scale factor 1',
    data: 'identical intercepted synthetic responses for both variants; YouTube hosts stubbed; fictional actors only',
    posters: assets,
  },
  sources: {
    baseline: { ...sources.baseline, note: 'pinned f3c063c, rendered from a disposable local clone in the session scratchpad' },
    proposed: sources.proposed,
  },
  direction: {
    classification: 'Not treated as a new visual direction: View demo takes the exact slot, left edge and type of the released External video link; the dialog reuses the accepted instruction-dialog pattern; the coach control is a standard fieldset. No bold probe was made.',
    owner_decision: 'pending — owner visual/content acceptance remains a release gate',
    tracker_layout: layout,
    player_sizes: players,
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

const layoutRows = layout.map((v) => `<tr><td>${v.viewport}</td><td>${v.first_set_input_top_px.baseline} / ${v.first_set_input_top_px.proposed}</td><td>${v.control_dock_top_px.baseline} / ${v.control_dock_top_px.proposed}</td><td>${v.document_width_px.baseline} / ${v.document_width_px.proposed}</td><td>${v.provider_requests_before_play}</td></tr>`).join('');
const playerRows = players.map((p) => `<tr><td>${esc(p.state)}</td><td>${p.viewport}</td><td>${p.player.join('×')}</td><td>${p.document_width}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exercise guides visual review</title>
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
table{border-collapse:collapse;width:100%;font-size:13px;min-width:520px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
nav ul{display:flex;flex-wrap:wrap;gap:6px 14px;padding:0;margin:8px 0;list-style:none;font-size:13px}
ul.limits li{margin:4px 0}
@media (max-width:640px){.row{grid-template-columns:minmax(0,1fr)}}
</style>
</head>
<body>
<main>
<h1>Exercise guides — actual before and after</h1>
<p>Paired renders of the pinned baseline and the local Photo + YouTube guides build under identical synthetic data, viewport and action state, at 320px and 390px phones plus a 1440px desktop.</p>
<p class="muted">Baseline <code>${esc(sources.baseline.commit)}</code> (tree <code>${esc(sources.baseline.tree)}</code>) · Proposed <code>${esc(sources.proposed.commit)}</code> (tree <code>${esc(sources.proposed.tree)}</code>) · ${esc(manifest.capture.browser)} · ${esc(manifest.capture.emulation)} · ${entries.length} images, hashes in <a href="manifest.json">manifest.json</a></p>
<p class="hold">LOCAL REVIEW ONLY — nothing pushed, published or deployed. Visual/content acceptance and cold visibility await owner review.</p>
<nav aria-label="Sections"><ul><li><a href="#direction">Direction and measurements</a></li>${SECTIONS.map((section) => `<li><a href="#${esc(section.state)}">${esc(section.title)}</a></li>`).join('')}</ul></nav>
<section id="direction">
<h2>Direction and measurements</h2>
<p>${esc(manifest.direction.classification)} Owner decision: ${esc(manifest.direction.owner_decision)}.</p>
<div class="table-wrap"><table><thead><tr><th>Viewport</th><th>First set input top (base / proposed)</th><th>Control dock top (base / proposed)</th><th>Document width (base / proposed)</th><th>Provider requests before Play</th></tr></thead><tbody>${layoutRows}</tbody></table></div>
<div class="table-wrap"><table><thead><tr><th>State</th><th>Viewport</th><th>Player (px)</th><th>Document width</th></tr></thead><tbody>${playerRows}</tbody></table></div>
<p class="muted">Positions are CSS px from the viewport top at the same scroll position. The player is never smaller than 200×200 and no state widens the document.</p>
</section>
${sectionHtml}
<section id="limitations"><h2>Known limitations</h2><ul class="limits">${LIMITATIONS.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></section>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`guides visual review: ${entries.length} images verified, manifest.json + index.html written`);
