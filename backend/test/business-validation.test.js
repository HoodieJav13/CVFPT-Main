const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateBookingListQuery,
  validateOptionalText,
  validatePackagePayload,
  validateSchedulePayload,
  validateSessionListQuery,
  validateSessionNotePayload,
  validateUuid,
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

test('schedule validation rejects invalid dates and out-of-range durations', () => {
  assert.equal(validateSchedulePayload({ scheduled_at: 'not-a-date' }, { requireDate: true }).ok, false);
  assert.equal(validateSchedulePayload({ scheduled_at: '2030-01-01T10:00:00Z', duration_minutes: 0 }, { requireDate: true }).ok, false);
  assert.equal(validateSchedulePayload({ duration_minutes: 241 }).ok, false);
  assert.equal(validateSchedulePayload({ scheduled_at: ['2030-01-01T10:00:00Z'] }, { requireDate: true }).ok, false);
  assert.equal(validateSchedulePayload({ duration_minutes: '60' }).ok, false);
  assert.equal(validateSchedulePayload({ scheduled_at: '2030-01-01T10:00:00Z' }, { requireDate: true }).value.duration_minutes, 60);
});

test('session and booking filters reject malformed identifiers, dates, and statuses', () => {
  assert.equal(validateUuid('not-a-uuid').ok, false);
  assert.equal(validateSessionListQuery({ client_id: 'not-a-uuid' }).ok, false);
  assert.equal(validateSessionListQuery({ from: 'not-a-date' }).ok, false);
  assert.equal(validateSessionListQuery({ status: 'pending' }).ok, false);
  assert.equal(validateBookingListQuery({ status: 'scheduled' }).ok, false);
  assert.deepEqual(validateBookingListQuery({ status: 'pending' }).value, { status: 'pending' });
});

test('schedule text and note fields reject structured values and truthy boolean strings', () => {
  assert.equal(validateOptionalText({ value: 'Studio' }, 'Location').ok, false);
  assert.deepEqual(validateOptionalText('  CVF Studio  ', 'Location'), { ok: true, value: 'CVF Studio' });
  assert.equal(validateSessionNotePayload({ content: 123 }).ok, false);
  assert.equal(validateSessionNotePayload({ content: 'Ready', shared_with_client: 'false' }).ok, false);
  assert.equal(validateSessionNotePayload({}, { partial: true }).ok, false);
  assert.equal(validateSessionNotePayload({ content: '   ' }, { partial: true }).ok, false);
  assert.deepEqual(
    validateSessionNotePayload({ content: '  Ready  ', shared_with_client: false }),
    { ok: true, value: { content: 'Ready', shared_with_client: false } },
  );
});
