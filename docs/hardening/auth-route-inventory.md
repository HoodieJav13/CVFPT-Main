# Express authorization route inventory

Audit date: 2026-07-10
Inventory updated: 2026-07-22
Inventory source: the 15 routers mounted in `backend/src/app.js` and their 113
active handlers. Dormant package/payment source files are excluded because their
routers are not mounted.

Common behavior:

- Protected endpoints return `401` without a valid bearer token.
- Role middleware returns `403` for an authenticated but disallowed role.
- Ownership checks should return `404` for both missing and different-owner records.
- `Admin: all` means the admin role intentionally crosses coach ownership boundaries.
- Test evidence codes and section-to-endpoint mappings appear after the inventory.

## Authentication

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `POST /api/auth/login` | Public | Resolves profile from authenticated user ID | Archived profile rejected | Yes, auth session | `400`, `401`, or `403` |
| `POST /api/auth/signup` | Public, invite-only | Claims invited email; no caller-selected client ID | Archived invite excluded | Yes, auth user + client link | `403`; duplicate `409` |
| `POST /api/auth/refresh` | Public with refresh token | Resolves an active linked profile before returning tokens | Archived/unlinked profile rejected and locally signed out | Yes, rotates session | `400`, `401`, or `403` |
| `GET /api/auth/me` | Any authenticated | Own resolved profile only | Archived profile blocked by middleware | No | `401` / `403` |

## Clients

All routes require authenticated coach/admin access.

| Method and path | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---:|---|
| `GET /api/clients` | Coach: own; admin: all | Excluded unless admin/coach requests `include_archived=true` | No | `401` / `403` |
| `POST /api/clients` | Coach forced to self; admin may choose active coach | Creates active | Yes | Invalid coach `404` |
| `GET /api/clients/:id` | Coach: own; admin: all | Archived hidden | No | Ownership-hiding `404` |
| `PUT /api/clients/:id` | Coach: own; admin may reassign | Archived hidden | Yes | Ownership-hiding `404` |
| `PATCH /api/clients/:id/invite` | Coach: own; admin: all | Archived hidden | Yes | Ownership-hiding `404` |
| `PATCH /api/clients/:id/archive` | Coach: own; admin: all | Intentional archive/restore boundary | Yes | Ownership-hiding `404` |

## Sessions and notes

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/sessions` | Coach/admin | Coach: own; admin: all | Sessions excluded | No | `401` / `403` |
| `POST /api/sessions` | Coach/admin | Client must be owned; admin uses client's coach | Archived client hidden | Yes | Ownership-hiding `404` |
| `PUT /api/sessions/:id` | Coach/admin | Coach: session coach; admin: all | Archived session hidden | Yes | Ownership-hiding `404` |
| `PATCH /api/sessions/:id/cancel` | Coach/admin | Coach: session coach; admin: all | Archived session hidden | Yes | Ownership-hiding `404` |
| `PATCH /api/sessions/:id/complete` | Coach/admin | Coach: session coach; admin: all; transactional RPC | Archived session hidden | Yes, completes session and records `credit_deducted=false`; never reads or mutates credits | Ownership-hiding `404`; handled `400` |
| `GET /api/sessions/:id/notes` | Coach/admin | Coach: session coach; admin: all | Notes and archived session hidden | No | Ownership-hiding `404` |
| `POST /api/sessions/:id/notes` | Coach/admin | Coach: session coach; admin: all | Archived session hidden | Yes | Ownership-hiding `404` |
| `PUT /api/sessions/notes/:noteId` | Coach/admin | Coach: related session coach; admin: all | Archived note/session hidden | Yes | Ownership-hiding `404` |
| `GET /api/sessions/client/mine` | Client | Authenticated client's ID only | Sessions and notes excluded | No | `401` / `403` |

## Progress

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/progress/clients/:clientId/metrics` | Coach/admin | Coach: own client; admin: all | Metrics/entries and archived client hidden | No | Ownership-hiding `404` |
| `POST /api/progress/clients/:clientId/metrics` | Coach/admin | Coach: own client; admin: all | Archived client hidden | Yes | Ownership-hiding `404` |
| `PATCH /api/progress/metrics/:metricId` | Coach/admin | Coach: own client; admin: all | Metric and client must be active | Yes | Ownership-hiding `404` |
| `POST /api/progress/metrics/:metricId/entries` | Authenticated | Client: own metric; coach: own client; admin: all | Metric must be active | Yes | Ownership-hiding `404` |
| `PUT /api/progress/entries/:entryId` | Authenticated | Client: own metric; coach: own client; admin: all | Entry and metric must be active | Yes | Ownership-hiding `404` |
| `PATCH /api/progress/metrics/:metricId/archive` | Coach/admin | Coach: own client; admin: all | Metric must currently be active | Yes | Ownership-hiding `404` |
| `PATCH /api/progress/entries/:entryId/archive` | Coach/admin | Coach: own client; admin: all | Active entry/metric/client only | Yes | Ownership-hiding `404` |
| `GET /api/progress/mine` | Client | Authenticated client's ID only | Metrics/entries excluded | No | `401` / `403` |

## Daily check-ins

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/check-ins/mine` | Client | Authenticated client's ID only | Check-ins excluded | No | `401` / `403` |
| `POST /api/check-ins/mine` | Client | Authenticated client's ID only | Upserts active day | Yes | Validation `400` |
| `GET /api/check-ins/clients/:clientId` | Coach/admin | Coach: own client; admin: all | Check-ins and archived client hidden | No | Ownership-hiding `404` |
| `POST /api/check-ins/clients/:clientId` | Coach/admin | Coach: own client; admin: all | Upserts active day; archived client hidden | Yes | Ownership-hiding `404` |
| `PUT /api/check-ins/:id` | Authenticated | Client: own; coach: own client; admin: all | Check-in must be active | Yes | Ownership-hiding `404` |
| `PATCH /api/check-ins/:id/archive` | Authenticated | Client: own; coach: own client; admin: all | Active check-in only | Yes | Ownership-hiding `404` |

## Programs, workouts, imports, and assignments

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/programs/exercise-library` | Coach/admin | Business-wide library | Exercises excluded | No | `401` / `403` |
| `POST /api/programs/exercise-library` | Coach/admin | Business-wide mutation by any coach | Creates active | Yes | Validation `400` |
| `POST /api/programs/exercise-library/import` | Coach/admin | Business-wide mutation by any coach | Creates active | Yes, bulk | Validation `400` |
| `PUT /api/programs/exercise-library/:id` | Coach/admin | Current policy: any coach; admin: all | Archived hidden | Yes | Missing/archived `404` |
| `PATCH /api/programs/exercise-library/:id/archive` | Coach/admin | Current policy: any coach; admin: all | Intentional archive/restore boundary | Yes | Missing `404` |
| `GET /api/programs/workouts` | Coach/admin | Coach: own + global; admin: all | Workouts excluded | No | `401` / `403` |
| `POST /api/programs/workouts` | Coach/admin | Coach creates own; admin creates global | Creates active | Yes, transactional compound write | Validation `400` |
| `GET /api/programs/workouts/:id` | Coach/admin | Coach: own/global; admin: all | Archived hidden | No | Ownership-hiding `404` |
| `PUT /api/programs/workouts/:id` | Coach/admin | Coach: own only; admin: all including global | Archived hidden | Yes, transactional compound write | Ownership-hiding `404` |
| `PATCH /api/programs/workouts/:id/archive` | Coach/admin | Coach: own only; admin: all including global | Archive only | Yes | Ownership-hiding `404` |
| `GET /api/programs/import/template.csv` | Coach/admin | No record ownership | N/A | No | `401` / `403` |
| `POST /api/programs/import/parse-csv` | Coach/admin | No database mutation | N/A | CPU/memory only | File `400`/`413`; draft `422` |
| `POST /api/programs/import/parse-paste` | Coach/admin | No database mutation; deterministic parser only | N/A | CPU/memory only | No exercises/request `400`; draft `422` |
| `POST /api/programs/import/parse-pdf` | Coach/admin | Sends extracted program text to configured AI | N/A | External AI request | File `400`/`413`; config `503`; draft `422` |
| `POST /api/programs/import/commit` | Coach/admin | RPC receives authenticated coach ID; admin uses own coach profile; paste reuses normalized exercise matches and creates unmatched exercises as manual/needs-review | Creates active one-to-five-day program | Yes, transaction | Draft `422`; RPC `500` |
| `GET /api/programs` | Coach/admin | Coach: own; admin: all | Programs excluded | No | `401` / `403` |
| `POST /api/programs` | Coach/admin | Program owned by caller; all day workouts resolved as own/global/admin-accessible | Creates active | Yes, transactional compound write | Validation `400`; workout `404` |
| `GET /api/programs/:id/export.pdf` | Coach/admin | Coach: own; admin: all | Program must be active | CPU/PDF only | Ownership-hiding `404` |
| `GET /api/programs/:id` | Coach/admin | Coach: own; admin: all | Program must be active | No | Ownership-hiding `404` |
| `PUT /api/programs/:id` | Coach/admin | Coach: own; admin: all; all day workouts ownership-checked | Archived hidden | Yes, transactional compound write | Ownership-hiding `404` |
| `PATCH /api/programs/:id/archive` | Coach/admin | Coach: own; admin: all | Archive only | Yes | Ownership-hiding `404` |
| `POST /api/programs/:id/assign` | Coach/admin | Active program/client must be accessible; admin: all | Archived program/client hidden | Yes | Ownership-hiding `404`; duplicate `409` |
| `PATCH /api/programs/assignments/:assignmentId/archive` | Coach/admin | Through active related program ownership; admin: all | Active assignment only | Yes | Ownership-hiding `404` |
| `GET /api/programs/workout-assignments/client/:clientId` | Coach/admin | Coach: own active client; admin: all | Assignments and archived client/workouts hidden | No | Ownership-hiding `404` |
| `POST /api/programs/workout-assignments` | Coach/admin | Active client and workout must be accessible; admin: all | Archived client/workout hidden | Yes | Ownership-hiding `404` |
| `PATCH /api/programs/workout-assignments/:assignmentId/archive` | Coach/admin | Active assignment's client ownership checked; admin: all | Active assignment/client only | Yes | Ownership-hiding `404` |
| `GET /api/programs/client/assigned` | Client | Authenticated client's ID only | Archived assignments/programs/workouts hidden | No | `401` / `403` |

## Resource library

The library is business-wide for coach/admin management. Client visibility is
derived from the authenticated client profile and requires either public state
or an active assignment; storage paths never leave the backend.

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/resources` | Any authenticated | Coach/admin: all resources; client: public or actively assigned only | Resources excluded | No | `401`; inaccessible rows omitted |
| `POST /api/resources` | Coach/admin | Business-wide library; uploader recorded from authenticated coach profile | Creates active | Yes, private Storage upload + row | File/category validation `400`; size `413` |
| `GET /api/resources/:id/download-link` | Any authenticated | Coach/admin: any active resource; client: public or actively assigned | Archived hidden | Yes, creates 60-second signed URL | Client access-hiding `404` |
| `PATCH /api/resources/:id` | Coach/admin | Any coach/admin may edit visibility, metadata, or archive state regardless of uploader | Intentional archive/restore boundary | Yes | Missing `404` |
| `POST /api/resources/:id/assign` | Coach/admin | Any resource; target client must pass existing coach ownership/admin access | Archived resource/client hidden | Yes, activates unique pair | Ownership-hiding `404` |
| `PATCH /api/resources/:id/assignments/:clientId` | Coach/admin | Any resource; target client must pass existing coach ownership/admin access | Assignment retained with `active=false` | Yes | Ownership-hiding `404` |
| `GET /api/resource-categories` | Coach/admin | Business-wide categories | Categories are retained | No | `401` / `403` |
| `POST /api/resource-categories` | Coach/admin | Business-wide; case/whitespace-insensitive reuse | Categories are retained | Yes | Validation `400` |

## Messages

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/messages/threads` | Any authenticated | Client: own; coach: own clients; admin: all | Clients/messages excluded | No | `401` |
| `GET /api/messages/with/:clientId` | Coach/admin | Coach: own client; admin: all | Messages and archived client hidden; read update excludes archived | Yes, marks read | Ownership-hiding `404` |
| `POST /api/messages/with/:clientId` | Coach/admin | Coach: own client; admin: all | Archived client hidden | Yes | Ownership-hiding `404` |
| `GET /api/messages/mine` | Client | Authenticated client's ID only | Messages excluded | Yes, marks read | `401` / `403` |
| `POST /api/messages/mine` | Client | Authenticated client's ID only | Archived profile blocked by middleware | Yes | Validation `400` |

## Booking requests

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `POST /api/bookings` | Client | Authenticated client's coach relationship | Creates active | Yes | Validation `400` |
| `GET /api/bookings/mine` | Client | Authenticated client's ID only | Requests excluded | No | `401` / `403` |
| `GET /api/bookings` | Coach/admin | Coach: own; admin: all | Requests excluded | No | `401` / `403` |
| `PATCH /api/bookings/:id/approve` | Coach/admin | Coach: request coach; admin: all; transactional RPC | Archived hidden; pending-only transition | Yes, atomically creates one session | Ownership-hiding `404`; handled `400` |
| `PATCH /api/bookings/:id/decline` | Coach/admin | Coach: request coach; admin: all | Archived hidden; conditional pending-only transition | Yes | Ownership-hiding `404`; handled `400` |

## Waivers

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/waivers/latest` | Any authenticated | Same immutable version for all roles | Waiver records are append-only, not archived | No | `404` if none |
| `GET /api/waivers/versions` | Admin | All versions | Append-only | No | `403` |
| `POST /api/waivers/versions` | Admin | Service-role-only RPC serializes next version | Append-only | Yes, transaction | Validation `400` |
| `GET /api/waivers/client/:clientId/status` | Coach/admin | Coach: own active client; admin: all | Archived client hidden | No | Ownership-hiding `404` |
| `POST /api/waivers/client/:clientId/sign-paper` | Coach/admin | Coach: own active client; admin: all | Archived client hidden; duplicate version signature `409` | Yes, append only | Ownership-hiding `404` |
| `GET /api/waivers/my-status` | Client | Authenticated client's ID only | Profile must be active | No | `401` / `403` |
| `POST /api/waivers/sign` | Client | Authenticated client's ID only | Profile must be active | Yes, append only | Validation `400`; duplicate `409` |

## Workout tracking and coach feedback

All routes require authentication. Client mutation routes derive the client from
the authenticated profile; coach routes reuse assigned-client/admin access.

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `POST /api/workout-logs/start` | Client | Own assigned program day or workout only; one active workout per client | Archived assignments/workouts hidden | Yes, transactional snapshot start | `400`; active/already-completed `409` |
| `GET /api/workout-logs/active` | Client | Authenticated client's active workout only | Archived logs/children hidden | No | `401` / `403` |
| `GET /api/workout-logs/mine` | Client | Authenticated client's completed workout history only | Archived logs/children hidden | No | `401` / `403` |
| `GET /api/workout-logs/coach-feedback/unread-count` | Client | Authenticated client's response rows only | Archived responses hidden | No | `401` / `403` |
| `PATCH /api/workout-logs/:id/coach-feedback/read` | Client | Own workout responses only | Archived logs/responses hidden | Yes, idempotent read state | Ownership-hiding `404` |
| `GET /api/workout-logs/client/:clientId` | Coach/admin | Coach: assigned client; admin: all | Archived clients/logs/children hidden | No | Ownership-hiding `404` |
| `PUT /api/workout-logs/:id/coach-response` | Coach/admin | Coach: assigned client; admin: all; one response per author/workout | Completed, non-archived log required; response soft state retained | Yes, transactional create/update with author snapshot | Ownership-hiding `404`; active log `409` |
| `GET /api/workout-logs/:id/exercises/:exerciseId/history` | Client | Own active workout exercise; canonical snapshot identity or exact-source custom identity | Archived logs/exercises and incomplete sets excluded | No | Cursor `400`; ownership-hiding `404` |
| `GET /api/workout-logs/:id` | Any authenticated | Client: own; coach: assigned client; admin: all | Archived logs/children hidden | No | Ownership-hiding `404` |
| `PATCH /api/workout-logs/:id/sets/:setId` | Client | Own active workout set only | Completed/archived logs and sets immutable | Yes, performed status/load/reps/RPE | Ownership-hiding `404`; completed log `409` |
| `POST /api/workout-logs/:id/exercises/:exerciseId/sets` | Client | Own active workout exercise only | Completed/archived logs and exercises immutable | Yes, idempotent extra-set creation | Ownership-hiding `404`; operation validation `400` |
| `PATCH /api/workout-logs/:id/sets/:setId/archive` | Client | Own active extra set only; prescribed sets cannot be removed | Completed/archived logs immutable | Yes, soft-removes extra set | Ownership-hiding `404`; completed log `409` |
| `PATCH /api/workout-logs/:id/exercises/:exerciseId/notes` | Client | Own active workout exercise only | Completed/archived logs immutable | Yes | Ownership-hiding `404`; completed log `409` |
| `POST /api/workout-logs/:id/complete-all` | Client | Own active workout only | Completed/archived logs immutable | Yes, completes remaining sets | Ownership-hiding `404`; completed log `409` |
| `POST /api/workout-logs/:id/abandon` | Client | Own active workout only | Completed/archived logs immutable | Yes, active-to-abandoned transition | Ownership-hiding `404`; completed log `409` |
| `POST /api/workout-logs/:id/complete` | Client | Own workout only; requires at least one completed set | Completed records/children become immutable | Yes, transactional completion + coach/admin notifications; credit-independent | Ownership-hiding `404`; validation `400` |

## Coach notifications

All routes require authenticated coach/admin access. Visibility is restricted
to notifications addressed to the authenticated coach identity whose referenced
client remains accessible under assigned-coach/admin rules.

| Method and path | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---:|---|
| `GET /api/notifications/unread-count` | Own visible notification rows only | Archived notifications/logs/clients hidden | No | `401` / `403` |
| `GET /api/notifications` | Own visible notification rows only | Archived notifications/logs/clients hidden | No | `401` / `403` |
| `PATCH /api/notifications/read-all` | Own visible unread rows only | Archived notifications hidden | Yes, idempotent read state | `401` / `403` |
| `PATCH /api/notifications/:id/read` | Own visible notification row only | Archived notifications hidden | Yes, idempotent read state | Ownership-hiding `404` |

## Retired package/payment routes

`backend/src/routes/packages.js` and `backend/src/routes/payments.js` remain as
dormant reversible source, but neither router is mounted. `/api/packages` and
`/api/payments` therefore return `404` and are not active authorization surfaces.
Historical payment/credit data and applied schema are preserved without runtime
reads or mutation.

## Admin

All routes require authenticated admin access.

| Method and path | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---:|---|
| `GET /api/admin/coaches` | Admin: all | Coaches excluded | No | `401` / `403` |
| `POST /api/admin/coaches` | Admin creates auth user + coach profile | Creates active | Yes | Duplicate `409` |
| `PATCH /api/admin/clients/:id/reassign` | Admin: active clients to active coaches | Archived client hidden | Yes | Coach/client `404` |
| `GET /api/admin/overview` | Admin aggregate across all coaches | Archived records excluded | No | `401` / `403` |

## Dashboards

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/dashboard/coach` | Coach/admin | Coach aggregates own clients; admin: all | Business records excluded | No | `401` / `403` |
| `GET /api/dashboard/client` | Client | Authenticated client's ID only | Business records excluded | No | `401` / `403` |

## Authorization matrix status

| Actor / condition | Expected default for owned-resource routes | Current evidence |
|---|---|---|
| Unauthenticated | `401` | Live integration and protected Vercel smoke passing |
| Owning client | Allowed only on explicitly client-facing/dual-role routes | Live API and browser flows passing |
| Different client | `404` or no path parameter capable of selecting another client | Route inventory plus derived-identity browser/API coverage |
| Owning coach | Allowed | Live API and browser flows passing |
| Different coach | `404` | Live integration ownership-safe `404` passing |
| Admin | Allowed across coach ownership unless explicitly client-only | Live integration, hosted smoke, and admin browser flow passing |
| Missing record | `404` | Stable missing handling and live ownership probes passing |
| Archived record | `404` outside list/restore boundaries | Cross-route contracts passing; explicit client restore boundary live-tested |

## Resource-by-actor authorization matrix

`Own` means the authenticated profile-derived client or coach owns the resource;
`404` is ownership-hiding; `—` means the role has no route for selecting that
resource. The expected behavior and the scope of its live/contract evidence are
identified below.

| Resource family | Unauthenticated | Owning client | Different client | Owning coach | Different coach | Admin | Missing | Archived |
|---|---|---|---|---|---|---|---|---|
| Clients | `401` | — | — | Allow | `404` | Allow | `404` | `404`, except explicit restore |
| Sessions / notes | `401` | Own read only | — | Allow | `404` | Allow | `404` | `404` |
| Progress / entries | `401` | Own read/write entry | — | Allow | `404` | Allow | `404` | `404` |
| Check-ins | `401` | Own read/write/archive | — | Allow | `404` | Allow | `404` | `404` |
| Programs / workouts / assignments | `401` | Own assigned read | — | Own/global policy | `404` | Allow | `404` | `404` |
| Resource library | `401` | Public/actively assigned read | Other-client assignments omitted | Global manage | Global manage | Global manage | `404` | `404`, except explicit restore |
| Messages | `401` | Own thread | — | Own-client threads | `404` | Allow | `404` | `404` |
| Booking requests | `401` | Own create/read | — | Own-client requests | `404` | Allow | `404` | `404` |
| Workout logs / coach feedback | `401` | Own tracker/history/feedback | — | Assigned-client history/response | `404` | Allow | `404` | `404`; completed children immutable |
| Coach notifications | `401` | — | — | Own addressed/visible rows | Other coach's rows hidden | Own addressed/visible rows | `404` | `404` |
| Packages / payments / credits (retired) | `404` | `404` | `404` | `404` | `404` | `404` | `404` | Historical data only |
| Waivers / signatures | `401` | Own status/sign | — | Own-client status/paper | `404` | Allow | `404` | Append-only; archived client `404` |
| Admin management | `401` | `403` | `403` | `403` | `403` | Allow | `404` where record-selected | Archived excluded |

## Per-endpoint test evidence

Evidence codes:

- **U94** — 94 backend regressions under `backend/test`, including access,
  archived-boundary, validation, CORS, rate-limit, Stripe-mode, claim-race,
  logging, deterministic paste/CSV/PDF drafts, grants, workout tracking,
  notifications, coach feedback, Exercise History, and transactional source
  contracts.
- **L88** — `backend/integration/api-hardening.mjs`, 88/88 against the hosted
  development database with real auth and labeled fake records.
- **B7** — `frontend/e2e/live-auth.spec.mjs`, 7/7 historical Production
  real-auth browser flows. This suite was not rerun for the PR #5 release.
- **P16** — `frontend/e2e/preview-critical.spec.mjs`, 16/16 deterministic
  browser flows.
- **PG** — isolated PostgreSQL migration/RPC behavior and hosted grant probes.
- **H19** — 12 protected-Vercel role/profile checks plus seven hosted
  invite/signup/refresh/identity/archive checks.

Evidence below is scoped by route family: it combines representative live role
probes, focused source/authorization contracts, and transactional PostgreSQL
checks. It does not claim that every actor/status permutation was sent to every
handler. External/gated exceptions are called out explicitly.

| Inventory section / endpoints | Relevant tests |
|---|---|
| Authentication — all four endpoints | **L88**, **B7**, **H19**; signup race and archived refresh: **U94** |
| Clients — all six endpoints | **L88**, **B7**, **U94**; archive/restore boundary: **B7** + **U94** |
| Sessions and notes — all nine endpoints | **L88**, **B7**, **U94**; atomic credit-independent completion: **PG** |
| Progress — all eight endpoints | **L88**, **B7**, **U94** |
| Daily check-ins — all six endpoints | **L88**, **B7**, **U94** |
| Exercise library/workout CRUD — first ten Program Builder endpoints | **L88**, **B7**, **P16**, **U94**, **PG** |
| Deterministic paste parse, shared review/commit, and one-to-five-day edit | **L88**, **B7**, **P16**, **U94**, **PG**; normalized-name reuse and manual/needs-review source tagging verified |
| CSV template/parse, import commit, PDF export | **L88**, **B7**, **P16**, **PG**; CSV/PDF draft validation remains three to five days |
| AI PDF parse | File/config/error boundaries: **U94**; successful external-AI parsing explicitly deferred by scope |
| Program CRUD and both assignment families | **L88**, **B7**, **P16**, **U94**, **PG** |
| Resource Library and categories — all eight endpoints | **L88**, **P16**, **U94**, **PG**; public/assigned access, cross-client hiding, cross-uploader management, upload rejection, signing order, and soft unassign/reassign verified |
| Messages — all five endpoints | **L88**, **B7**, **U94** |
| Booking requests — all five endpoints | **L88**, **B7**, **U94**, **PG** |
| Waiver reads/status | **L88**, **B7**, **U94**, **PG** |
| Waiver version/sign/paper mutations | Uniqueness/grants/transaction boundaries: **U94**, **PG**; successful UI signing/paper-sign verification explicitly deferred by the owner on 2026-07-11 pending approved legal text |
| Workout tracking, coach feedback, and notifications — all 20 endpoints | Baseline workout/notification flows: **B7**; current deterministic and backend coverage: **P16**, **U94**, **PG**. PR #5 hosted grants and rollback-only behavior probes are recorded in the release evidence; its dedicated real-auth suite was not rerun. |
| Retired package/payment routes | Production `404` checks; dormant source-level historical evidence remains **L88**, **B7**, **U94**, **PG** |
| Admin — all four endpoints | **L88**, **B7**, **H19** |
| Coach/client dashboards | **L88**, **B7**, **P16**, **H19** |
