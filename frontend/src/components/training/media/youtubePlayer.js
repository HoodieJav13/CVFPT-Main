// Deliberate click-to-load YouTube player (docs/exercise-guides/design.md).
// Nothing here runs until the viewer presses Play: no iframe, script,
// thumbnail or preconnect exists before that. The iframe is created directly
// at the fixed privacy-enhanced embed origin with an explicit origin-only
// referrer policy (never no-referrer, which YouTube rejects with error 153);
// the official IFrame API is loaded lazily, once, only for lifecycle and error
// events. If that script is blocked the plain embed still plays. One guide
// plays at a time; closing or switching destroys the player.
import { youtubeEmbedUrl } from '../../../lib/exerciseDemo.js';

export const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
export const PLAYER_MIN = 200;
const PLAYER_MAX_WIDTH = 960;
const API_TIMEOUT_MS = 10_000;

const ERROR_COPY = {
  2: 'This YouTube link is not valid. Open it on YouTube to check it.',
  5: 'This video could not play in this browser. Open it on YouTube instead.',
  100: 'This video was removed or is private. Open on YouTube may not work either; ask your coach for an updated link.',
  // YouTube also answers 150 for some missing or private videos, so the copy
  // names both causes rather than blaming the owner.
  101: 'This video cannot play here: its owner may not allow embedding, or it may be private or removed. Open it on YouTube instead.',
  150: 'This video cannot play here: its owner may not allow embedding, or it may be private or removed. Open it on YouTube instead.',
  153: 'YouTube could not identify this app, so it refused to play the video here. Open it on YouTube instead.',
  api_unavailable: 'The YouTube player could not load. Open the video on YouTube instead.',
};

export function playerErrorMessage(code) {
  return ERROR_COPY[code] || 'This video could not play here. Open it on YouTube instead.';
}

// 16:9 when there is room; never below 200x200 (YouTube's minimum viewport),
// which on a 320px phone means a taller, letterboxed player.
export function playerFrameSize(availableWidth) {
  const width = Math.min(PLAYER_MAX_WIDTH, Math.max(PLAYER_MIN, Math.floor(Number(availableWidth) || PLAYER_MIN)));
  return { width, height: Math.max(PLAYER_MIN, Math.round((width * 9) / 16)) };
}

export function createActivePlayerGuard() {
  let active = null;
  return {
    activate(player) {
      if (active && active !== player) { try { active.destroy(); } catch { /* already gone */ } }
      active = player;
    },
    release(player) {
      if (active !== player) return;
      active = null;
      try { player.destroy(); } catch { /* already gone */ }
    },
    current: () => active,
  };
}

const guard = createActivePlayerGuard();
let apiPromise = null;

// One lazy IFrame API load per page, only after a deliberate action.
export function loadYouTubeIframeApi({ win = window, doc = document, timeoutMs = API_TIMEOUT_MS } = {}) {
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => { apiPromise = null; reject(new Error('api_unavailable')); }, timeoutMs);
    win.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === 'function') previous();
      resolve(win.YT);
    };
    const script = doc.createElement('script');
    script.src = IFRAME_API_URL;
    script.async = true;
    script.onerror = () => { clearTimeout(timer); apiPromise = null; script.remove(); reject(new Error('api_unavailable')); };
    doc.head.appendChild(script);
  });
  return apiPromise;
}

// Mounts one player for `videoId` inside `container`. Returns a handle with
// destroy()/pause(). Callbacks: onState('loading'|'ready'|'limited'|'error', code).
export function mountYouTubePlayer({ container, videoId, title, onState = () => {}, win = window, doc = document }) {
  const src = youtubeEmbedUrl(videoId, { origin: win.location.origin });
  if (!src || !container) throw new Error('Invalid YouTube player request');
  const { width, height } = playerFrameSize(container.clientWidth);
  const iframe = doc.createElement('iframe');
  iframe.id = `cvf-yt-${Math.random().toString(36).slice(2)}`;
  iframe.title = title;
  iframe.width = String(width);
  iframe.height = String(height);
  iframe.style.width = '100%';
  iframe.style.minWidth = `${PLAYER_MIN}px`;
  iframe.style.height = `${height}px`;
  iframe.style.minHeight = `${PLAYER_MIN}px`;
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('data-testid', 'exercise-demo-iframe');
  iframe.src = src;
  let destroyed = false;
  let api = null;
  const handle = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { api?.destroy(); } catch { /* already gone */ }
      iframe.remove();
    },
    pause() { try { api?.pauseVideo(); } catch { /* not ready */ } },
  };
  guard.activate(handle);
  container.appendChild(iframe);
  onState('loading');
  loadYouTubeIframeApi({ win, doc }).then((YT) => {
    if (destroyed) return;
    api = new YT.Player(iframe.id, {
      events: {
        onReady: () => { if (!destroyed) onState('ready'); },
        onError: (event) => { if (!destroyed) onState('error', event?.data); },
      },
    });
  }).catch(() => { if (!destroyed) onState('limited'); });
  return {
    ...handle,
    release() { guard.release(handle); },
  };
}
