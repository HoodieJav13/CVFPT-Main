# Exercise media — validation record (local build, 2026-10-15)

Everything here ran on this Mac against task-owned, loopback-only local
services with fictional actors and synthetic media. Nothing touched a hosted
project, bucket, worker, provider or real record. Hosted live-auth suites were
not run (not authorized). Raw logs live in the gitignored
`.exercise-media-local/evidence/` folder; `exercise-media-return-manifest.json`
records their SHA-256 hashes.

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
