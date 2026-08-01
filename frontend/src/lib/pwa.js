// PWA plumbing: service-worker registration and the install-prompt store.
// The store captures Chrome's beforeinstallprompt event (which only fires
// once, often before any component mounts) so the menu entry can trigger it
// later; on iOS Safari there is no prompt event, so eligibility falls back
// to "iOS browser, not already installed" and the UI shows the
// Add-to-Home-Screen steps instead.
import { useSyncExternalStore } from 'react';

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

export function isIosBrowser() {
  if (typeof navigator === 'undefined') return false;
  const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS masquerades as macOS
  return iosDevice;
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

// 'prompt' → native install prompt available; 'ios' → show manual steps;
// null → nothing to offer (already installed, dismissed, or unsupported).
function computeInstallMode() {
  if (installed || isStandalone() || isDismissed()) return null;
  if (deferredPrompt) return 'prompt';
  if (isIosBrowser()) return 'ios';
  return null;
}

export function useInstallMode() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    computeInstallMode,
    () => null
  );
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
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
