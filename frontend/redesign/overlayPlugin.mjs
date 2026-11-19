// Redesign gate (frontend half). See docs/redesign-gate.md.
//
// Off by default: vite.config.js only adds this plugin when
// REACT_APP_PT_REDESIGN=look-a is set at build or dev-server start, so a
// normal build never reads a file under frontend/redesign/.
//
// When on, any import that lands on frontend/src/<path> is served from
// frontend/redesign/look-a/src/<path> when that file exists. Overlay files
// resolve their own imports as if they sat at the twin's place in src/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REDESIGN_NAME = 'look-a';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const OVERLAY = path.resolve(HERE, REDESIGN_NAME, 'src');

export const redesignRequested = (env = process.env) => env.REACT_APP_PT_REDESIGN === REDESIGN_NAME;
export const redesignContentGlob = `./redesign/${REDESIGN_NAME}/src/**/*.{js,jsx,ts,tsx}`;

const inside = (dir, file) => file.startsWith(dir + path.sep);
const clean = (id) => id.split('?')[0];

const EXTENSIONS = ['', '.js', '.jsx', '.mjs', '.json', '/index.js', '/index.jsx'];
// The overlay twin of a path under src/, trying the usual extensions so files
// that exist only in the redesign (no src/ original) are found too.
function overlayTwin(file) {
  if (!inside(SRC, file)) return null;
  const base = path.join(OVERLAY, path.relative(SRC, file));
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function redesignOverlay() {
  if (!fs.existsSync(OVERLAY)) throw new Error(`REACT_APP_PT_REDESIGN=${REDESIGN_NAME} is set but ${OVERLAY} is missing.`);
  return {
    name: 'cvf-redesign-overlay',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source.startsWith('\0')) return null;
      let from = importer;
      if (importer && inside(OVERLAY, clean(importer))) from = path.join(SRC, path.relative(OVERLAY, clean(importer)));
      const query = source.includes('?') ? source.slice(source.indexOf('?')) : '';
      // Where the import points inside src/, whether or not a file exists there.
      const bare = clean(source);
      const target = bare.startsWith('@/') ? path.join(SRC, bare.slice(2))
        : (bare.startsWith('.') && from) ? path.resolve(path.dirname(clean(from)), bare)
          : (path.isAbsolute(bare) && inside(SRC, bare)) ? bare // the '@' alias has already been applied
            : null;
      const twin = target && overlayTwin(target);
      if (twin) return twin + query;
      const resolved = await this.resolve(source, from, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return from === importer ? null : resolved;
      const file = clean(resolved.id);
      const late = overlayTwin(file);
      if (late) return { ...resolved, id: late + resolved.id.slice(file.length) };
      return from === importer ? null : resolved;
    },
  };
}
