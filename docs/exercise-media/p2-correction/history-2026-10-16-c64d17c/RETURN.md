# RETURN — exercise media P2 corrections (local, 2026-10-16)

```text
Completion state:      COMPLETE-LOCAL
Protocol version:      v1.1
Baseline SHA:          correction baseline 335588ec0c00a8c6ec65a9b13526f3bfd80688bd (tree 3a857e68a16461efd11427fad553e20af3123dff);
                       released baseline 8d68a7893f7a84a658ff6545bb0b2b70a0df91ce
Head SHA:              tested functional head 15487cffae02fbfa463fdff6783280dbfbecd2fe (tree 42882f3e62abccbaf48f4edb2c4cf682945a0747);
                       later commits are documentation only (proof below); `git rev-parse HEAD` gives the tip
Branch and upstream:   claude/exercise-media-local-20261015 -> NOT PUSHED (no upstream; push URL DISABLED-LOCAL-ONLY kept)
Authority used:        CVFPT-EXERCISE-MEDIA-P2-CORRECTION-STARTER-20261016.md (ROLE: EXECUTOR, DIAL: EXECUTE, local
                       corrections only): inspection, the two scoped fixes, test-only harness/fixture, owned disposable
                       loopback services, headless browser captures, disposable clones under the task folder,
                       documentation and scoped local commits after checks.
Commits:               6 correction commits on top of the 19 pre-existing feature commits (listed below)
Files changed:         correction 335588e→HEAD and released 8d68a78→HEAD: see "Footprint"
Migrations/deps:       none changed. The local draft migration 20261015213431_exercise_media_library.sql stays
                       SHA-256 54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c; no package.json or
                       lockfile change; same cached processor cvfpt-media-ffmpeg:6.1.2-r2-a322
                       (sha256:0652d08d74d68b319957f8c20330254db41240d4a16e5c6bbc622c07a0236767).
Checks passed:         R1 focused 7/7 (RED 3/7 on pinned); R2 focused 9/9 (RED 0/9 on pinned); contract; boundaries 2/2;
                       backend test:media 41/41; backend 584/584; frontend unit 103/103; build; stack guard 18; media
                       SQL 4 groups + 5 races; real-services integration 22/22; test:e2e:media 16/16; real-local
                       browser 5/5; preview 86 passed / 8 skipped; workout-UX 25/25; PR114 composition matrix (below).
Checks failed/not run: test:e2e:live and every hosted check — not-applicable (not authorized). Safari/WebKit —
                       unavailable (not in the local browser cache; downloads not authorized). PR114's
                       invite-quick-local.cjs — not-applicable (launcher outside the repository; no invite/claim code
                       touched). The 8 skipped preview tests are the credential-gated live-auth specs
                       (baseline-unrelated, unchanged).
External actions:      none (no push, PR, CI, deploy, hosted read/mutation, provider, credential, purchase or message)
Known gaps:            independent acceptance of these corrections is a later review; production storage/worker/
                       cost/retention, owner visual direction and cold visibility, real coach instruction/variant/rights
                       review and Safari/iOS remain gates; the other documented review debt is unchanged (listed below).
Push/deploy state:     all local: this checkout plus disposable clones ../p2-before-335588e and
                       ../compat-pr114-media-p2-20261016; nothing pushed, published or deployed.
```

The candidate's original handoff is preserved unchanged at
`docs/exercise-media/p2-correction/candidate-335588e/RETURN.md`
(SHA-256 `393a191ba45488ac3427452c903ef95d616ff607e5d1b46fcbc25d019aa968eb`) and its
manifest at `docs/exercise-media/p2-correction/candidate-335588e/exercise-media-return-manifest.json`
(SHA-256 `0341280a78676474abb041092f6654aa48062d91bdf805b3f9b35f99a26f1153`), matching the
independent review's recorded hashes. Read it for the feature's full build record; this file covers
the corrections.

## Starting identity (directly verified before edits)

Branch `claude/exercise-media-local-20261015`, clean, no upstream, HEAD `335588ec…`, tree
`3a857e68…`, fetch origin `https://github.com/HoodieJav13/CVFPT-Main.git`, push
`DISABLED-LOCAL-ONLY`, migration hash as above, contract validator "v1.1". Inputs read: the
independent `REVIEW.md`, both probes and results, repository instructions and the candidate packet.
The frozen review clone, the earlier composition `2716f7e`, the old main checkout and any Quick
checkout were not edited.

## Commits

The 19 feature commits `c919bd3…335588e` predate this correction and are not new repairs (see the
candidate RETURN). The correction adds:

```text
03f5af1 Keep committed source bytes recoverable and make same-request retries truthful   (functional, R1)
7caf451 Crop each video target on its saved frame, in the browser and the fallback        (functional, R2)
1898549 Prove both corrections through the real local services                             (tests)
15487cf Add paired before/after crop-frame evidence for the R2 correction                  (evidence)
<docs>  Record the P2 corrections in docs, status and validation                          (documentation only)
<return> Return packet and manifest for the P2 corrections                                 (documentation only)
```

The last two commit IDs are not written here, because a file cannot contain the ID of its own commit.
`git log --oneline 15487cf..HEAD` lists them, and
`git diff --name-only 15487cf HEAD` shows only `CLAUDE.md`, `RETURN.md`,
`exercise-media-return-manifest.json` and files under `docs/exercise-media/`.

## Footprint

- **Correction, `335588e` → tested head `15487cf`:** 27 files, +1,274 / −41 (18 added, 9 modified).
  - Production code: `backend/src/lib/exerciseMedia/service.js` (+58/−12),
    `backend/src/services/exerciseMedia/localStore.js` (+51/−1),
    `backend/src/services/exerciseMedia/worker.js` (+16/−7),
    `frontend/src/components/training/media/VideoSelectionEditor.jsx` (+113/−16).
  - Tests: `backend/test/exercise-media-upload-recovery.test.js` (new),
    `backend/test/exercise-media-routes.test.js`, `backend/integration/exercise-media-local.cjs`,
    `frontend/e2e/exercise-media-frame-selection.spec.mjs` (new),
    `frontend/e2e/exercise-media-local.spec.mjs`, `frontend/e2e/harness/*` (new, test-only),
    `frontend/e2e/fixtures/exercise-media/*` (new synthetic clip and README),
    `frontend/playwright.exercise-media.config.mjs`, `frontend/playwright.config.mjs`.
  - Evidence: `frontend/e2e/exercise-media-p2-frame.capture.mjs` and
    `frontend/playwright.exercise-media-p2-frame.config.mjs` (new), and
    `docs/exercise-media/p2-correction/frame-selection/*` (README, records, 8 PNGs).
- **Documentation commits after `15487cf`:** `CLAUDE.md`, `RETURN.md`,
  `exercise-media-return-manifest.json`, `docs/exercise-media/{design,local-runbook,validation}.md`,
  and the two preserved candidate files under `docs/exercise-media/p2-correction/candidate-335588e/`.
  That makes 35 files from `335588e` to the tip (20 added, 15 modified).
- **Released baseline `8d68a78` → tested head `15487cf`:** 162 files, +15,126 / −33 (145 added,
  17 modified). Adding the two preserved candidate files gives 164 at the tip. The feature footprint
  is detailed in the candidate RETURN.
- No migration, lockfile, `package.json` or dependency changes. The test-only harness is never built
  into `dist`.

## R1 — committed upload failure: preserve bytes, truthful retry

**Changed code** (`git diff 335588e HEAD`):
- `backend/src/lib/exerciseMedia/service.js` — `reconcileAttach` and `finishReplay` (new lines
  59–91); `attachSource` (lines 177–227): a `disposable` flag that stays true only until the
  database records the upload; the attach RPC is wrapped for an unknown outcome; replay finalizes the
  recorded asset; the install is verified.
- `backend/src/services/exerciseMedia/localStore.js` (lines 107–157): `#check` (size + SHA-256, no
  symlinks), `commitUpload(uploadId, key, expected)` now verifies and installs with a hard link that
  never overwrites, removing the staged copy only after the object is in place, `checkStaged`,
  `adoptStaged`.
- `backend/src/services/exerciseMedia/worker.js` (lines 27–46): recovery installs committed staged
  parts verified against the recorded size/hash and keeps them out of the age sweep when the install
  fails or the row cannot be read.

**Ordering and recovery.** Validation and every definite database refusal (stale, not found,
request mismatch, ownership) delete the staged bytes, as before. After the attach commits, the bytes
stay in quarantine under the recorded asset id until the recorded file is installed and verified,
and only then is success returned. If the attach call fails in transit, the service reads the
recorded row by its own asset id. If the row is found, it finishes and returns 201. If the row is
absent or unreadable, it keeps the bytes and returns the original failure. A same-request retry
(SQL replay) installs the ORIGINAL recorded key: from the original staged copy when it verifies,
otherwise from the retry's identical bytes re-filed under the recorded id. An already-installed
matching file is left untouched (same inode). A present file that does not match is never
overwritten. The retry's own staging key is never recorded or installed.

**RED → GREEN.** `backend/test/exercise-media-upload-recovery.test.js` ran against
`git archive 335588e backend` plus the final test file: 3 pass / 4 fail
(`.exercise-media-local/evidence/p2-correction/raw/r1-red.log`). On the corrected head it passes
7/7. Its assertions:
- (a) a one-time install error after the commit keeps `quarantine/<asset id>.part` and never reports
  success;
- (b) a same-request retry finalizes the original recorded asset/key with matching size and hash,
  with one record and one version bump;
- (c) a replay over an installed valid file leaves it untouched (same inode and mtime);
- (d) repeated install errors fail every attempt, keep one recoverable copy, and recovery finishes
  once installs work;
- (e) validation, ownership and request-mismatch rejections clean up and leave the attachment and
  the current guide unchanged;
- (f) the existing crash recovery still works and sweeps only uncommitted parts;
- (g) an uncertain RPC outcome is reconciled by the recorded row, and when the outcome is unknowable
  the bytes are kept and a later same-request retry finishes once.

The fault is injected only inside the test, by wrapping `commitUpload`, the post-database install
boundary. Image decoding is stubbed in this unit lane.

**Real services.** In integration case 22, a real filesystem fault occurs after the SQL attach
commits: the test-owned object directory is made read-only.
- The upload returns HTTP 500, the asset row is committed, the file is absent, and the bytes are kept.
- The same request id and the same bytes then return 200 `replayed: true`. The recorded key holds
  the recorded SHA-256, there is one source row, and there is no further draft version.
- Processing, review, publication and a client poster read then succeed, and the guide is withdrawn
  again to restore the fixture state.

The uncertain-RPC path is proven only in the unit lane: a real transport failure after a Postgres
commit was not injected.

**Existing test corrected.** One case in `backend/test/exercise-media-routes.test.js` faked a replay
of an asset that was never recorded and expected HTTP 200, which is the defective behaviour. It now
replays the asset recorded by the first upload and asserts that the file is untouched.

## R2 — crop the saved target frame

**Changed code.** `frontend/src/components/training/media/VideoSelectionEditor.jsx`:
- New lines 10–39: `cropTargetMs`, which returns `poster_frame_ms`, `end_frame_ms`, or the preview's
  selected start, and `seekForFrame`, which pauses, seeks, waits for `seeked` and decoded data, and
  times out after 10 s.
- Lines 75–91: a capture sequence counter, invalidated by a source change or unmount, and the source
  reset.
- Lines 114–165: target-aware `captureFrame`, with the server fallback called with the target's
  saved time, `closeCrop` returning focus to the opener, and `showPositionFrame`.
- Lines 208–218: Show frame is now a read-only position still.
- Lines 263–278: the crop editor renders only for a ready frame of the current target; otherwise it
  shows a loading or recoverable error state, and the target time is labelled.

`ImageCropEditor` crop math and the recipe contracts are unchanged.

**RED → GREEN.** `frontend/e2e/exercise-media-frame-selection.spec.mjs` is now part of
`test:e2e:media`. Its config `testMatch` lists it, and the preview config ignores it. It ran with the
component byte-identical to `335588e`: 0 pass / 9 fail (`raw/r2-red.log`). On the corrected head it
passes 9/9. Cases:
- poster saved at 500 ms, scrubbed to 3000 ms: the crop image equals the 500 ms frame, not the scrub
  frame, and the saved time is unchanged;
- end still at 3500 ms after scrubbing to 1000 ms;
- preview crop at its selected start of 1000 ms after scrubbing to 3500 ms;
- undecodable source: the server fallback requests 500 and 3500, and Show frame requests the scrub
  position (2000) without cropping;
- a slow poster capture does not replace a newer end-still capture, and a source change drops a
  pending capture;
- a 503 from the server shows a recoverable error, and Retry then shows the right frame;
- keyboard scrub, exact-time entry, crop keyboard zoom/move, Done returning focus, no horizontal
  overflow, no autoplay with reduced motion, at 320, 390 and 1280 px.

**Real local path.** In `test:e2e:media:local`, the band-row clip is used with the poster saved at
0.5 s and the end still at 5.0 s, scrubbing to 4.0 s and 1.0 s before each crop. The crop is zoomed
by keyboard, then processed by the real FFmpeg worker. The table shows the mean RGB difference at
64×36 against the generated 640×360 JPEG:

| Output | Coach crop view | Saved-time frame | Scrub-position control |
|---|---|---|---|
| Poster | 0.86 | 0.92 | 6.49 |
| End still | 1.6 | 1.62 | 7.7 |

The tolerance is < 12 and at least 2× below the control. Output hashes are in
`author-matrix/real-frame-selection.json`. The coach sees the same movement phase that is published.

**Paired captures.** `docs/exercise-media/p2-correction/frame-selection/` holds 8 images with
hashes. The before images come from the pinned candidate in the disposable clone
`../p2-before-335588e` at `335588e`, and the after images from `1898549`, at 390×844 and 1280×900:
- before: the crop editor shows the scrub-position frame in 4 of 4;
- after: it shows the saved frame, labelled with its time, in 4 of 4.

This is a functional bug correction with no visual-direction change.

## PR114 compatibility (new disposable composition)

Disposable clone `/Users/jav/Documents/Codex/2026-10-15/task-4/compat-pr114-media-p2-20261016`
(independent files, push `DISABLED-LOCAL-ONLY`). Pinned PR114 `a8a6a4958697c4d2d663ac9cc147a9b1ecc813b3`
was verified, then merged with the corrected media head `15487cffae02fbfa463fdff6783280dbfbecd2fe`:
composition `634f833afe0f3f43e5f216884e4ea125faeaa2f7`, tree
`a6ec973cb4f45548fcdbaa0083e5d55f86efba34`. The earlier composition `2716f7e` was not reused or changed.

**Conflicts and resolutions:**
- `backend/src/routes/programs.js`, `backend/src/routes/workoutLogs.js` and
  `frontend/src/lib/previewMode.js` are unchanged on the media side since `9dc347d`, so they were
  taken byte-for-byte from the earlier reviewed resolution: both features' imports and route blocks,
  and Quick's client allowlist strip plus media hydration.
- `frontend/playwright.config.mjs`: union `testIgnore` (Quick mocked plus the three media lanes).
- `CLAUDE.md`: both status entries kept.

The corrections themselves are in media modules and tests only, with no new overlap.
`git diff a8a6a495 634f833 -- supabase/migrations` shows only the added media migration. The Quick
migration stays SHA-256 `8842d98e…2119` and the media migration `54028175…dc9c`; both apply in order
(latest `20261015213431`).

**Results** (logs: `.exercise-media-local/evidence/p2-correction/compat-matrix/`, clean tested
status, no containers or lock left):

| Command (in the clone) | Result | Earlier composition `2716f7e` |
|---|---|---|
| boundaries frontend / backend | pass / pass | pass / pass |
| `npm --prefix backend test` | 609/609 | 602/602 |
| `npm --prefix frontend run test:unit` | 140/140 | 140/140 |
| `npm --prefix frontend run build` | pass | pass |
| focused R1 / focused R2 | 7/7 / 9/9 | — |
| `bash supabase/tests/exercise_media/run.sh --down` | 4 groups + 5 races | same |
| `bash supabase/tests/quick_sessions/run.sh --all --down` | parity reports identical (26 rows); 71 behavior/grant assertions; 21 race assertions | same |
| `node backend/integration/exercise-media-quick-compat.cjs` | 5/5 executed cases (not the "not applicable" branch) | 5/5 |
| `npm --prefix backend run test:media:integration` | 22/22 | 21/21 |
| `npm --prefix frontend run test:e2e:media` | 16/16 | 7/7 |
| `npm --prefix frontend run test:e2e:media:local` | 5/5 | 4/4 |
| `node node_modules/@playwright/test/cli.js test --config playwright.quick-sessions.config.mjs` | 30/30 | 30/30 |
| `npm --prefix frontend run test:e2e:preview` | 106 passed, 8 skipped | 106 / 8 |

The Quick×media cases cover:
- Quick create, replay, mismatch and recovery are unchanged;
- start keeps provenance with live media;
- a started Quick prescription stays frozen (409 `quick_session_started`) while the guide changes;
- the receipt row and request hash stay byte-stable across media replacement, as does the started
  log snapshot;
- save-to-library and ordinary assignment keep working.

This is local compatibility evidence only. It conveys no Quick release approval and does not change
PR114.

## Numbered judgment calls

1. **C1** The R1 fault is injected by a test-only wrapper around `commitUpload`, the existing install
   boundary, so the same test runs against the pinned and the corrected code. There is no
   production switch.
2. **C2** `commitUpload` was hardened in place (verify size and hash, hard link that never
   overwrites, remove the staged copy last) rather than adding a parallel method. Existing callers
   keep working. The cost is one extra file read per source install.
3. **C3** An attach RPC that throws is treated as an unknown outcome. The recorded row decides: if
   found, the service finishes and returns 201. If absent or unreadable, the bytes are kept and the
   original error is returned (500). Bounds: an uncommitted part is swept after the 1 h age, and a
   committed one is installed by recovery or by a retry.
4. **C4** Replay finalization prefers the original staged copy. Otherwise it re-files the retry's
   identical bytes under the recorded asset id, never overwriting, so recovery can still find them.
5. **C5** A present object that does not match the recorded size or hash is never overwritten. The
   install fails with `stored_source_mismatch`.
6. **C6** The replay case in `exercise-media-routes.test.js` was corrected, because it encoded the
   defective false success.
7. **C7** The preview crop uses the segment's selected start as its representative frame, because
   the processor applies one rectangle to the whole segment. The panel labels it.
8. **C8** Capturing moves the paused source player to the target time, so the coach sees the exact
   frame being cropped. No saved selection changes.
9. **C9** On undecodable sources, "Show frame" now previews the scrub position as a read-only still,
   and crops always request the target's saved time.
10. **C10** A source change resets the undecodable flag and invalidates captures. The earlier
    expired-link refresh budget still bounds retries.
11. **C11** The browser regression mounts the real component in a test-only Vite harness page that is
    never built. It uses a committed copy of the project's own synthetic clip (SHA-256
    `e78d5b71…`, 36,367 B), so the mocked lane needs no Docker.
12. **C12** Done returns focus to the button that opened the crop, a small accessibility correction
    inside the corrected flow.
13. **C13** The new integration case withdraws its guide at the end, because a later case relies on
    "Wall Sit" having no media.
14. **C14** The paired before images were rendered from a disposable clone at `335588e`, with the
    test-only harness copied in (untracked) and `node_modules` copied rather than shared, to avoid a
    shared Vite cache.
15. **C15** The composition reused the earlier byte-identical resolutions for the three route and
    preview files, and resolved `playwright.config.mjs` (union) and `CLAUDE.md` (both entries) anew.

## Local demo (unchanged)

```bash
npm --prefix backend run dev:media-local
```

Open `http://127.0.0.1:42771/__media-demo`. To stop it:

```bash
npm --prefix backend run dev:media-local:down
```

To resume, run `dev:media-local` again (fresh synthetic reset). The demo takes the host lock
`~/.cvfpt/disposable-db.lock`.

## Final state

Verified before the documentation commits and again after the last commit (see the final message):
- **Author checkout:** clean tracked tree. Intentional generated artifacts sit only in gitignored
  `.exercise-media-local/` (evidence, fixtures, run data) and the gitignored Playwright result
  folders.
- **Owned stacks:** `cvfpt-media-test` and `cvfpt-quick-sessions-test` are torn down with no `cvfpt`
  container left, `~/.cvfpt/disposable-db.lock` is released, and no task-owned listener or launcher
  process remains.
- **Unrelated process:** a Vite server on port 4640 (`vite.proto.config.mjs`) that is not from this
  task was left untouched.
- **Disposable clones under the task folder, kept as evidence:**
  - `p2-before-335588e`, detached at `335588e`, with only the copied test harness untracked;
  - `compat-pr114-media-p2-20261016` at `634f833`, clean.
- **Unchanged and not edited:**
  - the frozen review clone `exercise-media-review-20261016T0103` (at `335588e`, clean);
  - the review output folder;
  - the earlier composition `compat-pr114-media-20261015` (at `2716f7e`, clean);
  - the planning files;
  - PR114, the old main checkout and any Quick checkout.
- **Secrets:** none recorded anywhere. Logs carry only redacted error names and codes, and the
  manifest has no credentials, capabilities, signed links or client records.
- **External actions:** none.

## Remaining gates and review debt (not changed by this correction)

- Production private storage, upload transport, worker placement, cost, retention and purge (Gate 2).
- The owner's visual footprint choice (compact or Larger) and cold visibility.
- Coach review of real exercise instruction, variants, rights, captions and alt text.
- Safari/iOS playback.
- Migration reconciliation after Quick Sessions, and hosted release authority.
- Review debt still deferred and not fixed or independently approved here:
  - poster-mode crop revalidation through the API;
  - free-text `video_url` from import commit (render-safe);
  - the synchronous cached Docker availability check;
  - editor polling that stops after 5 minutes;
  - fast-start enforcement in the worker;
  - preview pause on active-exercise change;
  - link-cache eviction;
  - `FOR UPDATE` versus `FOR NO KEY UPDATE` on publish;
  - invalid-range handling;
  - frame-preview work-dir collisions;
  - a mocked spec title;
  - the design doc's lock-order wording;
  - the Quick and import `video_url` composition follow-up.
