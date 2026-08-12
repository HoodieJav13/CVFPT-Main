import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Emits sw.js into the build with __SW_VERSION__ replaced by a per-build id.
// The source lives at frontend/sw.js (not public/) so it can never ship with
// the placeholder unreplaced; every deploy byte-changes the worker, which is
// what makes browsers install the new one and drop old-build caches.
function serviceWorkerPlugin() {
  return {
    name: 'cvf-service-worker',
    apply: 'build',
    generateBundle() {
      const source = fs.readFileSync(path.resolve(__dirname, 'sw.js'), 'utf8');
      const buildId = Date.now().toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: source.replace(/__SW_VERSION__/g, buildId),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, ['REACT_APP_', 'VITE_']);
  const hostedTestBackend = process.env.CVF_E2E_BACKEND_URL;
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  // Demo mode on Vercel previews (owner decision 2026-07-31): preview
  // deployments boot with fixture data and the role toolbar, no credentials.
  // Production builds get the flags force-defined off, so no dashboard env
  // var can ever flip demo mode on in production.
  const vercelEnvironment = process.env.VERCEL_ENV || '';
  const hostedDemoDefines = vercelEnvironment === 'preview'
    ? {
        'import.meta.env.REACT_APP_PREVIEW_MODE': JSON.stringify('true'),
        'import.meta.env.REACT_APP_HOSTED_DEMO': JSON.stringify('true'),
      }
    : vercelEnvironment === 'production'
      ? {
          'import.meta.env.REACT_APP_PREVIEW_MODE': JSON.stringify('false'),
          'import.meta.env.REACT_APP_HOSTED_DEMO': JSON.stringify('false'),
        }
      : {};
  return {
    plugins: [react(), serviceWorkerPlugin()],
    envPrefix: ['REACT_APP_', 'VITE_'],
    define: {
      'process.env': JSON.stringify(env),
      ...hostedDemoDefines,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      // clientPort 443 is only right behind an HTTPS tunnel (the old cloud
      // IDE setup); locally it breaks HMR and logs a websocket error on
      // every page load. Opt in via CVF_DEV_TUNNEL when tunneling.
      hmr: process.env.CVF_DEV_TUNNEL ? { clientPort: 443 } : undefined,
      proxy: hostedTestBackend && protectionBypass ? {
        '/api': {
          target: hostedTestBackend,
          changeOrigin: true,
          headers: { 'x-vercel-protection-bypass': protectionBypass },
        },
      } : undefined,
    },
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.[jt]sx?$/,
      exclude: [],
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: { '.js': 'jsx' },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
