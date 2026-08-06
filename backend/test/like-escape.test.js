const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeLikePattern } = require('../src/utils/like');

test('escapes ILIKE wildcards so patterns match literally', () => {
  assert.equal(escapeLikePattern('j_hn@x.com'), 'j\\_hn@x.com');
  assert.equal(escapeLikePattern('j%@x.com'), 'j\\%@x.com');
  assert.equal(escapeLikePattern('a\\b@x.com'), 'a\\\\b@x.com');
  assert.equal(escapeLikePattern('plain@x.com'), 'plain@x.com');
  assert.equal(escapeLikePattern(''), '');
});
