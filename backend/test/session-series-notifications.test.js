const test = require('node:test');
const assert = require('node:assert/strict');

const sent = [];
const people = {
  clients: { id: 'client-1', name: 'Casey Client', email: 'casey@example.invalid' },
  coaches: { id: 'coach-1', name: 'Sam Coach', email: 'sam@example.invalid' },
};

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle() { return Promise.resolve({ data: people[table] || null, error: null }); } };
        return chain;
      },
    },
  },
};
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: {
    Resend: class {
      constructor() {
        this.emails = { send: async (message, options) => { sent.push({ message, options }); return { data: { id: 'email-1' }, error: null }; } };
      }
    },
  },
};

const { notifySeriesScheduled, notifySeriesCancelled } = require('../src/services/email');
const ENV = { RESEND_API_KEY: 'key', NOTIFY_REPLY_TO: 'reply@example.invalid', FRONTEND_URL: 'https://app.example.invalid' };
// Weekly at 23:00Z from 2031-06-03: all in daylight time, so the Denver wall-clock
// time is a constant 5:00 PM (no DST boundary inside the series).
const weekly = (count) => Array.from({ length: count }, (_, i) => new Date(Date.UTC(2031, 5, 3 + i * 7, 23, 0)).toISOString());

test('scheduled summary lists the first five dates and the remainder, one email total', async () => {
  sent.length = 0;
  await notifySeriesScheduled({ seriesId: 's-1', clientId: 'client-1', coachId: 'coach-1', dates: weekly(7) }, ENV);
  assert.equal(sent.length, 1);
  const { message, options } = sent[0];
  assert.deepEqual(message.to, ['casey@example.invalid']);
  assert.equal(message.subject, 'Your coach scheduled 7 sessions');
  assert.match(message.text, /…and 2 more/);
  assert.match(message.text, /These sessions are on your calendar\./);
  assert.doesNotMatch(message.text, /Times vary/);
  assert.equal(message.text.match(/(Jun|Jul) \d+/g).length, 5); // Jun 3, 10, 17, 24, Jul 1
  assert.equal(options.idempotencyKey, 'series-scheduled/s-1/client-1');
  assert.match(message.text, /https:\/\/app\.example\.invalid\/client\/sessions/);
});

test('scheduled summary says times vary when saved times differ', async () => {
  sent.length = 0;
  const dates = [new Date(Date.UTC(2031, 5, 3, 23, 0)).toISOString(), new Date(Date.UTC(2031, 5, 10, 22, 0)).toISOString()];
  await notifySeriesScheduled({ seriesId: 's-2', clientId: 'client-1', coachId: 'coach-1', dates }, ENV);
  assert.match(sent[0].message.text, /Times vary/);
  assert.equal(sent[0].message.subject, 'Your coach scheduled 2 sessions');
});

test('a single saved session uses the singular', async () => {
  sent.length = 0;
  await notifySeriesScheduled({ seriesId: 's-3', clientId: 'client-1', coachId: 'coach-1', dates: weekly(1) }, ENV);
  assert.equal(sent[0].message.subject, 'Your coach scheduled 1 session');
});

test('cancel summary is one email keyed by series and first cancelled session', async () => {
  sent.length = 0;
  const cancelled = weekly(3).map((scheduled_at, i) => ({ id: `sess-${i + 1}`, scheduled_at }));
  await notifySeriesCancelled({ seriesId: 's-1', clientId: 'client-1', coachId: 'coach-1', cancelled }, ENV);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.subject, 'Your 3 sessions were cancelled');
  assert.equal(sent[0].options.idempotencyKey, 'series-cancelled/s-1/sess-1/client-1');
});

test('missing inputs or recipient are skipped, not thrown', async () => {
  sent.length = 0;
  assert.deepEqual(await notifySeriesScheduled({ seriesId: null, clientId: 'client-1', coachId: 'coach-1', dates: weekly(1) }, ENV), { skipped: 'missing-series' });
  assert.deepEqual(await notifySeriesScheduled({ seriesId: 's', clientId: 'client-1', coachId: 'coach-1', dates: [] }, ENV), { skipped: 'missing-series' });
  assert.deepEqual(await notifySeriesCancelled({ seriesId: 's', clientId: 'client-1', coachId: 'coach-1', cancelled: [] }, ENV), { skipped: 'missing-series' });
  people.clients = { id: 'client-1', name: 'No Email', email: null };
  assert.deepEqual(await notifySeriesScheduled({ seriesId: 's', clientId: 'client-1', coachId: 'coach-1', dates: weekly(1) }, ENV), { skipped: 'missing-recipient' });
  assert.equal(sent.length, 0);
});
