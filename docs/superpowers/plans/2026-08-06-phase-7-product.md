# Phase 7: Product Fast-Follows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the owner's 2026-08-06 Phase 7 decisions: client self-serve cancellation (24h cutoff, policy Option A), withdrawable requests, `no_show` tracking counted against adherence, full coach lifecycle for the admin, a client-roster CSV importer, ICS calendar links, and optimistic chat send. Upstash rate limiting is **deferred** (owner decision).

**Architecture:** One forward-only migration widens the two status CHECKs (`sessions` += `no_show`, `booking_requests` += `withdrawn`). All new routes follow existing ownership/masking patterns; emails reuse `services/email.js`; the importer mirrors the exercise-library CSV flow (client-side parse → preview → commit).

## Owner decisions locked in

- **1b**: client cancel up to **24h** before start; inside the window the UI says "message your coach". Policy text (Option A): *"Cancellations: You can cancel or rebook a session up to 24 hours before it starts. Inside 24 hours, message your coach directly — late cancellations and no-shows may be handled per your coaching agreement."*
- **2a**: `no_show` status; counts against adherence (exposed in session totals + rate).
- **3**: all four — edit coach, archive/restore (blocked while clients assigned; never self; never last admin), admin toggle (never removes the last admin), coach password reset.
- **4**: Upstash **deferred** until it's an issue or >3 coaches.
- **5**: roster CSV importer (name/email/phone/goals), no history import.
- **6**: ICS "Add to calendar" + optimistic message send.

## Tasks

- [ ] **T1 Migration** `supabase/migrations/20260807090000_no_show_and_withdrawn.sql`: drop/re-add `sessions_status_check` with `no_show` and `booking_requests_status_check` with `withdrawn`. PR carries the `migration-applied` label flow.
- [ ] **T2 Emails** (`services/email.js`): `booking-withdrawn` event (to coach) in `notifyBookingEvent`; `notifySessionCancelledByClient(session)` (to coach).
- [ ] **T3 Sessions routes**: `PATCH /:id/no-show` (coach; only past-start scheduled sessions), `PATCH /:id/client-cancel` (client-own; scheduled; ≥24h before start else 400 pointing to messaging; emails the coach), `GET /:id/ics` (owner client or coach; scheduled only; `lib/ics.js` builder with proper escaping/UTC).
- [ ] **T4 Bookings route**: `PATCH /:id/withdraw` (client-own pending → `withdrawn`; emails the coach).
- [ ] **T5 Analytics** (`lib/analytics.js`): `sessionTotals` counts `no_show`; settled denominator includes it; adds `no_show_rate`.
- [ ] **T6 Admin lifecycle** (`routes/admin.js`): `PATCH /coaches/:id` (edit + auth-email sync, 409 duplicates), `PATCH /coaches/:id/archive` (guards: self, last active admin, active clients assigned), `PATCH /coaches/:id/admin` (guard: last admin), `POST /coaches/:id/send-password-reset`.
- [ ] **T7 Roster import** (`routes/clients.js`): `POST /import` (coach; ≤200 rows; name required; lowercased emails; dedupes against existing and in-file; reports `{imported, skipped:[{name,email,reason}]}`; rate-limited).
- [ ] **T8 Backend tests**: mounted coverage for T3/T4/T6/T7 guards, ICS content, analytics no-show math, migration-content assertions.
- [ ] **T9 Frontend**: client Sessions (policy text in drawer + page, two-tap Cancel ≥24h, Withdraw on pending, Add-to-calendar ICS download); coach Sessions (Mark no-show for stale sessions); Chat optimistic send (pending bubbles, failure retry); coach Clients (Import CSV dialog with preview → commit); Admin (edit/archive/admin-toggle/reset actions).
- [ ] **T10 Verify + ship**: backend suite, frontend build, preview e2e; scoped commits; PR titled with DO-NOT-MERGE-until-migration note.

**⏸ OWNER CHECK-IN:** apply the migration (`supabase db push` — or ask me to), add the `migration-applied` label, merge; then a real-account pass: client cancels a session >24h out, withdraws a request, adds a session to their phone calendar; coach marks a no-show and sees it in analytics; admin edits/archives a test coach; import a small CSV. Finally the DEPLOYMENT.md launch condition (separate Production Supabase project at real-domain time).
