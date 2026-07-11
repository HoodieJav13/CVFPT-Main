# Phase 3–4 coach and client flow verification

Verification date: 2026-07-11

Target: protected Vercel previews plus the hosted fake-data Supabase development
project. All identities and created records were labeled test data. Cleanup used
soft archive/state transitions only; no business record was hard-deleted.

## Evidence summary

- Real-auth browser suite: 3/3 passing (client, coach, admin).
- Hosted-Supabase API harness: 32/32 passing.
- Protected Vercel role smoke: 12/12 passing.
- Hosted invite/signup/refresh flow: 7/7 passing.
- Preview browser regressions: 4/4 passing; backend regressions: 29/29 passing.
- Backend/frontend production audits: zero known vulnerabilities; frontend build passes.

## Phase 3 — coach/admin flows

| Flow | Status | Evidence / disposition |
|---|---|---|
| Login, logout, profile, role routing | Pass | Real browser plus protected Vercel login and `/auth/me` |
| Token refresh | Pass | Hosted refresh followed by authenticated identity read |
| Dashboard, loading/empty/error states | Pass | Live browser/API plus preview regressions |
| Client create, invite, archive, restore | Pass | Live browser create/archive/restore and hosted invite/signup/archive |
| Edit/reassign and ownership boundaries | Pass | Route regressions; 32-check live matrix; cross-coach `404` and admin access |
| Sessions, notes, cancel/complete, credits | Pass with scoped evidence | Read surfaces live; transactional state/credit behavior passes PostgreSQL fault/idempotency tests. No live credit-backed session was consumed. |
| Progress and daily check-ins | Pass | Live client check-in save/archive; coach dashboard/detail surfaces; API reads |
| Programs, assignments, exercise library | Pass with one block | Builder/navigation, CSV parse, atomic commit, assignment reads, cross-coach `404`, and branded PDF export pass. AI PDF import is blocked by missing OpenAI preview configuration. |
| Messaging | Pass | Real client send plus coach/client live read surfaces |
| Booking approve/decline | Pass | Client live request and coach live decline; transactional approval passes database idempotency verification |
| Manual purchases/packages | Not applicable in live UI | No fake package fixture was added; payment-disabled state passes and transactional manual-purchase RPC is verified. Stripe remains intentionally disabled. |
| Waiver status/sign/paper workflow | Blocked by legal-data gate | Status and append-only route controls pass. No waiver text was created or changed, so signing/paper-sign UI was not exercised. |
| Admin-only surfaces | Pass | Real admin browser tabs, hosted overview, and client-route redirect |
| Responsive/mobile navigation | Pass | Live client mobile tab plus preview mobile regression |

## Phase 4 — client flows

| Flow | Status | Evidence / disposition |
|---|---|---|
| Invite-only signup and non-invited rejection | Pass | Hosted positive invite/signup/login and `403` rejection |
| Login, logout, refresh, protected routing | Pass | Real browser and hosted token lifecycle checks |
| Home dashboard and daily check-in | Pass | Live browser save/update and soft-archive cleanup |
| Sessions and booking requests | Pass | Live request, pending display, coach decline, and API reads |
| Progress | Pass for current empty state | Live empty state and API ownership checks; write UI needs a coach-created metric fixture |
| Programs/workouts/video links | Pass for current empty state | Live empty state plus API assignment reads. No assigned video fixture exists. |
| Messaging | Pass | Real browser send/read |
| Waiver | Blocked by legal-data gate | Status works; signing is unavailable without approved waiver text |
| Packages, payments-disabled, credits/history | Pass | Live disabled/zero-credit UI and API reads; no live Stripe |
| Coach/admin and other-owner access attempts | Pass | Browser redirect plus live authorization matrix |
| Loading, success, empty, error, mobile states | Pass | Combined real-auth and deterministic preview browser suites |

## Functional cleanup result

The real-auth browser run found one confirmed defect: after archiving a client,
the detail page reloaded through an active-only lookup and could not expose the
restore action. The explicit `include_archived=true` restore boundary now loads
only an owned/admin-visible archived client, while ordinary detail reads remain
active-only. Regression coverage and the live archive/restore browser flow pass.

No other Phase 3/4 failures were confirmed. Deferred/blocked items above require
either an OpenAI preview credential, approved legal waiver content, or additional
fake business fixtures; they do not justify weakening the current security model.
