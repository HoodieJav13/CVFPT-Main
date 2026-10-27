import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayProofConfig, proofReplayUrl, proofStyleRegistry } from '../../src/lib/replayProofSanitizer.js';
const gate = { approved: true, fixturesOnly: true, production: false, origin: 'http://127.0.0.1:42734', allowedOrigin: 'http://127.0.0.1:42734', pathname: '/coach' };
const session = '00000000-0000-4000-8000-000000000001';
const windowId = '00000000-0000-4000-8000-000000000002';
function packet(data, patch = {}) { return { event: '$snapshot', timestamp: new Date(0), uuid: 'PRIVATE_UUID', properties: {
  $session_id: session, $window_id: windowId, token: 'phc_LOCAL_SYNTHETIC', $snapshot_data: data,
  $current_url: 'https://private.invalid/athlete/private', $set: { email: 'private@example.invalid' }, notes: 'PRIVATE', ...patch,
} }; }
const full = { type: 2, timestamp: 0, data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: 'body', attributes: { 'data-PRIVATE': 'SECRET' }, childNodes: [
  { type: 2, id: 3, tagName: 'nav', attributes: { class: 'flex PRIVATE_CLASS items-center', title: 'PRIVATE_EMAIL' }, childNodes: [{ type: 3, id: 4, textContent: 'PRIVATE_NAME_HEALTH_NOTE' }] },
] }] }, initialOffset: { left: 0, top: 0, private: 'SECRET' } } };
const config = (patch = {}) => createReplayProofConfig({ gate, decodeCompressed: v => v, now: () => 0, ...patch });

test('real snapshot envelope reconstruction drops provider defaults, arbitrary attributes, text and custom/config records', () => {
  const clean = config().options.before_send(packet([full, { type: 5, timestamp: 0, data: { tag: '$posthog_config', payload: { token: 'PRIVATE' } } },
    { type: 6, timestamp: 0, data: { plugin: 'network', payload: { authorization: 'PRIVATE' } } },
    { type: 3, timestamp: 0, data: { source: 5, id: 3, text: 'PRIVATE_INPUT' } },
    { type: 3, timestamp: 0, data: { source: 0, texts: [{ id: 4, value: 'PRIVATE_MUTATION' }], attributes: [{ id: 3, attributes: { 'data-PRIVATE': 'SECRET', style: 'background:url(https://private.invalid)' } }], adds: [], removes: [] } },
  ]));
  assert(clean); assert.doesNotMatch(JSON.stringify(clean), /PRIVATE|SECRET|HEALTH|private.invalid|example.invalid|\$posthog_config|network|authorization/);
  assert.equal(clean.properties.$snapshot_data.length, 2);
  assert.equal(clean.properties.$snapshot_data[0].data.node.childNodes[0].childNodes[0].attributes.class, 'flex items-center');
  assert.equal(clean.properties.$snapshot_data[0].data.node.childNodes[0].childNodes[0].childNodes[0].textContent, '[redacted]');
});

test('only exact reviewed styles are serialized, with resource URLs/imports/comments removed', () => {
  const css = '/* PRIVATE */ @import url(https://private.invalid/x); .flex { display:flex; background-image:url(data:SECRET); }';
  const registry = proofStyleRegistry([css]); assert.doesNotMatch(registry.get(css), /PRIVATE|SECRET|url\(|@import|https?:|data:/);
  const node = { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: 'style', attributes: { 'data-secret': 'PRIVATE' }, childNodes: [{ type: 3, id: 3, textContent: css }, { type: 3, id: 4, textContent: 'PRIVATE unreviewed stylesheet' }] }] };
  const clean = config({ reviewedStyles: [css] }).options.before_send(packet([{ type: 2, timestamp: 0, data: { node, initialOffset: {} } }]));
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE|SECRET|unreviewed|url\(|@import|https?:|data:/);
  assert.equal(clean.properties.$snapshot_data[0].data.node.childNodes[0].childNodes.length, 1);
});

test('route metadata uses a fictional origin; query/hash/identifiers and actual network requests fail closed', () => {
  assert.equal(proofReplayUrl('/coach/sessions', gate.origin), 'https://cvfpt-synthetic.invalid/coach/sessions');
  for (const url of ['/coach/clients/id', '/coach?token=PRIVATE', '/coach#PRIVATE', 'https://external.invalid/coach']) assert.equal(proofReplayUrl(url, gate.origin), null);
  const mask = config().options.session_recording.maskCapturedNetworkRequestFn;
  assert.deepEqual(mask({ name: gate.origin + '/coach' }), { name: 'https://cvfpt-synthetic.invalid/coach' });
  assert.equal(mask({ name: gate.origin + '/coach', headers: { secret: 'PRIVATE' } }), undefined);
  assert.equal(mask({ name: gate.origin + '/coach?token=PRIVATE' }), undefined);
});

test('blocked media retain only numeric placeholder geometry; whitespace stays empty', () => {
  const node = { type: 0, id: 1, childNodes: [
    { type: 2, id: 2, tagName: 'img', attributes: { class: 'h-9 w-9 PRIVATE', rr_width: '36px', rr_height: '36px', src: 'https://private.invalid/athlete' }, childNodes: [] },
    { type: 3, id: 3, textContent: '\n  ' },
    { type: 2, id: 4, tagName: 'img', attributes: { rr_width: 'PRIVATE', rr_height: '36px' }, childNodes: [] },
  ] };
  const proof = config();
  const clean = proof.options.before_send(packet([{ type: 2, timestamp: 0, data: { node, initialOffset: {} } }]));
  const children = clean.properties.$snapshot_data[0].data.node.childNodes;
  assert.equal(children.length, 2);
  assert.deepEqual(children[0].attributes, { class: 'h-9 w-9', rr_width: '36px', rr_height: '36px' });
  assert.equal(children[0].tagName, 'div'); assert.equal(children[1].textContent, '');
  const masking = proof.options.session_recording;
  assert.equal(masking.maskAttributeFn('rr_width', '36px'), '36px');
  assert.equal(masking.maskAttributeFn('rr_width', '100000px'), '[redacted]');
  assert.equal(masking.maskAttributeFn('src', 'PRIVATE'), '[redacted]');
  assert.equal(masking.maskTextFn('\n ', null), '');
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE|private.invalid|src/);
});

test('session/time/byte caps, explicit stop and decoder failure prevent further recording', () => {
  const a = config(); assert(a.options.before_send(packet([full])));
  assert.equal(a.options.before_send(packet([full], { $session_id: windowId })), null); assert.equal(a.stats().stopped, true);
  const b = config(); b.stop(); assert.equal(b.options.before_send(packet([full])), null);
  let time = 0; const c = config({ now: () => time }); time = 120000; assert.equal(c.options.before_send(packet([full])), null);
  const d = config({ decodeCompressed: () => { throw Error('PRIVATE'); } }); assert.equal(d.options.before_send(packet([full])), null); assert.equal(d.stats().stopped, true);
  const e = config(); const large = packet(Array.from({ length: 200000 }, () => ({ type: 3, timestamp: 0, data: { source: 2, id: 3, x: 0, y: 0, type: 2 } })));
  assert.equal(e.options.before_send(large), null); assert.equal(e.stats().stopped, true);
  assert.throws(() => config({ gate: { ...gate, production: true } }), /ineligible/);
  assert.throws(() => config({ gate: { ...gate, fixturesOnly: false } }), /ineligible/);
});
