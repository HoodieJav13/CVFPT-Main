# Exercise media — validation record (local build, 2026-10-15; P2 corrections 2026-10-16)

Everything here ran on this Mac against task-owned, loopback-only local
services with fictional actors and synthetic media. Nothing touched a hosted
project, bucket, worker, provider or real record. Hosted live-auth suites were
not run (not authorized). Raw logs live in the gitignored
`.exercise-media-local/evidence/` folder; `exercise-media-return-manifest.json`
records their SHA-256 hashes.

## Residual R2 follow-up — crop selection changes (2026-10-16)

An independent review of `c64d17cb9596a700515d17f9c514ca9f1dab5060` verified R1
and the original R2 case. It reproduced one remaining defect: with a crop
open, changing that target's saved time (or clearing the target or switching
the poster mode) left the old frame editable, and its edits were written into
the new selection. Fixed in `VideoSelectionEditor.jsx`. R1 and all backend
code are untouched.

| Regression | RED (component byte-identical to `c64d17c`) | GREEN |
|---|---|---|
| `frontend/e2e/exercise-media-frame-selection.spec.mjs`: 8 new cases covering poster, end-still and preview-start time changes with a ready crop; a pending browser capture; a pending server capture changed away and back; a late server failure; clear and poster-mode switch; a pending capture for a cleared target; plus a positive control for crop edits, alt/cue changes and scrubbing | 10 passed / 8 failed: every new defect case fails, the positive control and 9 earlier cases pass (`r2-followup/raw/red.log`) | 18/18, repeated 3× (`raw/green*.log`) |

Real local path (`test:e2e:media:local`, now 6 tests): the poster crop is
opened at a saved 0.5 s, the saved time is changed to 3.5 s with the crop
open, and the crop reloads that frame and is edited by keyboard before
processing. Mean RGB difference at 64×36 against the generated 640×360 JPEG:
- coach crop view: 1.63;
- new 3.5 s frame: 1.63;
- old 0.5 s phase (negative control): 13.36.

The data is in `r2-followup/author-matrix/real-selection-change.json`. The
original saved-frame case still passes (poster 0.86 / 0.92 / 6.49, end still
1.6 / 1.62 / 7.7).

Paired captures (`docs/exercise-media/p2-correction/selection-change/index.html`,
18 images, rendered and headless-checked at 390/1280 and in dark mode):
- **Before** (`c64d17c`): after the change, the crop still shows the 0.5 s frame
  labelled 0:00.5, and keyboard edits write into the 3.0 s recipe.
- **After**: the crop shows the 3.0 s frame labelled 0:03.0.
- No horizontal overflow at 320, 390 or 1280 px.

### Follow-up author matrix (tested head `c4229d877180bb78554150186bef9696ff4910d9`, tree `894f7444afded5ae824a97e91b7718504d09bd6f`, clean)

Logs: `.exercise-media-local/evidence/r2-followup/author-matrix/`.

| Command | Result | `c64d17c` |
|---|---|---|
| frame-selection spec (focused) | 18/18 | 9/9 (+8 new cases fail) |
| contract / boundaries | pass / pass / pass | same |
| `npm --prefix backend test` | 584/584 | 584/584 |
| `npm --prefix frontend run test:unit` | 103/103 | 103/103 |
| `npm --prefix frontend run build` | pass | pass |
| `npm --prefix frontend run test:e2e:media` | 25/25 | 16/16 |
| `npm --prefix frontend run test:e2e:media:local` | 6/6 | 5/5 |
| `npm --prefix frontend run test:e2e:preview` | 86 passed, 8 skipped (credential-gated) | 86 / 8 |
| `npm --prefix backend run test:media:integration` | 22/22 on the first attempt (no rerun needed) | 22/22 |
| workout-UX (`playwright.workout-ux.config.mjs`) | 25/25 | 25/25 |

The integration qualification from the independent review still applies.
Its first run once stopped at the unchanged batched-hydration query-count
equality (7 exercises = 10 queries, 50 = 9), and a clean rerun passed. Worker
interference with the shared request counter is inferred, not proven. Here the
first attempt passed with 9 = 9; the assertion was not edited or relaxed.

### Composition with pinned PR114

A new disposable clone, `../compat-pr114-media-r2f-20261016`, starts at the
saved composition `634f833` (left unchanged). Only this follow-up's runtime and
test delta was applied (`VideoSelectionEditor.jsx`, the frame-selection spec,
the harness and the real-local spec, each byte-identical to the author's).
Result: `990a42b1bd0b51fd08d7408df53eedbb6dba88f6`, tree
`7d6741c09873bcce0e94c02eaaf8af04d9486dd5`. Migrations are unchanged (Quick
`8842d98e…`, media `54028175…`).

| Lane | Result |
|---|---|
| unit | 140/140 |
| build | pass |
| frame selection | 18/18 |
| `test:e2e:media` | 25/25 |
| real-local | 6/6 |
| Quick mocked | 30/30 |

Quick SQL, backend and preview were not rerun, because the delta is frontend
component and test code only (disclosed evidence boundary; the `634f833`
results stand for those lanes). This is no Quick release approval.

## P2 corrections (2026-10-16)

An independent review of candidate `335588ec0c00a8c6ec65a9b13526f3bfd80688bd`
reproduced two P2 defects that the green normal-path lanes did not cover.
Both are corrected locally; independent acceptance is a later review.

| Finding | Regression | RED (pinned behaviour) | GREEN |
|---|---|---|---|
| R1 — a post-commit source-file install failure deleted the only staged bytes; a same-request retry answered 200 with the recorded file still missing | `backend/test/exercise-media-upload-recovery.test.js` (real temporary `LocalMediaStore`, synthetic JPEG, repository mirroring the SQL commit/replay rules, test-only fault at `commitUpload`) | 3 pass / 4 fail against `git archive 335588e backend` with the final test (`p2-correction/raw/r1-red.log`) | 7/7 |
| R2 — crops used the current scrub frame (and the server fallback the scrub time) instead of each target's saved frame | `frontend/e2e/exercise-media-frame-selection.spec.mjs` (real `VideoSelectionEditor` in a test-only harness page, labelled synthetic moving geometry), now in `test:e2e:media` | 0 pass / 9 fail with the component byte-identical to `335588e` (`p2-correction/raw/r2-red.log`) | 9/9 |

Real-service proof:
- **R1 integration case** (`test:media:integration`, 22 cases): a real
  filesystem fault after the SQL attach commits (read-only object directory)
  → HTTP 500 and the validated bytes kept as `quarantine/<asset id>.part` →
  the same request id and bytes return 200 `replayed: true`, the recorded key
  holds the recorded SHA-256, one source row, no further draft version →
  processing, review, publication and a client poster read succeed.
- **R2 real-local browser case** (`test:e2e:media:local`, 5 tests): band-row
  clip, poster saved at 0.5 s and end still at 5.0 s, source scrubbed to 4.0 s /
  1.0 s before each crop. Mean RGB difference at 64×36 between the generated
  640×360 JPEG and (a) the coach's crop view, (b) the saved-time frame, (c) the
  scrub-position control: poster 0.86 / 0.92 / 6.49, end still 1.6 / 1.62 / 7.7
  (`p2-correction/author-matrix/real-frame-selection.json`; tolerance: < 12 and
  at least 2× below the control).
- **Paired crop-frame captures** (`docs/exercise-media/p2-correction/frame-selection`):
  the pinned candidate shows the scrub-position frame in all 4 captures; the
  corrected tree shows the saved frame in all 4.

### Corrected author matrix (tested head `15487cffae02fbfa463fdff6783280dbfbecd2fe`, tree `42882f3e62abccbaf48f4edb2c4cf682945a0747`, clean)

Logs: `.exercise-media-local/evidence/p2-correction/author-matrix/`.

| Command | Result | Candidate (`335588e`) |
|---|---|---|
| `node --test backend/test/exercise-media-upload-recovery.test.js` | 7/7 | 3/7 |
| `npx playwright test --config playwright.exercise-media.config.mjs e2e/exercise-media-frame-selection.spec.mjs` (frontend) | 9/9 | 0/9 |
| `bash .agentic/validate-contract-version.sh .` | pass | pass |
| `bash scripts/check-boundaries.sh frontend` / `backend` | pass / pass | pass / pass |
| `npm --prefix backend run test:media` | 41/41 | 34/34 |
| `npm --prefix backend test` | 584/584 | 577/577 |
| `npm --prefix frontend run test:unit` | 103/103 | 103/103 |
| `npm --prefix frontend run build` | pass (harness not in `dist`) | pass |
| `bash supabase/tests/exercise_media/stack_guard_test.sh` | 18 | 18 |
| `bash supabase/tests/exercise_media/run.sh --down` | 4 SQL groups + 5 races | same |
| `npm --prefix backend run test:media:integration` | 22/22 | 21/21 |
| `npm --prefix frontend run test:e2e:media` | 16/16 (7 mocked + 9 frame selection) | 7/7 |
| `npm --prefix frontend run test:e2e:media:local` | 5/5 | 4/4 |
| `npm --prefix frontend run test:e2e:preview` | 86 passed, 8 skipped (credential-gated live auth) | 86 / 8 |
| `node node_modules/@playwright/test/cli.js test --config playwright.workout-ux.config.mjs` (frontend) | 25/25 | 25/25 |

Every DB-owning lane ran serially under `~/.cvfpt/disposable-db.lock`; no
`cvfpt` container and no lock remained afterwards.

### PR114 composition with the corrections

Disposable clone `../compat-pr114-media-p2-20261016`: composition `634f833afe0f3f43e5f216884e4ea125faeaa2f7`
(tree `a6ec973c…`), parents pinned PR114 `a8a6a495…` and corrected media `15487cf…`. Conflicts were
resolved as follows:
- `programs.js`, `workoutLogs.js` and `previewMode.js`: byte-identical to the earlier reviewed
  resolution (media side unchanged since `9dc347d`).
- `playwright.config.mjs`: union.
- `CLAUDE.md`: both entries.

Migrations: Quick unchanged (`8842d98e…`), media unchanged (`54028175…`). Results, from logs in
`p2-correction/compat-matrix/`:

| Lane | Result |
|---|---|
| boundaries | 2/2 |
| backend | 609/609 |
| unit | 140/140 |
| build | pass |
| focused R1 / R2 | 7/7 / 9/9 |
| media SQL | 4 groups + 5 races |
| Quick SQL `--all` | parity identical (26 rows), 71 behavior/grant, 21 races |
| Quick×media API | 5/5 executed |
| media integration | 22/22 |
| `test:e2e:media` | 16/16 |
| real-local | 5/5 |
| Quick mocked | 30/30 |
| preview | 106 passed / 8 skipped |

Local compatibility evidence only, with no Quick release approval.

The sections below are the candidate's original 2026-10-15 record, kept as
history.

## Tested source

| Tree | Commit | Tree id |
|---|---|---|
| Released baseline (before edits) | `8d68a7893f7a84a658ff6545bb0b2b70a0df91ce` | `004fbfe3f1faf1785f3af25f6c81fb7110f12d0d` |
| Media build (final head) | `9dc347d2fa6dd602f3f39e7b08aed8ff8de0a9a8` | `410e8bf4e9366d764ff315bcf960f0cc07881a39` |
| PR114 compatibility composition (disposable clone) | `2716f7e99ae770aa82284d40ebefe0b257f86fd8` | `16e62c407eb52c5b111db634f1b8f214a41685f7` |

The composition's parents are pinned PR114 `a8a6a4958697c4d2d663ac9cc147a9b1ecc813b3`
and the media head `9dc347d`.

## Media build — final head

| Command | Result | Baseline (8d68a78) | Log |
|---|---|---|---|
| `.agentic/validate-contract-version.sh .` | pass | pass | `final/validate-contract.log` |
| `bash scripts/check-boundaries.sh frontend` / `backend` | pass / pass | pass / pass | `final-head/boundaries-*.log` |
| `npm --prefix backend test` | 577/577 | 540/540 | `final-head/backend-test.log` |
| `npm --prefix backend run test:media` | 34/34 | — | `final-head/backend-test-media.log` |
| `npm --prefix frontend run test:unit` | 103/103 | 95/95 | `final-head/frontend-unit.log` |
| `npm --prefix frontend run build` | pass | pass | `final-head/frontend-build.log` |
| `VERCEL_ENV=production npx vite build` (gate check) | pass; same file set as the baseline Production build; media/demo strings only in the already-gated `previewMode`/`PreviewToolbar` chunks | same chunks present | `final/frontend-build-production.log` |
| `bash supabase/tests/exercise_media/stack_guard_test.sh` | 18 cases | — | `final-head/media-guard.log` |
| `bash supabase/tests/exercise_media/run.sh --down` | 4 SQL groups + 5 committed races | — | `final-head/media-sql.log` |
| `npm --prefix backend run test:media:integration` | 21/21 | — | `final-head/media-integration.log`, `final-head/integration-results.json` |
| `npm --prefix frontend run test:e2e:media` (normal-mode mocked) | 7/7 | — | `final-head/media-mocked.log` |
| `npm --prefix frontend run test:e2e:media:local` (real local stack) | 4/4 | — | `final-head/media-local-browser.log`, `final-head/browser-local-network.json` |
| `npm --prefix frontend run test:e2e:preview` | 86 passed, 8 skipped | 80 passed, 8 skipped | `final-head/preview-full.log` |
| `npx playwright test --config playwright.workout-ux.config.mjs` | 25/25 | — | `final-head/workout-ux.log` |
| `test:e2e:invites` / `auth` / `analytics` / `series` / `playwright.metrics.config.mjs` | 17 / 4 / 6 / 23 / 3 | — | `final/e2e-*.log` |
| `bash supabase/tests/session_series/run.sh --down` + its guard tests | pass; 18 + 11 guard cases | — | `final/series-*.log` |
| `bash supabase/tests/client_invites/run.sh` | pass (contracts + races) | — | `final/invites-sql.log` |
| `bash supabase/tests/workout_metrics/run.sh` | pass | — | `final/metrics-sql.log` |

The 8 skipped preview tests are the hosted `live-auth` specs, which skip
without `CVF_E2E_*` credentials (unchanged from baseline). The session-series,
invite and metrics SQL runners predate the host-wide lock; they ran serially
while this task held `~/.cvfpt/disposable-db.lock`. Every stack was torn down
and the lock released afterwards (`final-head/leftover-*.txt`).

## PR114 compatibility (composition `2716f7e`)

Conflicts (4, mechanical): `backend/src/routes/programs.js` (PR114 moved
`trackingExercises` into `lib/quickSessions`; both feature imports and both
route blocks kept), `backend/src/routes/workoutLogs.js` (both imports),
`frontend/playwright.config.mjs` (union of `testIgnore`), and
`frontend/src/lib/previewMode.js` (`/programs/client/assigned`: PR114's
client allowlist strip plus media hydration). PR114's migration stays
byte-identical (SHA-256 `8842d98e…2119`).

| Command (in the clone) | Result |
|---|---|
| boundaries frontend/backend | pass / pass |
| `npm --prefix backend test` | 602/602 |
| `npm --prefix frontend run test:unit` | 140/140 |
| `npm --prefix frontend run build` | pass |
| `bash supabase/tests/quick_sessions/run.sh --all --down` | parity reports identical (26 rows, both migrations applied, latest `20261015213431`); 71 behavior/grant assertions; 21 race assertions |
| `bash supabase/tests/exercise_media/run.sh --down` | 4 groups + 5 races |
| `node backend/integration/exercise-media-quick-compat.cjs` | 5/5: Quick create/replay/mismatch/recovery unchanged; start keeps provenance with live media; started prescription stays frozen (409 `quick_session_started`) while the guide changes; receipt row and request hash byte-stable across media replacement; save-to-library and ordinary assignment keep working |
| `npm --prefix backend run test:media:integration` | 21/21 |
| `npm --prefix frontend run test:e2e:preview` | 106 passed, 8 skipped |
| `npm --prefix frontend run test:e2e:quick-sessions` | 30/30 |
| `npm --prefix frontend run test:e2e:media` / `:local` | 7/7 / 4/4 |

Logs: `.exercise-media-local/evidence/compat-pr114-r2/` (the first
composition, before the review fixes, is kept in `compat-pr114/`).

Composition finding (not fixed here, since PR114 must not change): Quick's
`POST /quick-sessions` stores per-exercise `video_url` as free text, so the
media branch's new unsafe-link rejection does not cover that path in a composed
tree. Rendering stays safe (`safeHttpUrl` on every link). Whichever lands second
should run `unsafeExternalVideoUrls(req.body.exercises)` before
`normalizeQuickSessionCreate` and add a route test.

## RED → GREEN evidence for fixes found late

| Finding | Test | RED | GREEN |
|---|---|---|---|
| Coach library 343 px wide at 320 px (capture metrics) | preview: "coach library and media editor never scroll sideways on a 320px phone" | 343 > 320 | pass |
| Media test stack ignored the Quick host lock | `stack_guard_test.sh` lock cases | exit 0 ≠ 3 | 18 cases |
| Disabled media logged a 503 on every coach library visit (workout-UX missing-mock guard + review) | routes: "…disabled discovery 200 and everything else 503" | 503 ≠ 200 | 7/7 |
| Guide publishable after clearing alt text | validation alt-text test; SQL `03_lifecycle` alt-text block | `accepted`; review `approved` | pass |
| Endless spinner after a guide changed mid-workout | mocked: "a guide replaced mid-workout…" | spinner, no Retry | 7/7 |
| Another coach's raw sources copied into a seeded draft | SQL `02_boundaries` seeding block | "no foreign source copied" failed | pass |
| Coach scrubber called an expired link "can't play" | unit "refresh gate"; mocked "coach source scrubber…" | missing export; 1 link | pass |

Earlier milestone RED evidence (SQL, processing, authorization mutation
checks, hydration, external links, link cache) is under
`.exercise-media-local/evidence/history/raw/`.

## Not run, and why

- `test:e2e:live` and any hosted check: not authorized (local build only).
- Safari/WebKit: the WebKit browser is not in the local Playwright cache, and
  downloading it was not authorized. Chromium headless only.
- `backend/integration/invite-quick-local.cjs` (PR114): its launcher lives in
  PR114's own task folder, outside the repository; media changes no invite or
  claim code.
- ESLint: the repository has no ESLint configuration.

## Measurements (synthetic fixtures, this machine)

From `final-head/integration-results.json` and
`final-head/browser-local-network.json`; see the production-gates document for
how they size Gate 2.

| Item | Measured |
|---|---|
| Photo upload (66 KB JPEG) | ~0.35–0.46 s |
| Photo processing (decode, EXIF orient, crop, 640×360 JPEG) | ~0.6–0.9 s |
| Poster | 20,028 B (budget 160 KiB) |
| 6 s 720p video job (poster, 2 s preview, instruction, captions) | ~2.6–3.5 s (3.25 s in the final run) |
| Preview / instruction / captions | 13,367 B / 44,708 B / 159 B |
| 90 s 1080p30 source (56.7 MB) | instruction 5.77 MB, preview 48 KB; completed after a forced worker crash |
| Workout read with media | 9 PostgREST requests for 7 and for 50 exercises |
| 50-exercise log JSON | 75,865 B |
| Initial tracker load | 2 poster requests (27,963 B), 0 video requests, preview served as 206 range, no external origins |
