# PR #114: four P2 repairs, local evidence

> Historical original repair handoff. Current reconciliation onto released PR117 main and fresh verification: [integration-2026-10-17.md](integration-2026-10-17.md). Original source hashes, captures and counts below are preserved as historical evidence.


Latest follow-through: [2026-10-16 verification and publication gates](followthrough-2026-10-16.md). The initial outcomes below are preserved as historical evidence.

Baseline: released merge `433784a42287a8d7049b8df5de4fca6a9a00bbad` of
HoodieJav13/CVFPT-Main. Review input:
https://github.com/HoodieJav13/CVFPT-Main/pull/114#pullrequestreview-5542923386.
The saved checkout was clean on `work` at `8d68a78`; the exact release commit was
fetched and repairs isolated on `codex/pr114-p2-local-repairs`. The original
branch and its source are preserved. No push, PR, merge, deployment, hosted
application-data access, or credential access is part of this task. Automatic
preview deployment must be checked before publication.

## Reproduced behavior and minimal repairs

1. **Archive response, P2.** Fictional mounted route tests reproduced
   `create_request_id` and `create_request_hash` in authorized coach/admin
   responses. Apply the existing `coachAssignment()` sanitizer. The fingerprint
   is not a credential. Preserve the standard coach contract's intentional
   `created_by_coach_id` and `library_template_id` visibility. Regression checks
   also preserve unrelated-coach 404, client 403 and unauthenticated 401 with no
   mutation in the test fixture. Auth is stubbed; these are local route checks,
   not hosted authorization proof.
2. **Postcommit workout hydration, P2.** Injected `workouts` read failures yielded
   `{state:'not_found'}` / 404 on both create and status after the create RPC
   returned a committed receipt. Throw the query error so existing handlers
   return 500. A genuinely missing or inaccessible workout retains 404 masking.
   Clearing the failure permits repeated status checks and identical replay
   under the same UUID/fingerprint. Browser fixtures exercise identical frozen
   retry and Check again after another status 500. The original Check again
   already recovered when the read recovered: mandatory re-entry was not
   reproduced and is not claimed.
3. **Cross-tab vanished storage entry, P2.** After an initial status 404, another
   tab's successful create removed the pending key; the observing tab retained
   its warning and made no further status request. Recheck trusted in-memory
   recovery routing records whose keys are truly absent from available storage.
   Reuse the authorized status endpoint and existing actor/session/client/page/
   operation fences. Removal alone never authorizes display or proves rollback.
   No create, Start, library save, storage rewrite or key recreation occurs.
   Blocked, corrupt or replaced entries are not interpreted as removals. A
   further 404 retains uncertainty; 500 permits another check. Unit regressions
   cover actor, same-actor session epoch, client, environment, disposal and
   explicit-discard changes before the delayed status response.
4. **ClientDetail library loading, P2.** A failed exercise-library read left
   Quick session on a spinner, including across reopen. Add a real error state
   with an explicit Try again action. Opening the dialog retriggers an unfinished
   load; cached successful reads remain reusable. Effect cleanup ignores stale
   responses on close, type/context change or unmount. Browser checks include
   repeated failures, reopen, slow retry, stale success/failure released after
   reopen, preserved current editor/library identity, and successful assignment.

No evidence warranted increasing severity above the four reported P2s. No
migration, RPC, receipt format, ownership rule, dependency, lockfile, preview
gate or deploy-root import was changed.

## RED evidence before repairs

Actual released runtime plus new fictional-fixture regressions:

- Backend routes: 12 passed / 3 failed. Both authorized-role archive tests found
  the receipt keys. The hydration test directly observed create **and** status
  as `{status:404, hasState:true}` instead of `{status:500, hasState:false}`.
- Recovery units: 38 passed / 2 failed. After key removal the call count stayed
  **1**, where a fresh status call should have made it **2**.
- Browser library failure: expected inline error absent at 320, 390 and desktop;
  actual baseline screenshots retain the spinner.
- Real two-page browser storage event: status calls stayed at **2** after the
  other page committed, rather than increasing. The same failing state was
  captured from a detached baseline worktree at all three viewport sizes.

Raw session evidence is retained under `/tmp/cvfpt-red-routes.log`,
`/tmp/cvfpt-red-unit.log`, `/tmp/cvfpt-red-browser-library.log`,
`/tmp/cvfpt-red-browser-tabs.log`, and
`/tmp/cvfpt-red-browser-tabs-paired.log` in the selected environment. The RED
failures are intentional pre-fix evidence, not unresolved repair regressions.

## Fresh checks

See `checks.txt` for final command outcomes and classifications. The browser
runs use the repository Playwright configs with a temporary local wrapper that
selects `/usr/bin/chromium`; the bundled browser download was denied with
HTTP 403 `Domain forbidden`. No tracked browser config or dependency changed.
Only local mock/fixture servers were exercised. Browser plugin unavailable;
repository-required Playwright was used.

The full preview suite's first run timed out in the existing unrelated client
workout test `Same as last time keeps reps typed while history is still loading`
(`frontend/e2e/preview-critical.spec.mjs:843`, second `startDayOne`). The snapshot
remained on the completed workout after the test's synthetic history navigation.
This test passed in isolation on the exact baseline. Candidate isolated result
and final aggregate outcomes are recorded in `checks.txt`. No unrelated source
was repaired, and the initial failed run remains disclosed.

Database behavior/grant/concurrency suites could not start with the repository's
pinned Supabase CLI 2.118.0 in this environment. Its npm entrypoint attempts to
initialize `/home/agent/.supabase` on a read-only filesystem. The packaged Go
component reports 2.118.0 but exposes only `db` and `functions`, not the required
`start` command; the owned series runner fails `unknown command "start"` and
cleans up its scratch directory. Docker was available and no containers were
started. Remaining database suites share that unavailable startup dependency.
No alternate CLI version, schema or runner was substituted. This is an
**unavailable** repository-wide check, not evidence of database acceptance.
The SQL bytes are unchanged. Hosted/live-auth checks are **not-applicable** to
this local-only task because hosted data and credentials are prohibited.

The independent reviewer inspected all three runtime repairs and regressions
and directly reran 15 route tests and 40 controller tests, finding no actionable
issue. A follow-up review of the extra delayed-fetch and postcommit browser
regressions is recorded with final outcomes in `checks.txt`. Review does not
certify hosted transactions, real authentication or deployment.

## Paired UI evidence

[Open the actual before/after comparison](index.html).
[Source and screenshot manifest](manifest.json) records commit/source hashes,
PNG hashes, dimensions and state. Both sides use Coach Sam / Casey Client
fictional fixtures, dark theme, browser timezone UTC, full viewport context,
320×800, 390×844 and 1280×900. Images and the rendered review document were
inspected. Existing small-screen tab overflow/scroll affordance is visible and
unchanged; this patch makes no visual-direction change.

These are local review artifacts. They do not establish release readiness,
real server authorization, transactional database behavior, delivery, or any
preview/production deployment state.
