// Redesign gate (docs/redesign-gate.md): off by default, on only for PT_REDESIGN=look-a.
// Each case runs in its own process because the gate patches module resolution.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const backend = path.join(__dirname, '..');
const overlay = path.join(backend, 'redesign', 'look-a', 'src');
// The generated switched-on copy (scripts/redesign.mjs materialize) has the overlay applied in place and no overlay folder.
const skip = fs.existsSync(overlay) ? false : 'no overlay folder here (already applied in this copy)';

const probe = `
  const gate = require('./src/lib/redesignGate');
  gate.install();
  const out = { active: gate.active(), files: {} };
  for (const name of ['./src/routes/workoutLogs', './src/routes/programs', './src/lib/sessionEvents', './src/lib/trainingLibrary', './src/routes/sessions', './src/supabase']) out.files[name] = require.resolve(name);
  try { out.lookARoutes = require.resolve('./src/routes/workoutLookA'); } catch { out.lookARoutes = null; }
  if (gate.active()) {
    // An overlay file's own requires: unchanged neighbours come from src/, changed ones from the overlay, packages from node_modules.
    const Module = require('module');
    const parent = new Module(out.files['./src/routes/workoutLogs']);
    parent.filename = out.files['./src/routes/workoutLogs'];
    parent.paths = Module._nodeModulePaths(require('path').dirname(parent.filename));
    out.fromOverlay = { session: Module._resolveFilename('./workoutLogSession', parent), auth: Module._resolveFilename('../middleware/auth', parent), express: Module._resolveFilename('express', parent) };
  }
  console.log(JSON.stringify(out));
`;
function run(value) {
  const env = { ...process.env };
  delete env.PT_REDESIGN;
  if (value !== undefined) env.PT_REDESIGN = value;
  return JSON.parse(execFileSync(process.execPath, ['-e', probe], { cwd: backend, env, encoding: 'utf8' }));
}
const rel = (file) => path.relative(backend, file);

test('gate off by default: every module is the file under src/, and the Look A routes do not exist', { skip }, () => {
  for (const value of [undefined, '', 'true', '1', 'on', 'LOOK-A', 'look-a ']) {
    const out = run(value);
    assert.equal(out.active, false, `PT_REDESIGN=${JSON.stringify(value)} must not switch the redesign on`);
    for (const file of Object.values(out.files)) assert.ok(rel(file).startsWith('src' + path.sep), rel(file));
    assert.equal(out.lookARoutes, null);
  }
});

test('gate on (PT_REDESIGN=look-a): changed modules come from the overlay, unchanged ones stay in src/', { skip }, () => {
  const out = run('look-a');
  assert.equal(out.active, true);
  const overlayRel = path.join('redesign', 'look-a', 'src');
  for (const name of ['./src/routes/workoutLogs', './src/routes/programs', './src/lib/sessionEvents', './src/lib/trainingLibrary']) assert.ok(rel(out.files[name]).startsWith(overlayRel), `${name} -> ${rel(out.files[name])}`);
  for (const name of ['./src/routes/sessions', './src/supabase']) assert.ok(rel(out.files[name]).startsWith('src' + path.sep), `${name} -> ${rel(out.files[name])}`);
  assert.ok(rel(out.lookARoutes).startsWith(overlayRel));
  assert.ok(rel(out.fromOverlay.session).startsWith(overlayRel));
  assert.equal(rel(out.fromOverlay.auth), path.join('src', 'middleware', 'auth.js'));
  assert.match(out.fromOverlay.express, /node_modules/);
});

test('every backend overlay file sits under src/ and none is picked up as a test', { skip }, () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const files = walk(path.join(backend, 'redesign'));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(file.startsWith(overlay + path.sep), rel(file));
    assert.doesNotMatch(path.basename(file), /(\.test\.|-test\.|_test\.|^test-|^test\.)/);
    assert.ok(!file.split(path.sep).includes('test'));
  }
});
