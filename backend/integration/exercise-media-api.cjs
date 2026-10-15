// Owned harness child: the REAL Express app (all routes, real requireAuth and
// profile checks) on 127.0.0.1, pointed at the harness's loopback gateway.
// Started only by exercise-media-harness.cjs with `node -r ./local-guard.cjs`.
if (process.env.CVF_MEDIA_LOCAL !== 'exercise-media-20261015') throw new Error('Owned launcher required');
if (new URL(process.env.SUPABASE_URL).hostname !== '127.0.0.1') throw new Error('Loopback SUPABASE_URL required');

const app = require('../src/app');

const server = app.listen(Number(process.env.CVF_MEDIA_API_PORT || 0), '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ event: 'listening', port: server.address().port, pid: process.pid })}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
