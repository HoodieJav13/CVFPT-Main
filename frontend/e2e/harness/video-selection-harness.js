// Test-only harness, served by the Vite dev server for browser tests and never
// part of a build: mounts the real VideoSelectionEditor with props the test
// controls. Video bytes (/__media-fixture/...) and server frames
// (/__media-frame) are answered by page.route in the spec.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoSelectionEditor } from '/src/components/training/media/VideoSelectionEditor.jsx';
import '/src/index.css';

const params = new URLSearchParams(window.location.search);
const EMPTY = { poster_mode: null, poster_frame_ms: null, poster_crop: null, preview_start_ms: null, preview_end_ms: null, preview_crop: null, end_frame_ms: null, end_frame_crop: null };

async function serverFrame(timeMs) {
  const response = await fetch(`/__media-frame?time_ms=${timeMs}`);
  if (!response.ok) throw new Error('frame_failed');
  return URL.createObjectURL(await response.blob());
}

function Harness() {
  const [src, setSrc] = useState(params.get('src') || '/__media-fixture/moving.mp4');
  const [recipe, setRecipe] = useState({ ...EMPTY, ...JSON.parse(params.get('recipe') || '{}') });
  window.__harness = { recipe, setSrc };
  return React.createElement('main', { className: 'mx-auto max-w-3xl p-4' },
    React.createElement(VideoSelectionEditor, {
      src,
      facts: { width: 1280, height: 720, durationMs: 4000 },
      recipe,
      onChange: (patch) => setRecipe((current) => ({ ...current, ...patch })),
      onServerFrame: serverFrame,
    }));
}

createRoot(document.getElementById('root')).render(React.createElement(Harness));
