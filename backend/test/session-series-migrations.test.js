// Static checks on the recurring-sessions migrations. Behavior is proven by the
// local-database suite in supabase/tests/session_series/ (see run.sh); these only
// guard the shape: additive, forward-only, service-role-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../supabase/migrations', name), 'utf8');
const FORBIDDEN = /drop table|drop column|delete from|truncate|drop function|drop constraint/i;

test('schema migration adds session_series and the session link additively', () => {
  const sql = read('20260930100000_session_series_schema.sql');
  assert.match(sql, /create table if not exists public\.session_series/);
  assert.match(sql, /unique \(coach_id, request_id\)/);
  assert.match(sql, /receipt jsonb not null/);
  assert.match(sql, /request_hash text not null/);
  assert.match(sql, /add column if not exists series_id uuid references public\.session_series\(id\)/);
  assert.match(sql, /add column if not exists series_ordinal integer/);
  assert.match(sql, /create index if not exists idx_sessions_series[\s\S]*where series_id is not null/);
  assert.match(sql, /alter table public\.session_series enable row level security/);
  assert.match(sql, /grant select, insert, update on table public\.session_series to service_role/);
  assert.doesNotMatch(sql, /to (anon|authenticated|public)\b/i);
  assert.doesNotMatch(sql, /set not null/i); // existing columns are never tightened
  assert.doesNotMatch(sql, FORBIDDEN);
});
