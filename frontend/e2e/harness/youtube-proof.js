// Test-only harness for the separate real-provider proof (never built or
// served by the app): mounts the REAL youtubePlayer module for a public sample
// video id passed in the query string, only after the button is pressed.
import { mountYouTubePlayer } from '/src/components/training/media/youtubePlayer.js';

const params = new URLSearchParams(window.location.search);
const videoId = params.get('v') || '';
window.__proof = { states: [] };
document.getElementById('play').addEventListener('click', () => {
  window.__proof.player = mountYouTubePlayer({
    container: document.getElementById('slot'),
    videoId,
    title: 'Public sample video (YouTube)',
    onState: (state, code = null) => {
      window.__proof.states.push({ state, code, at: Date.now() });
      document.getElementById('state').textContent = code === null ? state : `${state} ${code}`;
    },
  });
});
