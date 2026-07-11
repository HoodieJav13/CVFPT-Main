# Phase 2A credential and schema audit

Audit date: 2026-07-10

## Target discovery

- Connected project: `CVFPT-Main` (`hhzpzcxcurmhpmfgriqb`), healthy, PostgreSQL 17, created 2026-07-06.
- Connected API origin: `https://hhzpzcxcurmhpmfgriqb.supabase.co`.
- The repository previously named `kzmsgwkmewbjnhmioduj`; that hostname no longer resolves and the project is not available through the connected Supabase account.
- The connected project is empty. This contradicts the prior expectation that the development project already contained fake practice data, so live baseline application requires explicit target confirmation.

## Environment and credential state

- General `.env`, `.env.*`, `.secrets/`, private-key containers, credential JSON, and token JSON files are ignored. Sanitized `.env.example` templates are intentionally tracked.
- The current tree contains no detected secret-shaped values or fixed passwords. Full Git history contains the previously confirmed development passwords in `tests/backend_test.py`; history was intentionally left unchanged.
- No backend Supabase/OpenAI/Stripe values are present in the current shell environment. The only discovered local frontend environment file is ignored and contains only the preview-mode flag.
- The connected project has an enabled current publishable key and an enabled legacy `anon` key.
- Current secret-key presence, legacy `service_role` disabled state, and Vercel variable state are not yet verifiable. The local Supabase CLI requires a secure login, and the connected project tool does not expose secret-key metadata.

## Expected versus actual schema

| Area | Repository baseline | Connected project | Result |
|---|---:|---:|---|
| Application tables | 23 | 0 | Missing |
| Application indexes | 25 | 0 | Missing |
| RLS-enabled application tables | 23 | 0 | Missing with tables |
| RLS policies | 0 intentionally | 0 | Architecture-compatible, but no tables exist |
| Application routines | `commit_program_import(uuid,text,jsonb)` | Missing | Missing |
| Versioned migrations | Baseline + transactional hardening | 0 remote migrations | Prepared locally; not applied |
| Program Builder tables | 9 relevant tables | 0 | Missing |

The repository baseline currently grants table access through Supabase defaults to `anon`, `authenticated`, and `service_role`; the accepted architecture depends on RLS with zero policies to block non-service roles. This must be rechecked after table creation.

## Verified security findings

### High: application schema absent

The API cannot function against the connected project because every expected application table and the transactional import RPC are absent.

### High: hosted `rls_auto_enable()` helper is Data API executable

The only public routine is a `SECURITY DEFINER` event-trigger helper. `PUBLIC`, `anon`, and `authenticated` currently have `EXECUTE`; both Supabase security advisors flag this. Its `search_path` is restricted to `pg_catalog`, and it is used by an event trigger, but it does not need direct Data API execution.

### Priority RPC review: repository definition unsafe if applied unchanged

The repository definition of `commit_program_import` was `SECURITY DEFINER`, accepted a caller-supplied coach ID, had no fixed `search_path`, and did not revoke default `PUBLIC` execution. If applied unchanged, unauthorized Data API roles could invoke a privileged transactional import.

The prepared baseline changes it to `SECURITY INVOKER`, fixes `search_path` to empty with schema-qualified relations, revokes `PUBLIC`/`anon`/`authenticated`, grants only `service_role`, and tightens future function default privileges. The follow-up transactional RPCs use the same permission model. This preserves the Express/service-role-only architecture.

## Prepared migration and recovery plan

- Local Supabase versioned migration structure was created with the installed CLI.
- Prepared baseline: `supabase/migrations/20260710151327_baseline_schema.sql`.
- Prepared transactional hardening: `supabase/migrations/20260710202908_transactional_business_mutations.sql`.
- Prepared transactional compound writes: `supabase/migrations/20260711051129_transactional_program_writes.sql`.
- The baseline is not applied pending target confirmation.
- All three migrations executed successfully against isolated PostgreSQL 16. Behavioral
  assertions verified booking/session/purchase idempotency, atomic credit/ledger
  updates, waiver-signature/version uniqueness, compound-write rollback, and RPC
  grants. Hosted PostgreSQL 17 execution remains required after target confirmation.
- Pre-change recovery evidence is this empty-schema inventory plus the remote migration list (empty). Because there is no application data or schema, rollback can safely remove only the objects introduced by the baseline; the reviewed reverse-order rollback is `docs/hardening/phase-2a-baseline-rollback.sql`.

## Documentation basis

- [Supabase database functions](https://supabase.com/docs/guides/database/functions): prefer invoker security, fix `search_path` for definer functions, and revoke broad default execution.
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api): grants control object reachability; RLS controls accessible rows.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): current `sb_secret_` keys replace legacy `service_role`; creating new keys does not disable legacy keys.
