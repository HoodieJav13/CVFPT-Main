import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsMode, buildCoachEvent, coachScreen, createCaptureTransport, createCoachTracker,
  failureKind, observeSessionSave,
} from '../../src/lib/coachAnalyticsCore.js';

const saveFields = { operation: 'create', outcome: 'success', workout_change: 'attached', failure_kind: 'none' };
const secret = 'PRIVATE Name private@example.invalid athlete-123 notes-health SECRET /coach/clients/athlete-123?token=SECRET';
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('gates reject production, real data, default/missing config and personal account keys', () => {
  const config = { allowedBuild: true, syntheticFixtures: true, requestedMode: 'synthetic-preview', host: 'https://us.i.posthog.com', token: 'phc_SYNTHETIC' };
  assert.equal(analyticsMode(config), 'synthetic-preview');
  assert.equal(analyticsMode({ ...config, requestedMode: 'local', token: '' }), 'local');
  for (const patch of [
    { allowedBuild: false }, { syntheticFixtures: false }, { requestedMode: undefined },
    { requestedMode: 'off' }, { token: '' }, { token: 'phx_ACCOUNT' },
    { host: 'https://us.i.posthog.com/evil' }, { host: 'https://other.invalid' },
  ]) assert.equal(analyticsMode({ ...config, ...patch }), 'off');
});

test('navigation maps only mounted coach routes to enums and drops query/hash/IDs', () => {
  const cases = { '/coach': 'home', '/coach/clients': 'clients', '/coach/clients/athlete-123?token=SECRET': 'client_detail',
    '/coach/sessions/s123': 'session_detail', '/coach/messages/athlete-123': 'messages',
    '/coach/programs/': 'programs', '/coach/workouts/athlete-123': 'workout_detail', '/coach/workouts/w123/track': 'workout_tracker' };
  for (const [path, screen] of Object.entries(cases)) assert.equal(coachScreen(path), screen);
  for (const path of ['/client', '/client/sessions/x', '/admin', '/login', '/reset-password?token=SECRET', '/coach/resources/x', '/coach/clients/x/notes', '/coach/workouts']) assert.equal(coachScreen(path), null);
});

test('all payloads are reconstructed from enums, with no free text or SDK context', () => {
  for (const [event, fields] of [
    ['cvfpt_coach_screen_viewed', { screen: 'client_detail' }],
    ['cvfpt_coach_session_save', saveFields],
    ['$exception', { source: 'action', operation: 'create', failure_kind: 'server' }],
    ['$exception', { source: 'render', screen: 'sessions', failure_kind: 'unknown' }],
  ]) {
    const payload = buildCoachEvent(event, { ...fields, name: secret, email: secret, client_id: secret, notes: secret,
      error: new Error(secret), url: secret, $current_url: secret, $set: { name: secret }, $exception_list: [{ value: secret }], $ip: secret });
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(secret), false);
    assert.equal(payload.distinct_id, 'cvfpt-synthetic-preview');
    assert.equal(payload.properties.$ip, null);
    assert.equal(payload.properties.$geoip_disable, true);
    assert.equal(payload.properties.$process_person_profile, false);
    assert.equal('stacktrace' in (payload.properties.$exception_list?.[0] || {}), false);
    assert.deepEqual(Object.keys(payload).sort(), ['distinct_id', 'event', 'properties']);
  }
  assert.equal(buildCoachEvent('$pageview', { screen: 'sessions' }), null);
  assert.equal(buildCoachEvent('cvfpt_coach_screen_viewed', { screen: secret }), null);
  assert.equal(buildCoachEvent('cvfpt_coach_session_save', { ...saveFields, operation: secret }), null);
  assert.equal(buildCoachEvent('$exception', { source: 'action', operation: secret, failure_kind: 'server' }), null);
});

test('only numeric HTTP status is used, even for malicious/nonstandard errors', () => {
  assert.equal(failureKind({ message: secret }), 'network');
  for (const [status, kind] of [[503, 'server'], [409, 'conflict'], [401, 'authorization'], [403, 'authorization'], [422, 'validation'], ['503', 'unknown'], [200, 'unknown']]) {
    assert.equal(failureKind({ response: { status, data: secret }, message: secret, stack: secret }), kind);
  }
  assert.equal(failureKind({ get response() { throw Error(secret); } }), 'unknown');
});

test('telemetry throws/rejects/hangs cannot break successful saves or change the original API error', async () => {
  const response = { data: { id: 'private-session', notes: secret } };
  const originalError = { response: { status: 503, data: { error: secret } } };
  for (const emit of [() => { throw Error(secret); }, () => Promise.reject(Error(secret)), () => new Promise(() => {})]) {
    assert.equal(await observeSessionSave(() => Promise.resolve(response), saveFields, emit), response);
    await assert.rejects(observeSessionSave(() => Promise.reject(originalError), saveFields, emit), (error) => error === originalError);
  }
  await tick();
});

test('API outcomes reflect commit uncertainty and recovered recurring saves, with no false error on conflicts', async () => {
  for (const [status, outcome, exceptions] of [[undefined, 'unconfirmed', 1], [500, 'unconfirmed', 1], [409, 'failure', 0], [422, 'failure', 0]]) {
    const events = [];
    const original = status === undefined ? Error(secret) : { response: { status, data: secret } };
    await assert.rejects(observeSessionSave(() => { throw original; }, saveFields, (event, fields) => events.push(buildCoachEvent(event, fields))), (error) => error === original);
    assert.equal(events[0].properties.outcome, outcome);
    assert.equal(events.filter((event) => event.event === '$exception').length, exceptions);
    assert.equal(JSON.stringify(events).includes(secret), false);
  }
  const events = [];
  await observeSessionSave(() => ({ data: { replayed: true, receipt: { slots: [{ client_id: secret }] } } }), { ...saveFields, operation: 'series_create' }, (event, fields) => events.push(buildCoachEvent(event, fields)));
  assert.equal(events[0].properties.outcome, 'recovered');
});

test('tracker is off by default, bounds traffic/errors and deduplicates repeated exceptions', async () => {
  const events = [];
  assert.equal(createCoachTracker({ send: (payload) => events.push(payload) })('cvfpt_coach_session_save', saveFields), false);
  let now = 0;
  const emit = createCoachTracker({ mode: 'local', send: (payload) => events.push(payload), now: () => now });
  const error = { source: 'action', operation: 'create', failure_kind: 'server' };
  assert.equal(emit('$exception', error), true);
  assert.equal(emit('$exception', error), false);
  now += 30000;
  assert.equal(emit('$exception', error), true);
  for (let i = 0; i < 30; i += 1) { now += 30000; emit('$exception', error); }
  assert.equal(events.length, 20);
  for (let i = 0; i < 200; i += 1) emit('cvfpt_coach_session_save', saveFields);
  assert.equal(events.length, 100);
  for (const send of [() => { throw Error(secret); }, () => Promise.reject(Error(secret))]) {
    createCoachTracker({ mode: 'local', send })('cvfpt_coach_session_save', saveFields);
  }
  await tick();
});

test('HTTP envelope contains exact safe fields, no cookies/referrer/auth interceptor or injected data', async () => {
  let request;
  const send = createCaptureTransport({ host: 'https://us.i.posthog.com', token: 'phc_SYNTHETIC', fetchFn: async (url, options) => { request = { url, options }; return { ok: true }; } });
  assert.equal(await send({ ...buildCoachEvent('cvfpt_coach_session_save', saveFields), distinct_id: secret,
    properties: { ...saveFields, name: secret, $current_url: secret, $ip: secret } }), true);
  assert.equal(request.url, 'https://us.i.posthog.com/i/v0/e/');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.deepEqual(request.options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(request.options.body), { api_key: 'phc_SYNTHETIC', ...buildCoachEvent('cvfpt_coach_session_save', saveFields) });
  assert.equal(request.options.body.includes(secret), false);
});

test('HTTP failures are swallowed without retries and invalid destinations/tokens never send', async () => {
  const payload = buildCoachEvent('cvfpt_coach_session_save', saveFields);
  let calls = 0;
  const failingFetch = () => { calls += 1; throw Error(secret); };
  assert.equal(await createCaptureTransport({ host: 'https://us.i.posthog.com', token: 'phc_SYNTHETIC', fetchFn: failingFetch })(payload), false);
  assert.equal(calls, 1);
  for (const patch of [{ host: 'https://other.invalid' }, { token: 'phx_ACCOUNT' }]) {
    assert.equal(await createCaptureTransport({ host: 'https://us.i.posthog.com', token: 'phc_SYNTHETIC', ...patch, fetchFn: failingFetch })(payload), false);
  }
  assert.equal(calls, 1);
});
