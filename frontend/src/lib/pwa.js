// PWA plumbing: service-worker registration and the install-prompt store.
// The store captures Chrome's beforeinstallprompt event (which only fires
// once, often before any component mounts) so the menu entry can trigger it
// later. Without a prompt event (iOS, Samsung Internet, in-app browsers)
// the mode names the manual Add-to-Home-Screen steps for that browser.
import { useSyncExternalStore } from 'react';
import { trackProductEvent } from '@/lib/telemetry';
import { detectInstallGuide } from '@/lib/installPlatform';

const DISMISS_KEY = 'cvf_install_dismissed';

let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function phoneGuide() {
  if (typeof navigator === 'undefined') return null;
  return detectInstallGuide({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

function isDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch { /* private mode: dismissal just won't persist */ }
  notify();
}

// 'prompt' → native install prompt available; otherwise a manual-steps mode
// from detectInstallGuide; null → nothing to offer (installed or desktop).
function computeInstallMode() {
  if (installed || isStandalone()) return null;
  if (deferredPrompt) return 'prompt';
  return phoneGuide();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallMode() {
  return useSyncExternalStore(subscribe, computeInstallMode, () => null);
}

// The client Home card: phones only, until installed or "Not now". The menu
// entry (useInstallMode) ignores the dismissal so it stays findable.
function computeShowInstallCard() {
  return Boolean(computeInstallMode() && phoneGuide() && !isDismissed());
}

export function useShowInstallCard() {
  return useSyncExternalStore(subscribe, computeShowInstallCard, () => false);
}

export async function promptInstall(source = 'native_prompt') {
  if (!deferredPrompt) return false;
  trackProductEvent('pwa_install_requested', { source });
  const prompt = deferredPrompt;
  deferredPrompt = null;
  notify();
  prompt.prompt();
  const choice = await prompt.userChoice;
  return choice?.outcome === 'accepted';
}

export function initPwa() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    trackProductEvent('pwa_install_accepted', { source: 'appinstalled' });
    installed = true;
    deferredPrompt = null;
    notify();
  });

  // Dev servers skip the worker: registration only makes sense against a
  // real build, where /sw.js exists with its per-build version baked in.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failure (old browser, storage off) just means no
        // offline shell — the app itself is unaffected.
      });
    });
  }
}
