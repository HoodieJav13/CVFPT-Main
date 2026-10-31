// The real app mounts the whole-week routers behind requireAuth. Requests carry
// no bearer token, so requireAuth answers 401 before any Supabase call; no
// credentials or network are used. Unknown /api paths still answer JSON 404.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

test('whole-week routes are mounted behind authentication without changing unknown-route 404s', async (t) => {
  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const activity = '00000000-0000-4000-8000-000000000031';
  for (const [method, path] of [
    ['GET', '/whole-week/capability'], ['GET', '/whole-week/mine'], ['GET', `/whole-week/clients/${activity}`],
    ['POST', '/outside-activities/mine'], ['PATCH', `/outside-activities/${activity}`], ['PATCH', `/outside-activities/${activity}/archive`],
    ['PATCH', '/context-preferences/mine'],
  ]) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  const unknown = await fetch(`${base}/not-a-real-route`);
  assert.equal(unknown.status, 404);
});
