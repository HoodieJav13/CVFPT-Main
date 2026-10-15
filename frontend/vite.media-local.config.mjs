// LOCAL HARNESS ONLY (exercise media). Extends the normal Vite config with a
// dev-server page at /__media-demo that signs in one of the four fictional
// loopback accounts of the owned local stack. The throwaway password stays in
// this dev-server process (env from the launcher) and never reaches the page,
// a URL or a log. Production builds never use this file.
import baseConfig from './vite.config.js';

const ACCOUNTS = {
  'coach-a': { email: 'coach-a@media-local.invalid', label: 'Synthetic Coach Avery (coach A)', home: '/coach/programs' },
  'coach-b': { email: 'coach-b@media-local.invalid', label: 'Synthetic Coach Blake (coach B)', home: '/coach/programs' },
  admin: { email: 'admin@media-local.invalid', label: 'Synthetic Admin Morgan (admin)', home: '/coach/programs' },
  'client-1': { email: 'client-1@media-local.invalid', label: 'Synthetic Client Riley (client of coach A)', home: '/client/programs?view=other' },
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Synthetic local demo</title>
<style>body{font-family:system-ui,sans-serif;background:#1d1a17;color:#f2efe9;margin:0;padding:24px}main{max-width:520px;margin:auto}
button{display:block;width:100%;min-height:48px;margin:10px 0;border-radius:10px;border:1px solid #4a433c;background:#2a2622;color:inherit;font-size:16px;cursor:pointer}
p{color:#c9c1b8}strong{color:#ffd166}</style></head><body><main>
<h1>Synthetic local demo</h1><p><strong>Fictional accounts on an owned loopback stack.</strong> No real people, credentials or hosted services.
Exercise media is synthetic test media, not instruction.</p>
${Object.entries(ACCOUNTS).map(([key, account]) => `<button type="button" data-account="${key}" data-testid="demo-login-${key}">${account.label}</button>`).join('')}
<p id="status" role="status"></p></main>
<script>
document.querySelectorAll('button[data-account]').forEach((button) => button.addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Signing in…';
  const response = await fetch('/__media-demo/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: button.dataset.account }) });
  if (!response.ok) { status.textContent = 'Sign-in failed. Is the local stack running?'; return; }
  const data = await response.json();
  localStorage.setItem('cvf_access_token', data.access_token);
  localStorage.setItem('cvf_refresh_token', data.refresh_token);
  location.assign(data.home);
}));
</script></body></html>`;

function mediaDemoPlugin() {
  return {
    name: 'cvf-media-local-demo',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__media-demo', async (req, res) => {
        if (process.env.CVF_MEDIA_LOCAL !== 'exercise-media-20261015') { res.statusCode = 404; res.end(); return; }
        if (req.method === 'GET') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); return; }
        if (req.method === 'POST' && req.url === '/login') {
          let raw = '';
          req.on('data', (chunk) => { raw += chunk; if (raw.length > 1024) req.destroy(); });
          req.on('end', async () => {
            try {
              const account = ACCOUNTS[JSON.parse(raw).account];
              const api = new URL(process.env.REACT_APP_BACKEND_URL);
              if (!account || api.hostname !== '127.0.0.1') throw new Error('refused');
              const login = await fetch(`${api.origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: process.env.CVF_MEDIA_DEMO_PASSWORD }) });
              const body = await login.json();
              if (!login.ok) throw new Error('login failed');
              res.setHeader('content-type', 'application/json');
              res.setHeader('cache-control', 'no-store');
              res.end(JSON.stringify({ access_token: body.access_token, refresh_token: body.refresh_token, home: account.home }));
            } catch {
              res.statusCode = 400; res.end('{"error":"demo sign-in failed"}');
            }
          });
          return;
        }
        res.statusCode = 405; res.end();
      });
    },
  };
}

export default async (env) => {
  const config = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  return { ...config, plugins: [...(config.plugins || []), mediaDemoPlugin()], server: { ...config.server, host: '127.0.0.1', allowedHosts: ['127.0.0.1', 'localhost'] } };
};
