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
4. **Verify hosted save and read before merging: real auth against this
   branch's backend.** Do not use the Vercel Preview of the *frontend* for
   this: `frontend/vite.config.js` force-defines `REACT_APP_PREVIEW_MODE` and
   `REACT_APP_HOSTED_DEMO` on for every `VERCEL_ENV=preview` build, so that
   site runs on in-memory sample data and a save there never reaches the
   database. A SQL probe alone isn't enough either: it skips sign-in, the
   role and ownership checks in Express, the three-measure limit, and the
   dashboard reads.

   Run the real-auth Playwright test instead. It starts a local frontend with
   preview mode forced off (`playwright.live.config.mjs`) and signs in for
   real against the **backend** Preview deployment built from this branch's
   head commit (the `cvfpt-backend` project; check that the deployment's
   commit matches the head you plan to merge). Preview and Production share
   the hosted database, so it uses only the dedicated `CVF_E2E_*` test
   accounts; the test client must belong to the test coach and must not
   belong to coach B.

   ```sh
   cd frontend
   CVF_E2E_BACKEND_URL=https://<branch backend preview URL> \
   REACT_APP_BACKEND_URL=https://<branch backend preview URL> \
   VERCEL_AUTOMATION_BYPASS_SECRET=<only if the preview is protected> \
   CVF_E2E_ADMIN_EMAIL=... CVF_E2E_ADMIN_PASSWORD=... \
   CVF_E2E_COACH_EMAIL=... CVF_E2E_COACH_PASSWORD=... \
   CVF_E2E_COACH_B_EMAIL=... CVF_E2E_COACH_B_PASSWORD=... \
   CVF_E2E_CLIENT_EMAIL=... CVF_E2E_CLIENT_PASSWORD=... \
   npm run test:e2e:live -- -g "hosted goal measures"
   ```

   With `VERCEL_AUTOMATION_BYPASS_SECRET` set, the Vite dev server proxies
   `/api` to `CVF_E2E_BACKEND_URL` with the bypass header (the browser stays
   same-origin); without it, the browser calls `REACT_APP_BACKEND_URL`
   directly and the backend's CORS must allow `http://127.0.0.1:4174`. No
   Supabase key is needed: leave `SUPABASE_SERVICE_ROLE_KEY` unset. The owner
   supplies these values (or runs the command); agents don't copy or store
   them. The test must **pass, not skip**: a skip means the `CVF_E2E_*`
   variables were missing and nothing was verified.

   What the test (`frontend/e2e/live-auth.spec.mjs`, "hosted goal measures
   save, read back, respect the limit and ownership") checks:
   - **Authentication and save:** the coach, client and coach B sign in through
     `/api/auth/login`; the coach creates metrics with `is_goal_measure: true`
     up to three for the test client (201, flag returned as `true`).
   - **Limit:** a fourth goal measure is refused on create and on edit (400,
     "up to 3 goal measures"); a plain metric still saves with the flag off.
   - **Authorization:** editing the flag with no token is 401, as the client
     is 403 (coach-only route), and as coach B, who doesn't own the client, is
     404 (ownership masking).
   - **Reads (API):** `GET /api/dashboard/coach` lists the client under
     `goal_clients` with those measures; `GET /api/dashboard/client` returns
     them in `goal.measures`.
   - **Reads (UI, real sign-in):** the coach dashboard's Clients by goal card
     and the client home's Your goal card show the rows.
   - **Turn off:** clearing one flag removes it from the client dashboard.
   - **Cleanup:** every metric it created is archived (soft delete), pass or
     fail.

   Then run the whole real-auth suite once against the same backend
   (`npm run test:e2e:live`, same variables): this branch also changed the
   navigation those tests drive (top bar tabs, corner menu). Record the
   commit, backend deployment, date and pass counts with the release notes.

   Optional, read-only, after the run: the SQL in step 3 should still show
   the column and index, and the test's metrics should be archived:
   ```sql
   select name, is_goal_measure, archived from public.metrics
   where name like 'CVF LIVE GOAL %' order by created_at desc limit 10;
   -- expect archived = true on every row
   ```
5. **Label the PR** `migration-applied` (the `migration-guard` workflow blocks
   the merge without it; `migrations-in-flight` allows one unapplied PR).
6. **Merge as a separate, deliberate step.** Merging auto-deploys both
   Production projects. Run the usual post-deploy checks (health, CORS, a
   client and a coach dashboard load) afterwards.

## Not covered by the preview suite

The preview browser suite, and every Vercel Preview of the frontend, runs on
in-memory sample data. The tests it reports as skipped are the real-auth
suite (`frontend/e2e/live-auth.spec.mjs`, gated on `CVF_E2E_*`), so preview
passes are not evidence about hosted auth, ownership or the hosted data path.
Step 4 is.
