const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const {
  completedLogsPage, decodeLogListCursor, encodeLogListCursor, logPageSize,
} = require('../src/routes/workoutLogs');

const root = path.resolve(__dirname, '../..');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('history cursors round-trip exactly and reject anything else', () => {
  const row = { completed_at: '2026-09-28T18:00:00.123456+00:00', id: uuid(7) };
  assert.deepEqual(decodeLogListCursor(encodeLogListCursor(row)), row);
  assert.equal(decodeLogListCursor(undefined), null);
  const bad = [
    '', 'not-base64-json',
    Buffer.from(JSON.stringify({ completed_at: 'Tue, 01 Sep 2026 10:00:00 GMT', id: uuid(1) })).toString('base64url'),
    Buffer.from(JSON.stringify({ completed_at: '2026-09-28T18:00:00Z",x', id: uuid(1) })).toString('base64url'),
    Buffer.from(JSON.stringify({ completed_at: '2026-09-28T18:00:00Z', id: 'x),or(id.neq.0' })).toString('base64url'),
    Buffer.from(JSON.stringify({ completed_at: '2026-09-28T18:00:00Z', id: uuid(1), extra: 1 })).toString('base64url'),
    'a'.repeat(600),
  ];
  for (const value of bad) assert.throws(() => decodeLogListCursor(value), /invalid/, value);
  assert.equal(logPageSize(undefined), 20);
  assert.equal(logPageSize('5'), 5);
  assert.equal(logPageSize('500'), 50);
  assert.equal(logPageSize('0'), 20);
  assert.equal(logPageSize('2.5'), 20);
});

// A real supabase-js client over a fake network: checks the exact query
// sent and applies its keyset filter to an in-memory table.
function fakeDb(rows) {
  const requests = [];
  const fetch = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    const params = parsed.searchParams;
    assert.equal(params.get('status'), 'eq.completed');
    assert.equal(params.get('archived'), 'eq.false');
    let result = rows.filter((row) => row.client_id === params.get('client_id').replace('eq.', '')
      && row.status === 'completed' && row.archived === false);
    const or = params.get('or');
    if (or) {
      const match = or.match(/^\(completed_at\.lt\."([^"]+)",and\(completed_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)\)\)$/);
      assert.ok(match, `unexpected or filter ${or}`);
      const [, before, same, id] = match;
      result = result.filter((row) => row.completed_at < before || (row.completed_at === same && row.id < id));
    }
    assert.equal(params.get('order'), 'completed_at.desc,id.desc');
    result = [...result].sort((a, b) => (b.completed_at.localeCompare(a.completed_at)) || b.id.localeCompare(a.id))
      .slice(0, Number(params.get('limit')))
      .map(({ id, completed_at }) => ({ id, completed_at }));
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const db = createClient('http://db.test', 'key', { global: { fetch }, auth: { persistSession: false } });
  return { db, requests };
}

test('paging walks every completed workout once, newest first, across tied timestamps', async () => {
  const rows = [];
  for (let n = 1; n <= 7; n += 1) {
    // Pairs share a completed_at to exercise the id tie-break.
    rows.push({ id: uuid(n), client_id: 'c1', status: 'completed', archived: false, completed_at: `2026-09-${String(10 + Math.ceil(n / 2)).padStart(2, '0')}T18:00:00.000001+00:00` });
  }
  rows.push({ id: uuid(90), client_id: 'c2', status: 'completed', archived: false, completed_at: '2026-09-30T18:00:00+00:00' });
  rows.push({ id: uuid(91), client_id: 'c1', status: 'active', archived: false, completed_at: null });
  rows.push({ id: uuid(92), client_id: 'c1', status: 'completed', archived: true, completed_at: '2026-09-29T18:00:00+00:00' });
  const { db, requests } = fakeDb(rows);
  const details = async (ids) => ids.map((id) => ({ id }));

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await completedLogsPage('c1', { cursor, limit: 3 }, { db, details });
    seen.push(...page.logs.map((log) => log.id));
    cursor = page.next_cursor ? decodeLogListCursor(page.next_cursor) : null;
    pages += 1;
  } while (cursor && pages < 10);

  const expected = rows.filter((row) => row.client_id === 'c1' && row.status === 'completed' && !row.archived)
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at) || b.id.localeCompare(a.id)).map((row) => row.id);
  assert.deepEqual(seen, expected);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 7);
  // Each page asks for one extra row to know whether another page exists.
  assert.ok(requests.every((url) => url.searchParams.get('limit') === '4'));
  assert.equal(requests[0].searchParams.get('or'), null);
});

test('unpaged callers keep the array response; paged mode is opt-in', () => {
  const routes = fs.readFileSync(path.join(root, 'backend/src/routes/workoutLogs.js'), 'utf8');
  assert.match(routes, /if \(req\.query\.paged !== '1'\) \{[\s\S]*?\.limit\(50\);[\s\S]*?return res\.json\(await workoutLogsWithDetailsBulk/);
  assert.match(routes, /return res\.status\(400\)\.json\(\{ error: 'Invalid history cursor' \}\)/);
  // Both list routes share it, behind their existing role/ownership checks.
  assert.match(routes, /router\.get\('\/mine', requireClient,[\s\S]*?sendCompletedLogs\(req, res, req\.user\.client\.id\)/);
  assert.match(routes, /canAccessClient\(req\.user, client\)\) return res\.status\(404\)[\s\S]*?sendCompletedLogs\(req, res, client\.id\)/);
});
