# CVF PT

Internal personal training management app for Core Value Fitness (Albuquerque) — session scheduling, client management, packages, and waivers.

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
browser checks are secret-free. The current results are 44/44 backend checks and
5/5 preview browser flows:

```sh
cd backend && npm test
cd frontend && npm run build
cd frontend && npm run test:e2e:preview
```

The mutating API integration harness is opt-in and accepts only an explicitly
allowlisted development or preview target. Copy `backend/integration/.env.example`
to a local ignored environment file, export its values, then run
`cd backend && npm run test:integration`. It uses dedicated fake-data accounts,
forbids hard-delete requests, and soft-archives the records it creates. The current
matrix covers 88/88 health, authentication, ownership, client, session, note,
credit, package, progress, booking, messaging, Training Builder, Resource Library, and assignment
checks.
For real-auth browser artifacts that have no public archive endpoint, the guarded
`cd backend && npm run test:cleanup` command requires an allowlisted fake-data
Supabase host and a `CVF LIVE`/`CVF TEST` label prefix, then performs soft archives
only. Run it from the same secure ignored environment after browser verification.

Real-auth browser verification is also opt-in. Copy
`frontend/e2e/live.env.example` to a secure ignored location, supply dedicated
development accounts and the local backend URL, then run
`node --env-file=/path/to/live.env node_modules/@playwright/test/cli.js test --config playwright.live.config.mjs`
from `frontend/`. The live config explicitly disables preview mode. The current
six-flow suite covers negative auth, recoverable loading errors, client and coach
controls, Training Builder, session/payment/progress/booking/messaging lifecycles,
admin management, and responsive navigation.

Training Builder accepts deterministic pasted text through the same Program Draft
review/edit and atomic commit flow used by CSV/PDF imports. Blank-line blocks map
to one to five days; unmatched new exercises are stored as manual entries needing
review. CSV and PDF imports retain their existing three-to-five-day validation.
AI-assisted PDF parsing is explicitly deferred and safely returns `503` when its
optional OpenAI configuration is absent.
