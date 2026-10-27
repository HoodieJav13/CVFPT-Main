// Preloaded (node -r) into every process of the owned exercise-media harness.
// Denies any outbound network that is not loopback, so a local run can never
// reach a hosted database, auth provider, email/push provider or analytics.
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

if (process.env.CVF_MEDIA_LOCAL !== 'exercise-media-20261015') {
  throw new Error('exercise media local guard: owned launcher environment required');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
function assertLoopback(host, what) {
  const name = String(host || '').replace(/^\[|\]$/g, '');
  if (!LOOPBACK.has(name)) throw new Error(`exercise media local guard: refused ${what} to non-loopback host`);
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assertLoopback(url.hostname, 'fetch');
  return nativeFetch(input, init);
};
for (const mod of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = mod[method];
    mod[method] = function guarded(...args) {
      const first = args[0];
      const host = typeof first === 'string' || first instanceof URL ? new URL(first).hostname : (first?.hostname || first?.host || 'localhost');
      assertLoopback(host, `${mod === https ? 'https' : 'http'}.${method}`);
      return original.apply(this, args);
    };
  }
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { port: args[0], host: args[1] };
  if (!options.path) assertLoopback(options.host || 'localhost', 'socket');
  return originalConnect.apply(this, args);
};

for (const key of ['SUPABASE_URL']) {
  if (process.env[key]) assertLoopback(new URL(process.env[key]).hostname, key);
}
