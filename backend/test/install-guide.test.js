const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.join(__dirname, '..', '..', 'frontend');
const source = fs.readFileSync(path.join(frontend, 'src', 'lib', 'installPlatform.js'), 'utf8');
const { detectInstallGuide } = vm.runInNewContext(`${source.replace(/^export /gm, '')}\n({ detectInstallGuide });`);
const pwa = fs.readFileSync(path.join(frontend, 'src', 'lib', 'pwa.js'), 'utf8');
const guide = fs.readFileSync(path.join(frontend, 'src', 'components', 'InstallGuide.jsx'), 'utf8');
const home = fs.readFileSync(path.join(frontend, 'src', 'pages', 'client', 'Home.jsx'), 'utf8');

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 389.0.0.28.84 (iPhone15,2; iOS 18_5; en_US)',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/1]',
  iphoneGoogleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.779 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 343.0.0.33.101 Android',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};

test('install guide matches the phone and browser', () => {
  const cases = [
    ['iphoneSafari', {}, 'ios-safari'],
    ['iphoneChrome', {}, 'ios-chrome'],
    ['iphoneFirefox', {}, 'ios-other'],
    ['iphoneInstagram', {}, 'ios-other'],
    ['iphoneFacebook', {}, 'ios-other'],
    ['iphoneGoogleApp', {}, 'ios-other'],
    ['ipadDesktopMode', { platform: 'MacIntel', maxTouchPoints: 5 }, 'ios-safari'],
    ['androidChrome', {}, 'android'],
    ['androidSamsung', {}, 'android'],
    ['androidInstagram', {}, 'android-inapp'],
    ['androidWebView', {}, 'android-inapp'],
    ['macSafari', { platform: 'MacIntel', maxTouchPoints: 0 }, null],
    ['windowsChrome', { platform: 'Win32' }, null],
  ];
  for (const [name, extra, expected] of cases) {
    assert.equal(detectInstallGuide({ userAgent: UA[name], ...extra }), expected, name);
  }
  assert.equal(detectInstallGuide({}), null);
  assert.equal(detectInstallGuide(), null);
});

test('install mode: native prompt first, then the manual guide; installed apps offer nothing', () => {
  assert.match(pwa, /if \(installed \|\| isStandalone\(\)\) return null;/);
  assert.match(pwa, /if \(deferredPrompt\) return 'prompt';/);
  assert.match(pwa, /detectInstallGuide\(/);
  // "Not now" hides only the Home card; the menu entry stays reachable.
  assert.doesNotMatch(pwa.slice(pwa.indexOf('function computeInstallMode'), pwa.indexOf('export function useInstallMode')), /isDismissed/);
  assert.match(pwa, /export function useShowInstallCard\(/);
});

test('guide dialog covers every mode, and wrong-browser modes offer a copy-link escape hatch', () => {
  for (const mode of ['ios-safari', 'ios-chrome', 'ios-other', 'android', 'android-inapp']) {
    assert.match(guide, new RegExp(`\\n\\s+'?${mode}'?: \\{`), `${mode} handled`);
  }
  assert.match(guide, /navigator\.clipboard\.writeText/);
  assert.match(guide, /install-guide-copy-link/);
});

test('client Home shows the install card with show-how and not-now actions', () => {
  assert.match(home, /useShowInstallCard\(\)/);
  assert.match(home, /InstallCard/);
});
