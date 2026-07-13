const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { createSecretKeyFetch } = require('./lib/supabaseFetch');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from environment');
}

// Admin client: bypasses RLS, used for all data access + auth admin operations.
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: createSecretKeyFetch(SERVICE_ROLE_KEY) },
  realtime: { transport: ws },
});

// Anon client factory: used only for password sign-in / token refresh.
function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

module.exports = { supabaseAdmin, anonClient };
