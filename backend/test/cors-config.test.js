const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCAL_ORIGINS, corsConfiguration, createCorsOriginCheck } = require('../src/config/cors');

test('development defaults to local frontend origins without credentials', () => {
  assert.deepEqual(corsConfiguration({ NODE_ENV: 'development' }), {
    origins: LOCAL_ORIGINS,
    credentials: false,
  });
});

test('production defaults to no browser origins', () => {
  assert.deepEqual(corsConfiguration({ NODE_ENV: 'production' }), { origins: [], credentials: false });
});

test('CORS rejects wildcards, paths, malformed URLs, and non-HTTP schemes', () => {
  for (const value of ['*', 'https://example.com/path', 'not-a-url', 'ftp://example.com']) {
    assert.throws(() => corsConfiguration({ CORS_ORIGINS: value }), /explicit HTTP\(S\) origins/);
  }
});

test('CORS normalizes, de-duplicates, and checks exact origins', () => {
  const configuration = corsConfiguration({
    CORS_ORIGINS: 'https://preview.example.com,http://localhost:3000,https://preview.example.com',
  });
  assert.deepEqual(configuration.origins, ['https://preview.example.com', 'http://localhost:3000']);

  const check = createCorsOriginCheck(configuration.origins);
  check('https://preview.example.com', (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, true);
  });
  check('https://evil.example.com', (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, false);
  });
  check(undefined, (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, true);
  });
});
