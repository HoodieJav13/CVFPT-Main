# Workout Rescue — durable local continuation

This supersedes the fixture-only completion boundary at `231272b`. There is no unresolved owner architecture decision. The implementation follows the existing service-role Express boundary, program/client ownership model, canonical workout-start RPC and append-only receipts. The reviewed first-day UI behavior remains: explicit coach-authored time/equipment choices, reduced set counts/omissions, an intent/tradeoff note, explicit client differences before selection, cancel/reset, missing/conflicting choices and pain/injury exclusion. No ranking, medical inference, propagation, undo or additional exercise substitutions are added.

## Runtime interface

`GET /api/programs/:programId/days/:dayId/rescue?assignment_id=:assignmentId` returns `{original,current_version,selection_version,stale,plan:{version,revision,branches}}`. Client reads require their current active assignment; the role/ownership decision is rechecked in SQL using the provider-verified `req.user.authUserId`. Coaches follow existing shared-template/current-private-client ownership semantics; admins retain their existing access. Client DTOs exclude coach notes. Normal mode starts with no invented options. Preview mode retains its explicitly fictional seed choices and its production-off gate.

`PUT` to that same path requires coach/admin authentication and `{version,revision,branches}`. Each complete branch has an id, name, estimated minutes, required equipment, public intent/tradeoff, enabled flag and source-exercise/set-count items. Unknown prescription/actor fields are discarded. A stale original or revision is refused; source edits require deliberate fresh authoring. Save/reload is database-backed, not a browser journal.

The existing `POST /api/workout-logs/start` accepts a `rescue` choice containing `request_id`, branch id, plan version/revision, selection version, minutes and equipment. The authenticated client is resolved by the existing handler; a client-body identity cannot change it. The new RPC validates the saved branch and current assignment loads again, calls `start_workout_log_v2`, then applies only its approved omissions/reduced sets to that newly created active snapshot in the same transaction. Omitted rows/sets are soft-archived. Original programs/prescriptions are not edited and completed records remain immutable.

The receipt makes a repeated request return the same workout, including after completion or a later original edit. Changed request content under the same id is refused. A different choice cannot replace an active workout. Notification dispatch remains on the existing successful-start path and never fires for a replay. Client retries retain the request id while the selected context is unchanged. Missing migration returns503; it never silently starts the original workout instead.

## Migration and invariants

`20261027012847_workout_rescue_choices.sql` was created with the local Supabase CLI. It adds `workout_rescue_plans`, append-only `workout_rescue_start_receipts` and nullable `workout_logs.rescue_snapshot`, plus service-only security-invoker RPCs with empty search paths. Both tables have RLS enabled and no public/authenticated policies or access. Earlier migration bytes are unchanged. The receipt snapshots the authored choice, author identity/name/time, original public prescription, revision/context and explicit changes. No historical records are backfilled or rewritten.

Source rows and current ownership/load rows are locked before snapshot validation. The supported Rescue calls use the documented Program History advisory lock `cvf:program-history-edit:v1`. Canonical start's existing active-workout uniqueness remains authoritative, including a race with an ordinary start. PGlite is single-connection; actual multi-connection race/load certification is not claimed.

Options belong to the exact current program/day. The UI retains the reviewed first-day scope; define options on the client's assigned program instance. Copies/new assignments do not inherit approvals automatically and must be reviewed separately. This deliberately avoids new propagation behavior or silently transferring intent across different source exercise ids.

## Parallel integration contract

Program History branch `feature/program-change-history`, head `c5590a2158c95ac8fc946d9ebf5057ed5647c218`, and its `DURABLE-CONTINUATION.md` were read. Its source/worktree was not modified or merged. `backend/src/routes/programs.js` remains untouched by Rescue. Rescue adds a separate router and an additive mount in `backend/src/app.js`; the existing start handler changes only its explicit Rescue dispatch. Reconcile the small coach/client Programs entry additions when combining frontend changes. A local compatibility run applied History's separate migration into the disposable test DB and exercised `save_workout_with_program_history`: the stored History revision and Rescue stale-source rejection both passed.

Cue Retry durable notes at task16 head `09158dd` were read without merging its branch. Its migration `20261027203000_exercise_cue_retry.sql` follows Rescue and History in filename order. The parent must reconcile the start dispatch: keep the common History advisory/source lock order, authorize/lock the current client before canonical start, finish applying the selected Rescue snapshot, then call `bind_next_exercise_cues(v_new_log_id)` before inserting the Rescue receipt/committing, only for a fresh start. Binding failure must roll back the entire start; omitted exercise ids cannot inherit cues. Do not simply select one branch’s wrapper or attach cues in a later HTTP call. Triple-branch/native concurrency verification remains with the parent.

Cue Retry should preserve this explicit start dispatch, existing workout hydration, source-exercise ids, cues and tracker behavior. Rescue does not modify its retry/media implementation or write a second history journal. `rescue_snapshot` is a one-workout choice receipt, not a program edit.

## Evidence and scope

See `supabase/tests/workout_rescue/README.md` for the SQL, HTTP, process restart and normal-mode browser harness. The actual migration chain, SQL functions, transactions, grants, source/history comparisons, mounted Rescue/start handlers and production `requireAuth` profile/role middleware are exercised. Provider `getUser` verification and the PostgREST transport are isolated synthetic adapters; surrounding shell/media/telemetry reads are explicitly bounded. There is no live Supabase Auth, hosted database, PostgREST or physical-device claim.

The browser runs the ordinary frontend with preview mode disabled, saves through Express/SQL, kills/restarts the API process on the same disk store, reloads the stored choice, checks desktop/mobile differences and starts into the existing guided tracker. Actual provider authentication and a combined native-Postgres/PostgREST/multi-connection run remain release verification, not a local implementation blocker.

## Exact remaining release gates

1. Parent-coordinated integration/review with Program History and Cue Retry; do not merge these branches automatically.
2. Review the new migration/RPCs and run the combined supported paths against native PostgreSQL/PostgREST and real provider auth when that environment is authorized. Local PGlite/provider-adapter evidence must stay distinctly labeled.
3. Run locked Node22/dependency CI on the integrated candidate only when push/CI is authorized. Current local validation uses Node26 and reused installed dependencies.
4. Obtain separate hosted-migration and release authority. Apply and verify all approved additive migrations in both development and Production before deploying the backend; verify ledgers, RLS/grants and paired rollout. No hosted migration, production change, push/CI, merge or deployment occurred in this task.
