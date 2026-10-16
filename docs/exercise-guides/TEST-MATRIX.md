# Exercise guides — verification matrix (2026-10-16)

**What was tested.** The final sweep ran at functional head
`fb5d06e34a2ecc30e9411f28d74d24294ae9bcdc`, with no tracked changes at
start. It used host Node v26.7.0 and Chromium headless shell 149.0.7827.55
(Playwright 1.61.1).

- **Serial.** Stack-owning suites ran one at a time under the canonical
  host-wide lock `~/.cvfpt/disposable-db.lock`.
- **Clean teardown.** Afterwards the lock was released, and no `cvfpt`
  containers, volumes or owned ports remained.
- **Later commits.** Commits after `fb5d06e` change documentation and the
  return packet only.
- **Raw logs.** They are in the return packet's `evidence/logs/final/`.
- **No total.** No aggregate sum is claimed, because some focused suites
  overlap.

## Final sweep

All checks exited 0.

| Check | Command | Result |
|---|---|---|
| Backend unit/route | `npm --prefix backend test` | 673/673 |
| Frontend units | `npm --prefix frontend run test:unit` | 160/160 |
| Deploy boundaries | `bash scripts/check-boundaries.sh backend` and `... frontend` | no cross-root references (both) |
| Production build | `npm --prefix frontend run build` | built; existing chunk-size warning only |
| Guides mocked browser | `npm --prefix frontend run test:e2e:guides` | 19/19 |
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
passed.

- Zero requests before Play; the state reached `ready`.
- The embed was nocookie, and `embed_referer` was the origin only.
- Hosts contacted after Play: youtube-nocookie.com, youtube.com,
  googlevideo.com, i.ytimg.com, gstatic.com, google.com and googleapis.com.

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

**Quick v1:**

- Golden canonical hashes are pinned from baseline code.
- The committed same-request replay passes on the baseline export (1/1) and
  on the head (1/1).
- Equal input keeps the exact `v1:` hash and receipt, with no new row writes.
- A different `video_url` mismatches.
- An API `video_link_mode` key is rejected.

**Linux Node 24.22** (`node:24-bookworm-slim`): on both arm64 and amd64,
`npm ci` installed sharp 0.35.5 / libvips 8.18.7 and the photo tests passed
30/30.

**Dependency audit:** `npm audit` (backend) found 0 vulnerabilities.

## Visual evidence

- **Captures.** 84 headless captures of baseline `f3c063c` and proposed
  `e80d0c9` (clean), at 320×740, 390×844 and 1440×900, plus proposed-only
  player states and refinement checks. See
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
- **Rendered check.** The comparison page passed a headless check with 0
  errors at 390px and 1280px in dark mode.

## Not run, or not provable here

| Item | Classification | Note |
|---|---|---|
| iPhone Safari, Android Chrome, desktop Safari and Firefox | unavailable | no physical devices or WebKit in this environment; manual matrix in [local-runbook.md](local-runbook.md) |
| Hosted Supabase adapter against a real bucket | not-applicable | forbidden by task authority; contract-tested against a fake object client only |
| Hosted migrations | not-applicable | forbidden; applied only to disposable local databases |
| Live-auth preview specs (8) | unavailable | they need `CVF_E2E_*` credentials, which are not provided or handled |
| Real CVF channel content and captions | not-applicable | no channel access or uploads; all media and ids are synthetic |
