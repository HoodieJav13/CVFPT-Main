import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { build } from 'esbuild';

// Exercise the actual runtime adapter compiled with the actual Vite build guard,
// even if someone supplies enabling flags/token AND incorrectly enables fixtures.
test('Vercel Production and ordinary production builds cannot enable the runtime collector', async () => {
  const oldVercel = process.env.VERCEL_ENV;
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  let deliveries = 0;
  globalThis.window = { dispatchEvent: () => { deliveries += 1; }, addEventListener: () => { deliveries += 1; } };
  globalThis.fetch = () => { deliveries += 1; return Promise.resolve({ ok: true }); };
  try {
    for (const vercel of ['production', '']) {
      process.env.VERCEL_ENV = vercel;
      const config = await resolveConfig({ root: fileURLToPath(new URL('../../', import.meta.url)), logLevel: 'silent' }, 'build', 'production');
      assert.equal(config.define.__CVF_POSTHOG_PREVIEW_ALLOWED__, 'false');
      if (vercel === 'production') {
        assert.equal(config.define['import.meta.env.REACT_APP_PREVIEW_MODE'], '"false"');
        assert.equal(config.define['import.meta.env.REACT_APP_HOSTED_DEMO'], '"false"');
      }
      for (const requestedMode of ['local', 'synthetic-preview']) {
        const source = (await readFile(new URL('../../src/lib/coachAnalytics.js', import.meta.url), 'utf8'))
          .replace("import { isPreviewMode } from './previewFlag';", 'const isPreviewMode = true;');
        const output = await build({
          stdin: { contents: source, resolveDir: fileURLToPath(new URL('../../src/lib', import.meta.url)), loader: 'js' },
          bundle: true, platform: 'node', format: 'esm', write: false,
          define: {
            __CVF_POSTHOG_PREVIEW_ALLOWED__: config.define.__CVF_POSTHOG_PREVIEW_ALLOWED__,
            'import.meta.env.REACT_APP_POSTHOG_MODE': JSON.stringify(requestedMode),
            'import.meta.env.REACT_APP_POSTHOG_HOST': '"https://us.i.posthog.com"',
            'import.meta.env.REACT_APP_POSTHOG_PUBLIC_TOKEN': '"phc_SYNTHETIC"',
          },
        });
        const module = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${vercel}-${requestedMode}`);
        module.trackCoachScreen('/coach/sessions');
        module.reportCoachError('/coach/sessions', 'render');
        module.listenForCoachErrors(globalThis.window, () => '/coach/sessions')();
        const result = { data: { id: 'fictional' } };
        assert.equal(await module.observeCoachSessionSave(() => result, { operation: 'create', workout_change: 'none' }), result);
        assert.equal(deliveries, 0);
      }
    }
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldVercel;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    globalThis.fetch = oldFetch;
  }
});
