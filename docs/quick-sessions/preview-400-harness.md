# Preview-only HTTP 400 verification harness

This is local test preparation on main `b3129d2f51ed2abac47e14d2b659f8a9aa47f9c4`,
which already contains owner-merged PR115 and PR117. No repair code, backend,
migration, dependency, workflow, or deployment configuration is changed.

## What the instrumentation does

In fixture preview mode, the existing **Preview simulated failures** control
has **Reject next Quick save (400)** (`quick-400-once`). Only the next exact
`POST /programs/quick-sessions` consumes it. The fixture adapter synchronously
clears the switch and returns HTTP 400 with
`Simulated Quick validation rejection (preview)` before calling its route
handler. No workout, assignment, or request receipt is created by the rejected
attempt. Reads, auth, other saves, and Quick child routes leave it armed.
The existing generic 503 switch keeps its previous behavior.

The existing double preview gate is unchanged. Outside fixture mode,
`installPreviewApi` does not replace the real adapter or touch storage.
Production builds force the flags off even when opt-in values are requested.
The baseline bundler already emits unreachable fixture chunks: a chunk's
presence is not evidence that preview mode is enabled. Before/after non-fixture
Production JavaScript matches after normalizing generated hash references.

## Local checks

Direct local results: **142/142 unit**, **115 preview passed / 14 existing
skips**, **43/43 fake-backend Quick regressions**, and **3/3 focused new UI
cases**. Production and hosted-fixture Preview builds, contract v1.1,
deployment boundaries, and diff whitespace checks pass. All 23 non-fixture
Production JavaScript chunks match the baseline after normalizing generated
hash references. No repair file changed.

Before implementation, both new positive adapter tests and all three new
browser cases failed because the 400 mode/control was absent; the existing
non-fixture gate already passed. Baseline checks were 139 unit and 33 relevant
preview tests. The 14 configured skips and real authenticated backend/hosted
verification remain outside this local preparation's evidence.

The new unit tests execute the actual bundled fixture adapter: exact path,
one-shot rejection, simultaneous Quick requests, no mutation/receipt before
rejection, a subsequent successful create, and the Production/non-fixture gate.
The browser tests use the app's actual preview adapter and visible toolbar,
not a separate fake backend or an overridden application response.

For each of close, assignment-type change, and router navigation, the browser
tests verify:

1. A synthetic Quick save is definitively rejected with the fixture 400.
2. No fixture workout, assignment, or request receipt was created.
3. Cancelling the real discard prompt preserves form, UUID, and recovery.
4. Accepting it removes only that recovery record. Unrelated client, coach,
   and environment entries remain byte-for-byte unchanged.
5. Reopening starts blank; reload does not revive the discarded recovery.
6. Test-owned unrelated keys are removed and no test recovery remains.

Rerun from `frontend/` using disposable local Chromium contexts (no credentials):

```sh
npm run test:unit
npm run test:e2e:preview
npm run test:e2e:quick-sessions
VERCEL_ENV=production REACT_APP_PREVIEW_MODE=true REACT_APP_HOSTED_DEMO=true npm run build
VERCEL_ENV=preview npm run build
```

Run `scripts/check-boundaries.sh all`, `.agentic/validate-contract-version.sh .`,
and `git diff --check` from the repository root. Current run counts, raw logs,
screenshots, independent review, and the exact patch are retained in this task's
adjacent `pt400-evidence/` directory. Screenshots are actual local before/armed/
rejected captures, not hosted receipts or reconstructed images.

## Future hosted check and publication boundary

After publication is separately authorized, use only the new non-Production
fixture preview. Select its fictional coach, open a fictional client's
Programs → Assign training → Quick session, fill a clearly synthetic draft,
and select **Reject next Quick save (400)** before submitting it. Confirm the
rejection, cancel one discard, then accept discard and check the blank reopen
and recovery-free reload. Restore the original role/client/failure selection;
leave no test-owned recovery or fixture changes.

The one outstanding owner decision is whether to publish the exact reviewed
local commit to a test branch through the existing non-Production pipeline,
including ordinary CI and automatic Preview builds, with no new spend and no
merge, Production release, or hosted configuration change. Nothing has been
pushed, published, or deployed in this preparation task.

A future result proves the instrumented preview build at its own exact SHA.
It cannot retrospectively prove the earlier PR117 preview and does not establish
real backend authorization, persistence, or business-data behavior.
