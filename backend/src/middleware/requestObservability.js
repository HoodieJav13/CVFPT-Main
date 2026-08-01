const { randomUUID } = require('node:crypto');

function requestObservability(req, res, next) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  res.once('finish', () => {
    if (res.statusCode < 500) return;
    // Never log originalUrl: it can contain client IDs, filters, or other
    // user-supplied values. Route templates are safe and still searchable.
    console.error('request failure', {
      request_id: requestId,
      method: req.method,
      route: req.route?.path || 'unmatched',
      status: res.statusCode,
      duration_ms: Math.max(0, Date.now() - startedAt),
    });
  });
  next();
}

module.exports = { requestObservability };
