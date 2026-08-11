// Program 012: client-side push enrollment. Permission is only ever
// requested from a deliberate tap in the notification-settings dialog.
// iOS delivers web push exclusively to installed-to-home-screen PWAs —
// pushSupport() reports that honestly instead of failing silently.
import { api } from '@/lib/api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const IS_STANDALONE = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return IS_IOS && !IS_STANDALONE ? 'ios_needs_install' : 'unsupported';
  }
  if (IS_IOS && !IS_STANDALONE) return 'ios_needs_install';
  return 'supported';
}

export function pushPermission() {
  return 'Notification' in window ? Notification.permission : 'denied';
}

export async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush() {
  const { data } = await api.get('/push/public-key');
  if (!data.public_key) {
    const error = new Error('Push notifications are not set up yet');
    error.code = 'unconfigured';
    throw error;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const error = new Error('Notifications were not allowed. You can change this in your browser settings.');
    error.code = 'denied';
    throw error;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.public_key),
  });
  await api.post('/push/subscribe', subscription.toJSON());
  return true;
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (subscription) {
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  return true;
}
