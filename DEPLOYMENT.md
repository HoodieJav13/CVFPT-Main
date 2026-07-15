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
| Production | Deployment exists, but the real launch domain/configuration is pending | Supabase variables are configured; `CORS_ORIGINS` and `FRONTEND_URL` remain unset until a real frontend domain exists |

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
- With no Production `CORS_ORIGINS`, cross-origin browser requests receive no
  allow-origin grant. Requests without an `Origin` header, including server-side
  health checks, remain available.
- `FRONTEND_URL` is used for Stripe checkout success/cancel redirects. It is
  conditional until a real frontend domain exists and Stripe remains test-only.

### Optional integrations

- `OPENAI_API_KEY` and `PROGRAM_IMPORT_MODEL` are intentionally absent while
  AI-assisted PDF parsing is deferred. That route fails closed with `503`;
  deterministic paste/CSV parsing and branded PDF export do not need them.
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and
  `STRIPE_WEBHOOK_SECRET` are optional test-mode settings. Without them, the app
  exposes its supported “payments not configured” state. Live Stripe keys are
  rejected by application configuration.
- `STRIPE_PORTAL_CONFIGURATION_ID` is optional. When set, it must reference the
  test-mode Customer Portal configuration that allows cancellation and
  next-cycle plan changes without proration.

If test-mode webhooks are enabled, send the following events to
`https://<backend-domain>/api/payments/webhook` and configure the corresponding
test webhook secret manually:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`
- `charge.dispute.created`

Stripe Products and Prices are created manually in the Stripe test dashboard.
The admin Packages tab links a package to its `price_...` identifier and verifies
the active Price through the backend; Stripe then supplies the monetary amount
and recurring interval. Cash-only packages may omit a Stripe Price.

## Frontend project

Vercel project root: `frontend/`.

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist/`
- `frontend/vercel.json` supplies the single-page application fallback.

`REACT_APP_BACKEND_URL` must contain the target backend origin without a trailing
slash. Preview must target the protected backend Preview alias. Production should
be configured only when its final backend/frontend domain pair is approved.

## Database migrations

`supabase/migrations/` is the canonical schema history. It currently contains
**twelve versioned migrations**. The first eight, including metric direction and
the base payment/subscription schema, are applied and verified on the hosted
PostgreSQL 17 development project. Migrations nine through twelve snapshot
subscription entitlements, make payment-review credit adjustments atomic,
archive resources with an explicit assigned-access decision, and honor reviewed
exercise-library choices during program import. Apply all four before deploying
the corresponding branch code. Every future schema change must be a new numbered
migration; never edit an applied migration.

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
CORS/redirect checks are not applicable until its real frontend domain exists.
The protected development evidence and accepted deferrals are recorded under
`docs/hardening/`.

Application rollback means re-aliasing the Vercel project to a previously Ready
deployment. Database recovery must follow the migration-specific guidance in the
hardening audit and must not hard-delete business records.

## Related current documentation

- [Product overview](docs/product-overview.md)
- [Design principles](docs/design-principles.md)
- [Repository invariants and current status](CLAUDE.md)
