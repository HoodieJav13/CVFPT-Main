# Integration verification — 2026-10-16

Tested functional source: `98a839b5d848838b1fb4d001d7c3d0fa40ed31ca`, tree `0e3f281f82e6de98b208ef9cb1477dd55db07d48`. Runtime suites were executed by the integration author; the independent reviewer performed static code/SQL review and read the named receipts. No aggregate sum is claimed because some focused suites overlap.

| Check | Observed result | Raw evidence in task evidence folder |
|---|---|---|
| Released baseline backend / units | 565/565; 132/132 | baseline-backend.log; baseline-unit.log |
| Integration backend / frontend units | 611/611; 140/140 | integrated-backend.log; integrated-unit.log |
| New unsafe URL boundaries | RED 13 pass / 2 fail, then GREEN 15/15; safe request hashes unchanged | video-boundaries-red.log; video-boundaries-green.log |
| R1 focused upload recovery (subset of backend) | 7/7 | r1-focused.log |
| Account-preparation safety (mock SDK only) | 10/10 | prepare-accounts-safety-tests.log |
| Media/frame mocked browser | 25/25, including 18 frame-selection cases | media-browser.log |
| Quick mocked browser | 30/30 | quick-browser.log |
| Full preview | 106 passed / 8 credential-gated live-auth skips / 0 failed | preview.log |
| Invite / auth / analytics / series / workout UX browser | 17/17; 4/4; 6/6; 23/23; 25/25 | invites.log; auth.log; analytics.log; series.log; workout-ux.log |
| Media SQL | 4 groups + 5 committed races | media-sql.log |
| Quick SQL --all | PASS, 26-row pre/post parity identical, grants/behavior/races passed | quick-sql.log; quick-sql-reports/parity.diff |
| Series / Invite / metrics SQL | PASS including committed races; owned stacks removed | series-sql.log; invite-sql.log; metrics-sql.log |
| Media / series / isolation / Quick stack guards | 18/18; 18/18; 11/11; 25/25 | media-guard.log; series-guard.log; series-isolation-guard.log; quick-guard.log |
| Real media API + filesystem + FFmpeg worker | 22/22 | real-media-api.log; real-media-api-results.json |
| Real Quick × media compatibility | 5/5; applicable combined-tree path executed | quick-media-api.log; quick-compat-results.json |
| Real local media browser | 6/6, including saved-frame/crop → generated output comparisons | real-browser.log; real-frame-selection.json; real-selection-change.json |
| Production build / contract / deploy boundaries / whitespace | PASS; contract v1.1; two boundaries; existing chunk warning | integrated-build.log; static-checks.log; static-checks.json |
| Fresh independent exact-head code + SQL review | ACCEPTED-LOCAL; no introduced blockers; static review with author receipts inspected | INDEPENDENT-REVIEW.md |

Raw evidence root: `/Users/jav/Documents/Codex/2026-10-15/task-4/exercise-media-integration-20261016T1201/evidence`. The unchanged independent report was originally written there; references to “this folder” in that report refer to this evidence root. Compact result JSON files are copied beside this matrix. All fixtures and accounts are fictional, loopback only.

Expected failures: the two new unsafe-URL RED cases failed before guard implementation (both writes incorrectly returned 201). A preliminary Quick test fixture named the completion RPC incorrectly and was corrected before the meaningful RED. No final acceptance lane failed. The eight preview skips are live-auth specs, not passed tests. Hosted/live-auth, real instruction footage and Safari/iOS checks were not run under this local authority.
