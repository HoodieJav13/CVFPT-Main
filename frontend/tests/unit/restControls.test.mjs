import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustRestEnd, DEFAULT_MANUAL_REST_SECONDS, manualRestSeconds, REST_ADJUST_SECONDS,
} from '../../src/lib/rest.js';

test('manual rest uses the current exercise rest, else 90 seconds', () => {
  assert.equal(REST_ADJUST_SECONDS, 15);
  assert.equal(manualRestSeconds({ prescribed_rest_seconds: 120 }), 120);
  assert.equal(manualRestSeconds({ prescribed_rest_seconds: 0 }), DEFAULT_MANUAL_REST_SECONDS);
  assert.equal(manualRestSeconds({ prescribed_rest_seconds: null }), 90);
  assert.equal(manualRestSeconds(undefined), 90);
  assert.equal(manualRestSeconds({ prescribed_rest_seconds: 999999 }), 36000);
});

test('±15 adjusts a running timer, never into the past and within the rest range', () => {
  const now = 1_000_000;
  const end = now + 60_000;
  assert.equal(adjustRestEnd(end, 15, now), now + 75_000);
  assert.equal(adjustRestEnd(end, -15, now), now + 45_000);
  // Ten seconds left, minus 15: the rest finishes now.
  assert.equal(adjustRestEnd(now + 10_000, -15, now), now);
  // Capped at 10 hours remaining.
  assert.equal(adjustRestEnd(now + 36_000_000, 15, now), now + 36_000_000);
});
