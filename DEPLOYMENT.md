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
| `SUPABASE_URL` | `https://kzmsgwkmewbjnhmioduj.supabase.co` |
| `SUPABASE_ANON_KEY` | (anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | (service role key - secret!) |
| `STRIPE_SECRET_KEY` | `sk_test_...` (TEST mode; leave empty to disable payments gracefully) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (optional) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (optional; payment verification also works without webhooks via `/api/payments/verify` polling on the success redirect) |
| `FRONTEND_URL` | The deployed frontend URL, e.g. `https://cvfpt.vercel.app` (used for Stripe success/cancel redirects) |
| `CORS_ORIGINS` | `*` or comma-separated allowed origins |

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
Schema lives in `backend/migration.sql` (already applied to the Supabase project via the SQL editor).
Seed demo data anytime with: `cd backend && node scripts/seed.js` (idempotent).

## 4. Local development (this workspace)
Supervisor runs `backend/server.py`, a thin ASGI proxy that spawns the Node server (port 8002) and proxies port 8001 -> Node. This is local-environment glue only; Vercel uses the Node app directly.
