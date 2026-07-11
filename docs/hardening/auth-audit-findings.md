# Authentication and ownership audit findings

Audit date: 2026-07-10

Scope: all 94 Express endpoints registered under `backend/src/routes`, the global authentication middleware, Supabase service-role isolation, CORS, payment/webhook handling, and state-changing multi-step flows.

Local verification now includes 21 backend regression tests plus an isolated
PostgreSQL execution test of both migrations and the transactional RPC behavior.
Live development authorization and browser verification remain pending target confirmation.

## Critical and high findings

### P1 — Cross-coach workout-assignment archive (fixed locally)

`PATCH /api/programs/workout-assignments/:assignmentId/archive` updates the supplied assignment ID directly. It never loads the assignment's client or checks `canAccessClient`. A different coach with an assignment UUID can archive it. The expected response is ownership-hiding `404`.

Evidence: `backend/src/routes/programs.js`, workout-assignment archive handler.

Resolution: the handler loads the active assignment with its client, applies the
admin/coach ownership rule, returns ownership-hiding `404`, and conditionally
archives only the verified active row. Pure authorization and source-contract
regressions cover owning coach, different coach, admin, missing, and archived cases.

### P1 — Cross-coach workout disclosure through program days (fixed locally)

Program create and update validate only that each day has a `workout_id`. They do not verify that every referenced workout is global or owned by the calling coach. A coach can place another coach's workout UUID into their own program; `programWithDetails` then returns that workout and its exercises because it trusts the program ownership check.

Evidence: `replaceProgramDays`, `POST /api/programs`, and `PUT /api/programs/:id` in `backend/src/routes/programs.js`.

Resolution: create/update resolve every unique workout ID and reject inaccessible,
missing, or archived workouts with `404`. Regression coverage includes own,
global, different-coach, missing, and archived references.

### P1 — Stripe live keys are not rejected (fixed locally)

`getStripe()` accepts any configured secret key. If a live key were accidentally supplied, checkout and webhook code could perform live-mode operations, contrary to the locked test-mode-only invariant.

Evidence: `backend/src/routes/payments.js:getStripe`.

Resolution: only `sk_test_`/`rk_test_` secrets and optional `pk_test_` publishable
keys configure Stripe. Live or malformed values are discarded without logging;
five regression cases prove the client cannot be constructed in live mode.

### P1 — Booking approval can create duplicate sessions (fixed locally)

Before remediation, approval loaded a pending request, inserted a session, then
updated the request. Concurrent approvals could both observe `pending` and create
two sessions; a failure after insertion could also leave a pending request.

Evidence: `PATCH /api/bookings/:id/approve` in `backend/src/routes/bookings.js`.

Resolution: `approve_booking(uuid)` conditionally transitions one active pending
request and creates its session in the same transaction. The HTTP route delegates
to the service-role-only RPC. Isolated PostgreSQL verification proved a repeated
approval creates exactly one session.

### P1 — Session completion and credit updates are non-transactional (fixed locally)

Session completion reads the session, performs a read-modify-write credit deduction, then marks the session completed. Concurrent requests can deduct twice. `setBalance` also loses concurrent credit changes. Purchase completion marks a purchase complete before granting credits, so an interruption can permanently omit the grant.

Evidence: `PATCH /api/sessions/:id/complete` and `backend/src/utils/credits.js`.

Resolution: versioned `complete_session`, `complete_purchase`, and
`record_manual_purchase` invoker-security RPCs use row locks, conditional state
transitions, atomic credit updates, and idempotent ledger source keys. Direct
Data API execution is revoked from `PUBLIC`, `anon`, and `authenticated`; only
`service_role` is granted. PostgreSQL verification proved repeat completion/grant
calls do not double-apply credits.

### P1 — No application rate limits on authentication or expensive imports (fixed locally)

Login, signup, token refresh, CSV parsing, PDF parsing/OpenAI requests, and bulk exercise import have no application-level throttling. Supabase Auth limits do not cover the Express/OpenAI/PDF processing boundary.

Resolution: proxy-aware limiters cover login, signup, refresh, library import,
CSV/PDF parsing, import commit, and PDF export. The generic `429` response and
standard headers are regression-tested. Secret-dependent integration remains opt-in.

## Moderate findings

### P2 — Waiver-signature and version uniqueness relied on pre-checks (fixed locally)

Client signature creation checks for an existing current signature before insert, but the schema has no unique `(client_id, waiver_version_id)` constraint. Concurrent requests can append duplicate signatures. Paper signing does not check duplicates. Waiver version allocation also reads the latest version and increments it outside a transaction.

Resolution: a unique `(client_id, waiver_version_id)` index rejects concurrent
duplicates and both signing routes return deterministic `409`s. No legal text or
existing signature is updated or deleted. `create_waiver_version(text)` uses a
transaction-scoped advisory lock to serialize monotonic version allocation.

### P2 — Multi-step program/workout edits can leave partial state (fixed locally)

Workout creation inserts the parent before replacing exercises. Program creation inserts the parent before replacing days. Replacement archives existing children before inserting replacements. A later failure can leave empty or partially updated business records.

Resolution: create/update delegate to service-role-only `save_workout` and
`save_program` RPCs. Isolated PostgreSQL fault injection proved invalid child
writes roll back parent changes and preserve the previous active child set.

### P2 — Archived records remain directly mutable in several coach routes (fixed locally)

Before remediation, client, session, message, progress, check-in, program,
assignment, and payment ownership loaders commonly omitted `archived = false`.
Lists hid archived rows while known IDs could still reach them.

Resolution: ordinary ID-based client, session/note, progress, check-in, message,
program/workout/assignment, booking, waiver, package, payment, and admin reassignment
paths now hide archived rows. Explicit archive/restore boundaries retain intentional
access. A regression contract covers the cross-route predicate set.

### P2 — Input validation is inconsistent (partially fixed locally)

Invalid dates and durations can become database errors and generic `500`s; package updates can introduce negative/non-numeric prices or credits; manual payment amounts can be negative; bulk imports are not bounded by row count; several string fields accept unbounded values.

Resolution to date: centralized bounded validation covers package price/credits,
session and booking timestamps/durations, manual purchase amounts, and 500-row
exercise import limits, with stable `400`/`413` responses. Broader string and
payload schemas remain a maintenance item.

### P2 — CORS can reflect every origin while credentials are enabled (fixed locally)

Before remediation, `CORS_ORIGINS=*` reflected arbitrary origins and enabled
credential support, broader than the isolated two-project deployment requires.

Resolution: exact explicit origins only, with wildcard/path/malformed rejection,
no production defaults, local development defaults, and credentials disabled.

### P2 — Signup claim linking should be conditional (fixed locally)

The claim flow finds an invited/unclaimed client, creates an auth user, then updates the client by ID only. The update should repeat the invited, unclaimed, and non-archived predicates and verify a returned row before treating the claim as successful.

Resolution: the link update repeats invited/unclaimed/active predicates, requires
a returned row, rejects ambiguous invitations, and removes the orphaned auth user
when the claim race is lost. Token refresh also rejects archived/unlinked profiles.

## Lower-severity and maintenance findings

- Admin client reassignment and package mutations now return stable `404`s for missing/archived records.
- Message read-marking now excludes archived messages.
- Shared/global workouts remain readable by coaches but are now admin-only to edit/archive.
- The client dashboard always returns `coach_name: null` even though the client has a coach relationship.
- Some error logging passes full error objects. No credential value was found in source, but structured redaction should be applied before production logging.
- Duplicate statements exist in the program route (`error.status`, exercise update loop, and `frequency_days` property). They are harmless but should be removed during scoped cleanup.

## Controls verified as present

- Supabase service/secret use is confined to the backend; no frontend Supabase client or service-role variable reference exists.
- Authentication resolves non-archived coach/client profiles server-side for every protected route.
- Coach ownership checks generally return `404` for missing/different-owner clients, sessions, metrics, notes, messages, programs, and payment history.
- Client routes derive their client ID from the authenticated profile rather than request bodies or path parameters.
- Waiver versions and signatures have no update/delete endpoint; existing legal records remain append-only.
- Business-record deletion is implemented through `archived` updates; no route issues hard-delete operations.
- Stripe webhook signatures are verified against the raw request body when test Stripe configuration is present.

## Regression and live verification status

- Legacy Python and destructive proof-of-concept runners were removed.
- Secret-free CI runs backend regressions, frontend build, and production audits.
- Backend regressions: 21 passing.
- Opt-in API integration harness: development/preview allowlist, dedicated fake
  accounts, hard-delete prohibition, and soft-archive cleanup implemented; live run pending.
- All three migrations and transactional RPC assertions executed successfully
  against isolated PostgreSQL 16, including rollback-on-child-failure tests.
  Hosted PostgreSQL 17 verification remains pending.
- Live authorization matrix and coach/client browser flows remain pending until
  the intended empty Supabase development target is explicitly confirmed and initialized.
