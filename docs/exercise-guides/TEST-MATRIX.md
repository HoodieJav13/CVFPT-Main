# Exercise guides — verification matrix (2026-10-16)

**What was tested.** The final sweep ran at
`88b2d7afa5658ef6ffea4f83a57a5d6718fb1f36`. Its product code is the same as
functional head `49d30a6`, which includes the review fixes. There were no
tracked changes at start. It used host Node v26.7.0 and Chromium headless
shell 149.0.7827.55 (Playwright 1.61.1).

- **Serial.** Stack-owning suites ran one at a time under the canonical
  host-wide lock `~/.cvfpt/disposable-db.lock`.
- **Clean teardown.** Afterwards the lock was released, and no `cvfpt`
  containers, volumes or owned ports remained.
- **Earlier sweep.** An identical sweep at the pre-review head `fb5d06e`
  also passed all 18 checks: backend 673, units 160, guides browser 19, and
  the rest identical. Both are kept as raw logs in the return packet's
  `evidence/logs/final/` and `evidence/logs/final2/`.
- **Later commits.** Commits after `88b2d7a` change evidence, documentation
  and the return packet only.
- **No total.** No aggregate sum is claimed, because some focused suites
  overlap.

## Final sweep

All 18 checks exited 0.

| Check | Command | Result |
|---|---|---|
| Backend unit/route | `npm --prefix backend test` | 674/674 |
| Frontend units | `npm --prefix frontend run test:unit` | 162/162 |
| Deploy boundaries | `bash scripts/check-boundaries.sh backend` and `... frontend` | no cross-root references (both) |
| Production build | `npm --prefix frontend run build` | built; existing chunk-size warning only |
| Guides mocked browser | `npm --prefix frontend run test:e2e:guides` | 22/22 (player, still and editor specs) |
| Media mocked browser | `npm --prefix frontend run test:e2e:media` | 25/25 |
| Quick mocked browser | `npm --prefix frontend run test:e2e:quick-sessions` | 30/30 |
| Full preview | `npm --prefix frontend run test:e2e:preview` | 107 passed, 8 skipped (credential-gated live-auth specs), 0 failed |
| Media SQL, grants, races | `bash supabase/tests/exercise_media/run.sh --down` | 6 SQL groups (incl. `05_guides`, `06_photo_uploads`) + 5 committed races |
| Quick SQL | `bash supabase/tests/quick_sessions/run.sh --all --down` | PASS; pre/post parity identical (26 rows, empty `parity.diff`); behavior, grants and races passed |
| Guides real local API | `npm --prefix backend run test:guides:integration` | 14/14 (photos mode, no worker) |
| Full owned-video real local API | `npm --prefix backend run test:media:integration` | 22/22 (FFmpeg worker, preserved) |
| Quick × media real local | `node backend/integration/exercise-media-quick-compat.cjs` | 5/5 |
| Guides real local browser | `npm --prefix frontend run test:e2e:guides:local` | 3/3 |
| Media real local browser (full) | `npm --prefix frontend run test:e2e:media:local` | 6/6 |
| Real-provider proof, sample | `npm --prefix frontend run test:e2e:youtube-proof` | see below |
| Real-provider proof, missing id | `CVF_YT_PROOF_ID=SYNTHdemo01 npm --prefix frontend run test:e2e:youtube-proof` | see below |

**Real-provider sample** (Google's documentation id `M7lc1UVf-VE`): 1/1
passed. Zero requests before Play; the state reached `ready`; the embed was
nocookie, and `embed_referer` was the origin only.

**Real-provider missing id:** 1/1 passed. Zero requests before Play, and the
real provider returned error 150.

## Baseline and failure-first receipts

**Baseline f3c063c:** backend 611/611 and frontend units 140/140, after
`npm ci` in both roots.

**RED→GREEN receipts.** Each failed first for the stated reason, then passed:

| Milestone | Area | RED result |
|---|---|---|
| M1 | references | 14 failing, 5 compatibility pins passing |
| M1 | SQL | the mode column and writers were missing |
| M2 | SQL | the intent table and functions were missing |
| M2 | image processor | — |
| M2 | upload transport | — |
| M2 | content-stream abort | — |
| M3 | browser | 11 failing at the M2 export |
| M4 | focus after Play | focus stayed on the dialog shell |
| M4 | action alignment and type | 49px/12px against 41px/14px |
| M4 | pill hit area | missed at ±20px |
| M4 | editor overflow | 141px at 320px; 71px at 390px |
| M4 | expired photo fallback | broken image |
| M4 | history pairing | — |
| M4 | short-window cap | — |
| M4 | "always works" copy | — |
| M4 | still confirmation direction | — |

**Independent-review fix pass.** Each fix was RED, then GREEN:

| Finding | Test | RED | GREEN |
|---|---|---|---|
| Duplicated legacy-link row | `exercise-guides-editor.spec.mjs` drives the real editor and checks the saved body against the real backend rules | server rule 400 | passes |
| Duplicated legacy-link row | 2 unit tests (`demoFieldsForCopy`, `demoProblem` for new rows) | 2 failing | 6/6 |
| In-flight still export: controls | held-`toBlob` stub; controls disabled while exporting | enabled | disabled |
| In-flight still export: late frame | held-`toBlob` stub; frame finishing after close | blob URLs created 2, revoked 1 | balanced |
| Save/read link agreement (both copies) | `exercise-demo.test.js` | apostrophe link resolved to nothing | 11/11 |

**Quick v1:**

- Golden canonical hashes are pinned from baseline code.
- The committed same-request replay passes on the baseline export (1/1) and
  on the head (1/1).
- Equal input keeps the exact `v1:` hash and receipt, with no new row writes.
- A different `video_url` mismatches.
- An API `video_link_mode` key is rejected.

**Linux Node 24.22** (`node:24-bookworm-slim`): on both arm64 and amd64,
`npm ci` installed sharp 0.35.5 / libvips 8.18.7 and the photo tests passed
30/30. This ran during M2 (commit `81d7f90`) and was not rerun at the final
head; the backend `package.json` and lockfile are unchanged since M2.

**Dependency audit:** `npm audit` (backend) found 0 vulnerabilities.

## Visual evidence

- **Captures.** 84 headless captures of baseline `f3c063c` and the proposed
  final code (commit `88b2d7a`; the capture-tooling framing change was
  uncommitted at capture time), at 320×740, 390×844 and 1440×900, plus
  proposed-only player states and refinement checks. See
  [visual-review/index.html](visual-review/index.html).
- **Hashes.** The SHA-256 of every image is re-verified by
  `scripts/exercise-guides/build-visual-review.mjs`.
- **Clean capture.** There were zero unmocked requests and zero provider
  requests before Play.
- **Layout.** The tracker layout did not move: the first set input and the
  control dock sit at identical positions in baseline and proposed at every
  viewport.
- **Player size.** The player was 270×202, 340×202 and 622×351 at the three
  widths, and 590×272 at 200% zoom.
- **Run-to-run stability.** Two consecutive full captures were 79/84
  byte-identical. The other five differed by at most 767 pixels, confined to
  decoded media and a 1-pixel focus-ring row.
- **Rendered check.** The comparison page passed a headless check with 0
  errors at 390px and 1280px in dark mode.

## Mobile dialog correction (2026-10-16)

**What was tested.** The second independent review's P2 (pre-Play facade
overflow at 320/390px) was fixed in `ee0759c` and tested in `fbf7d86`. The
lanes below ran at `fbf7d86`
(tree `d68b67d50565ada440340af6728ac3e76c5535ef`) with no tracked changes. All
exited 0.

| Check | Result |
|---|---|
| Copied independent reproduction | RED 2/2 at `6363a3d` (scroll 404/318 and 404/388), then GREEN 2/2 (318/318, 388/388) |
| New pre-Play regression tests in `exercise-guides-player.spec.mjs` | 8 RED at `6363a3d`, then GREEN |
| Frontend units | 162/162 |
| Guides mocked browser | 30/30 |
| Media mocked browser | 25/25 |
| Full preview | 107 passed, 8 skipped (live-auth), 0 failed |
| Production build / deploy boundaries | pass / pass |
| Guides real local browser (photos stack, canonical lock) | 3/3; lock released, 0 owned containers/volumes/ports |

**Reused, not rerun.** Backend, SQL and packaging evidence is reused from the
final sweep above. The correction changes only frontend layout and tests, so
backend, SQL, integration and provider-proof lanes were not rerun.

**Evidence location.** Paired before/after captures (`6363a3d` and
`fbf7d86`), measurements and raw logs are in
`../return-mobile-dialog-correction-20261016/`.

## Not run, or not provable here

| Item | Classification | Note |
|---|---|---|
| iPhone Safari, Android Chrome, desktop Safari and Firefox | unavailable | no physical devices or WebKit in this environment; manual matrix in [local-runbook.md](local-runbook.md) |
| Hosted Supabase adapter against a real bucket | not-applicable | forbidden by task authority; contract-tested against a fake object client only |
| Hosted migrations | not-applicable | forbidden; applied only to disposable local databases |
| Live-auth preview specs (8) | unavailable | they need `CVF_E2E_*` credentials, which are not provided or handled |
| Real CVF channel content and captions | not-applicable | no channel access or uploads; all media and ids are synthetic |
