# CVF PT - Deployment Guide (Vercel)

The app is two deployables: a **Node/Express API** (`/backend`) and a **React/Vite SPA** (`/frontend`).
Deploy them as two Vercel projects (recommended) pointing at the respective subdirectories.

---

## 1. Backend (Vercel project root: `backend/`)

- `api/index.js` exports the Express app as a serverless function; `vercel.json` rewrites all paths to it.
- All routes are already prefixed `/api/...`.
- Local/server mode also works anywhere with `npm start` (binds `0.0.0.0:$PORT`, default 8001).

### Required environment variables (Vercel -> Settings -> Environment Variables)
| Variable | Value |
|---|---|
| `SUPABASE_URL` | The explicitly confirmed development Supabase project URL |
| `SUPABASE_ANON_KEY` | Current `sb_publishable_...` key (the legacy variable name is retained for application compatibility) |
| `SUPABASE_SERVICE_ROLE_KEY` | Current `sb_secret_...` server key; never expose it to the frontend |
| `OPENAI_API_KEY` | Optional secret for AI-assisted PDF program import; omit to return a safe `503` from that path |
| `PROGRAM_IMPORT_MODEL` | Required model identifier when AI-assisted PDF import is enabled; document and pin the preview choice |
| `STRIPE_SECRET_KEY` | `sk_test_...` (TEST mode; leave empty to disable payments gracefully) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (optional) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (optional; payment verification also works without webhooks via `/api/payments/verify` polling on the success redirect) |
| `FRONTEND_URL` | The deployed frontend URL, e.g. `https://cvfpt.vercel.app` (used for Stripe success/cancel redirects) |
| `CORS_ORIGINS` | Comma-separated exact frontend origins; wildcards and paths are rejected |

The current hardening preview intentionally leaves `OPENAI_API_KEY` and
`PROGRAM_IMPORT_MODEL` unset, so AI PDF parsing is the only unverified deployment
path. CSV parsing, atomic import commit, and branded PDF export do not require them.

### Stripe webhook (optional but recommended)
Point a TEST-mode webhook at `https://<backend-domain>/api/payments/webhook` for event `checkout.session.completed`, then set `STRIPE_WEBHOOK_SECRET`.

---

## 2. Frontend (Vercel project root: `frontend/`)

- Framework preset: **Vite**. Build: `yarn build` (or `npm run build`), output `dist/`.
- `vercel.json` contains the SPA fallback rewrite.

### Required environment variable
| Variable | Value |
|---|---|
| `REACT_APP_BACKEND_URL` | The deployed **backend** URL (no trailing slash), e.g. `https://cvfpt-api.vercel.app` |

---

## 3. Database
Schema lives in `supabase/migrations/`; `backend/migration.sql` mirrors the current
baseline for review. Apply versioned migrations only to the explicitly confirmed
development project and verify the resulting schema before deploying either app.

The idempotent seed is development/preview-only and fails closed unless
`CVF_SEED_CONFIRM_DEVELOPMENT=true`, the exact Supabase hostname is allowlisted,
and dedicated fake-account credentials are supplied through the environment.
It never prints those credentials. Run it with `cd backend && npm run seed` only
after those safeguards are configured.

## 4. Verified hardening previews

- Frontend branch alias: `https://cvfpt-frontend-git-codex-phase-2-5-hardening-cvf.vercel.app`
- Backend branch alias: `https://cvfpt-backend-git-codex-phase-2-5-hardening-cvf.vercel.app`

Both previews remain behind Vercel Authentication. Verification covered backend
health, exact-origin CORS, real login/refresh, CSV parse, atomic commit, branded
PDF export, frontend root/bundle/backend target, and logo delivery. Runtime logs
were reviewed after the final healthy requests: no new error entry accompanied the
successful health/auth/import/export probes. Earlier isolated failures for missing
variables and serverless PDF loading are retained in Vercel history and resolved by
the current commits. Rollback is re-aliasing either project to its prior Ready
deployment; the originally empty database rollback is documented under
`docs/hardening/`.

## 5. Local development (this workspace)
Supervisor runs `backend/server.py`, a thin ASGI proxy that spawns the Node server (port 8002) and proxies port 8001 -> Node. This is local-environment glue only; Vercel uses the Node app directly.
