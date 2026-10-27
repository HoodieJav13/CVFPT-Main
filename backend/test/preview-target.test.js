const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewTargetHandler } = require('../src/routes/previewTarget');

function invoke(overrides = {}) {
  const env = { VERCEL: '1', VERCEL_ENV: 'preview', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', ...overrides };
  const response = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  createPreviewTargetHandler(env)({ query: { VERCEL_ENV: 'preview', SUPABASE_URL: 'https://another-project.example' } }, response);
  return response;
}

test('Preview returns exactly the parsed project reference, with no credentials or caching', () => {
  const r = invoke({ NODE_ENV: 'production', SUPABASE_SERVICE_ROLE_KEY: 'never_return_this', SUPABASE_ANON_KEY: 'never_return_that' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { project_ref: 'abcdefghijklmnopqrst' });
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(r.body).includes('never_return'));
});

for (const env of ['production', 'development', '', undefined, 'Preview']) {
  test(`unavailable outside exact Preview: ${String(env)}`, () => {
    const r = invoke({ VERCEL_ENV: env });
    assert.equal(r.statusCode, 404);
    assert.deepEqual(r.body, { error: 'Not found' });
  });
}

test('local runtime cannot expose the diagnostic', () => {
  assert.equal(invoke({ VERCEL: undefined }).statusCode, 404);
});

for (const url of [undefined, '', 'not a URL', 'http://abcdefghijklmnopqrst.supabase.co', 'https://user:password@abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co:444', 'https://abcdefghijklmnopqrst.supabase.co/path', 'https://abcdefghijklmnopqrst.supabase.co?secret=value', 'https://abcdefghijklmnopqrst.supabase.co#secret', 'https://abcdefghijklmnopqrst.supabase.co.attacker.example', 'https://short.supabase.co']) {
  test(`invalid or unsupported URL is unavailable without echo: ${String(url)}`, () => {
    const r = invoke({ SUPABASE_URL: url });
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.body, { project_ref: null });
    assert.equal(r.headers['Cache-Control'], 'no-store');
  });
}

test('another valid project is reported truthfully rather than hardcoded Development', () => {
  assert.deepEqual(invoke({ SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co/' }).body, { project_ref: 'zyxwvutsrqponmlkjihg' });
});
