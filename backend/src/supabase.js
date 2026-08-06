const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { createSecretKeyFetch } = require('./lib/supabaseFetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  const message = 'FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from environment';
  // In production a half-configured deploy must die at boot with one clear
  // line, not limp along throwing confusing client errors per request.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error(message);
  console.error(message);
}

// A hanging (vs. refusing) database connection should fail fast, not ride
// out the entire serverless function timeout. Caller-supplied signals win.
function withDefaultTimeout(fetchImpl, timeoutMs = 15000) {
  return (input, init = {}) => fetchImpl(input, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}

// Admin client: bypasses RLS, used for all data access + auth admin operations.
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: withDefaultTimeout(createSecretKeyFetch(SERVICE_ROLE_KEY)) },
  realtime: { transport: ws },
});

// Anon client factory: used only for password sign-in / token refresh.
function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: withDefaultTimeout((input, init) => fetch(input, init)) },
    realtime: { transport: ws },
  });
}

module.exports = { supabaseAdmin, anonClient };
