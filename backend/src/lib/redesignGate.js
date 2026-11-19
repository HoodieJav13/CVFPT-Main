// Redesign gate (backend half). See docs/redesign-gate.md.
//
// Off by default. With PT_REDESIGN unset (or any value other than "look-a")
// this file does nothing and the backend is exactly the code under src/.
//
// With PT_REDESIGN=look-a, a require() that lands on a file under backend/src
// is served from its twin under backend/redesign/look-a/src when that twin
// exists. Files inside the overlay resolve their own requires as if they sat
// at the twin's place in src/, so unchanged modules and node_modules are
// found as usual. Nothing is copied or rewritten.
//
// The redesign also needs its database migrations (redesign/look-a/supabase/
// migrations at the repo root, deliberately outside supabase/migrations). Do
// not switch this on against a database that does not have them.
const Module = require('module');
const fs = require('fs');
const path = require('path');

const NAME = 'look-a';
const SRC = path.join(__dirname, '..');
const OVERLAY = path.join(__dirname, '..', '..', 'redesign', NAME, 'src');

const requested = () => process.env.PT_REDESIGN === NAME;
const inside = (dir, file) => typeof file === 'string' && file.startsWith(dir + path.sep);
let installed = false;
const EXTENSIONS = ['', '.js', '.cjs', '.json', path.sep + 'index.js'];
function twinOf(file) {
  const base = path.join(OVERLAY, path.relative(SRC, file));
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function install() {
  if (installed || !requested()) return installed;
  if (!fs.existsSync(OVERLAY)) {
    throw new Error(`PT_REDESIGN=${NAME} is set but ${OVERLAY} is missing; refusing to start half-switched.`);
  }
  const original = Module._resolveFilename;
  Module._resolveFilename = function redesignResolve(request, parent, ...rest) {
    let from = parent;
    if (parent && inside(OVERLAY, parent.filename)) {
      const twin = path.join(SRC, path.relative(OVERLAY, parent.filename));
      from = { id: twin, filename: twin, paths: Module._nodeModulePaths(path.dirname(twin)) };
    }
    let resolved;
    try {
      resolved = original.call(this, request, from, ...rest);
    } catch (error) {
      // A file that exists only in the redesign has no original under src/.
      const base = from && from.filename && request.startsWith('.') ? path.resolve(path.dirname(from.filename), request) : null;
      const found = base && inside(SRC, base) && twinOf(base);
      if (found) return found;
      throw error;
    }
    return (inside(SRC, resolved) && twinOf(resolved)) || resolved;
  };
  installed = true;
  return installed;
}

module.exports = { install, active: () => installed, NAME };
