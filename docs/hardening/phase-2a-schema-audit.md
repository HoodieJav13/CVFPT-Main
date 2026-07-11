# Phase 2A credential and schema audit

Audit date: 2026-07-10

## Target discovery

- Connected project: `CVFPT-Main` (`hhzpzcxcurmhpmfgriqb`), healthy, PostgreSQL 17, created 2026-07-06.
- Connected API origin: `https://hhzpzcxcurmhpmfgriqb.supabase.co`.
- The repository previously named `kzmsgwkmewbjnhmioduj`; that hostname no longer resolves and the project is not available through the connected Supabase account.
- The project was confirmed empty immediately before migration. The hardening brief
  identifies the connected database as the fake-data development target; no seed or
  business data was present or added during schema application.

## Environment and credential state

- General `.env`, `.env.*`, `.secrets/`, private-key containers, credential JSON, and token JSON files are ignored. Sanitized `.env.example` templates are intentionally tracked.
- The current tree contains no detected secret-shaped values or fixed passwords. Full Git history contains the previously confirmed development passwords in `tests/backend_test.py`; history was intentionally left unchanged.
- No backend Supabase/OpenAI/Stripe values are present in the current shell environment. The only discovered local frontend environment file is ignored and contains only the preview-mode flag.
- The connected project has an enabled current publishable key and an enabled legacy `anon` key.
- Current secret-key presence and legacy `service_role` disabled state are not yet
  verifiable because the connected project tool intentionally does not expose secret
  metadata. The two Vercel projects currently have no preview environment variables.

## Expected versus actual schema

| Area | Repository baseline | Connected project | Result |
|---|---:|---:|---|
| Application tables | 23 | 23 | Match |
| Explicit application indexes | 27 | 27 applied; 56 total including PK/constraint indexes | Match |
| RLS-enabled application tables | 23 | 23 | Match |
| RLS policies | 0 intentionally | 0 | Match: service-role-only architecture |
| Application routines | 8 transactional routines | 8 | Match |
| Versioned migrations | 4 | 4 hosted migration records | Match |
| Program Builder storage | 8 tables + `commit_program_import` | Present | Match |
| Direct table grants | service-role read/insert/update only | 23/23 service-role; 0 anon/authenticated; 0 service-role DELETE | Match |

All eight routines are `SECURITY INVOKER`, use an empty fixed `search_path`, deny
`PUBLIC`/`anon`/`authenticated` execution, and grant only `service_role`. A
rolled-back hosted probe verified future tables and sequences inherit the same
service-role-only boundary and intentionally omit DELETE.

## Verified security findings

### High: application schema absent (resolved)

The API could not function while the project was empty. Four reviewed migrations
now provide the complete application schema and transactional RPC set.

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
- All four migrations are applied to hosted PostgreSQL 17 and recorded as versions
  `20260711060153`, `20260711060202`, `20260711060208`, and `20260711060803`.
- All four migrations executed successfully against isolated PostgreSQL 16. Behavioral
  assertions verified booking/session/purchase idempotency, atomic credit/ledger
  updates, waiver-signature/version uniqueness, compound-write rollback, and RPC
  grants. Current and future table-grant assertions also pass locally and hosted.
- Pre-change recovery evidence is this empty-schema inventory plus the remote migration list (empty). Because there is no application data or schema, rollback can safely remove only the objects introduced by the baseline; the reviewed reverse-order rollback is `docs/hardening/phase-2a-baseline-rollback.sql`.

## Advisor results

- Security Advisor: zero warning/error findings. Its 23 informational notices are
  the expected “RLS enabled, no policy” state for the accepted service-role-only design.
- Performance Advisor: 12 informational unindexed-foreign-key notices and 24
  unused-index notices. The unused-index results are expected on an empty database;
  index additions are deferred until representative development flows provide query evidence.
- Advisor remediation reference: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

## Documentation basis

- [Supabase database functions](https://supabase.com/docs/guides/database/functions): prefer invoker security, fix `search_path` for definer functions, and revoke broad default execution.
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api): grants control object reachability; RLS controls accessible rows.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): current `sb_secret_` keys replace legacy `service_role`; creating new keys does not disable legacy keys.
