# Phase 2A credential and schema audit

Audit date: 2026-07-10
Credential/deployment verification updated: 2026-07-12

## Target discovery

- Connected project: `CVFPT-Main` (`hhzpzcxcurmhpmfgriqb`), healthy, PostgreSQL 17, created 2026-07-06.
- Connected API origin: `https://hhzpzcxcurmhpmfgriqb.supabase.co`.
- The repository previously named `kzmsgwkmewbjnhmioduj`; that hostname no longer resolves and the project is not available through the connected Supabase account.
- The project was confirmed empty immediately before migration. Schema application
  added no business data. Later verification added only clearly labeled fake accounts
  and soft-archived test records to this development target.

## Environment and credential state

- General `.env`, `.env.*`, `.secrets/`, private-key containers, credential JSON, and token JSON files are ignored. Sanitized `.env.example` templates are intentionally tracked.
- The current tree contains no detected secret-shaped values or fixed passwords.
  Full Git history contains previously confirmed development passwords in the
  removed `tests/backend_test.py`; history was intentionally left unchanged because
  rewriting shared history was outside authorization. Those obsolete-endpoint
  credentials are treated as compromised/retired and are not used by the connected
  Supabase project, either Vercel preview, or the new test harness. Dedicated current
  fake accounts use newly generated credentials supplied only through secure flows.
- No backend Supabase/OpenAI/Stripe values are present in the current shell environment. The only discovered local frontend environment file is ignored and contains only the preview-mode flag.
- The connected project has enabled current-format publishable and secret keys.
  Preview and Production secret creation/copying remain manual owner-only dashboard
  actions; verification uses the deployed backend without retrieving those values.
- Both legacy JWT-based Supabase keys were disabled in the authenticated dashboard;
  the legacy page now offers re-enable actions rather than disable actions.
- Preview and Production were rotated to owner-created, environment-specific
  current secret keys on 2026-07-12. Previous current-format keys remain enabled
  until the owner reviews the deployment verification report and disables them
  manually; automation must never create, copy, reveal, or retire Supabase keys.
- Backend Preview has `SUPABASE_URL`, current publishable/secret key variables,
  `CORS_ORIGINS`, and `FRONTEND_URL`. Frontend Preview has
  `REACT_APP_BACKEND_URL`. Values were transferred only through secure flows and
  were never committed.

## Expected versus actual schema

| Area | Repository baseline | Connected project | Result |
|---|---:|---:|---|
| Application tables | 26 | 26 | Match |
| Application columns | 232; signature `9f5aed736908f44c0a8ece396971ac2d` | 232; same signature | Match |
| Table constraints | 97; signature `80732d3dacc0dbed94fcc1b9f9e2f9cc` | 97; same signature | Match |
| Explicit application indexes | 32 | 32 applied; 66 total including PK/constraint indexes | Match |
| RLS-enabled application tables | 26 | 26 | Match |
| RLS policies | 0 intentionally | 0 | Match: service-role-only architecture |
| Application routines | 8 transactional routines | 8 | Match |
| Versioned migrations | 6 | 6 hosted migration records | Match |
| Program Builder storage | 8 tables + `commit_program_import`; program frequency 1–5 | Present | Match |
| Direct table grants | service-role read/insert/update only | 26/26 service-role; 0 anon/authenticated; 0 service-role DELETE | Match |

All eight routines are `SECURITY INVOKER`, use an empty fixed `search_path`, deny
`PUBLIC`/`anon`/`authenticated` execution, and grant only `service_role`. A
rolled-back hosted probe verified future tables and sequences inherit the same
service-role-only boundary and intentionally omit DELETE.

Column and constraint parity uses the checked-in read-only query at
`supabase/tests/schema_parity_signature.sql`. It hashes the ordered table/ordinal/
name/type/nullability/default inventory for every application column and the ordered
table/name/type/whitespace-normalized, case-sensitive definition inventory for every
primary-key, unique, foreign-key, check, and exclusion constraint. The signatures
above matched between the fresh local PostgreSQL 17 migration result and hosted
PostgreSQL 17.

## Verified security findings

### High: application schema absent (resolved)

The API could not function while the project was empty. The reviewed baseline and
four follow-up migrations now provide the complete application schema and
transactional RPC set.

### High: hosted `rls_auto_enable()` helper is Data API executable (resolved)

Before the baseline, the only public routine was a `SECURITY DEFINER` event-trigger
helper executable by broad roles. The baseline revoked direct `PUBLIC`, `anon`, and
`authenticated` execution without altering the event trigger.

### Priority RPC review: repository definition unsafe if applied unchanged (resolved)

The repository definition of `commit_program_import` was `SECURITY DEFINER`, accepted a caller-supplied coach ID, had no fixed `search_path`, and did not revoke default `PUBLIC` execution. If applied unchanged, unauthorized Data API roles could invoke a privileged transactional import.

The applied baseline changes it to `SECURITY INVOKER`, fixes `search_path` to empty
with schema-qualified relations, revokes `PUBLIC`/`anon`/`authenticated`, grants
only `service_role`, and tightens future function default privileges. The follow-up
transactional RPCs use the same permission model.

The fifth migration widens persisted program frequency and both transactional
program-write routines from three-to-five to one-to-five days. This supports
single-block deterministic paste drafts without creating a parallel storage path.
CSV/PDF parsing retains its existing three-to-five-day validation boundary.

The sixth migration adds the coach-managed PDF Resource Library,
case-insensitive categories, soft-state client assignments, and the private 10 MB
PDF-only Storage bucket. The three new tables use the same RLS-with-no-policies
and service-role-only grant boundary; no DELETE grant or security-definer routine
was introduced.

### Exercise source decision: use existing manual source (verified)

`exercise_library.source` has no check constraint. Deterministic paste import
therefore reuses the existing `manual` source for unmatched normalized exercise
names and sets `review_status='needs_review'`; existing normalized names are reused.
No source-column migration or new source vocabulary was needed.

### High: Data API table grants depended on project defaults (resolved)

Initial hosted verification found all 23 tables granted to `anon`, `authenticated`,
and `service_role`, despite RLS blocking rows for roles without policies. Migration
`20260711060556_restrict_data_api_to_service_role.sql` now explicitly revokes all
application-table and sequence privileges from public roles, grants only
read/insert/update plus sequence use to `service_role`, and applies those defaults
to future objects. DELETE remains intentionally ungranted.

## Prepared migration and recovery plan

- Local Supabase versioned migration structure was created with the installed CLI.
- Baseline: `supabase/migrations/20260710151327_baseline_schema.sql`.
- Transactional hardening: `supabase/migrations/20260710202908_transactional_business_mutations.sql`.
- Transactional compound writes: `supabase/migrations/20260711051129_transactional_program_writes.sql`.
- Explicit Data API grants: `supabase/migrations/20260711060556_restrict_data_api_to_service_role.sql`.
- One-to-five-day programs: `supabase/migrations/20260711234414_allow_one_to_five_day_programs.sql`
  (hosted version `20260711234414`).
- Resource Library: `supabase/migrations/20260712060335_coach_managed_pdf_resource_library.sql`
  (hosted version `20260712075915`).
- All six migrations are applied to hosted PostgreSQL 17 and present in its
  migration history.
- All six migrations executed successfully against isolated PostgreSQL 17. Behavioral
  assertions verified booking/session/purchase idempotency, atomic credit/ledger
  updates, waiver-signature/version uniqueness, compound-write rollback, and RPC
  grants. A rolled-back one-day import/edit probe and zero-day rejection also pass.
  Current and future table-grant assertions pass locally and hosted.
- The original empty-schema inventory and
  `docs/hardening/phase-2a-baseline-rollback.sql` remain historical recovery
  evidence; the full baseline rollback must not be run now that the hosted
  development schema contains labeled fake records. Application rollback is a
  prior Vercel deployment. Database rollback of the fifth migration may restore
  the old routines, but must retain the widened constraint until no one- or
  two-day rows exist or an approved non-destructive data migration transforms
  them. Hard deletion is not an acceptable recovery step.

## Advisor results

- Security Advisor: one project-level warning reports that leaked-password
  protection is disabled. Its 26 informational notices are the expected “RLS
  enabled, no policy” state for the accepted service-role-only design. The warning
  is an Auth configuration follow-up; it does not change the verified database
  grants, RLS posture, or service-role-only API boundary.
- Performance Advisor: existing unindexed-foreign-key notices plus unused-index
  notices, including the newly created Resource Library indexes before traffic.
  At the current fake-data volume these are informational;
  index additions are deferred until representative development flows provide
  query evidence.
- Advisor remediation reference: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

## Documentation basis

- [Supabase database functions](https://supabase.com/docs/guides/database/functions): prefer invoker security, fix `search_path` for definer functions, and revoke broad default execution.
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api): grants control object reachability; RLS controls accessible rows.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): current `sb_secret_` keys replace legacy `service_role`; creating new keys does not disable legacy keys.
