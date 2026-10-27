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

// storage-js asStream() intentionally discards status/headers. Validate ranges
// at the configured fetch boundary before that happens; never relabel a full
// or wrong-offset upstream body as the requested partial response. This affects
// only explicit HTTP byte ranges, not PostgREST item pagination.
function withStorageRangeValidation(fetchImpl) {
  return async (input, init = {}) => {
    const range = new Headers(init.headers).get('range');
    const requested = /^bytes=(\d+)-(\d+)$/.exec(range || '');
    const response = await fetchImpl(input, init);
    if (requested && response.ok) {
      const actual = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (response.status !== 206 || !actual || actual[1] !== requested[1] || actual[2] !== requested[2]
        || !Number.isSafeInteger(Number(actual[3])) || Number(actual[3]) <= Number(actual[2])) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Invalid storage range response');
      }
    }
    return response;
  };
}
module.exports.withStorageRangeValidation = withStorageRangeValidation;
