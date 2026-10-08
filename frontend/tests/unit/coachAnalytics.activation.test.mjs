import test from 'node:test';
import assert from 'node:assert/strict';
import * as analytics from '../../src/lib/coachAnalyticsCore.js';

const uuid1 = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const config = { allowedBuild: false, productionBuild: true, syntheticFixtures: false,
  requestedMode: 'production-coach', host: 'https://us.i.posthog.com', token: 'phc_FICTIONAL' };
const fields = { operation: 'create', outcome: 'success', workout_change: 'attached', failure_kind: 'none' };
const poison = 'PRIVATE client@example.invalid client-id health-message /coach/clients/id?secret=PRIVATE';

test('production capture requires explicit production mode, production build, US host and public token', () => {
  assert.equal(analytics.analyticsMode(config), 'production-coach');
  for (const patch of [{ productionBuild: false }, { syntheticFixtures: true }, { requestedMode: undefined },
    { requestedMode: 'off' }, { requestedMode: 'local' }, { requestedMode: 'synthetic-preview' },
    { host: 'https://eu.i.posthog.com' }, { host: 'https://us.i.posthog.com/evil' },
    { token: '' }, { token: 'phx_ACCOUNT' }]) {
    assert.equal(analytics.analyticsMode({ ...config, ...patch }), 'off');
  }
});

test('visit ID is memory-only, stable within a coach visit, and replaced after role loss', () => {
  let generated = 0;
  const visit = analytics.createCoachVisit({ randomUUID: () => ++generated === 1 ? uuid1 : uuid2 });
  for (const role of [null, undefined, 'client', 'admin', 'unknown']) {
    visit.setRole(role);
    assert.equal(visit.getContext('production-coach'), null);
  }
  assert.equal(generated, 0);
  visit.setRole('coach');
  const first = visit.getContext('production-coach');
  assert.equal(first.distinctId, uuid1);
  assert.deepEqual(visit.getContext('production-coach'), first);
  visit.setRole('coach');
  assert.deepEqual(visit.getContext('production-coach'), first);
  visit.setRole(null);
  assert.equal(visit.getContext('production-coach'), null);
  visit.setRole('coach');
  assert.equal(visit.getContext('production-coach').distinctId, uuid2);
  assert.equal(generated, 2);
  assert.equal(visit.getContext('off'), null);
  for (const randomUUID of [() => undefined, () => poison, () => { throw Error(poison); }]) {
    const broken = analytics.createCoachVisit({ randomUUID });
    broken.setRole('coach');
    assert.equal(broken.getContext('production-coach'), null);
  }
});

test('production serialization contains only exact enums, anonymous ID and privacy constants', async () => {
  const visit = analytics.createCoachVisit({ randomUUID: () => uuid1 });
  visit.setRole('coach');
  const getContext = () => visit.getContext('production-coach');
  const requests = [];
  const send = analytics.createCaptureTransport({ host: config.host, token: config.token, getContext,
    fetchFn: async (url, options) => { requests.push({ url, options }); return { ok: true }; } });
  for (const [event, safe] of [
    ['cvfpt_coach_screen_viewed', { screen: 'client_detail' }],
    ['cvfpt_coach_session_save', fields],
    ['$exception', { source: 'action', operation: 'create', failure_kind: 'server' }],
    ['$exception', { source: 'render', screen: 'sessions', failure_kind: 'unknown' }],
  ]) {
    const payload = analytics.buildCoachEvent(event, { ...safe, name: poison, email: poison, client_id: poison,
      workout_values: poison, message: poison, error: Error(poison), stack: poison, url: poison,
      $current_url: poison, $set: { name: poison }, $ip: poison,
      $exception_list: [{ value: poison }], $lib: poison, $session_id: poison }, getContext());
    assert.equal(await send(payload), true);
    const body = JSON.parse(requests.at(-1).options.body);
    assert.deepEqual(Object.keys(body).sort(), ['api_key', 'distinct_id', 'event', 'properties']);
    assert.equal(body.distinct_id, uuid1);
    assert.equal(body.properties.environment, 'production');
    assert.equal(body.properties.schema_version, 2);
    assert.equal(body.properties.$ip, null);
    assert.equal(body.properties.$geoip_disable, true);
    assert.equal(body.properties.$process_person_profile, false);
    const common = ['app', 'schema_version', 'environment', '$process_person_profile', '$ip', '$geoip_disable'];
    const additions = event === 'cvfpt_coach_screen_viewed' ? ['screen']
      : event === 'cvfpt_coach_session_save' ? ['operation', 'outcome', 'workout_change', 'failure_kind']
        : ['source', 'failure_kind', safe.source === 'action' ? 'operation' : 'screen',
          '$exception_list', '$exception_fingerprint', '$exception_level'];
    assert.deepEqual(Object.keys(body.properties).sort(), [...common, ...additions].sort());
    assert.equal(requests.at(-1).url, 'https://us.i.posthog.com/i/v0/e/');
    assert.equal(requests.at(-1).options.credentials, 'omit');
    assert.equal(requests.at(-1).options.referrerPolicy, 'no-referrer');
    assert.equal(JSON.stringify(body).includes(poison), false);
    if (event === '$exception') {
      assert.deepEqual(Object.keys(body.properties.$exception_list[0]).sort(), ['mechanism', 'type', 'value']);
      assert.equal(body.properties.$exception_list[0].type, 'CvfptCoachFailure');
      assert.deepEqual(body.properties.$exception_list[0].mechanism,
        { type: 'generic', handled: safe.source === 'action', synthetic: true });
      assert.match(body.properties.$exception_fingerprint, /^cvfpt-v2-/);
    }
  }
  assert.equal(analytics.buildCoachEvent('cvfpt_coach_session_save', fields, { mode: 'production-coach', distinctId: poison }), null);
});

test('tracker and transport reject non-coach roles, invalid identity and stale visit payloads', async () => {
  let next = 0;
  const visit = analytics.createCoachVisit({ randomUUID: () => ++next === 1 ? uuid1 : uuid2 });
  const getContext = () => visit.getContext('production-coach');
  let requests = 0;
  const send = analytics.createCaptureTransport({ host: config.host, token: config.token, getContext,
    fetchFn: async () => { requests += 1; return { ok: true }; } });
  const emit = analytics.createCoachTracker({ mode: 'production-coach', getContext, send });
  assert.equal(emit('cvfpt_coach_session_save', fields), false);
  visit.setRole('coach');
  const old = analytics.buildCoachEvent('cvfpt_coach_session_save', fields, getContext());
  assert.equal(emit('cvfpt_coach_session_save', fields), true);
  visit.setRole('client');
  assert.equal(emit('cvfpt_coach_session_save', fields), false);
  assert.equal(await send(old), false);
  visit.setRole('coach');
  assert.equal(await send(old), false);
  assert.equal(await send({ ...old, distinct_id: poison }), false);
  assert.equal(emit('cvfpt_coach_session_save', fields), true);
  assert.equal(requests, 2);
});

test('production caps remain per boot across role/visit changes and error dedup is retained', () => {
  const visit = analytics.createCoachVisit({ randomUUID: () => uuid1 });
  visit.setRole('coach');
  let now = 0;
  const events = [];
  const emit = analytics.createCoachTracker({ mode: 'production-coach', getContext: () => visit.getContext('production-coach'),
    now: () => now, send: payload => events.push(payload) });
  const error = { source: 'action', operation: 'create', failure_kind: 'server' };
  assert.equal(emit('$exception', error), true);
  assert.equal(emit('$exception', error), false);
  for (let i = 0; i < 30; i += 1) { now += 30000; emit('$exception', error); }
  assert.equal(events.length, 20);
  visit.setRole(null); visit.setRole('coach');
  for (let i = 0; i < 200; i += 1) emit('cvfpt_coach_session_save', fields);
  assert.equal(events.length, 100);
});
