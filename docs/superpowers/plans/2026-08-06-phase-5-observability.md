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
- [x] `helmet()` + `app.disable('x-powered-by')`; JSON 404 for unknown routes; terminal error middleware mapping body-parse errors to 400/413 JSON and everything else to a masked 500 via `logError`. _Verified 2026-09-24: `backend/src/app.js` (helmet + x-powered-by at lines 41–42, JSON 404 at 86, terminal handler at 92–101)._
- [x] Sentry init in `app.js` when `SENTRY_DSN` is set (environment tag, PII scrub); `logError` additionally does `captureException` with the context label as a tag, flushing via `waitUntil` on Vercel. _Verified 2026-09-24: `backend/src/app.js` lines 13–19 (gated init, `sendDefaultPii: false`, `beforeSend`); `backend/src/utils/logger.js` lines 28–35 (`captureException` with context tag, `waitUntil(Sentry.flush(...))`)._
- [x] Startup `console.error` warning when email is unconfigured in production (silent-no-email becomes visible in logs). _Verified 2026-09-24: `backend/src/app.js` line 32._
- [x] `supabase.js` throws at boot in production/Vercel when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are missing (dev keeps the console warning). _Verified 2026-09-24: `backend/src/supabase.js` lines 9–15._
- [x] 15s default `AbortSignal.timeout` on all outbound Supabase fetches (admin wrapper + anon client), preserving caller-supplied signals. _Verified 2026-09-24: `backend/src/supabase.js` `withDefaultTimeout` (lines 19–24) applied to both the admin client (line 29) and `anonClient()` (line 37)._

### Task 2: Frontend (`api.js`, `main.jsx`, `AppErrorBoundary.jsx`, `vercel.json`)
- [x] 60s axios timeout on the API client. _Verified 2026-09-24: `frontend/src/lib/api.js` line 8 (`timeout: 60000`)._
- [x] Sentry init in `main.jsx` when `REACT_APP_SENTRY_DSN` is set (no tracing/replay — errors only); `AppErrorBoundary.componentDidCatch` forwards the error to Sentry alongside the existing telemetry event. _Verified 2026-09-24: init lives in `frontend/src/lib/errorReporting.js` (DSN-gated dynamic import, `tracesSampleRate: 0`, no replay) and is called from `frontend/src/main.jsx` line 6; `frontend/src/components/AppErrorBoundary.jsx` line 18 calls `reportError` from `componentDidCatch`._
- [x] `vercel.json` headers: nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (camera/mic/geolocation off), HSTS. _Verified 2026-09-24: `frontend/vercel.json` `headers` block carries all five._

### Task 3: Migration guard workflow
- [x] `.github/workflows/migration-guard.yml` — `pull_request` with `labeled`/`unlabeled` types; fails any PR touching `supabase/migrations/**` unless it carries the `migration-applied` label; passing the label re-runs only this cheap job. _Verified 2026-09-24: `.github/workflows/migration-guard.yml` (types include `labeled`/`unlabeled`; diff on `supabase/migrations/`; label check)._

### Task 4: Env documentation
- [x] `backend/.env.example`: add `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFY_REPLY_TO`, `SENTRY_DSN` with comments; `frontend/.env.example`: add `REACT_APP_SENTRY_DSN`. _Verified 2026-09-24: `backend/.env.example` lines 14–22; `frontend/.env.example` line 9._
- [ ] DEPLOYMENT.md: env tables updated with the email/cron/Sentry vars; deferred-CSP note; uptime + backup check-in items referenced. _Partially verified 2026-09-24: `DEPLOYMENT.md` carries the `CRON_SECRET`/`SENTRY_DSN`/`REACT_APP_SENTRY_DSN` rows and the deferred-CSP note (lines 77–79, 99–100, 106); no uptime-monitor or backup check-in reference was found in `DEPLOYMENT.md`, so this item stays open._

### Task 5: Tests + verify
- [x] `backend/test/ops-hardening.test.js`: functional 404-is-JSON and malformed-JSON-is-400 against the mounted app (stubbed supabase); `.env.example` completeness assertions; source asserts for helmet, terminal handler, Sentry-gating, timeout wiring, and the production fail-fast. _Verified 2026-09-24: `backend/test/ops-hardening.test.js` lines 29–86 cover each of these._
- [ ] Full backend suite + frontend build green; scoped commits; push; PR. **PAUSE for owner.** _Backend suite (319/319) and frontend build re-verified green on 2026-09-24; the owner check-in gate below is not something this repo can verify, so the box stays open._

**⏸ OWNER CHECK-IN (launch-ready gate):** create Sentry (backend + frontend DSNs) and UptimeRobot (monitor `GET /api/health` + frontend URL) accounts; set `SENTRY_DSN`/`REACT_APP_SENTRY_DSN` in Vercel; confirm Supabase backup tier, enable PITR/Pro backups, run one test restore; enable branch protection requiring CI; create the `migration-applied` label in GitHub.
