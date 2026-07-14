# Optional owner-supplied photography

The active build intentionally uses the no-photo BrandBackdrop fallback. When
consented, production-ready photography is available, add files at these exact
paths:

- `login-bg.jpg` — Login and Signup backdrop
- `dashboard-header.jpg` — coach and client dashboard greeting

Vite discovers these files at build time. When they are absent, the app emits no
image request and uses the ridge/gradient fallback without an error. Final crop,
overlay, and duotone tuning should happen only after the real approved images
land.

