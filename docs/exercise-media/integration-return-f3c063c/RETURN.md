# RETURN — Exercise Media integrated onto released PT (local, 2026-10-16)

```text
Completion state:      COMPLETE-LOCAL
Protocol version:      v1.1
Released baseline:     433784a42287a8d7049b8df5de4fca6a9a00bbad
Accepted media:        92a54240eab315f884157e8489ad20912463e516
Tested functional head: 98a839b5d848838b1fb4d001d7c3d0fa40ed31ca
Tested tree:           0e3f281f82e6de98b208ef9cb1477dd55db07d48
Merge parents:         released PT, then accepted media (above)
Branch / upstream:     integrate/exercise-media-release-20261016 / none
Workspace:             /Users/jav/Documents/Codex/2026-10-15/task-4/exercise-media-integration-20261016T1201/checkout
Authority used:        isolated local source integration, fictional media/services, local tests,
                       fresh independent code/SQL review, documentation and local commits
Migrations/deps:       all 43 released migrations unchanged; exact accepted media draft unchanged;
                       dependency/lockfile bytes unchanged; no hosted application
Checks passed:         full matrix and evidence below; independent verdict ACCEPTED-LOCAL
Checks failed/unrun:   expected RED 2 boundary regressions; no final acceptance failure;
                       8 live-auth skips; hosted/live/real-footage/Safari checks not authorized/run
External actions:      read-only GitHub source/deployment metadata + public Supabase docs;
                       no external writes, messages, push, CI, deployment, hosted data or credentials
Known gates:           hosted adapter/provider/worker/budget/retention, exact SQL application,
                       owner visual/content review, publication/release/activation authority
Push/deploy state:     NOT PUSHED; push URL DISABLED-LOCAL-ONLY; no CI/preview/Production action
```

The full approved media build is composed with current released Quick PT. The final commit following the tested merge changes only this return packet, documentation and compact evidence. `git rev-parse HEAD` and `../FINAL-STATE.json` identify that documentation tip; the functional code and migration stay exactly at the tested/reviewed merge. Main was read again before handoff and remains `433784a42287a8d7049b8df5de4fca6a9a00bbad`. Deployment metadata identifies both successful Production roots at that release; no production pages, client records or hosted ledgers were queried.

## Implementation and preservation

The existing stable exercise library now composes with the durable local media workflow: owned/permissioned source upload, selected poster/crop, short preview or frames, alt text/cues/captions, processing states, explicit review/publication, current guide replacement, client-authorized derivative reads and separate optional external instruction links. Real API/worker tests preserve prior current media on a failed replacement and keep workout prescriptions/history unchanged. A complete recorded catalog is not required; the representative fixture sample is labeled synthetic and does not depict validated coaching instruction.

Five overlaps were resolved: `backend/src/routes/programs.js`, `backend/src/routes/workoutLogs.js`, `frontend/playwright.config.mjs`, `frontend/src/lib/previewMode.js` and `CLAUDE.md`. The first four reuse the previously accepted `990a42b` composition bytes. CLAUDE retains the released Invite behavior and updates source status. The independent reviewer compared every runtime and migration file to that composition: the only new production difference is **three lines** in `programs.js` rejecting unsafe exercise URLs before Quick-create or import-commit RPCs, as already required by accepted media Gate 3. Two mounted-route tests first returned 201 instead of the required 400; after the guard, 15/15 pass, including safe payload and exact Quick hash assertions. No request hash, receipt protocol, workout snapshot SQL or normalization was changed.

The larger baseline-to-functional-head footprint is **194 files, +18,283 / −35**, including the inherited feature, tests, visual evidence and historical returns; it is not merely three lines. Detailed lists are in `../evidence/released-to-integration-files.tsv` and `released-to-integration-numstat.tsv`. The final documentation footprint is recorded in `../FINAL-STATE.json`. Two inherited trailing blank lines in a frame spec and synthetic SQL fixture were normalized for whitespace validation; assertions and SQL semantics are unchanged.

All 43 released migration files are byte-identical. The unapplied local media draft `supabase/migrations/20261015213431_exercise_media_library.sql` remains SHA-256 `54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c` and later than the released Quick migration. It was applied only to disposable local test databases. Reconcile its version against then-current hosted ledgers before any separately authorized application; do not infer hosted state from local tests or Git.

The R1 service/store/worker and R2 `VideoSelectionEditor` match accepted `92a54240eab315f884157e8489ad20912463e516` exactly. Quick request recovery, ClientDetail and Quick normalization match released `433784a42287a8d7049b8df5de4fca6a9a00bbad` exactly. Source hashes are recorded in the manifest. The accepted original `/Users/jav/Documents/Codex/2026-10-15/task-4/cvfpt-exercise-media-build-20261015` remains clean at `92a54240`; prior compatibility checkout remains clean at `990a42b`. The old primary checkout remains at `78f5aa7` with its original deleted agent-browser entry and two untracked files. No existing worktree was changed. The original accepted RETURN/manifest are preserved byte for byte in `docs/exercise-media/accepted-92a54240/`.

## Verification and independent review

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


All runtime checks above were executed on local fictional services/accounts. The reviewer separately checked exact source, all 802 lines of the media SQL, grants/RLS/function execution, locking, serializers, authorization, R1/R2 preservation and the new guard ordering. It found no introduced code/SQL blocker. The review inspected runtime receipts; it did not rerun those suites or approve production activation.

Raw evidence root: `/Users/jav/Documents/Codex/2026-10-15/task-4/exercise-media-integration-20261016T1201/evidence`. The compact matrix, independent review, measured API/compatibility/frame results and SHA-256 raw-evidence index are under `docs/exercise-media/integration-acceptance/`. DB and Vite lanes were serialized; traces were disabled and output placed outside watched frontend files. Each owned database stack was torn down and coordination locks released. No live account-provisioning command ran; the safety suite uses a mock SDK.

Synthetic sizing: the photo poster is 20,028 bytes; short band-row preview 13,367 bytes; separate instruction 44,708 bytes. The 90-second 1080p stress source is 56,736,783 bytes, producing a 5,771,922-byte instruction and 48,200-byte preview. Seven- and 50-exercise log hydration both cost 10 queries, and normal reads fetch no video bytes. These are local measurements, not a hosted cost quote or real-footage forecast. Fresh selected-frame error measurements and negative controls are saved in the JSON results.

## Separate Quick repair and later gates

Unapproved repair `507d23d`, task `01a14322-dabc-732d-9fec-8a0e06376021`, was not fetched/applied/reimplemented. Its four released-baseline P2s remain separate: archive receipt sanitization, committed-create hydration failure classification, vanished cross-tab recovery key handling and ClientDetail library retry. Later reconciliation overlaps **`backend/src/routes/programs.js`**. Reconcile only an approved repair tip in another isolated workspace, preserving these URL guards/current-guide serializers and their sanitizer/error handling; rerun overlapping route, browser and receipt checks. This packet is not a review or acceptance of that repair.

The deliberately local adapter is disabled in Production/Vercel and by default. Hosted private storage/transport, worker execution, spending limits, retention/purge and owner-managed credentials still need a bounded design/implementation/provisioning decision. The exact later requests and migration-first/automatic-deploy sequencing are in **`docs/exercise-media/integration-release-gates.md`**. No decision is silently exercised here. Owner compact-versus-Larger/cold-visibility review, real media rights/variant/instruction/accessibility review and Safari/iOS remain distinct gates. Recording all exercises is not a prerequisite for the working sample flow.

Inherited accepted media debt remains disclosed: server crop revalidation, synchronous processor checks, finite editor polling, fast-start enforcement, preview pause/cache eviction and small-race debt. The integration did not quietly fix it or broaden scope. No new important local integration finding remains unresolved.

## Judgment and launch record

Rulings 1–8 are in the plan/progress ledger: native-worktree unavailability required a fresh task-owned Git anchor; use verified release rather than unapproved repair; reuse accepted composition; add only explicitly planned boundary guards with RED→GREEN; retain evidence; preserve the unique unapplied SQL draft; retain accepted visual design; normalize only inherited EOF whitespace. No optional check-in interrupted authorized work.

For a synthetic local launch, read `CLAUDE.md` and `docs/exercise-media/local-runbook.md` in the exact workspace above; `npm --prefix backend run dev:media-local` starts only its owned local stack/frontend and prints its loopback entry. `npm --prefix backend run dev:media-local:down` tears down only that stack. Check local Docker/processor readiness first. No hosted variables or real data are needed. The final task-owned services are stopped; the checkout and evidence remain available for review.
