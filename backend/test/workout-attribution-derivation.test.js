const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { computeLogAttribution } = require('../src/routes/workoutLogs');

function log(startedBy, sets) {
  return {
    started_by: startedBy,
    exercises: [{ sets }],
  };
}

const clientSet = { status: 'completed', entered_by: 'client', archived: false };
const coachSet = { status: 'completed', entered_by: 'coach', archived: false };

test('all completed sets client-entered derives client', () => {
  assert.equal(computeLogAttribution(log('client', [clientSet, clientSet])), 'client');
});

test('all completed sets coach-entered derives coach', () => {
  assert.equal(computeLogAttribution(log('coach', [coachSet, coachSet])), 'coach');
});

test('both actors on completed sets derives mixed', () => {
  assert.equal(computeLogAttribution(log('client', [clientSet, coachSet])), 'mixed');
});

test('untouched prescribed and skipped sets carry no attribution weight', () => {
  const pendingDefault = { status: 'pending', entered_by: 'client', archived: false };
  const skippedDefault = { status: 'skipped', entered_by: 'client', archived: false };
  // A coach-run workout whose remaining sets were skipped must not read as mixed.
  assert.equal(computeLogAttribution(log('coach', [coachSet, pendingDefault, skippedDefault])), 'coach');
});

test('archived completed sets are ignored', () => {
  const archivedCoach = { ...coachSet, archived: true };
  assert.equal(computeLogAttribution(log('client', [clientSet, archivedCoach])), 'client');
});

test('no completed sets falls back to who started the log', () => {
  const pending = { status: 'pending', entered_by: 'client', archived: false };
  assert.equal(computeLogAttribution(log('coach', [pending])), 'coach');
  assert.equal(computeLogAttribution(log('client', [pending])), 'client');
  assert.equal(computeLogAttribution(log(undefined, [])), 'client');
});
