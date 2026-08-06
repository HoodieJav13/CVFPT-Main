# Phase 5: Observability + Deploy Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production 500, a down backend, or a misconfigured email system becomes visible; deploys can no longer outrun migrations silently; requests fail fast instead of hanging.

**Architecture:** Sentry SDKs wired but inert without a DSN (owner adds accounts at check-in). Error capture hooks into the existing `logError` chokepoint (routes catch their own errors, so an Express error handler alone would see almost nothing). Security headers via `helmet` (backend) and `vercel.json` (frontend static). A separate `migration-guard` workflow enforces the migration-first rule with a `migration-applied` label.

**Tech Stack:** @sentry/node, @sentry/react, helmet, GitHub Actions, Vercel headers.

## Global Constraints

- Sentry must preserve the existing PII discipline: no request bodies, headers, queries, or user-supplied values in events (`sendDefaultPii: false` + `beforeSend` scrub).
- All new behavior no-ops cleanly when its env var is absent — CI and local dev need no new configuration.
- No CSP on the SPA yet (needs an inline-script/style inventory first) — deferred, recorded in DEPLOYMENT.md.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

### Task 1: Backend hardening (`app.js`, `logger.js`, `supabase.js`, `supabaseFetch.js`)
- [ ] `helmet()` + `app.disable('x-powered-by')`; JSON 404 for unknown routes; terminal error middleware mapping body-parse errors to 400/413 JSON and everything else to a masked 500 via `logError`.
- [ ] Sentry init in `app.js` when `SENTRY_DSN` is set (environment tag, PII scrub); `logError` additionally does `captureException` with the context label as a tag, flushing via `waitUntil` on Vercel.
- [ ] Startup `console.error` warning when email is unconfigured in production (silent-no-email becomes visible in logs).
- [ ] `supabase.js` throws at boot in production/Vercel when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are missing (dev keeps the console warning).
- [ ] 15s default `AbortSignal.timeout` on all outbound Supabase fetches (admin wrapper + anon client), preserving caller-supplied signals.

### Task 2: Frontend (`api.js`, `main.jsx`, `AppErrorBoundary.jsx`, `vercel.json`)
- [ ] 60s axios timeout on the API client.
- [ ] Sentry init in `main.jsx` when `REACT_APP_SENTRY_DSN` is set (no tracing/replay — errors only); `AppErrorBoundary.componentDidCatch` forwards the error to Sentry alongside the existing telemetry event.
- [ ] `vercel.json` headers: nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (camera/mic/geolocation off), HSTS.

### Task 3: Migration guard workflow
- [ ] `.github/workflows/migration-guard.yml` — `pull_request` with `labeled`/`unlabeled` types; fails any PR touching `supabase/migrations/**` unless it carries the `migration-applied` label; passing the label re-runs only this cheap job.

### Task 4: Env documentation
- [ ] `backend/.env.example`: add `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFY_REPLY_TO`, `SENTRY_DSN` with comments; `frontend/.env.example`: add `REACT_APP_SENTRY_DSN`.
- [ ] DEPLOYMENT.md: env tables updated with the email/cron/Sentry vars; deferred-CSP note; uptime + backup check-in items referenced.

### Task 5: Tests + verify
- [ ] `backend/test/ops-hardening.test.js`: functional 404-is-JSON and malformed-JSON-is-400 against the mounted app (stubbed supabase); `.env.example` completeness assertions; source asserts for helmet, terminal handler, Sentry-gating, timeout wiring, and the production fail-fast.
- [ ] Full backend suite + frontend build green; scoped commits; push; PR. **PAUSE for owner.**

**⏸ OWNER CHECK-IN (launch-ready gate):** create Sentry (backend + frontend DSNs) and UptimeRobot (monitor `GET /api/health` + frontend URL) accounts; set `SENTRY_DSN`/`REACT_APP_SENTRY_DSN` in Vercel; confirm Supabase backup tier, enable PITR/Pro backups, run one test restore; enable branch protection requiring CI; create the `migration-applied` label in GitHub.
