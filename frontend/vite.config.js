import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, ['REACT_APP_', 'VITE_']);
  const hostedTestBackend = process.env.CVF_E2E_BACKEND_URL;
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return {
    plugins: [react()],
    envPrefix: ['REACT_APP_', 'VITE_'],
    define: {
      'process.env': JSON.stringify(env),
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
