#!/usr/bin/env node
// OWNER-RUN. Creates hosted users. Do not run from CI or from an agent.
//
// Creates the four dedicated fake accounts the real-auth suites need
// (backend/integration/api-hardening.mjs, frontend/e2e/live-auth.spec.mjs):
// admin, coach A, coach B (coaches rows) and one client assigned to coach A
// (clients row, invited + linked). Uses the service-role admin API, so it
// must only ever point at a DEVELOPMENT project.
//
// Reads from env (never from argv):  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   CVF_TEST_PROJECT_REF   — the dev project ref; SUPABASE_URL must contain it
//                            (guard against the shared Preview/Production project)
//   CVF_TEST_EMAIL_DOMAIN  — optional, default "cvf-test.invalid" (undeliverable on purpose)
// Prints no secret to stdout. Writes ./.env.test-accounts (gitignored via .env.*)
// with the CVF_TEST_* values for scripts/set-test-secrets.sh.
//
//   cd backend && CVF_TEST_PROJECT_REF=<dev-ref> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node ../scripts/prepare-test-accounts.mjs --yes
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const need = (name) => {
  const v = process.env[name]?.trim();
  if (!v) { console.error(`missing env ${name}`); process.exit(2); }
  return v;
};
if (!process.argv.includes('--yes')) {
  console.error('This creates users on a hosted Supabase project. Re-run with --yes after checking CVF_TEST_PROJECT_REF.');
  process.exit(2);
}
const url = need('SUPABASE_URL');
const key = need('SUPABASE_SERVICE_ROLE_KEY');
const ref = need('CVF_TEST_PROJECT_REF');
if (!new URL(url).hostname.startsWith(`${ref}.`)) {
  console.error('SUPABASE_URL does not belong to CVF_TEST_PROJECT_REF — refusing (Preview and Production share a project; this must be the development one).');
  process.exit(2);
}
const domain = process.env.CVF_TEST_EMAIL_DOMAIN?.trim() || 'cvf-test.invalid';
const outFile = path.resolve(process.cwd(), '.env.test-accounts');
if (existsSync(outFile)) { console.error(`${outFile} already exists — move it aside first.`); process.exit(2); }

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const password = () => randomBytes(18).toString('base64url');
const accounts = {
  ADMIN: { email: `cvf-test-admin@${domain}`, name: 'Test Admin', kind: 'coach', is_admin: true },
  COACH_A: { email: `cvf-test-coach-a@${domain}`, name: 'Test Coach A', kind: 'coach', is_admin: false },
  COACH_B: { email: `cvf-test-coach-b@${domain}`, name: 'Test Coach B', kind: 'coach', is_admin: false },
  CLIENT: { email: `cvf-test-client@${domain}`, name: 'Test Client', kind: 'client' },
};

async function ensureAuthUser(email, pwd) {
  const { data, error } = await supabase.auth.admin.createUser({ email, password: pwd, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const lines = [];
const ids = {};
for (const [label, acct] of Object.entries(accounts)) {
  const pwd = password();
  const authUserId = await ensureAuthUser(acct.email, pwd);
  if (acct.kind === 'coach') {
    const { data, error } = await supabase.from('coaches')
      .insert({ auth_user_id: authUserId, name: acct.name, email: acct.email, is_admin: acct.is_admin })
      .select('id').single();
    if (error) throw new Error(`coaches insert ${label}: ${error.message}`);
    ids[label] = data.id;
  } else {
    const { data, error } = await supabase.from('clients')
      .insert({ coach_id: ids.COACH_A, name: acct.name, email: acct.email, invited: true, auth_user_id: authUserId })
      .select('id').single();
    if (error) throw new Error(`clients insert ${label}: ${error.message}`);
    ids[label] = data.id;
  }
  lines.push(`CVF_TEST_${label}_EMAIL=${acct.email}`, `CVF_TEST_${label}_PASSWORD=${pwd}`);
  console.log(`created ${label}: ${acct.email}`);
}
writeFileSync(outFile, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`wrote ${outFile} (mode 600; gitignored). Next: scripts/set-test-secrets.sh`);
