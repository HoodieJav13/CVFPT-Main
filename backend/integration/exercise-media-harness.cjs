// Owned, loopback-only harness for the exercise media local build.
//  - Database: the disposable cvfpt-media-test Supabase stack (583xx), reset
//    from the repository's migrations (supabase/tests/exercise_media/stack.sh).
//  - PostgREST: an owned, labelled container on 127.0.0.1 with an EPHEMERAL
//    JWT secret generated per run; the service-role JWT is signed here.
//  - Auth: a FICTIONAL loopback gateway for synthetic accounts only (password
//    grant/refresh/user/logout) — no real provider, no real credentials.
//  - API and worker: child processes running the real Express app and worker
//    with `node -r local-guard.cjs` (non-loopback network refused).
// Never loads .env, never targets hosted projects, never restarts Docker and
// never stops anything it cannot prove it owns.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const express = require('express');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes, randomUUID, createHmac, timingSafeEqual } = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const BACKEND = path.join(ROOT, 'backend');
const STACK = path.join(ROOT, 'supabase/tests/exercise_media/stack.sh');
const LOCAL_DIR = path.join(ROOT, '.exercise-media-local');
const RUN_DIR = path.join(LOCAL_DIR, 'run');
const MARKER = 'exercise-media-20261015';

const IDENTITIES = {
  'coach-a': { auth: 'a1000000-0000-4000-8000-0000000000a1', profile: 'c1000000-0000-4000-8000-0000000000c1', email: 'coach-a@media-local.invalid', name: 'Synthetic Coach Avery', kind: 'coach', admin: false },
  'coach-b': { auth: 'a1000000-0000-4000-8000-0000000000a2', profile: 'c1000000-0000-4000-8000-0000000000c2', email: 'coach-b@media-local.invalid', name: 'Synthetic Coach Blake', kind: 'coach', admin: false },
  admin: { auth: 'a1000000-0000-4000-8000-0000000000a3', profile: 'c1000000-0000-4000-8000-0000000000c3', email: 'admin@media-local.invalid', name: 'Synthetic Admin Morgan', kind: 'coach', admin: true },
  'client-1': { auth: 'a1000000-0000-4000-8000-0000000000b1', profile: 'd1000000-0000-4000-8000-0000000000d1', email: 'client-1@media-local.invalid', name: 'Synthetic Client Riley', kind: 'client', coach: 'coach-a' },
  'client-2': { auth: 'a1000000-0000-4000-8000-0000000000b2', profile: 'd1000000-0000-4000-8000-0000000000d2', email: 'client-2@media-local.invalid', name: 'Synthetic Client Jordan', kind: 'client', coach: 'coach-b' },
};

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function signJwt(payload, secret) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url'));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return payload.exp * 1000 > Date.now() ? payload : null;
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function stack(args, { input } = {}) {
  const env = { ...process.env, CVFPT_LOCK_PID: String(process.pid) };
  const result = spawnSync('bash', [STACK, ...args], { input, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const error = new Error(`stack.sh ${args[0]} failed (exit ${result.status})`);
    error.output = `${result.stdout || ''}\n${result.stderr || ''}`.slice(-4000);
    throw error;
  }
  return result.stdout;
}

function commandLine(pid) {
  const result = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

async function waitFor(check, { timeoutMs = 30_000, intervalMs = 250, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { const value = await check(); if (value) return value; } catch { /* retry */ }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

class MediaHarness {
  constructor({ runId = randomUUID().slice(0, 8), mediaRoot = path.join(LOCAL_DIR, 'media'), log = () => {} } = {}) {
    this.runId = runId;
    this.mediaRoot = mediaRoot;
    this.log = log;
    this.children = new Map();
    this.password = randomBytes(18).toString('base64url');
    this.gatewaySecret = randomBytes(32).toString('base64url');
    this.restSecret = randomBytes(36).toString('base64url');
    this.linkSecret = randomBytes(32).toString('base64url');
    this.anonKey = `local-anon-${randomBytes(12).toString('hex')}`;
    this.serviceKey = signJwt({ role: 'service_role', iss: 'cvf-media-local', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86_400 }, this.restSecret);
    this.restRequests = [];
    this.refreshTokens = new Map();
    fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  }

  async startDatabase({ reset = true } = {}) {
    const status = spawnSync('bash', [STACK, 'status'], { encoding: 'utf8' });
    if (status.status === 2) throw new Error('Docker did not answer; not starting (this harness never restarts Docker)');
    // Host-wide disposable-database lock shared with the other cvfpt test stacks; held until down().
    stack(['lock']);
    if (status.status !== 0) stack(['up']);
    if (reset) stack(['reset']);
  }

  psql(sql) { return stack(['psql', '-At'], { input: sql }); }

  async startPostgrest() {
    const envFile = path.join(RUN_DIR, `postgrest-${this.runId}.env`);
    fs.writeFileSync(envFile, `PGRST_JWT_SECRET=${this.restSecret}\n`, { mode: 0o600 });
    try {
      stack(['postgrest-down']);   // only a PostgREST carrying this stack's owner label
      this.restPort = await freePort();
      stack(['postgrest-up', String(this.restPort), envFile]);
    } finally { fs.rmSync(envFile, { force: true }); }
    this.restUrl = `http://127.0.0.1:${this.restPort}`;
    await waitFor(async () => (await fetch(`${this.restUrl}/`)).status < 500, { what: 'PostgREST', timeoutMs: 60_000 });
  }

  session(identity) {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({ sub: identity.auth, email: identity.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }, this.gatewaySecret);
    const refresh = randomBytes(24).toString('base64url');
    this.refreshTokens.set(refresh, identity);
    const user = { id: identity.auth, aud: 'authenticated', role: 'authenticated', email: identity.email, app_metadata: {}, user_metadata: {}, created_at: '2026-10-15T00:00:00Z' };
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
  }

  async startGateway() {
    const gateway = express();
    gateway.post('/auth/v1/token', express.json(), (req, res) => {
      if (req.headers.apikey !== this.anonKey) return res.status(401).json({ error: 'invalid_api_key' });
      if (req.query.grant_type === 'password') {
        const identity = Object.values(IDENTITIES).find((item) => item.email === String(req.body?.email || '').toLowerCase());
        if (!identity || req.body?.password !== this.password) return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return res.json(this.session(identity));
      }
      if (req.query.grant_type === 'refresh_token') {
        const identity = this.refreshTokens.get(req.body?.refresh_token);
        if (!identity) return res.status(400).json({ error: 'invalid_grant' });
        this.refreshTokens.delete(req.body.refresh_token);
        return res.json(this.session(identity));
      }
      return res.status(400).json({ error: 'unsupported_grant_type' });
    });
    gateway.get('/auth/v1/user', (req, res) => {
      const payload = verifyJwt((req.headers.authorization || '').replace(/^Bearer /, ''), this.gatewaySecret);
      const identity = payload && Object.values(IDENTITIES).find((item) => item.auth === payload.sub);
      if (!identity) return res.status(401).json({ message: 'Fictional invalid session' });
      return res.json({ id: identity.auth, aud: 'authenticated', role: 'authenticated', email: identity.email, app_metadata: {}, user_metadata: {} });
    });
    gateway.post('/auth/v1/logout', (_req, res) => res.status(204).end());
    // Matches the local Supabase gateway's API-key-to-role mapping; PostgREST
    // still verifies the signed ephemeral service-role JWT.
    gateway.use('/rest/v1', express.raw({ type: '*/*', limit: '4mb' }), async (req, res) => {
      if (req.headers.apikey !== this.serviceKey) return res.sendStatus(401);
      this.restRequests.push({ method: req.method, path: req.path });
      try {
        const headers = { authorization: `Bearer ${this.serviceKey}` };
        for (const name of ['content-type', 'accept', 'prefer', 'range', 'range-unit', 'content-profile', 'accept-profile']) if (req.headers[name]) headers[name] = req.headers[name];
        const response = await fetch(this.restUrl + req.url, {
          method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) || !req.body?.length ? {} : { body: req.body }),
        });
        res.status(response.status);
        for (const name of ['content-type', 'content-range', 'preference-applied', 'content-location']) if (response.headers.has(name)) res.set(name, response.headers.get(name));
        res.send(Buffer.from(await response.arrayBuffer()));
      } catch { res.status(502).json({ message: 'Local gateway failure' }); }
    });
    gateway.use((_req, res) => res.status(404).json({ message: 'Not part of the local gateway' }));
    this.gatewayServer = gateway.listen(0, '127.0.0.1');
    await once(this.gatewayServer, 'listening');
    this.gatewayUrl = `http://127.0.0.1:${this.gatewayServer.address().port}`;
  }

  baseEnv(extra = {}) {
    const env = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'USER', 'SHELL', 'DOCKER_HOST', 'DOCKER_CONFIG']) if (process.env[key]) env[key] = process.env[key];
    return {
      ...env,
      CVF_MEDIA_LOCAL: MARKER,
      SUPABASE_URL: this.gatewayUrl,
      SUPABASE_SERVICE_ROLE_KEY: this.serviceKey,
      SUPABASE_ANON_KEY: this.anonKey,
      EXERCISE_MEDIA_STORE: 'local',
      EXERCISE_MEDIA_ROOT: this.mediaRoot,
      EXERCISE_MEDIA_LINK_SECRET: this.linkSecret,
      ...extra,
    };
  }

  spawnChild(name, script, args, env) {
    const out = fs.openSync(path.join(RUN_DIR, `${name}-${this.runId}.log`), 'a', 0o600);
    const child = spawn(process.execPath, ['-r', path.join(BACKEND, 'integration/local-guard.cjs'), script, ...args, `--cvf-media-run=${this.runId}`], {
      cwd: BACKEND, env, stdio: ['ignore', 'pipe', out], detached: false,
    });
    child.logFile = path.join(RUN_DIR, `${name}-${this.runId}.log`);
    child.output = '';
    child.stdout.on('data', (chunk) => { child.output += chunk; fs.appendFileSync(child.logFile, chunk); });
    this.children.set(name, child);
    return child;
  }

  async startApi({ name = 'api', env = {}, port = 0, media = true } = {}) {
    const extra = media ? {} : { EXERCISE_MEDIA_STORE: '', EXERCISE_MEDIA_ROOT: '' };
    const child = this.spawnChild(name, path.join(BACKEND, 'integration/exercise-media-api.cjs'), [], this.baseEnv({ CVF_MEDIA_API_PORT: String(port), ...extra, ...env }));
    const ready = await waitFor(() => {
      const line = child.output.split('\n').find((item) => item.includes('"listening"'));
      return line ? JSON.parse(line) : null;
    }, { what: `${name} listening` });
    child.url = `http://127.0.0.1:${ready.port}`;
    return child;
  }

  async startWorker({ name = 'worker', leaseSeconds = 30, pollMs = 300 } = {}) {
    const child = this.spawnChild(name, path.join(BACKEND, 'scripts/exercise-media-worker.cjs'), [], this.baseEnv({
      EXERCISE_MEDIA_WORKER_LABEL: `${name}-${this.runId}`, EXERCISE_MEDIA_LEASE_SECONDS: String(leaseSeconds), EXERCISE_MEDIA_POLL_MS: String(pollMs),
    }));
    await waitFor(() => child.output.includes('worker ready'), { what: `${name} ready` });
    return child;
  }

  async stopChild(name, signal = 'SIGTERM') {
    const child = this.children.get(name);
    if (!child || child.exitCode !== null || child.signalCode) { this.children.delete(name); return; }
    // Prove ownership: the process must still carry this run's marker.
    if (!commandLine(child.pid).includes(`--cvf-media-run=${this.runId}`)) throw new Error(`refusing to signal pid ${child.pid}: not this run`);
    child.kill(signal);
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
    this.children.delete(name);
  }

  seed() {
    const sql = [];
    for (const identity of Object.values(IDENTITIES)) {
      sql.push(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
        values ('00000000-0000-0000-0000-000000000000', '${identity.auth}', 'authenticated', 'authenticated', '${identity.email}', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb) on conflict (id) do nothing;`);
    }
    for (const identity of Object.values(IDENTITIES).filter((item) => item.kind === 'coach')) {
      sql.push(`insert into public.coaches (id, auth_user_id, name, email, is_admin) values ('${identity.profile}', '${identity.auth}', '${identity.name}', '${identity.email}', ${identity.admin}) on conflict (id) do nothing;`);
    }
    for (const identity of Object.values(IDENTITIES).filter((item) => item.kind === 'client')) {
      sql.push(`insert into public.clients (id, coach_id, auth_user_id, name, email, invited) values ('${identity.profile}', '${IDENTITIES[identity.coach].profile}', '${identity.auth}', '${identity.name}', '${identity.email}', true) on conflict (id) do nothing;`);
    }
    this.psql(sql.join('\n'));
  }

  async login(key, apiUrl) {
    const identity = IDENTITIES[key];
    const response = await fetch(`${apiUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identity.email, password: this.password }) });
    const body = await response.json();
    if (response.status !== 200) throw new Error(`login ${key} failed: ${response.status} ${body.error}`);
    return body.access_token;
  }

  writeRuntime(extra = {}) {
    const runtime = {
      schema_version: 1, run_id: this.runId, marker: MARKER, started_at: new Date().toISOString(),
      database: { project_id: 'cvfpt-media-test', container: 'supabase_db_cvfpt-media-test', port: 58322, published_host: '0.0.0.0 (Supabase CLI default; disposable fictional data only)' },
      postgrest: { container: 'cvfpt-media-test-postgrest', url: this.restUrl },
      gateway: { url: this.gatewayUrl, pid: process.pid, note: 'fictional loopback auth for synthetic accounts only' },
      children: Object.fromEntries([...this.children].map(([name, child]) => [name, { pid: child.pid, url: child.url || null, log: path.relative(ROOT, child.logFile) }])),
      media_root: path.relative(ROOT, this.mediaRoot),
      ...extra,
    };
    fs.writeFileSync(path.join(RUN_DIR, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
    return runtime;
  }

  async down({ keepDatabase = false } = {}) {
    for (const name of [...this.children.keys()]) await this.stopChild(name);
    if (this.gatewayServer) await new Promise((resolve) => this.gatewayServer.close(resolve));
    // The coordination lock stays held while a kept demo database is still running.
    if (!keepDatabase) { stack(['down']); stack(['unlock']); }
    // Remove the runtime manifest only when this run wrote it.
    const runtimeFile = path.join(RUN_DIR, 'runtime.json');
    try { if (JSON.parse(fs.readFileSync(runtimeFile, 'utf8')).run_id === this.runId) fs.rmSync(runtimeFile, { force: true }); } catch { /* absent */ }
  }
}

module.exports = { MediaHarness, IDENTITIES, MARKER, ROOT, LOCAL_DIR, RUN_DIR, stack, commandLine, waitFor, freePort, signJwt };
