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
//   CVF_TEST_PROJECT_REF   — independently confirmed dev project ref
//   CVF_TEST_EMAIL_DOMAIN  — optional, default "cvf-test.invalid" (undeliverable on purpose)
// Prints no secret. Writes backend/.env.test-accounts (gitignored via .env.*)
// with the CVF_TEST_* values for scripts/set-test-secrets.sh.
//
//   cd backend && CVF_TEST_PROJECT_REF=<dev-ref> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node ../scripts/prepare-test-accounts.mjs --yes
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
let target;
try { target = new URL(url); } catch { /* refused below */ }
if (!/^[a-z0-9]+$/.test(ref) || !target || target.protocol !== 'https:'
    || target.hostname !== `${ref}.supabase.co` || target.port
    || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
  console.error('SUPABASE_URL must be exactly https://<CVF_TEST_PROJECT_REF>.supabase.co — refusing.');
  process.exit(2);
}
// The linked project is not a development allowlist. Refuse it conservatively,
// plus the known shared project even in fresh clones without .temp metadata.
const deniedRefs = new Set(['hhzpzcxcurmhpmfgriqb']);
try {
  const linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
  if (linked) deniedRefs.add(linked);
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Cannot read linked project reference — refusing.');
    process.exit(2);
  }
}
if (deniedRefs.has(ref)) {
  console.error('Refusing the shared or repo-linked project. Use a separately confirmed development project.');
  process.exit(2);
}
const domain = process.env.CVF_TEST_EMAIL_DOMAIN?.trim() || 'cvf-test.invalid';
if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)) {
  console.error('CVF_TEST_EMAIL_DOMAIN must be a hostname — refusing.');
  process.exit(2);
}
const outFile = fileURLToPath(new URL('../backend/.env.test-accounts', import.meta.url));
let journal;
try {
  // Exclusive creation refuses existing files and symlinks without overwriting.
  journal = openSync(outFile, 'wx', 0o600);
} catch {
  console.error('Cannot create backend/.env.test-accounts exclusively. Preserve any existing recovery file and follow scripts/README.md.');
  process.exit(2);
}
function persist(text) {
  writeFileSync(journal, text);
  fsyncSync(journal);
}

const password = () => randomBytes(18).toString('base64url');
const accounts = {
  ADMIN: { email: `cvf-test-admin@${domain}`, name: 'Test Admin', kind: 'coach', is_admin: true },
  COACH_A: { email: `cvf-test-coach-a@${domain}`, name: 'Test Coach A', kind: 'coach', is_admin: false },
  COACH_B: { email: `cvf-test-coach-b@${domain}`, name: 'Test Coach B', kind: 'coach', is_admin: false },
  CLIENT: { email: `cvf-test-client@${domain}`, name: 'Test Client', kind: 'client' },
};

const ids = {};
const states = Object.fromEntries(Object.keys(accounts).map(label => [label, 'NOT_STARTED']));
try {
  persist(`# Project ${ref}\n# Recovery journal: the last status for each account wins.\n`);
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  for (const [label, acct] of Object.entries(accounts)) {
    const pwd = password();
    persist(`CVF_TEST_${label}_EMAIL=${acct.email}\nCVF_TEST_${label}_PASSWORD=${pwd}\n# ${label} PENDING\n`);
    states[label] = 'PENDING';
    const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email: acct.email, password: pwd, email_confirm: true });
    if (authError || !auth?.user?.id) throw new Error('Auth creation failed');
    const row = acct.kind === 'coach'
      ? { auth_user_id: auth.user.id, name: acct.name, email: acct.email, is_admin: acct.is_admin }
      : { coach_id: ids.COACH_A, name: acct.name, email: acct.email, invited: true, auth_user_id: auth.user.id };
    const { data, error } = await supabase.from(acct.kind === 'coach' ? 'coaches' : 'clients').insert(row)
      .select('id').single();
    if (error || !data?.id) throw new Error('Profile creation failed');
    ids[label] = data.id;
    // Append rather than truncate: a failed write cannot erase earlier passwords.
    persist(`# ${label} DONE\n`);
    states[label] = 'DONE';
    console.log(`${label} DONE`);
  }
  console.log('All four accounts DONE. Recovery file: backend/.env.test-accounts (mode 600). Next: scripts/set-test-secrets.sh');
} catch {
  // Do not echo SDK errors: they can contain credentials or request payloads.
  console.error('Provisioning stopped. Preserve backend/.env.test-accounts; do not rerun or upload secrets yet.');
  for (const [label, state] of Object.entries(states)) console.error(`${label} ${state}`);
  console.error('PENDING may already exist. Inspect the listed test accounts in the dashboard and follow scripts/README.md for manual recovery. No users were reset or deleted.');
  process.exitCode = 1;
} finally {
  closeSync(journal);
}
