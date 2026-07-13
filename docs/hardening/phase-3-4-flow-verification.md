# Phase 3–4 coach and client flow verification

Verification date: 2026-07-12

Targets: protected Vercel previews, plus an isolated local frontend/backend pointed
at the hosted fake-data Supabase development project. The 12-check protected role
smoke covers deployed boundaries; the expanded real-auth browser and 88-check API
harness exercise the local candidate code against hosted data. All identities and
created records were labeled test data. Cleanup used soft archive/state transitions
only; no business record was hard-deleted.

## Evidence summary

- Expanded real-auth browser suite: 6/6 passing (auth-negative, recoverable
  load failures, client, coach/Training Builder, session/payment/progress, admin).
- Hosted-Supabase API harness: 88/88 passing.
- Protected Vercel role smoke: 12/12 passing.
- Hosted invite/signup/refresh flow: 7/7 passing.
- Preview browser regressions: 5/5 passing; backend regressions: 44/44 passing.
- Backend/frontend production audits: zero known vulnerabilities; frontend build
  passes. The full frontend audit additionally reports two low-severity dev-only
  `@eslint/plugin-kit` findings; the forced fix would move ESLint outside its
  declared range and was not applied.

## Phase 3 — coach/admin flows

| Flow | Status | Evidence / disposition |
|---|---|---|
| Login, logout, profile, role routing | Pass | Real browser plus protected Vercel login and `/auth/me` |
| Token refresh | Pass | Hosted refresh followed by authenticated identity read |
| Dashboard, loading/empty/error states | Pass | Real-auth fault injection proves client and coach failures expose an accessible retry state and recover; initial skeleton, empty, and success states also pass |
| Client create, edit, invite, archive, restore | Pass | Real-auth browser lifecycle plus hosted invite/signup/archive |
| Reassign and ownership boundaries | Pass | Real admin UI reassigns the authenticated client away and back; 88-check live matrix verifies former/new coach access, cross-coach `404`, and admin access |
| Sessions, notes, cancel/complete, credits | Pass | Real UI schedule/edit/cancel, shared-note create/share toggles, complete, past filtering, client shared-note read, and credit deduction; API idempotency also passes |
| Progress and daily check-ins | Pass | Real browser coach/client check-in and metric entry/edit/archive controls plus API ownership checks |
| Programs, assignments, exercise library | Pass | The local candidate UI against hosted data covers library search/import/create/edit/archive; workout add/remove/create/edit/archive; program frequency/day notes/create/edit/archive; deterministic paste and CSV parsing through the shared review/edit and atomic commit path; active/dated assignment/unassignment; client video-link read; and branded PDF export. Paste import accepts one to five days, reuses normalized exercise matches, and creates unmatched exercises as `manual`/`needs_review`; CSV/PDF validation remains three to five days. Cross-coach `404` passes. AI-assisted PDF parsing is explicitly deferred. |
| Resource Library | Pass | Coaches globally list/manage resources regardless of uploader; valid PDF upload, non-PDF rejection, category reuse, public access, private assignment, unassign/reassign, 60-second signed links, client response redaction, and access-hiding `404` all pass. Cleanup archives test resources and deactivates assignments without deleting stored PDFs. |
| Messaging | Pass | Real client send, coach thread/reply, and client reply read all pass |
| Booking approve/decline | Pass | Real UI request plus exact approve and decline controls; atomic approval creates the session shown in the coach/client lifecycle |
| Manual purchases/packages | Pass | Real UI package recurring/create/edit/archive/restore, manual purchase/history, credit grant, session deduction, and client history/balance. Stripe remains intentionally disabled. |
| Waiver status/sign/paper workflow | Deferred by owner | Status and append-only route controls pass. On 2026-07-11 the owner explicitly deferred successful signing/paper-sign verification until business-approved legal text exists. No waiver text was created or changed. |
| Admin-only surfaces | Pass | Real admin browser covers tabs, safe duplicate-coach rejection, blank waiver-publish gate, package lifecycle, client reassignment round trip, mobile admin link, and client-route redirect; hosted coach creation also passes |
| Responsive/mobile navigation | Pass | Real client and coach browser flows click all five bottom tabs; coach quick-add and admin mobile link pass |

## Phase 4 — client flows

| Flow | Status | Evidence / disposition |
|---|---|---|
| Invite-only signup and non-invited rejection | Pass | Hosted positive invite/signup/login and `403` rejection |
| Login, logout, refresh, protected routing | Pass | Real browser and hosted token lifecycle checks |
| Home dashboard and daily check-in | Pass | Live browser save/update and soft-archive cleanup |
| Sessions and booking requests | Pass | Real request/pending display, coach approve/decline, completed-session read, and shared-note read |
| Progress | Pass | Live client entry creation/update, coach metric lifecycle, ownership checks, and browser empty state |
| Programs/workouts/video links | Pass | Live one-day paste import/edit, assignment/read with a video-bearing exercise, normalized exercise reuse/source verification, and empty-state browser coverage |
| Resource Library | Pass | Client list/download includes public or actively assigned PDFs only; another fake client cannot list or directly request a private assignment, and responses never expose storage paths. |
| Messaging | Pass | Real browser client send, coach reply, and client receipt |
| Waiver | Deferred by owner | Status works. Successful signing verification was explicitly deferred on 2026-07-11 until approved waiver text exists. |
| Packages, payments-disabled, credits/history | Pass | Live payment-disabled state plus manual-purchase history and credit grant/use balance; no live Stripe |
| Coach/admin and other-owner access attempts | Pass | Browser redirect plus live authorization matrix |
| Loading, success, empty, error, mobile states | Pass | Real-auth skeleton/error/retry fault injection, explicit empty states, successful mutations, and all client mobile destinations; preview regressions remain deterministic |

## Functional cleanup result

The real-auth browser run found two confirmed defects. First, after archiving a client,
the detail page reloaded through an active-only lookup and could not expose the
restore action. The explicit `include_archived=true` restore boundary now loads
only an owned/admin-visible archived client, while ordinary detail reads remain
active-only. Second, initial API load failures left several pages on an endless
skeleton or blank screen. A shared accessible retry state now covers the affected
coach, client, admin, and client-detail loaders while preserving their skeletons
and existing data on background refresh failures. Regression coverage and live
fault-injection/retry flows pass.

No other Phase 3/4 failures were confirmed. Every labeled, archivable
`CVF TEST`/`CVF LIVE` business row left without an application cleanup route was
soft-archived with the guarded,
allowlisted `npm run test:cleanup` command; a second idempotency pass reported zero
active rows across parents, child rows, purchases, ledgers, bookings, and messages.
An initial live-suite attempt also exposed test-harness configuration/order issues
only; after correcting the harness, the final real-auth run passed 6/6. AI-assisted
PDF parsing is explicitly deferred by scope. Successful waiver signing/paper-sign
verification is also explicitly deferred by the owner until approved legal text
exists. Those accepted deferrals leave no remaining verification gate in the
Phase 2–5 hardening scope and do not justify weakening the current security model.
