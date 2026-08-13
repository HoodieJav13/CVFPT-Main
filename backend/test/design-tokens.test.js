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
