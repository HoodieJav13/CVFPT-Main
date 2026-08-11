# CVF PT deployment guide

CVF PT deploys as two isolated Vercel projects from one repository:

- `frontend/` — React/Vite single-page application
- `backend/` — Node/Express API

Each Vercel project must use its own directory as the project root. A deployment
cannot import files from the other project or from a repository-root shared
folder. See [CLAUDE.md](CLAUDE.md) for the locked deploy-boundary rules.

## Current environment model

Preview and Production are separate Vercel environment scopes. They currently
point to the same Supabase project and intentionally share one surviving
current-format server secret. This is temporary while CVF PT has no real launch
domain. At launch, Production must receive its own Supabase project and its own
owner-created key before real users or live data are onboarded.

Supabase key creation, copying, rotation, and retirement are always manual,
owner-only dashboard actions. An agent may verify variable names/scopes and test
deployed endpoints, but must never create, retrieve, reveal, copy, or disable a
Supabase key. Environment changes apply only to new Vercel deployments, so
redeploy the affected scope after changing a variable.

Current scope expectations:

| Vercel scope | Frontend project | Backend project |
|---|---|---|
| Preview | `REACT_APP_BACKEND_URL` targets the protected backend Preview alias | Supabase variables plus exact Preview `CORS_ORIGINS` and `FRONTEND_URL` |
| Production | `cvfpt-frontend.vercel.app` targets the Production backend alias | Supabase variables plus exact `cvfpt-frontend.vercel.app` CORS/redirect origin |

## Merge and migration ordering

Merging to `main` automatically starts both Vercel Production deployments through
Git integration. A migration-bearing PR therefore cannot be merged and then
honestly promise that a separately run migration will land before deployment.

If a release requires migration-first ordering, use a backward-compatible
forward migration and apply/verify it before the owner merges the PR, or
explicitly pause automatic deployment. The owner still performs the merge; agents
must disclose the trigger and obtain the separate hosted-migration authorization.
The 2026-07-22 PR #5 release exposed this sequencing constraint and is documented
in [its hosted release ledger](docs/hardening/2026-07-22-pr5-hosted-release.md).

## Backend project

Vercel project root: `backend/`.

`api/index.js` exports the Express application as a serverless function, and
`vercel.json` rewrites API traffic to it. Application routes are under `/api`.

### Required Supabase variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Explicitly confirmed Supabase project URL for the target environment |
| `SUPABASE_ANON_KEY` | Current publishable key; the legacy variable name is retained for application compatibility |
| `SUPABASE_SERVICE_ROLE_KEY` | Current server-only secret; never expose it to the frontend |

### Origin and redirect variables

- `CORS_ORIGINS` is a comma-separated list of exact HTTP(S) origins. Each value
  must contain only scheme, host, and optional port. Wildcards, paths, malformed
  URLs, and partial-host matching are rejected. Browser credential support is
  disabled.
- Production `CORS_ORIGINS` is the exact deployed frontend alias. Requests
  without an `Origin` header, including server-side health checks, remain
  available.
- `FRONTEND_URL` remains the canonical frontend origin for backend-generated
  links/redirects. Active payment routes are retired and do not use it.

### Email and cron variables (required for notifications)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key. Without it (or the other two rows) every email — invites, password resets, booking/session notifications, daily digest — silently no-ops; production logs a startup warning |
| `NOTIFY_REPLY_TO` | Reply-to address on all outgoing email |
| `CRON_SECRET` | Bearer secret for the Vercel cron hitting `POST /api/internal/digest`; the digest fails closed without it |

`FRONTEND_URL` (above) is also part of the email gate — links in emails are
built from it.

### Web push variables (optional; lock-screen notifications)

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Key pair identifying this server to browser push services. Generate once with `npx web-push generate-vapid-keys`; all three rows required or push stays inert |
| `VAPID_SUBJECT` | Contact URI for push services, e.g. `mailto:owner@corevaluefitness.com` |

iPhones deliver web push only to the installed (Home Screen) PWA; the
notification-settings dialog explains this to users. Rotating the key pair
invalidates every existing subscription — users just re-enable the toggle.

### Observability variables (optional but strongly recommended for Production)

| Variable | Project | Purpose |
|---|---|---|
| `SENTRY_DSN` | backend | Error tracking via Sentry; inert when unset. Events are PII-scrubbed (no bodies, headers, or user values) |
| `REACT_APP_SENTRY_DSN` | frontend | Browser error tracking; the SDK is not even loaded when unset |

### Security headers

The backend sets baseline headers via `helmet`; the frontend sets
nosniff/frame/referrer/permissions/HSTS headers via `frontend/vercel.json`.
A Content-Security-Policy for the SPA is deliberately deferred until an
inline-script/style inventory exists — do not add one ad hoc.

### Migration guard

`.github/workflows/migration-guard.yml` fails any PR that touches
`supabase/migrations/` unless it carries the `migration-applied` label —
add the label only after `supabase db push` has been run against the hosted
project and `supabase migration list --linked` shows no drift. The label
must exist in the repository (Settings → Labels → create `migration-applied`).

### Optional integrations

- `OPENAI_API_KEY` and `PROGRAM_IMPORT_MODEL` are intentionally absent while
  AI-assisted PDF parsing is deferred. That route fails closed with `503`;
  deterministic paste/CSV parsing and branded PDF export do not need them.
- Stripe/package/payment runtime routes are retired and unmounted. Do not
  configure a webhook or add Stripe variables for the active app. Dormant source,
  dependency, applied schema, and historical data remain preserved for
  reversibility; reactivation requires an explicit product decision and a
  separate deployment review.

## Frontend project

Vercel project root: `frontend/`.

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist/`
- `frontend/vercel.json` supplies the single-page application fallback.

`REACT_APP_BACKEND_URL` must contain the target backend origin without a trailing
slash. Preview must target the protected backend Preview alias. Production
targets the Production backend alias paired with `cvfpt-frontend.vercel.app`.

## Database migrations

`supabase/migrations/` is the canonical schema history. It currently contains
**16 applied versioned migrations**, matching the hosted PostgreSQL 17
development project through
`20260720173000_exercise_performance_history.sql`. Every future schema change
must be a new numbered migration; never edit an applied migration.

`backend/migration.sql` is frozen historical evidence from before versioning. Do
not edit it or run it against a database where the versioned migrations have been
applied.

The development seed is opt-in and fails closed unless its development target,
hostname allowlist, and dedicated fake-account settings are explicitly supplied.
It must never run against a future standalone Production project.

## Local development

Use the ordinary Node and Vite processes; there is no Python/uvicorn proxy.

Backend:

```sh
cd backend
npm install
npm run dev
```

The API listens on port 8001 by default. Use `npm start` for non-watch mode.

Frontend:

```sh
cd frontend
npm install
npm run dev
```

The Vite development server listens on port 3000. Start from the sanitized
`backend/.env.example` and `frontend/.env.example` templates; keep real values in
ignored local files or secure deployment settings.

## Verification and rollback

After deploying either backend scope, verify health, authentication boundaries,
service-backed reads, and the applicable exact-origin CORS behavior. Production
CORS is active for the current Vercel frontend alias and must be verified after
backend deployment. The protected development evidence, accepted deferrals, and
dated hosted releases are recorded under `docs/hardening/`.

Application rollback means re-aliasing the Vercel project to a previously Ready
deployment. Database recovery must follow the migration-specific guidance in the
hardening audit and must not hard-delete business records.

## Related current documentation

- [Product overview](docs/product-overview.md)
- [Design principles](docs/design-principles.md)
- [Repository invariants and current status](CLAUDE.md)
- [Latest hosted release evidence](docs/hardening/2026-07-22-pr5-hosted-release.md)
