// Vercel serverless entrypoint - wraps the Express app.
// All routes (/api/*) are handled by this single function via vercel.json rewrites.
const app = require('../src/app');

module.exports = app;
