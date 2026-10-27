# Local integration release packet

This candidate combines only the approved Workout Rescue, Program History and Cue Retry additions on baseline `84b47186ba8a1adf7559ff96a16eca265a0e4461`. Exact delivered commit and final verification results are recorded in the task-level `INTEGRATION-RETURN.md`, adjacent evidence directory and verified bundle. This document is a proposed release procedure; none of its hosted or publication steps has been executed.

## Authority and provenance

DIAL: EXECUTE. Inspect/edit/test/scoped local commits and isolated synthetic stores are allowed by the delegated task. Push, CI, PR publication, merge, deployment, hosted migrations/data/settings, raw credentials, paid services, external model calls, extra agents and destructive history are forbidden in this run. Both production and all original worktrees remain untouched.

Inputs, all based on the exact baseline:

- Rescue `c7aae4306ec98559d453a39c27044ddea63e52bc` (prototype `231272b`), verified `workout-rescue-integrated.bundle`.
- History `c5590a2158c95ac8fc946d9ebf5057ed5647c218` (runtime `c336b49`, prototype `113ed4b`, evidence `338b8da`).
- Cue `09158dd40ccc43b3fc3abead1eb4ceba06b639a6` (prototype `78851d4`), verified `cue-retry-backend.bundle`.

The new branch/worktree uses a separate local bare Git store, copied without hardlinks. No source repository metadata is written. Inputs are combined as one reviewable integration commit; their original commits and branches are preserved separately. The app worktree tool cannot target these unrelated source repositories from the initially empty task folder, so Git created a linked worktree in the task-owned store. No network Git remote exists in that store.

## Integrated behavior and corrections

1. The start route deliberately selects `start_workout_rescue_with_cues` for explicit Rescue requests and `start_workout_log_with_cues` for ordinary/Quick starts. Both preserve existing verified actor/session handling, canonical v2 execution and existing hydration/notification behavior. A missing combined Rescue function returns 503 and creates no workout; there is no silent partial or ordinary-start fallback.
2. Rescue authorizes and locks the current client, rechecks plan/source/load/revision/context, starts a fresh canonical log, reduces/soft-archives its new exercise/set snapshots, then binds cues against the final exact retained sources, then inserts its immutable receipt, all in one SQL transaction. The cue cutoff uses actual binding time, so a transaction begun before a cue save does not exclude that eligible cue. Client serialization and fresh-only caller gates prevent retroactive resume/replay binding. Binding/receipt failure rolls everything back. Replay/resume/conflict do not bind again. Same request/body replays the original log; changed body conflicts.
3. Supported History writes, cue writes and starts serialize on the existing history advisory key. Quick starts, cue writes and history-wrapped workout edits retain Quick advisory before current-client/assignment/workout locking. Assignment row share locks fence supported load saves, including newly inserted load rows. Native multi-connection race proof remains a release gate; single-connection tests do not certify scheduling or deadlock absence.
4. Private client program copies have separate IDs and approval plans. The real template list excludes them. The normal browser found the existing coach authoring entry missing from the assigned-client card; the existing first-day Rescue control is now also mounted on that card, using the exact private program/day ID. No automatic approval copying, propagation, new day scope or new authoring workflow is added. A failing normal-browser assertion preceded the correction.
5. History remains append-only and read-only from its viewer. Only supported program/workout PUTs journal actual writes in the same transaction; no seeds, Rescue starts, cue mutations, completed records, assignment loads, create/import/copy/archive or backfill are journaled. First observation has unknown historical attribution; actual revisions use the verified coach and name snapshot. Prior completed log/exercise/performed-set rows remain immutable.
6. The three input migrations and every baseline migration remain byte-identical. Only a new forward integration migration changes functions. No dependency, lockfile, deploy/workflow configuration, production preview gate or existing payments/waiver/history invariant changes.

## Migrations and permission requirements

Apply in this exact filename order after the baseline's 49 migrations:

1. `20261027012847_workout_rescue_choices.sql`
2. `20261027190000_program_change_history.sql`
3. `20261027203000_exercise_cue_retry.sql`
4. `20261027210000_pt_combined_start_cue_binding.sql`

The local CLI generated the integration file with an earlier clock timestamp than the two supplied future-dated migrations. Its still-empty, unapplied file was renamed forward to 210000 before adding SQL; no input/applied migration was renamed or edited. Final SQL applies as a 53-file chain. SHA256 values are in `migration-sha256.txt`.

The migration executor needs schema/function/table/sequence/trigger DDL authority. This is an owner-authorized hosted action in each environment, separately from runtime service_role. No new credentials or services are required by the source.

- New tables: `workout_rescue_plans`, `workout_rescue_start_receipts`, `program_change_revisions`, `exercise_attempt_cues`, `exercise_cue_receipts`; `workout_logs.rescue_snapshot` is additive.
- All five tables have RLS enabled and zero browser policies. PUBLIC/anon/authenticated have no table privileges. service_role gets SELECT/INSERT, with UPDATE only for Rescue plans and soft-state cues. No business DELETE grant.
- History identity sequence: service_role USAGE/SELECT only.
- New callable functions are invoker with empty search_path. PUBLIC/anon/authenticated EXECUTE is revoked; only service_role may invoke them. Replaced functions retain their prior service-only ACLs. Old canonical writers and old Rescue RPC remain preserved but the combined backend uses the new entry point.
- Append-only triggers protect history/receipts even from accidental mutation; existing completed-workout protection is unchanged.

## Proposed release order — not executed

1. Reconcile this exact candidate with then-current main and review the resulting final diff, migration ledger and grants. Re-run isolated verification on any changed source. Do not assume current hosted ledger state from historical handoffs.
2. Under separate authorization, publish only the reviewed branch and run locked Node22 exact-head CI. This run reused already installed dependencies under Node26; no install/audit/network package refresh was performed.
3. Before enabling the new backend anywhere, separately authorize and apply/verify all four migrations to Development. Compare actual function definitions/signatures/ACLs/RLS/policies/sequence grants and ledger with the reviewed files. Refresh/verify PostgREST schema cache and real provider auth. Use owned fictional Development accounts for actual concurrent HTTP checks, cleanup with soft archival and retain receipts/completed/history.
4. Verify real PostgREST and multi-connection races: duplicate same/different request, active-start conflict, reassignment between middleware and commit, history source edit vs Rescue start, load replacement (including insertion) vs start/cue save, Quick edit vs normal/Quick start, link failure and transport-loss replay. Also test existing tracker/offline/history behavior and physical/device scope before claiming those certifications.
5. Obtain separate Production migration authority, apply the same reviewed migration bytes and verify the full ledger/catalog there. Both required migration labels must be satisfied. No test seeds, probes that persist client changes, backfills or fixture accounts in Production.
6. Only then obtain release/owner merge authority. A merge to main automatically deploys BOTH Vercel roots; migrations must already be verified in BOTH hosted databases before that merge, or automatic deployment must be separately paused. Verify paired deployments at the actual merge SHA, normal coach/client access and bounded read-only production health. Leave the existing assignment/feature/production settings unchanged unless separately authorized.

No owner product or architecture decision is pending for this local implementation. Remaining owner decisions are whether/when to authorize publication/CI, hosted migration verification and release, and any genuinely new issue found at those gates.

## Rollback and retention

Before rollout, record the actual currently accepted paired backend/frontend deployment IDs and current settings. Do not assume baseline-main equals the currently live production deployment. If rollout must be backed out, restore that recorded compatible pair under separate authorization; stop new use through the prior UI/backend, and verify no candidate route remains active. A code rollback does not require deleting any schema/data.

Retain all five new tables, receipts, revision snapshots, author metadata, Rescue log snapshots, linked cues/verdicts and completed exercises/performed sets. Do not delete/undo/rewrite business history or client programs, do not truncate tables, and do not run down migrations. Already created Rescue workouts remain ordinary retained workout logs under the older app; their Rescue metadata must remain stored even if older UI does not display it. Prior code resumes its prior uncaptured-write behavior, so any later reactivation must mark unsupported intervening history as unknown and must not backfill authors. If a database function correction is required, use a separately reviewed new forward migration; never modify the four applied files or revoke shared canonical function permissions speculatively.

## Evidence scope and risks

The disk-backed PGlite harness executes actual PostgreSQL migration/function/trigger/grant/transaction bodies with service_role for the real Express paths. Provider getUser verification uses fictional tokens and transport uses a parameterized SQL adapter; shell-only client/waiver/counter reads are synthetic. No browser cue or Rescue response is mocked in the normal combined journey, previewMode is false and no IndexedDB cue adapter participates. A separate API process is terminated and reopened to prove disk persistence; it is not merely a page reload.

Browser plugin/skill is not available; regular repository Playwright/Chromium is used. Screenshots cover 390 and 1440px and retained cue fixture tests cover 320px. Service workers are blocked in the normal laboratory. Physical devices, Safari/Firefox, cold service-worker offline, real JWT/provider verification, hosted PostgREST/schema cache and native two-connection races remain untested. Local Docker daemon was unavailable even with permitted read-only inspection, and no psql/postgres/pg_ctl/postgrest binary was present; nothing was installed, started or credentialed as a workaround. The static lock-order review and single-connection proof are explicitly not native concurrency certification.

Known first-slice limits remain: Rescue first day only, coach-approved full options only; no medical/catalog equivalence or approval propagation; History supported PUT paths/latest200 snapshots only; cues exact assignment/day/source identity only and no remapping across new copies/assignments (including a new dated or Quick assignment). Names/library equivalence never substitutes for source identity. Large-chunk/Babel and historical module-type advisories remain. The targeted ESLint config reports one pre-existing unused-disable warning in app.js, zero errors.

Official reference checked: [Supabase function security and privileges](https://supabase.com/docs/guides/database/functions). Local implementation conclusions above are based on the actual repository SQL, not a hosted documentation certification.

Paired assigned-card screenshots use the actual pre-fix ClientDetail bytes from preserved History input c5590a2 in an otherwise combined temporary frontend, plus the actual final component in normal mode; no DOM removal or original-worktree edits. Source hashes are recorded beside the captures. The final task return contains the exact-head result counts.
