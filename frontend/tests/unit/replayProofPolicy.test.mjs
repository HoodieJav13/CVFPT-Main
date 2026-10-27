import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleReplayProof, REPLAY_PROOF_POLICY as policy } from '../../src/lib/replayProofPolicy.js';

const fictional = { approved: true, fixturesOnly: true, production: false,
  origin: 'http://127.0.0.1:42732', allowedOrigin: 'http://127.0.0.1:42732', pathname: '/coach' };
test('replay proposal stays disabled and explicitly masks/blocks data, console, network and media', () => {
  const options = policy.options;
  for (const key of ['autocapture', 'rageclick', 'capture_pageview', 'capture_pageleave', 'capture_exceptions', 'enable_recording_console_log', 'capture_performance']) assert.equal(options[key], false);
  assert.equal(options.disable_session_recording, true);
  assert.equal(options.disable_persistence, true);
  assert.equal(options.person_profiles, 'never');
  assert.equal(options.opt_out_capturing_by_default, true);
  assert.equal(options.before_send({ properties: { notes: 'PRIVATE' } }), null);
  const recording = options.session_recording;
  assert.equal(recording.maskAllInputs, true);
  assert.equal(recording.maskTextSelector, '*');
  assert.equal(recording.maskAllElementAttributes, true);
  for (const key of ['recordCanvas', 'recordCrossOriginIframes', 'recordHeaders', 'recordBody', 'recordPerformance']) assert.equal(recording[key], false);
  assert.equal(recording.maskCapturedNetworkRequestFn({ url: '/clients/private', body: 'health notes', headers: { authorization: 'SECRET' } }), undefined);
  assert.match(recording.blockSelector, /main/);
  assert.match(recording.blockSelector, /dialog/);
});

test('only approved fixture navigation within one explicit non-production origin is eligible', () => {
  for (const path of policy.allowedPaths) assert.equal(eligibleReplayProof({ ...fictional, pathname: path }), true);
  for (const patch of [{ approved: false }, { fixturesOnly: false }, { production: true },
    { origin: 'https://app.corevaluefit.com', allowedOrigin: 'https://app.corevaluefit.com' },
    { origin: 'https://another-preview.invalid' }, { allowedOrigin: '' },
    { search: '?token=SECRET' }, { hash: '#private' },
    ...['/coach/clients', '/coach/clients/client_sarah', '/coach/sessions/session123', '/coach/messages', '/coach/workouts/w1/track', '/client', '/login', '/admin'].map((pathname) => ({ pathname })),
  ]) assert.equal(eligibleReplayProof({ ...fictional, ...patch }), false);
});

test('replay test budget admits only one run under two minutes and two MiB', () => {
  for (const patch of [{ sessionsUsed: 1 }, { sessionsUsed: -1 }, { elapsedMs: 120000 }, { bytes: 2 * 1024 * 1024 }, { elapsedMs: NaN }, { bytes: -1 }]) {
    assert.equal(eligibleReplayProof({ ...fictional, ...patch }), false);
  }
});
