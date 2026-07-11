# Express authorization route inventory

Audit date: 2026-07-10
Inventory source: the routers mounted in `backend/src/app.js` and all 94 handlers in `backend/src/routes/*.js`.

Common behavior:

- Protected endpoints return `401` without a valid bearer token.
- Role middleware returns `403` for an authenticated but disallowed role.
- Ownership checks should return `404` for both missing and different-owner records.
- `Admin: all` means the admin role intentionally crosses coach ownership boundaries.
- “Current gap” records behavior that must be fixed or explicitly accepted.
- Automated matrix coverage is pending unless a test identifier is named.

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
| `POST /api/clients` | Coach forced to self; admin may choose coach | Creates active | Yes | Invalid coach currently becomes `500` |
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
| `PATCH /api/sessions/:id/complete` | Coach/admin | Coach: session coach; admin: all; transactional RPC | Archived session hidden | Yes, atomic credits + ledger | Ownership-hiding `404`; handled `400` |
| `GET /api/sessions/:id/notes` | Coach/admin | Coach: session coach; admin: all | Notes and archived session hidden | No | Ownership-hiding `404` |
| `POST /api/sessions/:id/notes` | Coach/admin | Coach: session coach; admin: all | Archived session hidden | Yes | Ownership-hiding `404` |
| `PUT /api/sessions/notes/:noteId` | Coach/admin | Coach: related session coach; admin: all | Archived note/session hidden | Yes | Ownership-hiding `404` |
| `GET /api/sessions/client/mine` | Client | Authenticated client's ID only | Sessions and notes excluded | No | `401` / `403` |

## Progress

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `GET /api/progress/clients/:clientId/metrics` | Coach/admin | Coach: own client; admin: all | Metrics/entries and archived client hidden | No | Ownership-hiding `404` |
| `POST /api/progress/clients/:clientId/metrics` | Coach/admin | Coach: own client; admin: all | Archived client hidden | Yes | Ownership-hiding `404` |
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
| `POST /api/programs/import/parse-pdf` | Coach/admin | Sends extracted program text to configured AI | N/A | External AI request | File `400`/`413`; config `503`; draft `422` |
| `POST /api/programs/import/commit` | Coach/admin | RPC receives authenticated coach ID; admin uses own coach profile | Creates active | Yes, transaction | Draft `422`; RPC `500` |
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

## Packages

All routes require authentication; mutations additionally require admin.

| Method and path | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---:|---|
| `GET /api/packages` | All roles; admin can request archived | Excluded by default | No | `401` |
| `POST /api/packages` | Admin only | Creates active | Yes | `403`; validation `400` |
| `PUT /api/packages/:id` | Admin only | Archived hidden | Yes | Missing/archived `404` |
| `PATCH /api/packages/:id/archive` | Admin only | Intentional archive/restore boundary | Yes | Missing `404` |

## Payments and credits

| Method and path | Auth / role | Ownership and admin behavior | Archived behavior | Mutates | Missing / unauthorized |
|---|---|---|---|---:|---|
| `POST /api/payments/webhook` | Stripe signature | Session ID selects active purchase; service-role-only completion RPC | Archived purchase hidden | Yes, atomic purchase + credits + ledger | Signature `400`; config `503` |
| `GET /api/payments/config` | Any authenticated | No record ownership; returns publishable config only | N/A | No | `401` |
| `POST /api/payments/checkout` | Client | Authenticated client's ID; active package only | Package excluded | Yes, Stripe + pending purchase | Package `404`; config `503` |
| `GET /api/payments/verify` | Client | Active purchase must belong to authenticated client | Archived purchase hidden | May atomically complete purchase | Ownership-hiding `404` |
| `POST /api/payments/manual` | Coach/admin | Coach: own active client; admin: all; active package | Archived client/package hidden | Yes, atomic purchase + credits + ledger | Ownership-hiding `404`; amount `400` |
| `GET /api/payments/history` | Client | Authenticated client's ID only | Purchases excluded | No | `401` / `403` |
| `GET /api/payments/history/:clientId` | Coach/admin | Coach: own active client; admin: all | Purchases and archived client hidden | No | Ownership-hiding `404` |
| `GET /api/payments/credits` | Client | Authenticated client's ID only | Profile must be active | No | `401` / `403` |
| `GET /api/payments/credits/:clientId` | Coach/admin | Coach: own active client; admin: all | Archived client hidden | No | Ownership-hiding `404` |

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
| Unauthenticated | `401` | Middleware/source contract plus opt-in integration harness; live pending |
| Owning client | Allowed only on explicitly client-facing/dual-role routes | Route inspection plus integration harness; live pending |
| Different client | `404` or no path parameter capable of selecting another client | Route inspection; live pending |
| Owning coach | Allowed | Pure helper/source contracts plus integration harness; live pending |
| Different coach | `404` | Program/workout ownership regressions plus integration harness; live pending |
| Admin | Allowed across coach ownership unless explicitly client-only | Route inspection plus integration harness; live pending |
| Missing record | `404` | Stable missing handling fixed on audited mutation routes; live pending |
| Archived record | `404` outside list/restore boundaries | Cross-route source contract passing; live pending |
