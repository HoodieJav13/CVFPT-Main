# RETURN — exercise media residual R2: crop selection validity (local, 2026-10-16)

```text
Completion state:      COMPLETE-LOCAL
Protocol version:      v1.1
Baseline SHA:          correction baseline c64d17cb9596a700515d17f9c514ca9f1dab5060 (tree d476d551ea60e295bda0f99375c0fe693f086446);
                       released baseline 8d68a7893f7a84a658ff6545bb0b2b70a0df91ce
Head SHA:              tested functional head c4229d877180bb78554150186bef9696ff4910d9 (tree 894f7444afded5ae824a97e91b7718504d09bd6f);
                       later commits are documentation only (proof below); `git rev-parse HEAD` gives the tip
Branch and upstream:   claude/exercise-media-local-20261015 -> NOT PUSHED (no upstream; push URL DISABLED-LOCAL-ONLY kept)
Authority used:        CVFPT-R2-CROP-SELECTION-FOLLOWUP-20261016.md (ROLE: EXECUTOR, DIAL: EXECUTE, local follow-up
                       only): inspect; fix the residual R2 crop-validity bug in VideoSelectionEditor; focused
                       test/harness changes; synthetic fixtures; owned loopback tests and headless captures; disposable
                       clones under the task folder; docs; scoped local commits after checks.
Commits:               5 follow-up commits after c64d17c (listed below)
Files changed:         see "Footprint"
Migrations/deps:       none. No backend, schema, migration, dependency or lockfile change. Media migration SHA-256 stays
                       54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c.
Checks passed:         frame-selection spec 18/18 (RED 8 new cases failing on c64d17c; 3 repeat GREEN runs);
                       contract; boundaries 2/2; backend 584/584; frontend unit 103/103; build; test:e2e:media 25/25;
                       test:e2e:media:local 6/6; preview 86 passed / 8 skipped; integration 22/22 (first attempt);
                       workout-UX 25/25; composition subset (below).
Checks failed/not run: test:e2e:live and hosted checks — not-applicable (not authorized). Safari/WebKit — unavailable.
                       SQL suites — not-applicable (no SQL, migration or backend behavior changed). In the composition,
                       Quick SQL/backend/preview were not rerun (frontend-only delta; evidence boundary disclosed). The
                       8 skipped preview tests are credential-gated live-auth specs (baseline-unrelated).
External actions:      none (no push, PR, CI, deploy, hosted access, credentials, purchases or messages)
Known gaps:            independent acceptance of this follow-up is a later review; production storage/worker/cost/
                       retention, owner visual direction/cold visibility, real coach instruction/variant/rights review
                       and Safari/iOS remain gates; other documented review debt unchanged (listed below).
Push/deploy state:     all local: this checkout plus disposable clones ../r2-before-c64d17c and
                       ../compat-pr114-media-r2f-20261016; nothing pushed, published or deployed.
```

**Scope.** This packet addresses only the residual R2 defect the independent review of `c64d17c`
reproduced: an open crop stayed editable on its old frame after the target's saved time changed.
**R1 remains independently verified and is untouched.** Its backend service, store and worker files,
its tests, and its commit-ordering and retry guarantees are unchanged in this follow-up. The previous
handoff is preserved unchanged at
`docs/exercise-media/p2-correction/history-2026-10-16-c64d17c/RETURN.md` (SHA-256
`c1fe43ab305105bb07194cbb8305492f8e741cc146adc78fce6f49f4a1536990`) with its manifest
(`cc290f60ced575aa17061ca95eb2ee772df0fc81061c3c5ca5186e6c3047224d`), matching the review's
recorded hashes. The original candidate packet stays under `p2-correction/candidate-335588e/`.

## Starting identity (directly verified before edits)

Folder `/Users/jav/Documents/Codex/2026-10-15/task-4/cvfpt-exercise-media-build-20261015`, branch
`claude/exercise-media-local-20261015`, clean, no upstream, HEAD `c64d17cb…`, tree `d476d551…`, fetch
origin `https://github.com/HoodieJav13/CVFPT-Main.git`, push `DISABLED-LOCAL-ONLY`, contract
validator v1.1. Read: the independent `REVIEW.md` and `recipe-change-probe.{mjs,json}`, the
repository instructions and the current packet. The frozen review clone
`exercise-media-p2-review-20261016T0214`, the saved composition `634f833`, earlier clones and any
Quick checkout were not edited.

## Commits

```text
c17f4a6 Tie an open crop to its current saved frame selection                      (functional fix + regressions)
7627fba Prove the selection-change fix through the real local services             (real-local test)
c4229d8 Add paired before/after evidence for the crop selection-change fix         (evidence)
7aa207a Record the residual R2 crop selection-change fix in docs and status        (documentation only)
<return> Return packet and manifest for the residual R2 follow-up                   (documentation only)
```

The last commit's ID cannot appear in its own file. `git log --oneline c4229d8..HEAD` lists the two
documentation commits, and `git diff --name-only c4229d8 HEAD` shows only `CLAUDE.md`, `RETURN.md`,
`exercise-media-return-manifest.json`, `docs/exercise-media/{design,local-runbook,validation}.md` and
the two preserved files under `docs/exercise-media/p2-correction/history-2026-10-16-c64d17c/`.

## Footprint

- **`c64d17c` → tested head `c4229d8`:** 27 files, +931 / −16 (23 added, 4 modified).
  - Production code: one file, `frontend/src/components/training/media/VideoSelectionEditor.jsx`
    (+48 / −14).
  - Tests: `frontend/e2e/exercise-media-frame-selection.spec.mjs` (+165 / −1),
    `frontend/e2e/exercise-media-local.spec.mjs` (+58), and
    `frontend/e2e/harness/video-selection-harness.js` (+2 / −1, test-only `patchRecipe`).
  - Evidence tooling: `frontend/e2e/exercise-media-r2-selection.capture.mjs` and
    `frontend/playwright.exercise-media-r2-selection.config.mjs`.
  - Evidence: `docs/exercise-media/p2-correction/selection-change/` (README, index.html, records,
    18 PNGs).
- **Documentation commits after `c4229d8`:** 8 files. From `c64d17c` to the tip that makes 35 files
  (25 added, 10 modified).
- **Released baseline `8d68a78` → tip:** 189 files (172 added, 17 modified). The 19 feature commits and
  6 P2 correction commits before `c64d17c` are not part of this follow-up.

## The fix (`VideoSelectionEditor.jsx`, `git diff c64d17c c4229d8`)

- **Lines 92–100.** The open target's current saved time is
  `cropTargetMs(cropTarget, recipe)`, which is null when the target is cleared or the poster is not in
  video-frame mode. A capture is current only if its `{target, ms, source}` matches
  `{cropTarget, selectedMs, src}`. A latest-selection ref is refreshed every render.
- **Lines 122–129 and 146–148.** Every capture records its source, and a recapture keeps the original
  opener for focus return.
- **Lines 152–168.** When the open target's saved time differs from its capture, the capture
  generation is bumped, so pending success or failure responses are dropped. The new time is then
  recaptured, or the crop closes when there is nothing to crop.
- **Lines 191–199.** `readyFrame` requires the current selection. `writeCrop` re-checks the
  latest-selection ref before calling `onChange`, so a stale closure cannot write.
- **Lines 294–311.** The panel renders only while a saved time exists. It labels the current saved
  time, and shows a loading or error state unless the frame is current and ready.

Unchanged: preview's representative frame is still its selected start, and poster and end still
still target their saved times. Ordinary scrubbing, crop moves and zooms, and unrelated alt or cue
changes never invalidate the crop. Source changes, close and unmount still invalidate as before.
There is no autoplay and no new playback design. Recipes are not rewritten, and backend
version/CAS semantics are untouched.

## RED → GREEN

`frontend/e2e/exercise-media-frame-selection.spec.mjs` is part of `test:e2e:media` through its
config's `testMatch`, which lists both media specs. Eight new cases run on the real component with
labelled synthetic moving geometry:
- poster time 500 → 3000 ms, end still 3500 → 1500 ms and preview start 1000 → 2000 ms, each changed
  with a ready crop open. Each asserts that right after the commit the old image is not editable, that
  the label shows the new time, that the shown image equals a fresh decode of the new frame and not
  the old one, and that keyboard crop edits write to the unchanged new time;
- a browser capture still pending when the time changes;
- a server-fallback capture changed away and back while pending: the request sequence is
  `[500, 3000, 500]`, and only the fresh GREEN frame shows, never the obsolete RED response;
- a late server failure for the old time never replaces the new frame;
- clear end still, clear preview and switching the poster to an uploaded image each close the crop;
- a pending capture for a cleared end still cannot reopen the crop;
- a positive control: crop zoom and move, focus kept, unrelated alt/cue changes and unrelated
  scrubbing all keep the open crop and its saved frame.

With the component byte-identical to `c64d17c`, the run gave 10 passed / 8 failed: every new defect
case failed, while the positive control and the 9 earlier cases passed
(`.exercise-media-local/evidence/r2-followup/raw/red.log`). After the fix: 18/18, and three repeated
runs were also 18/18 (`raw/green*.log`).

## Real local path and generated output

`test:e2e:media:local` (now 6 tests) adds this case:
1. On "Synthetic Shuttle Walk", upload the band-row clip.
2. Open the poster crop at the saved 0.5 s.
3. With the crop still open, change the saved time to 3.5 s. The crop reloads that frame (a
   different image, labelled 0:03.5).
4. Keyboard-crop, save, process with the real FFmpeg worker, and publish.

Mean RGB difference at 64×36 against the generated 640×360 JPEG:

| Compared with | Difference |
|---|---|
| Coach crop view | **1.63** |
| New 3.5 s frame | **1.63** |
| Old 0.5 s phase (negative control) | **13.36** |

Tolerance: below 12 and at least 2× below the control. Data:
`r2-followup/author-matrix/real-selection-change.json`. The earlier saved-frame case still passes,
with poster 0.86 / 0.92 / 6.49 and end still 1.6 / 1.62 / 7.7.

## Paired before/after captures

[`docs/exercise-media/p2-correction/selection-change/index.html`](docs/exercise-media/p2-correction/selection-change/index.html)
shows the same harness sequence at 320×740, 390×844 and 1280×900 (18 images; hashes and source
identities in `capture-records.json`). The page was headless-render-checked at 390 and 1280 and in
dark mode: all images load, no overflow, no errors. The sequence is: crop open at 0.5 s, saved time
changed to 3.0 s, then a keyboard crop edit.
- **Before** (`c64d17c`, disposable clone `../r2-before-c64d17c`): the crop still shows the old 0.5 s
  frame labelled 0:00.5 while the recipe holds 3000 ms, and the keyboard edit writes into it. This
  happens at all 3 viewports.
- **After** (`7627fba`): the crop shows the new 3.0 s frame labelled 0:03.0, and the edit applies to
  it, at all 3 viewports.

There is no horizontal overflow in any capture. This is a functional bug proof, not a
visual-direction change.

## Test commands, results and tested source

Author matrix on clean `c4229d8` / tree `894f7444`. Logs are in
`.exercise-media-local/evidence/r2-followup/author-matrix/`, and every exit code is 0.

| Command | Result |
|---|---|
| `npx playwright test --config playwright.exercise-media.config.mjs e2e/exercise-media-frame-selection.spec.mjs` (frontend) | 18/18 |
| `bash .agentic/validate-contract-version.sh .` | v1.1 |
| `bash scripts/check-boundaries.sh frontend` / `backend` | pass / pass |
| `npm --prefix backend test` | 584/584 (includes R1 7/7) |
| `npm --prefix frontend run test:unit` | 103/103 |
| `npm --prefix frontend run build` | pass (harness not in `dist`) |
| `npm --prefix frontend run test:e2e:media` | 25/25 (7 mocked + 18 frame selection) |
| `npm --prefix frontend run test:e2e:media:local` | 6/6 |
| `npm --prefix frontend run test:e2e:preview` | 86 passed, 8 skipped |
| `npm --prefix backend run test:media:integration` | 22/22 on the first attempt; query counts 9 = 9 |
| `node node_modules/@playwright/test/cli.js test --config playwright.workout-ux.config.mjs` (frontend) | 25/25 |

The review's integration qualification is preserved. Its first run once stopped at the unchanged
batched-hydration query-count equality (10 against 9) before a clean rerun passed, and worker
interference with the shared counter is inferred, not proven. Here no rerun was needed, and the
assertion was not edited or relaxed.

## PR114 compatibility (subset)

A new disposable clone, `/Users/jav/Documents/Codex/2026-10-15/task-4/compat-pr114-media-r2f-20261016`,
with push `DISABLED-LOCAL-ONLY`, starts at the saved composition
`634f833afe0f3f43e5f216884e4ea125faeaa2f7`, which itself stays unchanged.
- **Applied:** only this follow-up's runtime and test delta (`git diff c64d17c c4229d8` of
  `VideoSelectionEditor.jsx`, the frame-selection spec, the harness and the real-local spec; all four
  files are byte-identical to the author's).
- **Result:** `990a42b1bd0b51fd08d7408df53eedbb6dba88f6`, tree
  `7d6741c09873bcce0e94c02eaaf8af04d9486dd5`, parent `634f833…`.
- **Migrations unchanged:** Quick `8842d98ed4dec4abe57000240c2952712f220018d8af785ba0001938376e2119`
  and media `54028175…dc9c`.

| Lane (logs `r2-followup/compat-matrix/`) | Result |
|---|---|
| frontend unit | 140/140 |
| build | pass |
| frame selection | 18/18 |
| `test:e2e:media` | 25/25 |
| real-local | 6/6 |
| Quick mocked (`playwright.quick-sessions.config.mjs`) | 30/30 |

Quick SQL, backend and preview were not rerun, because the delta is frontend component and test code
only. This evidence boundary is disclosed, and the `634f833` results stand for those lanes. This is
no Quick release approval.

## Numbered decisions

1. **F1** When the open target's saved time changes, the crop recaptures the new frame rather than
   closing, so the coach stays in the flow and the right frame loads under a new generation. A
   cleared target, or a poster leaving video-frame mode, closes the crop because there is nothing to
   crop.
2. **F2** Validity is `{source URL, target, saved time}`. Draft identity is carried by the source
   URL, a capability link per revision context, so `ExerciseMediaEditor.jsx` needed no change and no
   API was added.
3. **F3** Crop writes re-check a latest-selection ref, so a stale closure (for example a drag in
   flight) cannot write into a new selection before effects run. Rendering is checked separately.
4. **F4** A recapture keeps the original opener, so Done still returns focus to the Crop button.
5. **F5** The harness gains a test-only `patchRecipe` to stage changes made outside the editor
   (poster mode, alt text, cues). It is never part of a build.
6. **F6** The decodable "pending browser capture" case changes the time right after Crop without
   awaiting the seek. Deterministic pending coverage uses the delayed server fallback.
7. **F7** The new real-local case uses "Synthetic Shuttle Walk", so the original Wall Sit saved-frame
   case stays as it was.
8. **F8** The paired "before" images come from a disposable clone at `c64d17c`, whose harness already
   existed there, with copied `node_modules`.
9. **F9** The composition starts from the saved `634f833` and applies the scoped delta as a patch
   (SHA-256 `ec7f6b13e7c9a85f18fa84be0807ee8cc35dbf2bc30a7bca53200fb67a89a406`) instead of a new merge,
   which keeps both features and all Quick code byte-identical.

## Local demo (unchanged)

```bash
npm --prefix backend run dev:media-local
```

Open `http://127.0.0.1:42771/__media-demo`. To stop it:

```bash
npm --prefix backend run dev:media-local:down
```

To resume, run `dev:media-local` again (fresh synthetic reset; uses `~/.cvfpt/disposable-db.lock`).

## Final state

Verified after the matrices and again after the last commit (see the final message):
- **Author checkout:** clean tracked tree. Generated artifacts live only in gitignored
  `.exercise-media-local/` and the Playwright result folders.
- **Owned stacks:** no `cvfpt` container and no lock remain, and no task-owned listener or launcher
  process.
- **Disposable clones under the task folder:**
  - `r2-before-c64d17c`, detached at `c64d17c`, clean;
  - `compat-pr114-media-r2f-20261016` at `990a42b`, clean.
- **Not edited:**
  - the review folders and the frozen review clone;
  - the saved compositions `634f833` and `2716f7e`;
  - the earlier before-clone;
  - the planning files, PR114 and any Quick checkout.
- **Secrets:** none recorded.
- **External actions:** none.

## Remaining gates and review debt (unchanged)

Production storage, transport, worker, cost, retention and purge; the owner's visual footprint
choice and cold visibility; coach review of real instruction, variants, rights, captions and alt
text; Safari/iOS; and migration reconciliation after Quick plus hosted release authority. The
deferred review debt is unchanged and not fixed here:
- poster-mode crop revalidation through the API;
- import `video_url`;
- the synchronous Docker check;
- finite editor polling;
- fast-start enforcement;
- preview pause on exercise change;
- link-cache eviction;
- small races;
- the design doc's lock-order wording;
- isolating the query-count measurement from the background worker;
- the Quick/import `video_url` composition follow-up.

Independent acceptance of this follow-up remains a later review.
