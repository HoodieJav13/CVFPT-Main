// Temporary target attestation only. Never read or return credentials, make a
// provider request, or expose this route outside the trusted Vercel Preview.
function createPreviewTargetHandler(env = process.env) {
  return (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview') {
      return res.status(404).json({ error: 'Not found' });
    }
    let projectRef = null;
    try {
      if (typeof env.SUPABASE_URL === 'string') {
        const url = new URL(env.SUPABASE_URL);
        const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
        if (url.protocol === 'https:' && match && !url.username && !url.password
          && !url.port && url.pathname === '/' && !url.search && !url.hash) {
          projectRef = match[1];
        }
      }
    } catch {
      // Missing/malformed configuration must not be echoed in errors or logs.
    }
    return res.status(projectRef ? 200 : 503).json({ project_ref: projectRef });
  };
}

module.exports = { createPreviewTargetHandler };
