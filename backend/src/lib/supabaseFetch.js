function createSecretKeyFetch(secretKey, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required');
  }

  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');

    // Supabase's new sb_secret_ keys are API keys, not JWTs. supabase-js adds
    // the project key as both apikey and Bearer auth by default; remove only
    // that generated Bearer value while preserving real user access tokens.
    if (authorization === `Bearer ${secretKey}`) {
      headers.delete('authorization');
    }

    return fetchImpl(input, { ...init, headers });
  };
}

module.exports = { createSecretKeyFetch };
