// Warm-graphite surface guard (owner decision 2026-08-13): every neutral
// surface token lives at hue 25–45 with saturation ≤ 20% at low lightness —
// values arithmetically incapable of reading navy (hue 200–260) or green
// (hue 100–160). This test parses the token source directly so a future
// edit cannot drift the ramp back toward either; accents (--primary teal,
// --gold, --success, --destructive, charts) are deliberately unconstrained.
// Reading across the deploy boundary is fine here: tests run from the
// monorepo checkout, never from a deployed bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../frontend/src/index.css'), 'utf8');

function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  assert.ok(match, `token --${name} not found as an H S% L% triplet`);
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

const WARM_HUE = [25, 45];
const inWarmBand = ({ h }) => h >= WARM_HUE[0] && h <= WARM_HUE[1];

test('dark surface tokens sit in the warm band with capped saturation', () => {
  for (const name of ['background', 'card', 'popover', 'secondary', 'muted', 'accent', 'border', 'input']) {
    const value = token(name);
    assert.ok(inWarmBand(value), `--${name} hue ${value.h} outside warm band ${WARM_HUE.join('–')}`);
    assert.ok(value.s <= 20, `--${name} saturation ${value.s}% exceeds the 20% cap`);
    assert.ok(value.l <= 25, `--${name} lightness ${value.l}% is not a dark surface`);
  }
});

test('foreground and ink tokens stay in the warm band', () => {
  for (const name of [
    'foreground', 'card-foreground', 'popover-foreground', 'secondary-foreground',
    'accent-foreground', 'muted-foreground', 'signature-foreground',
    'primary-foreground', 'gold-foreground',
  ]) {
    const value = token(name);
    assert.ok(inWarmBand(value), `--${name} hue ${value.h} outside warm band ${WARM_HUE.join('–')}`);
    assert.ok(value.s <= 30, `--${name} saturation ${value.s}% exceeds the 30% cap`);
  }
});

test('the accent family is untouched by the surface rule', () => {
  // Canary values: if someone "fixes" the accents into the warm band, that
  // is a brand change, not hygiene — it should fail loudly here.
  assert.equal(token('primary').h, 188);
  assert.equal(token('gold').h, 58);
  assert.equal(token('success').h, 160);
  assert.equal(token('destructive').h, 352);
});

test('the PWA frame colors (meta theme-color, manifest) stay in the warm band', () => {
  // The app frame — splash screen, status bar, app-switcher card — is
  // painted from these two files, not from index.css; a palette change
  // that forgets them greets users with the old color before first paint.
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/public/site.webmanifest'), 'utf8'));
  const meta = html.match(/name="theme-color" content="(#[0-9a-fA-F]{6})"/);
  assert.ok(meta, 'theme-color meta not found');
  for (const [label, hex] of [
    ['meta theme-color', meta[1]],
    ['manifest theme_color', manifest.theme_color],
    ['manifest background_color', manifest.background_color],
  ]) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    assert.ok(h >= WARM_HUE[0] && h <= WARM_HUE[1], `${label} ${hex} hue ${h.toFixed(0)} outside warm band`);
  }
});
