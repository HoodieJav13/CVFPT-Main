// The daily digest now reminds clients (per-session, Denver-formatted) and
// coaches (count) about sessions in the next 24 hours. Real email service,
// stubbed Supabase; env stays unconfigured so no provider call happens —
// recipient selection is what these tests exercise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const state = { sessions: [] };

const COACH = { id: 'co1', name: 'Coach Sam', email: 'coach@x.com' };
const CLIENT = { id: 'c1', name: 'Jo Client', email: 'client@x.com', coach_id: 'co1' };

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          gte() { return chain; },
          lt() { return chain; },
          order() { return chain; },
          range() { return chain; },
          then(resolve) {
            const rows = {
              coaches: [COACH],
              clients: [CLIENT],
              sessions: state.sessions,
            }[table] || [];
            resolve({ data: rows, error: null });
          },
        };
        return chain;
      },
    },
  },
};

const { formatDenver, sendDailyDigests } = require('../src/services/email');

const UNCONFIGURED_ENV = {};

test('formatDenver renders Denver-local wall time', () => {
  // 23:00 UTC on Aug 6 is 5:00 PM MDT the same day.
  const rendered = formatDenver('2026-08-06T23:00:00Z');
  assert.match(rendered, /Aug 6/);
  assert.match(rendered, /5:00\s?PM/);
});

test('an upcoming session pulls both the client and the coach into the digest', async () => {
  state.sessions = [{
    id: 's1', client_id: CLIENT.id, coach_id: COACH.id,
    scheduled_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    duration_minutes: 60,
  }];
  const result = await sendDailyDigests(new Date(), UNCONFIGURED_ENV);
  assert.equal(result.recipients, 2);
});

test('no upcoming sessions and no other activity means no digest recipients', async () => {
  state.sessions = [];
  const result = await sendDailyDigests(new Date(), UNCONFIGURED_ENV);
  assert.equal(result.recipients, 0);
});

test('digest queries only scheduled, unarchived sessions in the next 24 hours', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/email.js'), 'utf8');
  assert.match(source, /from\('sessions'\)[^;]*eq\('status', 'scheduled'\)/s);
  assert.match(source, /upcomingUntil = new Date\(now\.getTime\(\) \+ 24 \* 60 \* 60 \* 1000\)/);
  assert.match(source, /Session \$\{formatDenver\(session\.scheduled_at\)\}/);
});

test('create and reschedule notifications are wired into the sessions routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/sessions.js'), 'utf8');
  assert.match(source, /notifySessionScheduled\(created\)/);
  assert.match(source, /notifySessionRescheduled\(updated, session\)/);
  // The reschedule email only fires on a real change to a scheduled session.
  assert.match(source, /meaningfullyChanged && updated\.status === 'scheduled'/);
});
