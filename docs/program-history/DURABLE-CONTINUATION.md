# Durable forward capture continuation

This supersedes the initial prototype's memory-only completion boundary. The architecture is inferred from existing transactional RPCs and service-role-only append history: no owner architecture decision is pending.

`20261027190000_program_change_history.sql` adds an append-only, RLS-enabled, service-only `program_change_revisions` table and two transaction wrappers. Existing canonical writers and migration bytes are preserved. Supported program edits call `save_program_with_history`; supported workout prescription edits call `save_workout_with_program_history`. The wrappers authenticate the acting coach/admin against current database records, lock the client's ownership row during private edits, capture allowlisted before/after JSON in the **same transaction**, and keep immutable author-name snapshots. A shared advisory lock serializes the two supported edit paths. The author is the verified actor, not the program creator or a body-supplied author.

No historical backfill is attempted. On the first supported edit, the exact current pre-edit state is stored as an observed baseline with unknown historical author/date, followed by the new revision with actual actor/time. Intervening unsupported changes receive an unknown-metadata observation rather than being attributed to the next save. No-op snapshots add no revision. History append failure rolls the underlying edit back.

The history route authorizes current ownership before reading stored revisions. It returns the latest200 snapshots with an explicit older-revisions warning when capped. Missing migration/table returns the honest unavailable state; other storage errors remain retryable errors. Edit routes require the new RPC migration and do not silently fall back to uncaptured writes. **Do not deploy this backend before the migration is separately authorized/applied and verified.** No hosted apply or deployment is authorized here.

Coverage remains the existing program PUT and workout prescription PUT paths. Create/import/copy/archive actions, assignment load overrides, substitutions and exercise-library edits remain outside durable capture. No undo, propagation, reassignment operation or completed-workout write is added.

## Verification and local launch

See [the reproducible SQL/HTTP/browser harness](../../supabase/tests/program_history/README.md). The final harness loads all50 actual migrations in a fresh local disk-backed PostgreSQL/WASM store; verifies rollback, append-only/RLS/grants, current ownership, stored author/date, unchanged completed records/sets; reopens in a separate process; exercises actual Express PUT/read with SQL; and verifies the persisted diff in the browser after an API restart. The surrounding browser shell is fictional and uses a test-only binding to the local SQL history response; this is disclosed in the evidence.

The existing fixture UI remains available at <http://127.0.0.1:58261/coach/programs>. To run the durable proof locally use:

```sh
PGLITE_MODULE=/Users/jav/.codex/.chatgpt-projects/g-p-6a5fd55610888191bd67cebe1102930c/coachos-task8/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/program_history/browser-check.cjs
```

The command prints its persisted synthetic DB directory; `pglite-check.mjs serve <directory>` reopens it as an interactive loopback-only synthetic API with the normal program GET/PUT and history GET routes. No credentials are needed or loaded. API auth is deliberately a fictional loopback role header, so never expose this test adapter beyond127.0.0.1.

[390px stored diff after restart](durable-visual/after-restart-390.png) · [desktop](durable-visual/after-restart-1440.png). These extend the earlier actual baseline comparison; they are not a reclassification of the earlier memory fixtures as durable evidence.

## Parallel integration

WorkoutRescue: retain its program/workout validation, legacy locks and hydration/retry logic while reconciling `backend/src/routes/programs.js`; the supported edit calls now use one history wrapper RPC. No active/completed workout runtime or conductor writer is changed.

CueRetry: existing workout PUT now records successful cue/prescription changes transactionally. History insert failure means the edit did not commit; transport uncertainty after commit still follows existing retry/reconciliation rules. No separate client-side journal write should be added.

Limitations: no hosted migration, Docker/PostgREST/real-provider auth or multi-connection race certification; local PGlite is single-connection. No production/client data, secrets, paid services, external model calls, CI, push, PR, merge or deploy. All original programs and parallel worktrees are untouched. The migration and supported runtime source require fresh release review before any later hosted action.

Verified runtime source `c336b494ddb8cf75d99d3e1331bac5a50fa930d9`; backend718 pass/4 platform skips; frontend270; fixture browser135 pass/14 designed skips; durable SQL/API/process/browser proof passes. Additional controlled ownership-change regression confirms a race between HTTP authorization and the SQL transaction remains404 and writes neither program nor history. Raw logs are retained in task-15/history-evidence.
