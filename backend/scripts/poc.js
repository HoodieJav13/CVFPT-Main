/**
 * CVF PT - Phase 1 POC script (single file, all core flows)
 *
 * Proves, against the REAL Supabase project + running Express API:
 *  1. Service-role CRUD on the clients table
 *  2. Coach auth user creation via Admin API (no emails sent)
 *  3. Coach login via API -> token -> /me resolves coach role
 *  4. Coach creates a client profile (client never logs in - fine)
 *  5. Coach toggles invited
 *  6. Signup with NON-invited email -> rejected with friendly message
 *  7. Signup with WRONG email -> rejected
 *  8. Signup with invited email -> account created + auth_user_id linked
 *  9. Client login -> /me resolves client role
 * 10. Ownership: coach A cannot read coach B's client (404)
 * 11. Cleanup of all POC data
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { supabaseAdmin } = require('../src/supabase');

const API = 'http://localhost:8001/api';
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

const STAMP = Date.now();
const coachAEmail = `poc.coacha.${STAMP}@cvfpoc.test`;
const coachBEmail = `poc.coachb.${STAMP}@cvfpoc.test`;
const clientEmail = `poc.client.${STAMP}@cvfpoc.test`;
const PW = 'PocPassw0rd!23';

const cleanup = { authUserIds: [], coachIds: [], clientIds: [] };

async function main() {
  console.log('\n=== 1. Service-role CRUD on clients table ===');
  // need a coach row first (FK)
  const { data: crudCoach, error: crudCoachErr } = await supabaseAdmin
    .from('coaches').insert({ name: 'POC CRUD Coach', email: `poc.crud.${STAMP}@cvfpoc.test` }).select().single();
  check('insert coach row (service role)', !crudCoachErr, JSON.stringify(crudCoachErr));
  cleanup.coachIds.push(crudCoach?.id);

  const { data: crudClient, error: insErr } = await supabaseAdmin
    .from('clients').insert({ name: 'POC CRUD Client', coach_id: crudCoach.id, email: `poc.crudclient.${STAMP}@cvfpoc.test` }).select().single();
  check('insert client row', !insErr, JSON.stringify(insErr));
  cleanup.clientIds.push(crudClient?.id);

  const { data: readBack } = await supabaseAdmin.from('clients').select('*').eq('id', crudClient.id).single();
  check('read client row', readBack?.name === 'POC CRUD Client');

  const { error: updErr } = await supabaseAdmin.from('clients').update({ goals: 'updated' }).eq('id', crudClient.id);
  check('update client row', !updErr);

  console.log('\n=== 2. Create coach auth users via Admin API ===');
  const { data: ua, error: uaErr } = await supabaseAdmin.auth.admin.createUser({ email: coachAEmail, password: PW, email_confirm: true });
  check('create coach A auth user (no email sent)', !uaErr, JSON.stringify(uaErr));
  cleanup.authUserIds.push(ua?.user?.id);
  const { data: ub, error: ubErr } = await supabaseAdmin.auth.admin.createUser({ email: coachBEmail, password: PW, email_confirm: true });
  check('create coach B auth user', !ubErr, JSON.stringify(ubErr));
  cleanup.authUserIds.push(ub?.user?.id);

  const { data: coachA } = await supabaseAdmin.from('coaches').insert({ name: 'POC Coach A', email: coachAEmail, auth_user_id: ua.user.id }).select().single();
  const { data: coachB } = await supabaseAdmin.from('coaches').insert({ name: 'POC Coach B', email: coachBEmail, auth_user_id: ub.user.id }).select().single();
  cleanup.coachIds.push(coachA?.id, coachB?.id);
  check('coach rows linked to auth users', Boolean(coachA?.auth_user_id && coachB?.auth_user_id));

  console.log('\n=== 3. Coach login via API + /me ===');
  const loginA = await api('/auth/login', { method: 'POST', body: { email: coachAEmail, password: PW } });
  check('coach A login returns 200 + token', loginA.status === 200 && Boolean(loginA.json?.access_token), JSON.stringify(loginA.json));
  check('coach A login resolves role=coach', loginA.json?.role === 'coach');
  const tokenA = loginA.json?.access_token;

  const meA = await api('/auth/me', { token: tokenA });
  check('/me returns coach profile', meA.status === 200 && meA.json?.profile?.id === coachA.id, JSON.stringify(meA.json));

  const badLogin = await api('/auth/login', { method: 'POST', body: { email: coachAEmail, password: 'wrongpassword' } });
  check('wrong password rejected (401)', badLogin.status === 401);

  console.log('\n=== 4. Coach creates client profile via API ===');
  const createClient = await api('/clients', { method: 'POST', token: tokenA, body: { name: 'POC Jane Doe', email: clientEmail, goals: 'Get strong' } });
  check('client created via API', createClient.status === 201 && createClient.json?.coach_id === coachA.id, JSON.stringify(createClient.json));
  const clientId = createClient.json?.id;
  cleanup.clientIds.push(clientId);

  console.log('\n=== 5/6. Signup blocked before invite ===');
  const earlySignup = await api('/auth/signup', { method: 'POST', body: { email: clientEmail, password: PW } });
  check('signup rejected before invite (403)', earlySignup.status === 403);
  check('friendly rejection message', String(earlySignup.json?.error || '').includes('contact your coach'), earlySignup.json?.error);

  console.log('\n=== 5b. Coach toggles invited ===');
  const invite = await api(`/clients/${clientId}/invite`, { method: 'PATCH', token: tokenA, body: { invited: true } });
  check('invite toggled', invite.status === 200 && invite.json?.invited === true, JSON.stringify(invite.json));

  console.log('\n=== 7. Signup with wrong (unknown) email rejected ===');
  const wrongSignup = await api('/auth/signup', { method: 'POST', body: { email: `nobody.${STAMP}@cvfpoc.test`, password: PW } });
  check('unknown email rejected (403)', wrongSignup.status === 403, JSON.stringify(wrongSignup.json));

  console.log('\n=== 8. Invited client signs up -> claim links auth_user_id ===');
  const signup = await api('/auth/signup', { method: 'POST', body: { email: clientEmail, password: PW } });
  check('invited signup succeeds (201)', signup.status === 201, JSON.stringify(signup.json));
  check('signup returns client role + tokens', signup.json?.role === 'client' && Boolean(signup.json?.access_token));
  const { data: claimed } = await supabaseAdmin.from('clients').select('*').eq('id', clientId).single();
  check('auth_user_id linked on profile', Boolean(claimed?.auth_user_id));
  if (claimed?.auth_user_id) cleanup.authUserIds.push(claimed.auth_user_id);

  console.log('\n=== 9. Client login + /me ===');
  const clientLogin = await api('/auth/login', { method: 'POST', body: { email: clientEmail, password: PW } });
  check('client login works', clientLogin.status === 200 && clientLogin.json?.role === 'client');
  const meC = await api('/auth/me', { token: clientLogin.json?.access_token });
  check('/me resolves client profile', meC.status === 200 && meC.json?.profile?.id === clientId);

  const clientListAttempt = await api('/clients', { token: clientLogin.json?.access_token });
  check('client blocked from coach endpoints (403)', clientListAttempt.status === 403);

  console.log('\n=== 10. Ownership: coach B cannot access coach A client ===');
  const loginB = await api('/auth/login', { method: 'POST', body: { email: coachBEmail, password: PW } });
  const tokenB = loginB.json?.access_token;
  const crossRead = await api(`/clients/${clientId}`, { token: tokenB });
  check('cross-coach read blocked (404)', crossRead.status === 404, JSON.stringify(crossRead.json));
  const listB = await api('/clients', { token: tokenB });
  check('coach B list excludes coach A clients', listB.status === 200 && !(listB.json || []).some(c => c.id === clientId));

  console.log('\n=== 11. Cleanup POC data ===');
  for (const id of cleanup.clientIds.filter(Boolean)) {
    await supabaseAdmin.from('clients').delete().eq('id', id);
  }
  for (const id of cleanup.coachIds.filter(Boolean)) {
    await supabaseAdmin.from('coaches').delete().eq('id', id);
  }
  for (const id of cleanup.authUserIds.filter(Boolean)) {
    await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log('  cleanup done');

  console.log(`\n========== POC RESULT: ${pass} passed, ${fail} failed ==========`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('POC crashed:', e); process.exit(1); });
