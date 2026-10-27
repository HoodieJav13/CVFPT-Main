Completion state:      COMPLETE-LOCAL (durable continuation)
Protocol version:      v1.1
Baseline SHA:          84b47186ba8a1adf7559ff96a16eca265a0e4461
Verified source SHA:   c336b494ddb8cf75d99d3e1331bac5a50fa930d9
Branch and upstream:   feature/program-change-history — NOT PUSHED; push disabled
Authority used:        parent continuation explicitly authorizes durable schema/migration files and isolated synthetic test database changes; no hosted action
Commits:               113ed4b prototype; 338b8da initial evidence; c336b49 durable source; following commit documentation/evidence only
Files changed:         see /Users/jav/Documents/Codex/2026-10-26/task-15/history-evidence/diffstat.txt
Migrations/deps:       one new forward migration20261027190000; previous49 migration bytes preserved; no dependency/lock changes
Checks passed:         backend718 pass/4 existing platform skips; frontend270/270; full preview135 pass/14 designed skips; build and both deploy boundaries; actual50-migration disk-backed PostgreSQL/WASM store; SQL/HTTP/separate-process persistence and browser after API restart; diff whitespace
Checks failed/not run: no final failures; hosted/Docker/PostgREST/real-provider auth/device and multi-connection race certification not run (outside this isolated proof / unavailable Docker CLI)
External actions:      none that mutate hosted state; no push, PR, CI, merge, deployment or credentials
Known gaps:            coverage limited to supported program/workout PUT; latest200 snapshots; no historical backfill; local single-connection SQL and fictional auth/transport limitations
Push/deploy state:     local only; hosted schemas/data/settings untouched

## Outcome

Durable forward-only capture now exists. A supported program or workout prescription edit and its stored revision commit in the same database transaction. Journal failure rolls both back. First-observed prior state has null historical author/date; subsequent revisions store authenticated actor, immutable name snapshot and time. Current-client authorization is checked again inside the transaction, and ownership changes between HTTP check and RPC remain masked404 with no edit or journal entry. Completed log/exercise/set records are unchanged and actual completed-set writes remain refused.

[Architecture, launch and parallel integration](DURABLE-CONTINUATION.md) · [reproducible SQL/HTTP/browser harness](../../supabase/tests/program_history/README.md) · [stored diff after restart](durable-visual/index.html) · [historical baseline comparison](visual-review/index.html).

The final durable proof applied all50 real migration files only to fresh `/tmp/cvf-history-db-*` stores. It closed/reopened in a separate Node process, compared actual stored revisions using the real frontend diff, mounted real Express routes over a SQL-backed test adapter, made a program PUT, restarted the API process, and displayed that persisted before/after diff in the browser. Browser shell/auth/transport are explicitly fictional test adapters; this is not a hosted authenticated deployment claim.

Latest retained browser-proof store: `/tmp/cvf-history-db-fCLUiV` (synthetic only). Reopen it with `pglite-check.mjs serve <directory>` as documented. The fixture frontend remains at `http://127.0.0.1:58261/coach/programs`; the durable browser proof binds its history request to the actual local SQL API only during the test.

## Release boundary

This backend now requires the new wrapper RPC migration before deployment. There is no silent fallback to uncaptured edits. Applying a migration to either hosted database, running hosted data probes, publishing/CI, merging or deploying requires separate authorization; none occurred here. A future merge would automatically deploy both roots under the repository's normal Git integration, so migration-first readiness must be verified before any later release approval.

## Decisions and limits

1. Existing PostgreSQL transactional RPCs plus append-only service-only history are the supported architecture; no unresolved owner design choice. Cost: one additive migration and wrapper integration.
2. Shared advisory transaction lock serializes supported edit wrappers; private client ownership is row-locked during the edit. Multi-connection concurrency was not certified in this single-connection harness.
3. No backfill and no extra capture actions: creation/import/copy/archive, assignment load overrides, substitutions and library edits stay outside this first slice. Unobserved intervening state is marked unknown, never attributed to the next actor.
4. The installed CLI help failed on an out-of-sandbox telemetry write; the bundled Go helper lacks migration commands. The explicitly authorized new unique migration file was written locally after inventory. No settings or credentials changed.
5. Tests use existing test-only PGlite0.3.16 read-only and Node26.7.0. Browser/PGlite transport limitations are disclosed. No package installed or external model called. Existing chunk-size/module-type warnings remain; no final test failures.
6. Author self-review only, honoring the no-extra-agents restriction. No independent source, cold visual or physical-device acceptance claimed.

Original memory-only completion report is preserved as [historical prototype evidence](PROTOTYPE-RETURN.md); it is superseded by this durable continuation. Raw final logs/config are retained under `/Users/jav/Documents/Codex/2026-10-26/task-15/history-evidence/`. Latest supported shared usage17%, below working stop29%; no permission pending.
