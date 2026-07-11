import { randomBytes } from 'node:crypto';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required integration-test environment variable: ${name}`);
  return value;
};

const environment = required('CVF_TEST_ENV').toLowerCase();
if (!['development', 'preview'].includes(environment)) {
  throw new Error('CVF_TEST_ENV must be development or preview');
}
if (process.env.CVF_TEST_ALLOW_MUTATIONS !== 'true') {
  throw new Error('Refusing mutating integration tests without CVF_TEST_ALLOW_MUTATIONS=true');
}

const baseUrl = new URL(required('CVF_TEST_BASE_URL'));
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('CVF_TEST_BASE_URL must use HTTP(S)');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const allowedHosts = new Set(
  (process.env.CVF_TEST_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
);
if (!localHosts.has(baseUrl.hostname) && !allowedHosts.has(baseUrl.hostname.toLowerCase())) {
  throw new Error('Refusing unapproved remote target; allow its exact hostname in CVF_TEST_ALLOWED_HOSTS');
}

const accounts = {
  admin: { email: required('CVF_TEST_ADMIN_EMAIL'), password: required('CVF_TEST_ADMIN_PASSWORD') },
  coachA: { email: required('CVF_TEST_COACH_A_EMAIL'), password: required('CVF_TEST_COACH_A_PASSWORD') },
  coachB: { email: required('CVF_TEST_COACH_B_EMAIL'), password: required('CVF_TEST_COACH_B_PASSWORD') },
  client: { email: required('CVF_TEST_CLIENT_EMAIL'), password: required('CVF_TEST_CLIENT_PASSWORD') },
};

const runId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const cleanup = [];
let passed = 0;
let failed = 0;

function endpoint(path) {
  return new URL(`${baseUrl.pathname.replace(/\/$/, '')}${path}`, baseUrl).toString();
}

async function request(path, { method = 'GET', token, json, body, expected = 200 } = {}) {
  if (method === 'DELETE') throw new Error('Hard-delete requests are forbidden by this harness');
  const response = await fetch(endpoint(path), {
    method,
    headers: {
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json === undefined ? body : JSON.stringify(json),
    signal: AbortSignal.timeout(20_000),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json') ? await response.json() : await response.arrayBuffer();
  if (response.status !== expected) {
    const safeError = payload && typeof payload === 'object' && !ArrayBuffer.isView(payload)
      ? payload.error || payload.message || 'request failed'
      : 'request failed';
    throw new Error(`${method} ${path}: expected ${expected}, received ${response.status} (${safeError})`);
  }
  return { response, payload };
}

async function check(name, action) {
  try {
    const value = await action();
    passed += 1;
    console.log(`PASS ${name}`);
    return value;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
    return null;
  }
}

async function login(account, role) {
  const result = await request('/auth/login', { method: 'POST', json: account, expected: 200 });
  if (!result.payload?.access_token || result.payload.role !== role) throw new Error(`expected ${role} login`);
  return result.payload;
}

async function main() {
  console.log(`Integration target: ${environment} (${baseUrl.hostname}); run ${runId}`);

  await check('health endpoint', () => request('/health'));
  await check('protected route rejects anonymous access', () => request('/dashboard/coach', { expected: 401 }));

  const admin = await check('admin login', () => login(accounts.admin, 'admin'));
  const coachA = await check('coach A login', () => login(accounts.coachA, 'coach'));
  const coachB = await check('coach B login', () => login(accounts.coachB, 'coach'));
  const client = await check('client login', () => login(accounts.client, 'client'));
  if (!admin || !coachA || !coachB || !client) throw new Error('Required fake-data accounts could not log in');

  for (const [name, session] of Object.entries({ admin, coachA, coachB, client })) {
    await check(`${name} /auth/me`, async () => {
      const { payload } = await request('/auth/me', { token: session.access_token });
      if (!payload.profile?.id) throw new Error('profile missing');
    });
  }
  await check('client is blocked from coach dashboard', () => request('/dashboard/coach', { token: client.access_token, expected: 403 }));
  await check('coach dashboard', () => request('/dashboard/coach', { token: coachA.access_token }));
  await check('client dashboard includes assigned coach', async () => {
    const { payload } = await request('/dashboard/client', { token: client.access_token });
    if (payload.coach_name !== coachA.profile.name) throw new Error('assigned coach name missing');
  });
  await check('admin overview', () => request('/admin/overview', { token: admin.access_token }));

  const email = `cvf-test-${runId}@example.invalid`;
  const created = await check('coach creates isolated fake client', async () => {
    const { payload } = await request('/clients', {
      method: 'POST', token: coachA.access_token, expected: 201,
      json: { name: `CVF TEST ${runId}`, email, goals: 'Automated development verification' },
    });
    cleanup.push(() => request(`/clients/${payload.id}/archive`, {
      method: 'PATCH', token: coachA.access_token, json: { archived: true },
    }));
    return payload;
  });
  if (created) {
    await check('owning coach can read fake client', () => request(`/clients/${created.id}`, { token: coachA.access_token }));
    await check('other coach receives ownership-safe 404', () => request(`/clients/${created.id}`, { token: coachB.access_token, expected: 404 }));
    await check('admin can read fake client', () => request(`/clients/${created.id}`, { token: admin.access_token }));
    await check('non-invited signup is rejected', () => request('/auth/signup', {
      method: 'POST', expected: 403, json: { email, password: randomBytes(24).toString('base64url') },
    }));
  }

  const template = await check('Training Builder CSV template', () => request('/programs/import/template.csv', { token: coachA.access_token }));
  const parsed = await check('Training Builder CSV parse', async () => {
    if (!template) throw new Error('template unavailable');
    const form = new FormData();
    form.set('file', new Blob([template.payload], { type: 'text/csv' }), `CVF-TEST-${runId}.csv`);
    const { payload } = await request('/programs/import/parse-csv', {
      method: 'POST', token: coachA.access_token, body: form, expected: 200,
    });
    payload.draft.program.name = `CVF TEST ${runId}`;
    return payload.draft;
  });
  const imported = await check('Training Builder atomic import', async () => {
    if (!parsed) throw new Error('parsed draft unavailable');
    const { payload } = await request('/programs/import/commit', {
      method: 'POST', token: coachA.access_token, json: { draft: parsed }, expected: 201,
    });
    const programId = payload.program_id || payload.program?.id;
    if (!programId) throw new Error('program id missing');
    cleanup.push(() => request(`/programs/${programId}/archive`, { method: 'PATCH', token: coachA.access_token }));
    return { programId };
  });
  if (imported) {
    await check('imported program PDF export', async () => {
      const { response, payload } = await request(`/programs/${imported.programId}/export.pdf`, { token: coachA.access_token });
      if (!response.headers.get('content-type')?.includes('application/pdf') || payload.byteLength < 100) throw new Error('invalid PDF response');
    });
    await check('other coach cannot read imported program', () => request(`/programs/${imported.programId}`, { token: coachB.access_token, expected: 404 }));
  }

  await check('client assigned-program view', () => request('/programs/client/assigned', { token: client.access_token }));
  await check('client check-in view', () => request('/check-ins/mine', { token: client.access_token }));
  await check('client progress view', () => request('/progress/mine', { token: client.access_token }));
  await check('client messages view', () => request('/messages/mine', { token: client.access_token }));
  await check('client waiver status', () => request('/waivers/my-status', { token: client.access_token }));
  await check('payment configuration is test-safe or disabled', async () => {
    const { payload } = await request('/payments/config', { token: client.access_token });
    if (payload.publishable_key && !String(payload.publishable_key).startsWith('pk_test_')) throw new Error('non-test publishable key returned');
  });
  await check('client payment history', () => request('/payments/history', { token: client.access_token }));
  await check('client credit balance', () => request('/payments/credits', { token: client.access_token }));
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`FAIL harness: ${error.message}`);
} finally {
  for (const action of cleanup.reverse()) {
    try { await action(); } catch (error) { failed += 1; console.error(`FAIL cleanup: ${error.message}`); }
  }
  console.log(`Integration result: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
