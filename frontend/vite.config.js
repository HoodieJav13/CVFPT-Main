import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
    plugins: [react()],
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
      hmr: { clientPort: 443 },
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
