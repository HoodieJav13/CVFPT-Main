# Goal measures: hosted migration runbook (pending)

Branch `claude/cvf-pt-design-mockups-svkujp`, PR #99. Written 2026-10-01 before
any hosted step; nothing below has been run against either hosted database yet.
Applying it needs the owner's explicit authorization, for development and for
production. Once authorized, an agent may run it with existing authenticated
tooling (the Supabase CLI already configured on the owner's machine); creating,
copying or retrieving credentials stays owner-only.

There are two hosted databases (see `CLAUDE.md` → Migrations):

- **Development** `hhzpzcxcurmhpmfgriqb` (`CVFPT-Main`): the linked CLI project
  and the database behind every backend Preview, including this branch's.
- **Production** `dacqdoohqqcqgtpacerk` (`cvfpt-production`): backend
  Production, real users. No seeds, test accounts or test writes here.

## What is pending

Exactly one new migration on this branch versus `main` (as of `main` at
`8691b4c`, whose latest migration is `20260930130000_schedule_session_series.sql`,
recorded as applied to both databases on 2026-10-01):

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

Explicit `--project-ref` on every command, so nothing depends on which project
the checkout happens to be linked to.

### Development (`hhzpzcxcurmhpmfgriqb`)

1. **Confirm the pending set** (read-only):
   ```sh
   supabase migration list --project-ref hhzpzcxcurmhpmfgriqb
   supabase db push --project-ref hhzpzcxcurmhpmfgriqb --skip-vault --dry-run
   ```
   Expect everything through `20260930130000` applied and only
   `20260930150000_metric_goal_measures.sql` pending. Stop if anything else is
   pending or the remote has a version the repo lacks.
2. **Apply (authorized), then confirm the ledger:**
   ```sh
   supabase db push --project-ref hhzpzcxcurmhpmfgriqb --skip-vault
   supabase migration list --project-ref hhzpzcxcurmhpmfgriqb
   supabase db push --project-ref hhzpzcxcurmhpmfgriqb --skip-vault --dry-run
   ```
   The second dry run must report the remote up to date.
3. **Verify the schema** (read-only SQL):
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
   -- expect on_count = 0 before anyone uses the feature
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
   head commit (`https://cvfpt-backend-git-claude-cvf-pt-design-mockups-svkujp-cvf.vercel.app`;
   check that the deployment's commit matches the head you plan to merge).
   That Preview uses the development database, so this step verifies
   development only. It uses only the dedicated `CVF_E2E_*` test accounts;
   the test client must belong to the test coach and must not belong to
   coach B. Never point it at Production.

   ```sh
   cd frontend
   CVF_E2E_BACKEND_URL=https://cvfpt-backend-git-claude-cvf-pt-design-mockups-svkujp-cvf.vercel.app \
   REACT_APP_BACKEND_URL=https://cvfpt-backend-git-claude-cvf-pt-design-mockups-svkujp-cvf.vercel.app \
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
   Supabase key is needed: leave `SUPABASE_SERVICE_ROLE_KEY` unset. The
   test-account logins come from local settings on the machine that runs the
   test; the Supabase CLI does not supply them. Check which variables are
   already set (names only, never values) and report only what is missing;
   agents don't print, copy or store the values. The test must **pass, not skip**: a skip means the `CVF_E2E_*`
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

### Production (`dacqdoohqqcqgtpacerk`, authorized separately)

5. **Confirm, apply and confirm the ledger**: steps 1–2 with
   `--project-ref dacqdoohqqcqgtpacerk`. Expect the same single pending file.
6. **Verify the schema**: the step 3 SQL against Production (read-only). No
   live test, test account or write against Production; the development
   run in step 4 is the behavioral check, and the code is identical.

### Release

7. **Label the PR** `migration-applied` after development passes steps 1–4,
   and `prod-migration-applied` after Production passes steps 5–6. The
   `migration-guard` workflow blocks the merge without both;
   `migrations-in-flight` fails if another open PR also has an unapplied
   migration.
8. **Merge as a separate, deliberate step (owner).** Merging deploys both
   Production projects. Afterwards: health, CORS, the rendered login page,
   and a coach and a client dashboard load. Record the results here.

## Not covered by the preview suite

The preview browser suite, and every Vercel Preview of the frontend, runs on
in-memory sample data. The tests it reports as skipped are the real-auth
suite (`frontend/e2e/live-auth.spec.mjs`, gated on `CVF_E2E_*`), so preview
passes are not evidence about hosted auth, ownership or the hosted data path.
Step 4 is.

## Release checklist: who does what

| Step | Who |
|---|---|
| Draft PR, deployment URLs, CI, both migration labels, recording results | Agent |
| Authorize the migration (development and Production); arrange test access if it isn't configured | Owner |
| Steps 1–3 and 5–6 (pending set, apply, ledger, schema SQL) in each database | Agent with existing authenticated tooling, after authorization (or the owner) |
| Step 4 (focused hosted test, then the full real-auth suite, development only) | Agent, once the `CVF_E2E_*` test access is configured |
| Phone checks below | Owner or another tester; the agent prepares the setup |
| Merge | Owner only (`.agentic/PROJECT_POLICY.md`) |
| Post-deploy checks (health, CORS, test-account dashboards) | Agent |

Phone checks before release:

- **Navigation (required, affects everyone):** on an iPhone with VoiceOver,
  the corner menu announces and opens, the page behind isn't read, choosing
  the current page returns focus to the button, and the scrub gesture closes
  it; press-and-slide works with VoiceOver off. Sample data is enough, so the
  branch's frontend Vercel Preview works.
- **Focused set entry (only if it is being offered to clients):** it stays
  opt-in (`?entry=focused`), so its phone validation can remain pending as long
  as ordinary clients don't get it. When it is validated: keyboard open,
  decimal RPE, blank reps reading "Not recorded", rest timer, correcting a
  logged set, finish notes.
- **Offline save, with its limits:** a local dev server reached from a phone
  over the LAN tests queueing in an already-open page (airplane mode, log,
  finish, reconnect, reload). It does not test the installed app offline: the
  service worker is skipped in development and needs a secure context. The
  installed-app offline path needs an HTTPS build with real data.
- **Check icon beside Start workout (optional research):** asking two or
  three clients what it does is useful but not a release requirement; giving
  the button a visible label is the alternative.
