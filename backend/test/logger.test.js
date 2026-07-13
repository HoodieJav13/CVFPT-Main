const test = require('node:test');
const assert = require('node:assert/strict');
const { logError } = require('../src/utils/logger');

test('error logger omits messages, stacks, values, and unsafe provider codes', () => {
  const original = console.error;
  let captured;
  console.error = (...args) => { captured = args; };
  try {
    logError('checkout error', {
      name: 'ProviderError',
      code: 'bad code containing secret-value',
      status: 503,
      message: 'secret-value',
      stack: 'secret-value',
      request: { authorization: 'secret-value' },
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(captured, ['checkout error', { name: 'ProviderError', status: 503 }]);
  assert.doesNotMatch(JSON.stringify(captured), /secret-value/);
});
