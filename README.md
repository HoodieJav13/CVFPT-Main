# CVF PT

Internal personal training management app for Core Value Fitness (Albuquerque)
— client management, scheduling, workout programming/tracking, coach feedback,
progress, resources, messaging, and waivers.

## Frontend (React 19 + Vite)

```sh
cd frontend
npm install
npm run dev     # dev server on :3000
npm run build   # production build to dist/
```

## Backend (Node/Express + Supabase)

```sh
cd backend
npm install
npm start
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment details.

## Verification

Backend unit/regression checks, the frontend production build, and preview-mode
browser checks are secret-free. The 2026-09-24 verification recorded 319/319 backend checks
and 20/20 preview browser flows at `100053b` (PR #80). These are dated results,
not current suite totals; consult the latest CI run for current results:

```sh
cd backend && npm test
cd frontend && npm run build
cd frontend && npm run test:e2e:preview
```

Optional frontend lint audit: `cd frontend && npm run lint`. It is not a CI
gate and exits nonzero for findings. On 2026-10-27, the PR #80 audit config
against main `84b4718` reported 112 errors and 23 warnings across 54 of 305
scanned files, with no fatal parsing/configuration errors. The unchanged broad
audit also flags browser-resolved imports and non-React test helpers; these
counts are an audit backlog, not 112 confirmed application defects. No flagged
application code was changed. See PR #80 for the rule breakdown and provenance.

The older mutating API integration harness is opt-in and accepts only an explicitly
allowlisted development or preview target. Copy `backend/integration/.env.example`
to a local ignored environment file, export its values, then run
`cd backend && npm run test:integration`. It uses dedicated fake-data accounts,
forbids hard-delete requests, and soft-archives the records it creates. The current
historical matrix is 88/88 across health, authentication, ownership, client,
session, note, progress, booking, messaging, Training Builder, Resource Library,
assignment, and the package/credit surfaces that were active when that matrix was
recorded. Those package/payment routes are now retired and unmounted; use
`docs/hardening/auth-route-inventory.md` for the current active surface.
For real-auth browser artifacts that have no public archive endpoint, the guarded
`cd backend && npm run test:cleanup` command requires an allowlisted fake-data
Supabase host and a `CVF LIVE`/`CVF TEST` label prefix, then performs soft archives
only. Run it from the same secure ignored environment after browser verification.

Real-auth browser verification is also opt-in. Copy
`frontend/e2e/live.env.example` to a secure ignored location, supply dedicated
development accounts and the local backend URL, then run
`node --env-file=/path/to/live.env node_modules/@playwright/test/cli.js test --config playwright.live.config.mjs`
from `frontend/`. The live config explicitly disables preview mode. The suite
covers negative auth, recoverable loading errors, client and coach controls,
Training Builder, session/progress/booking/messaging lifecycles, admin
management, responsive navigation, and workout/notification behavior. Its last
accepted Production result is historical; PR #5's release did not rerun it
because the dedicated `CVF_E2E_*` credential set was unavailable. See
`docs/hardening/2026-07-22-pr5-hosted-release.md`.

Training Builder accepts deterministic pasted text through the same Program Draft
review/edit and atomic commit flow used by CSV/PDF imports. Blank-line blocks map
to one to five days; unmatched new exercises are stored as manual entries needing
review. CSV and PDF imports retain their existing three-to-five-day validation.
AI-assisted PDF parsing is explicitly deferred and safely returns `503` when its
optional OpenAI configuration is absent.
