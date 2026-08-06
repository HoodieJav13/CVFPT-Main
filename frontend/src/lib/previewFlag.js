// The preview-mode gate, alone in its own module so runtime code can check
// the flag without statically importing the ~2k-line fixture module —
// previewMode.js loads via dynamic import only when this flag is on.
// Local dev opt-in, or the hosted-demo flag that vite.config defines only
// for Vercel preview builds (and force-defines off for production).
export const isPreviewMode = Boolean(
  (import.meta.env.DEV || import.meta.env.REACT_APP_HOSTED_DEMO === 'true')
  && import.meta.env.REACT_APP_PREVIEW_MODE === 'true',
);
