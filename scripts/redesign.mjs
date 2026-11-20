#!/usr/bin/env node
// Redesign gate tooling (Look A). See docs/redesign-gate.md.
//
// The redesign lives in overlay folders that mirror the files it replaces:
//   frontend/redesign/look-a/src/**  -> frontend/src/**   (runtime, picked by the Vite plugin)
//   backend/redesign/look-a/src/**   -> backend/src/**    (runtime, picked by backend/src/lib/redesignGate.js)
//   redesign/look-a/**               -> repo root          (tests, e2e, SQL, docs: never loaded at runtime)
// With the gate off (the default) none of those files is read.
//
// Commands:
//   materialize [name]   write .redesign/<name>/ : a full copy of the repo with the overlay applied,
//                        so the redesign's own test suites run unchanged against it
//   verify <git-ref>     check the materialized tree matches <git-ref> file for file
//   list                 list overlay files
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'look-a';
export const OVERLAYS = [
  { from: `frontend/redesign/${NAME}`, to: 'frontend' },
  { from: `backend/redesign/${NAME}`, to: 'backend' },
  { from: `redesign/${NAME}`, to: '.' },
];
const OUT = path.join(ROOT, '.redesign', NAME);
// The only files allowed to differ from the redesign's source branch: the gate itself.
const GATE_FILES = new Set(['.gitignore', 'CLAUDE.md', 'backend/src/app.js', 'frontend/eslint.config.mjs', 'frontend/tailwind.config.js', 'frontend/vite.config.js']);
// Redesign files changed on the port branch after the move, each for a stated reason (docs/redesign-gate.md).
// Test-only so far: the app files of the redesign must stay identical to the source branch.
const PORT_EDITS = new Set(['look-a-server.mjs', 'workout-ux-look-a-focus.spec.mjs', 'workout-ux-look-a-swap-guidance.spec.mjs', 'workout-ux-quick-undo.spec.mjs'].map((name) => `frontend/tests/browser/${name}`));

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
}) : []);
const inOverlay = (file) => OVERLAYS.some(({ from }) => file === from || file.startsWith(`${from}/`));

export function overlayFiles() {
  return OVERLAYS.flatMap(({ from, to }) => walk(path.join(ROOT, from)).map((full) => {
    const rel = path.relative(path.join(ROOT, from), full);
    return { source: path.relative(ROOT, full), target: path.normalize(path.join(to, rel)) };
  }));
}

function copy(fromAbs, toAbs) {
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.copyFileSync(fromAbs, toAbs);
  fs.chmodSync(toAbs, fs.statSync(fromAbs).mode);
}

function materialize() {
  fs.rmSync(OUT, { recursive: true, force: true });
  // Tracked files plus new unignored ones. Ignored files (.env, node_modules, build output) are never copied.
  const files = git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)
    .filter((file) => !inOverlay(file) && !file.startsWith('port-evidence/') && fs.existsSync(path.join(ROOT, file)) && !fs.lstatSync(path.join(ROOT, file)).isSymbolicLink());
  for (const file of files) copy(path.join(ROOT, file), path.join(OUT, file));
  const applied = overlayFiles();
  for (const { source, target } of applied) copy(path.join(ROOT, source), path.join(OUT, target));
  for (const pkg of ['frontend', 'backend']) {
    const modules = path.join(ROOT, pkg, 'node_modules');
    if (fs.existsSync(modules)) fs.symlinkSync(fs.realpathSync(modules), path.join(OUT, pkg, 'node_modules'));
  }
  console.log(`materialized ${files.length} base files + ${applied.length} overlay files -> ${path.relative(ROOT, OUT)}`);
}

function verify(ref) {
  if (!ref) throw new Error('usage: redesign.mjs verify <git-ref>');
  const lines = git('ls-tree', '-r', '-z', ref).split('\0').filter(Boolean);
  let same = 0; const different = []; const missing = [];
  const expected = new Set();
  for (const line of lines) {
    const [meta, file] = line.split('\t');
    const [mode, type, hash] = meta.split(' ');
    if (type !== 'blob' || mode === '120000') continue;
    expected.add(file);
    const target = path.join(OUT, file);
    if (!fs.existsSync(target)) { missing.push(file); continue; }
    const actual = execFileSync('git', ['hash-object', target], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (actual === hash) same += 1; else different.push(file);
  }
  const extra = walk(OUT).map((full) => path.relative(OUT, full)).filter((file) => !expected.has(file) && !file.includes('node_modules'));
  const unexpected = different.filter((file) => !GATE_FILES.has(file) && !PORT_EDITS.has(file));
  console.log(JSON.stringify({ ref, same, gateFilesDiffering: different.filter((file) => GATE_FILES.has(file)), portEdits: different.filter((file) => PORT_EDITS.has(file)), unexpected, missing, extra }, null, 1));
  if (unexpected.length || missing.length) process.exitCode = 1;
}

const [command, arg] = process.argv.slice(2);
if (command === 'materialize') materialize();
else if (command === 'verify') verify(arg);
else if (command === 'list') for (const { source, target } of overlayFiles()) console.log(`${target}  <-  ${source}`);
else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error('usage: node scripts/redesign.mjs materialize | verify <git-ref> | list');
  process.exitCode = 2;
}
