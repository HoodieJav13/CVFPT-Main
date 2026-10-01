// Sky Field surface guard (owner decision 2026-10-01, replacing the
// 2026-08-13 warm-graphite rule): the sunrise (light, :root) and sunset
// (dark, .dark) themes both keep their neutral surfaces warm — hue 0–50, or
// pure white — so neither can drift toward navy (hue 200–260) or green
// (hue 100–160). Accents are the logo's own teal and gold. This test parses
// the token source directly. Reading across the deploy boundary is fine
// here: tests run from the monorepo checkout, never from a deployed bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../frontend/src/index.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(`  ${selector} {\n    --background`);
  assert.ok(start >= 0, `${selector} token block not found`);
  return css.slice(start, css.indexOf('\n  }', start));
}
const LIGHT = block(':root');
const DARK = block('.dark');

function token(name, source = DARK) {
  const match = source.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  assert.ok(match, `token --${name} not found as an H S% L% triplet`);
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

const WARM_HUE = [0, 50];
const isWarm = ({ h, s }) => s === 0 || (h >= WARM_HUE[0] && h <= WARM_HUE[1]);
const SURFACES = ['background', 'card', 'popover', 'secondary', 'muted', 'accent', 'border', 'input'];

test('sunset (dark) surfaces are warm, low-saturation and dark', () => {
  for (const name of SURFACES) {
    const value = token(name, DARK);
    assert.ok(isWarm(value), `dark --${name} hue ${value.h} is not warm`);
    assert.ok(value.s <= 20, `dark --${name} saturation ${value.s}% exceeds the 20% cap`);
    assert.ok(value.l <= 25, `dark --${name} lightness ${value.l}% is not a dark surface`);
  }
});

test('sunrise (light) surfaces are warm and light', () => {
  for (const name of SURFACES) {
    const value = token(name, LIGHT);
    assert.ok(isWarm(value), `light --${name} hue ${value.h} is not warm`);
    assert.ok(value.s <= 30, `light --${name} saturation ${value.s}% exceeds the 30% cap`);
    assert.ok(value.l >= 78, `light --${name} lightness ${value.l}% is not a light surface`);
  }
});

test('text on the light theme uses ink tokens that pass contrast on white', () => {
  // Logo teal and gold fail as text on a light ground (about 1.9:1 and 1.5:1),
  // so light --primary is a teal ink and gold/success/achievement text reads
  // the *-ink tokens (tailwind.config.js textColor).
  assert.ok(token('primary', LIGHT).l <= 32, 'light --primary must be a dark teal ink');
  for (const name of ['gold-ink', 'success-ink', 'achievement-ink']) {
    assert.ok(token(name, LIGHT).l <= 32, `light --${name} must be dark enough to read on white`);
  }
  const tw = fs.readFileSync(path.join(__dirname, '../../frontend/tailwind.config.js'), 'utf8');
  assert.match(tw, /textColor:[\s\S]*gold:[\s\S]*--gold-ink[\s\S]*success:[\s\S]*--success-ink[\s\S]*achievement:[\s\S]*--achievement-ink/);
});

test('accents are exactly the logo colours (#5CC9E0, #FECD2A)', () => {
  assert.deepEqual(token('primary', DARK), { h: 190.5, s: 68, l: 62 });
  assert.deepEqual(token('gold', DARK), { h: 46.1, s: 99.1, l: 58 });
  assert.deepEqual(token('gold', LIGHT), { h: 46.1, s: 99.1, l: 58 });
});

test('the PWA frame colors (meta theme-color, manifest) are warm', () => {
  // The app frame — splash screen, status bar, app-switcher card — is
  // painted from these two files before index.css loads.
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
    assert.ok(h >= WARM_HUE[0] && h <= WARM_HUE[1], `${label} ${hex} hue ${h.toFixed(0)} is not warm`);
  }
});

test('PDF export hex literals equal the logo --primary / --gold tokens', () => {
  // lib/programPdf.js cannot read CSS variables, so its teal/gold are hex
  // literals (CLAUDE.md "Brand system"). This pins them to the tokens: if
  // --primary or --gold moves, the PDF hex must move with it.
  const body = fs.readFileSync(path.join(__dirname, '../src/lib/programPdf.js'), 'utf8');
  assert.ok(body.includes('function generateProgramPdf('), 'generateProgramPdf not found in lib/programPdf.js');
  const literal = (name) => {
    const m = body.match(new RegExp(`const ${name} = '(#[0-9a-fA-F]{6})'`));
    assert.ok(m, `const ${name} = '#rrggbb' not found in lib/programPdf.js`);
    return m[1].toUpperCase();
  };
  const hslToHex = ({ h, s, l }) => {
    const S = s / 100; const L = l / 100;
    const c = (1 - Math.abs(2 * L - 1)) * S;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = L - c / 2;
    let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  };
  assert.equal(literal('teal'), hslToHex(token('primary', DARK)), 'PDF teal drifted from the logo-teal --primary');
  assert.equal(literal('gold'), hslToHex(token('gold', DARK)), 'PDF gold drifted from --gold');
  assert.equal(literal('teal'), '#5CC9E0', 'PDF teal is not the logo teal');
  assert.equal(literal('gold'), '#FECD2A', 'PDF gold is not the logo gold');
});
