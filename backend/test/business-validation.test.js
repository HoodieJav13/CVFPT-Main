const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCashPayment, validateCourtesyGrant, validatePackagePayload, validateSchedulePayload,
} = require('../src/validation/business');

test('package validation rejects negative, fractional, oversized, and empty values', () => {
  assert.equal(validatePackagePayload({ name: 'Pack', price: -1 }).ok, false);
  assert.equal(validatePackagePayload({ name: 'Pack', price: 10, session_credits: 1.5 }).ok, false);
  assert.equal(validatePackagePayload({ name: 'x'.repeat(121), price: 10 }).ok, false);
  assert.equal(validatePackagePayload({}, { partial: true }).ok, false);
  assert.deepEqual(
    validatePackagePayload({ name: '  Pack  ', price: '25', session_credits: '4' }).value,
    { name: 'Pack', price: 25, session_credits: 4 },
  );
});

test('payment validation separates cash revenue from courtesy credits', () => {
  assert.equal(validateCashPayment({ client_id: 'client', package_id: 'package', amount: 0 }).ok, false);
  assert.equal(validateCashPayment({ client_id: 'client', package_id: 'package', amount: 25 }).ok, true);
  assert.equal(validateCourtesyGrant({ client_id: 'client', credits: 1, reason: 'family' }).ok, true);
  assert.equal(validateCourtesyGrant({ client_id: 'client', credits: 1, reason: 'other' }).ok, false);
  assert.equal(validateCourtesyGrant({ client_id: 'client', credits: 11, reason: 'photography_barter', note: 'Photo trade' }).ok, true);
});

test('schedule validation rejects invalid dates and out-of-range durations', () => {
  assert.equal(validateSchedulePayload({ scheduled_at: 'not-a-date' }, { requireDate: true }).ok, false);
  assert.equal(validateSchedulePayload({ scheduled_at: '2030-01-01T10:00:00Z', duration_minutes: 0 }, { requireDate: true }).ok, false);
  assert.equal(validateSchedulePayload({ duration_minutes: 241 }).ok, false);
  assert.equal(validateSchedulePayload({ scheduled_at: '2030-01-01T10:00:00Z' }, { requireDate: true }).value.duration_minutes, 60);
});
