const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const frontend = path.join(root, 'frontend');
const manifest = JSON.parse(fs.readFileSync(path.join(frontend, 'public', 'site.webmanifest'), 'utf8'));
const indexHtml = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(frontend, 'sw.js'), 'utf8');
const viteConfig = fs.readFileSync(path.join(frontend, 'vite.config.js'), 'utf8');
const pwa = fs.readFileSync(path.join(frontend, 'src', 'lib', 'pwa.js'), 'utf8');
const mainEntry = fs.readFileSync(path.join(frontend, 'src', 'main.jsx'), 'utf8');
const appShell = fs.readFileSync(path.join(frontend, 'src', 'components', 'layout', 'AppShell.jsx'), 'utf8');

test('manifest is installable: id/scope/standalone plus any + maskable icons', () => {
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  const purposes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`).sort();
  assert.deepEqual(purposes, ['192x192:any', '192x192:maskable', '512x512:any', '512x512:maskable']);
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(frontend, 'public', icon.src)), `${icon.src} exists`);
  }
});

test('index.html links manifest, baked apple-touch icon, and iOS standalone metas', () => {
  assert.match(indexHtml, /<link rel="manifest" href="\/site\.webmanifest" \/>/);
  assert.match(indexHtml, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png" \/>/);
  assert.match(indexHtml, /apple-mobile-web-app-capable/);
  assert.ok(fs.existsSync(path.join(frontend, 'public', 'icons', 'apple-touch-icon.png')));
});

test('service worker is deploy-safe: no precache manifest, versioned caches, API untouched', () => {
  // Version placeholder gets replaced per build; caches are keyed by it and
  // old-version caches are deleted on activate.
  assert.match(sw, /const VERSION = '__SW_VERSION__';/);
  assert.match(sw, /caches\.delete\(key\)/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  // API requests are never intercepted or cached.
  assert.match(sw, /if \(url\.pathname\.startsWith\('\/api'\)\) return;/);
  // Navigations are network-first (fresh deploys win while online); hashed
  // assets are cache-first; there is no build-time precache list to go stale.
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /networkFirstShell/);
  assert.match(sw, /url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.doesNotMatch(sw, /__WB_MANIFEST|precacheAndRoute|\.addAll\(\[/);
  // Cross-origin and non-GET requests pass through untouched.
  assert.match(sw, /if \(request\.method !== 'GET'\) return;/);
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
});

test('build emits sw.js with the placeholder replaced by a per-build id', () => {
  assert.match(viteConfig, /function serviceWorkerPlugin\(\)/);
  assert.match(viteConfig, /apply: 'build'/);
  assert.match(viteConfig, /source\.replace\(\/__SW_VERSION__\/g, buildId\)/);
  assert.match(viteConfig, /plugins: \[react\(\), serviceWorkerPlugin\(\)\]/);
});

test('registration is production-only and wired at the entry point', () => {
  assert.match(pwa, /import\.meta\.env\.PROD && 'serviceWorker' in navigator/);
  assert.match(pwa, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(mainEntry, /initPwa\(\);/);
});

test('install entry: native prompt when available, iOS steps otherwise, dismissible', () => {
  // beforeinstallprompt is captured (it fires before components mount) and
  // eligibility goes quiet once installed, standalone, or dismissed.
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /event\.preventDefault\(\);/);
  assert.match(pwa, /appinstalled/);
  assert.match(pwa, /if \(installed \|\| isStandalone\(\) \|\| isDismissed\(\)\) return null;/);
  // Menu entry routes by mode; the iOS dialog offers a persistent dismissal.
  assert.match(appShell, /install-app-item/);
  assert.match(appShell, /installMode === 'prompt' \? promptInstall\(\) : setIosHelpOpen\(true\)/);
  assert.match(appShell, /ios-install-help/);
  assert.match(appShell, /Add to Home Screen/);
  assert.match(appShell, /dismissInstall\(\); setIosHelpOpen\(false\);/);
});
