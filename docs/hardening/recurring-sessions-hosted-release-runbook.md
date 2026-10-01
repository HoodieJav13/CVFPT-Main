# Recurring sessions: hosted release runbook

Status: **prepared, not executed.** Nothing in this document has been run against the
hosted Supabase project, Vercel, or GitHub. Every hosted action below needs the
owner's explicit authorization (`.agentic/PROJECT_POLICY.md`), and no step asks for
or exposes a credential.

Feature branch: `claude/recurring-sessions` · Spec:
`docs/superpowers/specs/2026-09-30-recurring-sessions-design.md` · Plan:
`docs/superpowers/plans/2026-09-30-recurring-sessions.md`

When the release happens, copy the results into a dated evidence record in this
directory, the way `2026-07-22-pr5-hosted-release.md` does.

## What ships

Four additive, forward-only migrations:

| Migration | Adds |
|---|---|
| `20260930100000_session_series_schema.sql` | `session_series` table (RLS on, no policies, `service_role` only); nullable `sessions.series_id` and `sessions.series_ordinal`; partial index `idx_sessions_series` |
| `20260930110000_find_session_conflict_helper.sql` | `find_session_conflict(...)` and a **redefinition of `schedule_session`** that calls it (same signature, lock, return shapes) |
| `20260930120000_check_session_slots.sql` | read-only `check_session_slots(...)` |
| `20260930130000_schedule_session_series.sql` | transactional `schedule_session_series(...)` |

Why this ordering matters: the new backend routes call the three new functions and
select `session_series`. If backend code deploys **before** the migrations are
applied, series requests would fail. The migrations themselves are backward
compatible for the currently deployed code (new table, nullable columns, new
functions, and a `schedule_session` that behaves identically — verified with a
before/after behavior matrix and booking approval), so applying them first is safe.

**Merging to `main` automatically deploys both Production projects.** Disclose this
before asking for the merge. Do not rely on a post-merge migration-first sequence.

## Gate 1 — before anything hosted

- [ ] Branch pushed and a **pull request opened** (CI only runs for `pull_request` and
      pushes to `main`; a bare branch push runs nothing).
- [ ] CI green on the PR: `backend`, `frontend` (build, unit tests, preview suite,
      audit), `frontend-series`, `database`. The `database` and `frontend-series` jobs have
      never run on GitHub: if either fails on its first run, investigate and resolve the
      cause (environmental or an implementation defect) before proceeding; do not skip the check.
- [ ] Migration diff is additions only:
      `git diff --name-status main...HEAD -- supabase/migrations` (every line starts `A`).
- [ ] Migration-dependent checks may remain red until both hosted projects pass Gate 2–3 and receive their labels: `migration-guard`, and `migrations-in-flight` if another migration PR is open. All non-migration CI jobs must pass before applying these migrations; ALL checks must pass before merge.

## Gate 2 — apply the migrations to hosted Supabase (owner-authorized)

Preview and Production use separate hosted Supabase projects (see DEPLOYMENT.md):

- Development / Preview: `hhzpzcxcurmhpmfgriqb` (`CVFPT-Main`).
- Production: `dacqdoohqqcqgtpacerk` (`cvfpt-production`).

Repeat Gates 2 and 3 for EACH project before merge. Use already-configured tooling;
do not print or copy keys. Explicit `--project-ref` targeting avoids changing the
checkout's development link. No seeds or test-account provisioning run in Production.

1. See what is pending (read-only):
   ```bash
   supabase migration list --project-ref <target-project-ref>
   supabase db push --project-ref <target-project-ref> --skip-vault --dry-run
   ```
   Expected: exactly the four `20260930…` files pending, nothing else.
2. Apply, then confirm the ledger:
   ```bash
   supabase db push --project-ref <target-project-ref> --skip-vault
   supabase migration list --project-ref <target-project-ref>
   supabase db push --project-ref <target-project-ref> --skip-vault --dry-run
   ```
   Expected: local and remote match; the second dry run reports the remote is up to date.
   (A trailing `pg-delta` catalog-cache warning after a successful push was seen last
   time; the ledger and second dry run are what establish success.)
3. State exactly which environment received the migrations in the evidence record.

## Gate 3 — read-only verification of the hosted schema

Run these with owner-authorized SQL access against EACH hosted project. All are read-only.

```sql
-- 1. The three new functions exist, are security invoker, and are service-role-only.
--    schedule_session keeps its existing boundary. Expect 4 rows:
--    security_definer = false, anon_exec = false, auth_exec = false, service_exec = true.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('find_session_conflict', 'check_session_slots', 'schedule_session_series', 'schedule_session')
order by p.proname;

-- 2. session_series: RLS on, no policies, service-role-only. Expect: true | 0 | false | false | true
select (select relrowsecurity from pg_class where oid = 'public.session_series'::regclass) as rls_on,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'session_series') as policies,
       has_table_privilege('anon', 'public.session_series', 'select') as anon_read,
       has_table_privilege('authenticated', 'public.session_series', 'select') as auth_read,
       has_table_privilege('service_role', 'public.session_series', 'insert') as service_write;

-- 3. Columns, uniqueness, and index. Expect the two sessions columns (uuid / integer, nullable),
--    the (coach_id, request_id) unique constraint, and idx_sessions_series.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'sessions' and column_name in ('series_id', 'series_ordinal')) or table_name = 'session_series')
order by table_name, ordinal_position;
select conname from pg_constraint where conrelid = 'public.session_series'::regclass and contype = 'u';
select indexname from pg_indexes where schemaname = 'public' and indexname = 'idx_sessions_series';

-- 4. The refactored scheduler still takes the global scheduling lock and now delegates to the helper.
--    Expect: true | true
select position('find_session_conflict' in pg_get_functiondef(p.oid)) > 0 as uses_helper,
       position('cvf_session_scheduling' in pg_get_functiondef(p.oid)) > 0 as takes_lock
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'schedule_session';

-- 5. Nothing is linked to a series yet (the feature has not been used). Expect 0 | 0.
select (select count(*) from public.sessions where series_id is not null) as linked_sessions,
       (select count(*) from public.session_series) as series_rows;
```

### Rollback-only functional probe

Everything below runs inside one transaction that is **rolled back**, using throwaway
ids and `example.invalid` addresses. It exercises creation, replay, and conflict
detection against the hosted functions without leaving data.

```sql
begin;
insert into public.coaches (id, name, email)
  values ('f0000000-0000-4000-8000-0000000000a1', 'Probe Coach', 'probe-coach@example.invalid');
insert into public.clients (id, coach_id, name, email)
  values ('f0000000-0000-4000-8000-0000000000b1', 'f0000000-0000-4000-8000-0000000000a1', 'Probe Client', 'probe-client@example.invalid');

-- A. Create: expect outcome = created, replayed = false, a 2-slot receipt.
select public.schedule_session_series(
  'f0000000-0000-4000-8000-0000000000c1', 'probe-hash',
  'f0000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-0000000000b1',
  60, null, '{}'::jsonb, null, false,
  '[{"key":"s1","scheduled_at":"2031-06-03T17:00:00Z","workout_id":null},
    {"key":"s2","scheduled_at":"2031-06-10T17:00:00Z","workout_id":null}]'::jsonb);

-- B. Same request again: expect outcome = created, replayed = true, the same series id.
select public.schedule_session_series(
  'f0000000-0000-4000-8000-0000000000c1', 'probe-hash',
  'f0000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-0000000000b1',
  60, null, '{}'::jsonb, null, false,
  '[{"key":"s1","scheduled_at":"2031-06-03T17:00:00Z","workout_id":null},
    {"key":"s2","scheduled_at":"2031-06-10T17:00:00Z","workout_id":null}]'::jsonb);

-- C. A slot overlapping the first session: expect slots[0].conflict.scope = 'coach'.
select public.check_session_slots(
  'f0000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-0000000000b1', 60,
  '[{"key":"x","scheduled_at":"2031-06-03T17:30:00Z"}]'::jsonb, null);
rollback;

-- D. After the rollback, nothing of the probe remains. Counted by the probe's EXACT ids, so
--    unrelated hosted rows can never cause a false failure. Expect 0 | 0 | 0 | 0.
select (select count(*) from public.session_series where request_id = 'f0000000-0000-4000-8000-0000000000c1') as series,
       (select count(*) from public.coaches where id = 'f0000000-0000-4000-8000-0000000000a1') as probe_coaches,
       (select count(*) from public.clients where id = 'f0000000-0000-4000-8000-0000000000b1') as probe_clients,
       (select count(*) from public.sessions
         where coach_id = 'f0000000-0000-4000-8000-0000000000a1'
            or client_id = 'f0000000-0000-4000-8000-0000000000b1') as probe_sessions;
```

If the final query returns anything other than zeros, stop and report; do not delete
rows by hand.

## Gate 4 — merge (owner or explicitly delegated agent performs it)

- [ ] Gates 1–3 complete and recorded; `migration-applied` and `prod-migration-applied` labels added; all CI checks green.
- [ ] The owner confirms they understand merge deploys both Production projects.
- [ ] Merge. Backend and frontend deploy from the merge commit.

## Gate 5 — after the merge

Following `docs/hardening/2026-07-22-pr5-hosted-release.md`:

- [ ] Backend `/api/health` returns `200`; frontend `/login` returns `200` and renders.
- [ ] CORS for the configured frontend origin is unchanged.
- [ ] Unauthenticated `POST /api/sessions/series/preview`, `/check`, `POST /api/sessions/series`,
      and `PATCH /api/sessions/series/<uuid>/cancel` return `401`.
- [ ] Retired `/api/packages` and `/api/payments` still return `404`.
- [ ] Vercel build logs show no new build failure.
- [ ] A one-hour scan of backend runtime logs finds no error/fatal entry and no `5xx`.
- [ ] Real-auth browser suite (`CVF_E2E_*`): rerun only if the credentials are available;
      otherwise record that it was **not rerun** (do not present the historical result as a
      run for this release).
- [ ] Optional first-use smoke test, by the owner, with a **test client** and
      **"Notify client when saved" turned off**: create a short series, confirm the badge
      ("Weekly · … · Session 1 of N") on the Sessions list, then cancel "this and all
      future". This creates and then cancels real (test) rows, so use a test client.

## Rollback posture

Forward-only. The new table and columns are inert to older code, so a backend rollback
alone is safe and leaves the schema in place. If a migration needs correcting, write a
new forward migration; never edit or remove an applied one. Rolling the frontend back
removes the Repeat control and badges but leaves any series already created as ordinary
sessions, which every existing view already handles.

## Known gaps to record in the evidence

- GitHub CI results for the new jobs (unverified until the PR runs).
- The hosted Supabase environment itself (the local checks ran on a disposable local
  Postgres 17 stack, not on hosted).
- Real-auth browser verification (depends on credential availability).
