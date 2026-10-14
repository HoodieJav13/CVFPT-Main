// Builds the compact comparison page (index.html) from manifest.json. Node built-ins only.
import { readFile, writeFile } from 'node:fs/promises';
const folder = new URL('.', import.meta.url).pathname;
const manifest = JSON.parse(await readFile(`${folder}manifest.json`, 'utf8'));
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const states = [...new Map(manifest.captures.map((c) => [c.state, c])).values()];
const pixelNotes = manifest.pixelComparison || {};
const cell = (capture) => capture
  ? `<figure><a href="${esc(capture.file)}"><img loading="lazy" src="${esc(capture.file)}" alt="${esc(`${capture.state} ${capture.viewport.width}px ${capture.version}`)}"></a><figcaption>${esc(capture.version)} · ${capture.image.width}×${capture.image.height} · <code>${capture.sha256.slice(0, 12)}</code></figcaption></figure>`
  : '<figure class="none"><p>No baseline: new-only state (there is no earlier quick-session screen).</p></figure>';
const sections = states.map((first) => {
  const rows = [320, 390, 1440].map((width) => {
    const of = (version) => manifest.captures.find((c) => c.state === first.state && c.viewport.width === width && c.version === version);
    const note = pixelNotes[`${first.state}@${width}`];
    return `<div class="row"><h3>${width}px${note ? ` <span class="note">${esc(note)}</span>` : ''}</h3><div class="pair">${cell(of('baseline'))}${cell(of('proposed'))}</div></div>`;
  }).join('');
  return `<section id="${esc(first.state)}"><h2>${esc(first.state)}</h2><p>${esc(first.caption)}</p>${rows}</section>`;
}).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quick sessions visual review</title>
<style>
:root { color-scheme: dark; --bg: #1b1916; --fg: #ece8e2; --muted: #a8a196; --line: #3a3530; --card: #24211d; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 8px; } h2 { font-size: 20px; margin: 40px 0 4px; } h3 { font-size: 14px; color: var(--muted); margin: 16px 0 8px; }
p, li { color: var(--muted); max-width: 72ch; } code { font-size: 12px; }
.meta { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
figure img { display: block; max-width: 100%; height: auto; max-height: 560px; margin: 0 auto; }
figcaption { font-size: 12px; color: var(--muted); margin-top: 6px; }
.none { display: grid; place-items: center; min-height: 120px; } .note { color: var(--fg); font-weight: 400; }
nav a { color: var(--fg); margin-right: 12px; font-size: 13px; }
@media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
</style></head><body><main>
<h1>Quick sessions: actual paired evidence</h1>
<div class="meta">
<p>Baseline <code>${esc(manifest.sources.baseline.sha)}</code> (left) vs proposed <code>${esc(manifest.sources.proposed.sha)}</code> (right). ${esc(manifest.fixture)} ${esc(manifest.theme)}.</p>
<p><strong>Classification:</strong> ${esc(manifest.classification)}</p>
<ul>${manifest.limitations.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
<p>${manifest.captures.length} viewport captures; hashes, dimensions, URLs and console results are in <a href="manifest.json">manifest.json</a>. Full-page context images are retained in the local review packet, not committed.</p>
</div>
<nav>${states.map((s) => `<a href="#${esc(s.state)}">${esc(s.state)}</a>`).join('')}</nav>
${sections}
</main></body></html>
`;
await writeFile(`${folder}index.html`, html);
console.log(`index.html: ${states.length} states`);
