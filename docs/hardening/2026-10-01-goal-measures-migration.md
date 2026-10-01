# Goal measures: hosted migration runbook (pending)

Branch `claude/cvf-pt-design-mockups-svkujp`. Written 2026-10-01 before any
hosted step; nothing below has been run against the hosted database yet. The
owner applies it; agents never handle the Supabase keys.

## What is pending

Exactly one new migration on this branch versus `main`:

- `supabase/migrations/20260930150000_metric_goal_measures.sql`
  - `alter table public.metrics add column if not exists is_goal_measure boolean not null default false;`
  - a column comment
  - `create index if not exists idx_metrics_client_goal_measure on public.metrics(client_id) where is_goal_measure = true and archived = false;`

Additive only: no backfill, no data change, no dropped or renamed objects.

## Compatibility

**Code currently deployed from `main`, after the migration:** safe.
- It reads `metrics` with `select('*')` (progress routes) or with named columns
  (analytics, dashboard). An extra column is ignored by both and by the frontend.
- It inserts metrics without the column; the default (`false`) fills it.
- It never updates the column.

**This branch's code, before the migration:** degrades without errors for
reads and ordinary edits, so a deploy that lands first does not break
existing screens.
- Dashboards load goal measures best-effort: a missing column logs an error
  and shows no measures (`goalMeasuresByClient` in `backend/src/routes/dashboard.js`).
- Creating a metric only sends the column when the switch is on.
- Editing a metric only sends `is_goal_measure` when the switch changes
  (`ClientDetail.jsx`, pinned by `backend/test/goal-measures.test.js`).
- Turning a goal measure on before the migration fails with a 500 for that
  one action. That is why the migration goes first.

## Order of operations

1. **Confirm the pending set.** `supabase migration list --linked` should show
   every migration up to `20260929120000_shared_training_library.sql` as
   applied remotely and only `20260930150000_metric_goal_measures.sql` as
   local-only. Stop if anything else is pending or the remote has a version the
   repo lacks.
2. **Apply (owner, authorized).** `supabase db push`, then rerun
   `supabase migration list --linked` and confirm `20260930150000` is applied.
3. **Verify the schema** (SQL editor, read-only):
   ```sql
   select column_name, data_type, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public' and table_name = 'metrics' and column_name = 'is_goal_measure';
   -- expect: is_goal_measure | boolean | NO | false

   select indexname, indexdef from pg_indexes
   where schemaname = 'public' and indexname = 'idx_metrics_client_goal_measure';
   -- expect one row, partial on is_goal_measure = true and archived = false

   select count(*) filter (where is_goal_measure) as on_count, count(*) as total
   from public.metrics;
   -- expect on_count = 0
   ```
4. **Verify hosted save and read before merging**, against the Vercel Preview
   deployment of this branch (Preview and Production share the hosted
   database, so use a test client):
   - As a coach, open the test client's Progress tab, edit a metric and turn
     on Goal measure. Save. Reload: the card shows the Goal measure badge.
   - Coach dashboard: the client appears under Clients by goal with that
     measure. Client home (same test client): the Your goal card shows it.
   - Try a fourth goal measure: the switch is disabled with the limit message;
     the API also refuses it (400, "up to 3 goal measures").
   - Turn the flag back off and confirm the dashboards drop it.
   - Alternative without the UI, rollback-only:
     ```sql
     begin;
     update public.metrics set is_goal_measure = true where id = '<test metric id>';
     select id, is_goal_measure from public.metrics where id = '<test metric id>';
     rollback;
     ```
5. **Label the PR** `migration-applied` (the `migration-guard` workflow blocks
   the merge without it; `migrations-in-flight` allows one unapplied PR).
6. **Merge as a separate, deliberate step.** Merging auto-deploys both
   Production projects. Run the usual post-deploy checks (health, CORS, a
   client and a coach dashboard load) afterwards.

## Not covered by the preview suite

The preview browser suite runs on in-memory sample data. Its eight skipped
tests are the real-auth suite (`frontend/e2e/live-auth.spec.mjs`, gated on
`CVF_E2E_*`), so preview passes are not evidence about hosted auth or the
hosted data path. Step 4 is.
