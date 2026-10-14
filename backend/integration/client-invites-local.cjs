// Task-owned local integration only. Real Express/auth/profile checks, supabase-js,
// PostgREST authenticator/service_role and canonical SQL; fictional Auth/provider.
// The disposable launcher supplies ephemeral local JWTs. Never load .env here.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
if (process.env.CVF_INVITE_LOCAL_INTEGRATION !== 'task45-isolated') throw Error('Owned local launcher required');
for (const key of ['SUPABASE_URL', 'LOCAL_POSTGREST_URL']) {
  const url = new URL(process.env[key]);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
}
const ACTOR = '10000000-0000-4000-8000-0000000000a1';
const OTHER = '10000000-0000-4000-8000-0000000000a2';
const identities = {
  'fixture-owner': { id: 'd0000000-0000-4000-8000-000000000001', email: 'owner@example.invalid' },
  'fixture-other': { id: 'd0000000-0000-4000-8000-000000000002', email: 'other@example.invalid' },
  'fixture-client': { id: 'd0000000-0000-4000-8000-000000000003', email: 'client@example.invalid' },
};
const nativeFetch = globalThis.fetch;
const permitted = new Set([new URL(process.env.SUPABASE_URL).origin, new URL(process.env.LOCAL_POSTGREST_URL).origin]);
let providerURL;
let providerMode = 'accepted';
const providerCalls = [];
const cases = [];
async function start(app, port = 0) { const server = app.listen(port, '127.0.0.1'); await once(server, 'listening'); return server; }
async function close(server) { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
async function main() {
  const gateway = express(); gateway.use(express.json());
  gateway.get('/auth/v1/user', (req, res) => {
    const user = identities[(req.headers.authorization || '').replace(/^Bearer /, '')];
    res.status(user ? 200 : 401).json(user || { message: 'Fictional invalid session' });
  });
  // Match the local Supabase gateway's API-key-to-role mapping. PostgREST still
  // verifies the signed ephemeral JWT and sets service_role under authenticator.
  gateway.use('/rest/v1', async (req, res) => {
    try {
      if (req.headers.apikey !== process.env.SUPABASE_SERVICE_ROLE_KEY) return res.sendStatus(401);
      const response = await nativeFetch(process.env.LOCAL_POSTGREST_URL + req.url, {
        method: req.method, headers: { 'content-type': 'application/json', accept: req.headers.accept || 'application/json', ...(req.headers.prefer ? { prefer: req.headers.prefer } : {}), authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: JSON.stringify(req.body) }),
      });
      res.status(response.status);
      for (const header of ['content-type', 'content-range', 'preference-applied']) if (response.headers.has(header)) res.set(header, response.headers.get(header));
      res.send(await response.text());
    } catch { res.status(502).json({ error: 'Local gateway failure' }); }
  });
  const provider = express(); provider.use(express.json());
  provider.post('/emails', (req, res) => {
    providerCalls.push({ key: req.headers['idempotency-key'], hash: createHash('sha256').update(JSON.stringify(req.body)).digest('hex'), to: req.body.to });
    if (providerMode === 'accepted') return res.json({ id: 'c0000000-0000-4000-8000-000000000001' });
    if (providerMode === 'unknown') return res.json({ id: 'invalid-id' });
    return res.status(422).json({ name: 'validation_error', message: 'Fictional rejection' });
  });
  let providerServer, gatewayServer, apiServer;
  try {
    providerServer = await start(provider); providerURL = `http://127.0.0.1:${providerServer.address().port}`; permitted.add(providerURL);
    gatewayServer = await start(gateway, Number(new URL(process.env.SUPABASE_URL).port));
  assert.equal(gatewayServer.address().port, Number(new URL(process.env.SUPABASE_URL).port));
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.href === 'https://api.resend.com/emails') return nativeFetch(providerURL + '/emails', init);
    if (!permitted.has(url.origin)) throw Error('External network forbidden in local integration');
    return nativeFetch(input, init);
  };
  process.env.RESEND_API_KEY = 'fictional-local-provider'; process.env.NOTIFY_REPLY_TO = 'reply@example.invalid'; process.env.FRONTEND_URL = 'https://fictional.example.invalid';
    const { supabaseAdmin } = require('../src/supabase');
    const router = require('../src/routes/clients');
    const app = express(); app.use(express.json()); app.use('/api/clients', router);
    apiServer = await start(app); const api = `http://127.0.0.1:${apiServer.address().port}`; permitted.add(api);
    async function send(path, method = 'GET', body, token = 'fixture-owner') {
      const response = await globalThis.fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    }
    const role = await supabaseAdmin.rpc('local_invite_role_check'); assert.ifError(role.error);
    assert.deepEqual(role.data, { current_role: 'service_role', login_role: 'authenticator' });
    cases.push('PostgREST signed service_role under authenticator: PASS');
    for (const token of [undefined, process.env.LOCAL_AUTHENTICATED_JWT]) {
      const response = await nativeFetch(process.env.LOCAL_POSTGREST_URL + '/rpc/admit_invite_call', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ p_actor: ACTOR, p_attempt_id: randomUUID() }) });
      assert.ok([401, 403].includes(response.status)); assert.equal((await response.json()).code, '42501');
    }
    cases.push('Anonymous and authenticated direct RPC denied: PASS');
    assert.equal((await send('/api/clients', 'POST', { name: 'No auth' }, null)).status, 401);
    assert.equal((await send('/api/clients', 'POST', { name: 'Invalid' }, 'invalid')).status, 401);
    assert.equal((await send('/api/clients', 'POST', { name: 'Client' }, 'fixture-client')).status, 403);
    cases.push('Actual middleware missing/invalid/client actor refusal: PASS');
    const absent = await send('/api/clients/create-requests/' + randomUUID()); assert.equal(absent.status, 200); assert.deepEqual(absent.data, { status: 'absent' });
    cases.push('Successful authorized receipt absence over PostgREST: PASS');
    const offId = randomUUID();
    const offBody = { request_id: offId, name: 'Off Fixture', email: 'off@example.invalid', coach_id: OTHER, invite_now: false };
    const off = await send('/api/clients', 'POST', offBody); assert.equal(off.status, 201); assert.equal(off.data.client.coach_id, ACTOR); assert.equal(off.data.invite, null); assert.equal(providerCalls.length, 0);
    const recovered = await send('/api/clients/create-requests/' + offId); assert.equal(recovered.data.status, 'committed'); assert.equal(recovered.data.client.id, off.data.client.id);
    const replay = await send('/api/clients', 'POST', offBody); assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true); assert.equal(replay.data.client.id, off.data.client.id);
    const mismatch = await send('/api/clients', 'POST', { ...offBody, name: 'Changed' }); assert.equal(mismatch.status, 409); assert.equal(mismatch.data.code, 'request_mismatch');
    cases.push('Create receipt/recovery/replay/mismatch and server actor authority: PASS');
    const request = randomUUID(); const body = { request_id: request, name: 'Accepted Fixture', email: 'accepted@example.invalid', invite_now: true };
    const accepted = await send('/api/clients', 'POST', body); assert.equal(accepted.status, 201); assert.equal(accepted.data.invite.status, 'accepted'); assert.equal(accepted.data.invite.retryable, false); assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].key, 'invite/' + accepted.data.invite.attempt_id);
    assert.equal((await send('/api/clients', 'POST', body)).data.invite.status, 'accepted'); assert.equal(providerCalls.length, 1);
    assert.equal((await send('/api/clients/' + accepted.data.client.id, 'GET', undefined, 'fixture-other')).status, 404);
    const attempt = await supabaseAdmin.from('client_invite_attempts').select('status,provider_body,admitted_calls,completed_calls').eq('id', accepted.data.invite.attempt_id).single(); assert.ifError(attempt.error);
    assert.deepEqual(attempt.data, { status: 'accepted', provider_body: null, admitted_calls: 1, completed_calls: 1 });
    const ownerDenied = await supabaseAdmin.rpc('admit_invite_call', { p_actor: OTHER, p_attempt_id: accepted.data.invite.attempt_id }); assert.ifError(ownerDenied.error); assert.equal(ownerDenied.data.outcome, 'not_found');
    cases.push('Actual create/admit/complete RPCs; accepted terminal, redacted, not delivered; foreign owner denied: PASS');
    const onAction = randomUUID();
    const on = await send(`/api/clients/${off.data.client.id}/invite`, 'PATCH', { action_id: onAction, invited: true, supersedes_attempt_id: null }); assert.equal(on.data.invite.status, 'accepted');
    const beforeOff = providerCalls.length;
    const withdrawn = await send(`/api/clients/${off.data.client.id}/invite`, 'PATCH', { action_id: randomUUID(), invited: false }); assert.equal(withdrawn.status, 200);
    const historic = await send(`/api/clients/${off.data.client.id}/invite`, 'PATCH', { action_id: onAction, invited: true, supersedes_attempt_id: null }); assert.equal(historic.data.action.replayed, true); assert.equal(providerCalls.length, beforeOff);
    assert.equal((await send('/api/clients/' + off.data.client.id)).data.invited, false);
    cases.push('Actual action RPC immutable on replay after withdrawal; no resend/repermission: PASS');
    providerMode = 'unknown'; const unknown = await send('/api/clients', 'POST', { request_id: randomUUID(), name: 'Unknown Fixture', email: 'unknown@example.invalid', invite_now: true }); assert.equal(unknown.data.invite.status, 'unknown'); assert.equal(unknown.data.invite.retryable, true);
    const uncertainCall = providerCalls.at(-1); providerMode = 'rejected';
    const retry = await send(`/api/clients/${unknown.data.client.id}/invite/resend`, 'POST', { action_id: randomUUID(), supersedes_attempt_id: unknown.data.invite.attempt_id, confirm_duplicate_risk: false });
    assert.equal(retry.data.invite.status, 'unknown'); assert.equal(retry.data.invite.retryable, false); assert.equal(retry.data.invite.needs_confirmation, true); assert.deepEqual(providerCalls.at(-1), uncertainCall);
    cases.push('Malformed acceptance unknown; uncertain retry same key/body; later rejection remains unknown: PASS');
    const failed = await send('/api/clients', 'POST', { request_id: randomUUID(), name: 'Rejected Fixture', email: 'failed@example.invalid', invite_now: true }); assert.equal(failed.data.invite.status, 'failed'); assert.equal(failed.data.invite.retryable, false);
    delete process.env.RESEND_API_KEY; const count = providerCalls.length;
    const unconfigured = await send('/api/clients', 'POST', { request_id: randomUUID(), name: 'Unconfigured Fixture', email: 'unconfigured@example.invalid', invite_now: true }); assert.equal(unconfigured.data.invite.status, 'unconfigured'); assert.equal(providerCalls.length, count);
    cases.push('Definitive first rejection failed; unconfigured does no provider request: PASS');
    const reassigned = await supabaseAdmin.from('clients').update({ coach_id: OTHER }).eq('id', accepted.data.client.id); assert.ifError(reassigned.error);
    assert.equal((await send('/api/clients/create-requests/' + request)).status, 404);
    assert.equal((await send('/api/clients', 'POST', body)).status, 404);
    cases.push('Former owner recovery and create replay blocked after reassignment: PASS');
    console.log(cases.join('\n'));
    console.log('LOCAL API → POSTGREST → SERVICE_ROLE RPC INTEGRATION: 10 cases PASS');
  } finally {
    globalThis.fetch = nativeFetch;
    await Promise.all([apiServer, gatewayServer, providerServer].filter(Boolean).map(close));
  }
}
main().catch(error => { console.error('LOCAL INTEGRATION FAILED:', error.message); process.exitCode = 1; });
