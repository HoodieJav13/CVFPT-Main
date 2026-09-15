import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute an unchanged copy of the real CLI in a temporary repo. Only the
// external SDK is replaced; filesystem writes, env parsing and exits are real.
function fixture(t, { linked, blockedOutput = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'cvf-provision-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'backend/node_modules/@supabase/supabase-js', 'supabase/.temp']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(new URL('./prepare-test-accounts.mjs', import.meta.url), path.join(root, 'scripts/prepare-test-accounts.mjs'));
  writeFileSync(path.join(root, 'backend/package.json'), '{}');
  const file = path.join(root, 'backend/.env.test-accounts');
  if (linked !== undefined) writeFileSync(path.join(root, 'supabase/.temp/project-ref'), linked);
  if (blockedOutput) mkdirSync(file);
  writeFileSync(path.join(root, 'backend/node_modules/@supabase/supabase-js/index.js'), `
    const fs = require('node:fs');
    const log = (value) => fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(value) + '\\n');
    exports.createClient = () => {
      log({ action: 'initialize' });
      let account = 0;
      return {
        auth: { admin: { createUser: async ({ email, password }) => {
          account++;
          const saved = fs.existsSync(process.env.JOURNAL) ? fs.readFileSync(process.env.JOURNAL, 'utf8') : '';
          log({ action: 'create', account, email, password, saved });
          if (process.env.FAIL_AT === 'auth' && account === 3) return { data: { user: null }, error: { message: password } };
          return { data: { user: { id: 'auth-' + account } }, error: null };
        } } },
        from: (table) => ({ insert: (row) => ({ select: () => ({ single: async () => {
          log({ action: 'profile', table, row });
          if (process.env.FAIL_AT === 'profile' && account === 3) return { data: null, error: { message: 'simulated failure' } };
          return { data: { id: 'profile-' + account }, error: null };
        } }) }) })
      };
    };
  `);
  const calls = path.join(root, 'calls.jsonl');
  function run(extra = {}, args = ['--yes']) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-test-accounts.mjs'), ...args], {
      cwd: path.join(root, 'backend'), encoding: 'utf8', timeout: 5000,
      // No inherited credentials, dotenv files or real SDK/network access.
      env: { PATH: process.env.PATH, SUPABASE_URL: 'https://dedicateddev.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-test-key', CVF_TEST_PROJECT_REF: 'dedicateddev',
        JOURNAL: file, CALL_LOG: calls, ...extra },
    });
    assert.equal(result.error, undefined);
    return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [] };
  }
  return { run, file };
}

for (const [name, env, linked] of [
  ['HTTP', { SUPABASE_URL: 'http://dedicateddev.supabase.co' }],
  ['lookalike hostname', { SUPABASE_URL: 'https://dedicateddev.supabase.co.evil.invalid' }],
  ['mismatched ref', { CVF_TEST_PROJECT_REF: 'otherproject' }],
  ['known shared project without linked file', { CVF_TEST_PROJECT_REF: 'hhzpzcxcurmhpmfgriqb', SUPABASE_URL: 'https://hhzpzcxcurmhpmfgriqb.supabase.co' }],
  ['repo-linked project', {}, 'dedicateddev\n'],
]) {
  test(`refuses ${name} before SDK initialization or output creation`, (t) => {
    const f = fixture(t, { linked });
    const r = f.run(env);
    assert.equal(r.status, 2);
    assert.deepEqual(r.calls, []);
    assert.equal(existsSync(f.file), false);
  });
}

test('requires explicit confirmation before any side effect', (t) => {
  const f = fixture(t);
  const r = f.run({}, []);
  assert.equal(r.status, 2);
  assert.deepEqual(r.calls, []);
  assert.equal(existsSync(f.file), false);
});

function states(content) {
  return Object.fromEntries([...content.matchAll(/^# (ADMIN|COACH_A|COACH_B|CLIENT) (PENDING|DONE)$/gm)].map(m => [m[1], m[2]]));
}

function assertPersistedBeforeCreate(r) {
  for (const call of r.calls.filter(c => c.action === 'create')) {
    assert.ok(call.saved.includes(`_EMAIL=${call.email}\n`), 'email persisted before mutation');
    assert.ok(call.saved.includes(`_PASSWORD=${call.password}\n`), 'password persisted before mutation');
    assert.equal(Object.values(states(call.saved)).filter(s => s === 'PENDING').length, 1);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(call.password), 'password never logged');
  }
}

test('dedicated target succeeds, saves credentials before calls, and refuses a rerun', (t) => {
  const f = fixture(t, { linked: 'sharedelsewhere' });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assertPersistedBeforeCreate(r);
  assert.deepEqual(states(readFileSync(f.file, 'utf8')), { ADMIN: 'DONE', COACH_A: 'DONE', COACH_B: 'DONE', CLIENT: 'DONE' });
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
  const client = r.calls.find(c => c.table === 'clients');
  assert.equal(client.row.coach_id, 'profile-2');
  const saved = readFileSync(f.file, 'utf8');
  const second = f.run();
  assert.equal(second.status, 2);
  assert.equal(second.calls.length, r.calls.length, 'rerun does not contact SDK');
  assert.equal(readFileSync(f.file, 'utf8'), saved);
});

for (const stage of ['auth', 'profile']) {
  test(`${stage} failure on third account retains two DONE and one PENDING with recovery guidance`, (t) => {
    const f = fixture(t);
    const r = f.run({ FAIL_AT: stage });
    assert.equal(r.status, 1);
    assertPersistedBeforeCreate(r);
    assert.deepEqual(states(readFileSync(f.file, 'utf8')), { ADMIN: 'DONE', COACH_A: 'DONE', COACH_B: 'PENDING' });
    assert.equal(statSync(f.file).mode & 0o777, 0o600);
    assert.equal(r.calls.filter(c => c.action === 'create').length, 3);
    for (const marker of ['ADMIN DONE', 'COACH_A DONE', 'COACH_B PENDING', 'dashboard']) assert.ok(r.stderr.includes(marker));
  });
}

test('unavailable output location refuses before SDK initialization', (t) => {
  const f = fixture(t, { blockedOutput: true });
  const r = f.run();
  assert.equal(r.status, 2);
  assert.deepEqual(r.calls, []);
});
