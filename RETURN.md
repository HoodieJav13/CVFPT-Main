# RETURN — Photo + YouTube exercise guides (local build, 2026-10-16)

```text
Completion state:      COMPLETE-LOCAL
Protocol version:      v1.1
Baseline SHA:          f3c063c4997b1ad49a1e7ceca5107ee6aae3c1dd (tree 90df1beaabf6222874075844b482635972f35a74)
Head SHA:              the return commit (adds only RETURN.md and the manifest) on top of
                       40c2a20840529a268fb20fd12976a582af242527 (tree 1a42cc388f86ff85d462244e5d000f30d32fc5b6)
Reviewed/tested code:  functional head 49d30a64c4548e113a1eeb595055740af1dbd36e; final sweep at 88b2d7a
                       (same product code); later commits are evidence/docs/return only
Branch and upstream:   claude/youtube-exercise-guides-20261016 -> none; NOT PUSHED (push URL DISABLED-LOCAL-ONLY)
Authority used:        the owner's starter (CVFPT-YOUTUBE-GUIDES-CLAUDE-STARTER-20261016.md): local edits,
                       scoped dependency install, loopback apps, synthetic tests, an additive unapplied local
                       migration, owned disposable DB stacks under the canonical lock, UI refinement/captures,
                       scoped local commits, one fresh independent review, return files
Commits:               16 before the return commit (listed below)
Files changed:         171 files, +11,719 / -166 (84 are PNG captures; 87 non-image files);
                       full list in return/evidence/footprint/
Migrations/deps:       NEW local unapplied 20261016170000_exercise_guides_photo_youtube.sql
                       (SHA-256 69ec99a0049d68f05dffff3ec6f37a7d9c6055d78819e83db3d80f15f52ba0ae);
                       media migration unchanged (54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c);
                       all 43 released migrations byte-identical; backend: + sharp 0.35.5 (exact),
                       engines node >=20.9.0; frontend dependencies unchanged
Checks passed:         final sweep, all 18 checks exit 0 (counts in the table below); independent review:
                       "With fixes", 0 Critical; 2 Important + 1 re-graded Minor fixed RED->GREEN
Checks failed/not run: 8 live-auth preview specs skipped (unavailable: CVF_E2E_* credentials);
                       physical iPhone/Android/Safari/Firefox (unavailable); hosted adapter/migrations
                       (not-applicable: forbidden); no final check failed
External actions:      npm registry reads (sharp install, npm audit); docker pull node:24-bookworm-slim;
                       headless real-provider proof against YouTube with a public documentation sample
                       and a synthetic missing id (no app data, cookies or tokens). No push, PR, CI,
                       deploy, hosted DB/storage access, provisioning, credentials, uploads or messages
Known gaps:            hosted gates, real devices, owner visual/content acceptance, deferred minors (below)
Push/deploy state:     local commits only in this checkout; nothing pushed, published or deployed
```

## What was built

The approved direction (SPEC, 2026-10-16) is one coach-to-workout guide
workflow:

- **Photo guide.** An owned or permissioned photo plus up to three cues
  appears inside the workout.
- **Full demo.** The full general demo is a pasted YouTube link (from CVF's
  own channel), played on request.
- **No video required.** No exercise needs a video for the feature to be
  useful.

Contracts and limits are in `docs/exercise-guides/design.md`.

### Milestones

- **M1 — references and parsing (`65fa80c`):**
  - strict YouTube single-video parsing, duplicated in both deploy roots with
    parity vectors, plus a DemoDTO on reads;
  - nullable `workout_exercises.video_link_mode`: `inherit` (follows the
    library live, stores no URL), `override` (explicit URL), and NULL legacy
    (old precedence, no backfill, never inferred from URL equality);
  - server validation of new-shape writes; old request shapes pass unchanged;
  - four writers replaced, each copied verbatim from its latest definition
    with minimal edits;
  - Program Draft modes in both copies;
  - **Quick create stays exactly v1:** browser projection before the body is
    frozen, golden hashes pinned, committed replay passing on both baseline
    and head, modes derived for fresh rows only;
  - the coach `DemoLinkField` (library demo / custom / legacy label);
  - preview fixtures.
- **M2 — photo pipeline without a video worker (`81d7f90`):**
  - `ImageOnlyProcessor` (sharp 0.35.5 / libvips 8.18.7): strict full decode,
    32 MP limit, orientation-correct crop, a 640×360 JPEG ≤ 160 KiB, one decode
    at a time with a queue of 4, 10 s / 15 s deadlines;
  - direct-upload transport: a durable intent before any grant, an app-issued
    `staging/<uuid>` key, a signed loopback PUT or Supabase signed upload, and
    an authoritative finalize through the accepted attach path;
  - inline leased processing with resume;
  - `photos` default and explicit `full` mode;
  - a Supabase private-image adapter, contract-tested against a fake only and
    never activated;
  - a content-route stream fix.
- **M3 — click-to-load demos (`0aaff11`):**
  - `ExerciseDemoDialog` and `youtubePlayer.js`: a first-party facade, zero
    provider requests before Play, one fixed-origin nocookie iframe,
    origin-only referrer, at least 200×200, one active player, teardown on
    close or switch, error copy, and Open on YouTube throughout;
  - used in the tracker, workout history ("Current demo") and the plan view;
  - an optional local still-from-clip selector that uploads only the chosen
    image.
- **M4 — refinement from paired captures:**
  - fixed test-first: focus after Play (`afca7f8`); action
    alignment/type, pill touch target and editor overflow (`24906c8`);
    expired-photo fallback (`485f472`); calm error state, honest copy,
    history pairing and short-window cap (`0aa35f3`); still confirmation copy
    (`e80d0c9`);
  - paired evidence (`fb5d06e`, refreshed in `f6b89eb`).
- **Independent-review fix pass:**
  - duplicated legacy-link rows stay saveable (`11b372e`);
  - in-flight still exports cannot land late or leak (`d7b65fc`);
  - every saveable external link resolves, and embedding stays strict
    (`49d30a6`).

### Commits

```text
65fa80c Add explicit inherit/override demo references and strict YouTube parsing
81d7f90 Add the photo pipeline without a video worker: image processor, upload transport, inline leased processing
0aaff11 Add click-to-load YouTube demos and optional local still selection
afca7f8 Move focus to the demo player region after Play                         (functional)
24906c8 Refine guide actions and the still option at phone widths              (visual)
485f472 Fall back to the exercise name when a demo dialog photo fails          (functional)
0aa35f3 Calm the demo player failure states and fit short windows              (visual/content)
e80d0c9 Point the still confirmation to the upload above it                    (content)
fb5d06e Record paired before/after captures for exercise guides                (evidence)
6b2118c Document Photo + YouTube guides: design, runbook, gates, test matrix   (docs)
11b372e Keep duplicated legacy-link rows saveable with the same demo           (functional, review)
d7b65fc Drop a still export that finishes after its clip or selector is gone   (functional, review)
49d30a6 Resolve every saveable external link; keep strictness for embeds       (functional, review)
88b2d7a Correct guides docs after the independent review                       (docs)
f6b89eb Refresh guides captures at the final code head; settle card framing    (evidence/tooling)
40c2a20 Record the independent review, fix pass and final verification         (docs)
```

## Verification (final sweep at `88b2d7a`, host Node v26.7.0, Chromium headless shell 149.0.7827.55)

| Check | Result |
|---|---|
| Backend unit/route (`npm --prefix backend test`) | 674/674 |
| Frontend units | 162/162 |
| Deploy boundaries (backend, frontend) / production build | clean / built |
| Guides mocked browser / media mocked / Quick mocked | 22/22 / 25/25 / 30/30 |
| Full preview | 107 passed, 8 live-auth skips, 0 failed |
| Media SQL + grants + races | 6 groups + 5 committed races |
| Quick SQL `--all` | PASS; pre/post parity identical (26 rows); grants, behavior and races |
| Guides real local API (photos, no worker) / full owned-video real API / Quick×media | 14/14 / 22/22 / 5/5 |
| Guides real local browser / full media real local browser | 3/3 / 6/6 |
| Real-provider proof, sample `M7lc1UVf-VE` | 0 requests before Play; `ready`; nocookie embed; origin-only referrer |
| Real-provider proof, synthetic missing id | 0 requests before Play; real error 150 |

- **Earlier sweep.** An identical sweep at the pre-review head `fb5d06e`
  also passed all 18 checks.
- **Baseline.** At `f3c063c`, backend 611/611 and units 140/140.
- **Linux Node 24.22.** On `node:24-bookworm-slim`, arm64 and amd64, the
  photo tests passed 30/30 during M2. The dependency bytes are unchanged
  since.
- **Audit.** `npm audit` (backend) found 0 vulnerabilities.
- **RED evidence.** Failure-first receipts for every milestone and for each
  review fix are listed in `docs/exercise-guides/TEST-MATRIX.md`. Raw logs
  are in `return/evidence/logs/`.
- **Visual evidence.** `docs/exercise-guides/visual-review/` holds 84 paired
  captures at 320, 390 and 1440 px:
  - SHA-256 hashes are re-verified by the generator, with zero unmocked
    requests and zero provider requests before Play;
  - the tracker layout does not shift;
  - two consecutive runs were 79/84 byte-identical (the rest differ only
    inside decoded media or a 1-pixel focus-ring row);
  - the rendered comparison page passed a headless check.

## Independent review

A fresh-context Opus reviewer did a static, read-only review of
`f3c063c..fb5d06e`; it ran no tests. The verdict was "With fixes", with no
Critical findings. The full report and the resolution table are in
`docs/exercise-guides/INDEPENDENT-REVIEW.md`.

**Fixed, each RED→GREEN, then a full re-sweep:**

1. *Important.* Duplicating a legacy-link row made the whole workout save
   fail with 400. A copy now takes the explicit mode that keeps its demo, and
   save flags any new unclassified row (`11b372e`).
2. *Important.* A still export in flight could be delivered after the clip
   changed or the selector closed, and its blob URL leaked. A generation guard
   now drops stale exports, and the controls are disabled while exporting
   (`d7b65fc`).
3. *Minor, re-graded to Important by effect.* Legacy links containing a raw
   space or quote, which the released tracker rendered, would silently
   disappear, and saveable custom links could resolve to nothing. External
   links now use the released rule; only embedding stays strict (`49d30a6`).
4. Docs: the backend **reads** `video_link_mode`, so the migration must land
   before the backend deploys. A rolling-deploy note was added (`88b2d7a`).

## Rulings and judgment calls

1. **Image deadlines.** The 15 s total deadline covers waiting plus
   processing. A timed-out decode keeps its slot until it settles, so decodes
   never overlap.
   - Cost if wrong: a job near the deadline fails retryably.
2. **Content-route stream fix.** I fixed a pre-existing content-route stream
   leak found by the real-browser lane: an aborted request stranded a
   FileHandle, which is fatal on Node 26. The fix uses `stream.pipeline`, has
   a regression test, and leaves authorization unchanged.
3. **Focus after Play.** Focus goes to a labelled player region in the app
   document, not the iframe: focusing the cross-origin iframe swallowed
   Escape.
   - Cost if wrong: one extra Tab to reach the player controls.
4. **No new visual direction.** The demo action reuses the released External
   video slot and type, and the dialog reuses the accepted instruction-dialog
   pattern. No bold probe was made; owner acceptance remains a gate.
5. **Crop seeding.** `editableForm` seeds the displayed default 16:9 crop for
   an uploaded image with no saved crop, so Save stores what is shown. The
   real-local photo flow otherwise failed with `poster_crop_required`.
6. **Calm error panel.** The embed-error panel moved from destructive red to
   the accepted calm neutral pattern. The evidence is the paired capture;
   there is no automated style assertion.
7. **History test written after wiring.** The history "Current demo" browser
   test was written after its wiring, so it is characterization coverage.
8. **Upload recovery is per tab.** There is no cross-session pending-upload
   list: recovery is in-tab retry/cancel plus server idempotency.
9. **Seed ids.** The pre-existing preview fixtures use third-party public
   YouTube ids and are unchanged here; replace them before release. The new
   seeds use synthetic `SYNTHdemo01/02`.
10. **Adjusted tests (intentional changes):**
    - `backend/test/tracker-exercise-videos.test.js` pins (select string,
      tracker source);
    - `supabase/tests/exercise_media/04_grants.sql` (new table, function
      count 29);
    - the `preview-critical` tracker demo test;
    - the `exercise-media-preview` switch-off test;
    - the full-mode real-browser config now passes `--full`.
11. **Linux validation.** Linux Node 24 was validated in a pulled
    `node:24-bookworm-slim` image. Docker was never started, restarted or
    reset.
12. **Visual baseline.** The baseline was rendered from a disposable local
    clone of `f3c063c` in the session scratchpad. The frontend lockfiles are
    identical, and its `node_modules` was an APFS clone. The capture tooling's
    framing fix was uncommitted at final capture time (recorded in the
    manifest) and was then committed in `f6b89eb`.
13. **Quick and ClientDetail.** The Quick builder gained the demo field under
    More. Quick request/recovery/receipt code, ClientDetail and Quick
    normalization are unchanged apart from the fresh-row mode derivation in
    `create_quick_session`.
14. **CSV import.** An import that creates a new library exercise from a row
    URL keeps that row as an override, as the plan specifies.
    - Cost if wrong: those imported rows do not follow later library
      replacements.
15. **Reviewer's declined-to-judge items.** Each stands as a labelled gate or
    gap. `cc_load_policy=1` is kept per the plan's captions preference
    (viewers can turn captions off). The rolling-deploy reclassification is
    documented.
16. **Review timing.** The review ran in parallel with the first sweep and
    was told not to execute anything.

## Deferred minors (from the review, not fixed)

- Retyping or re-picking the same exercise drops a custom or legacy link.
  This is pre-existing behavior.
- A staging 409 is treated as success, so finalize attaches the previously
  staged bytes of the same request.
- The Supabase adapter downloads the whole object before checking its size,
  and again for every Range request. This is a hosted gate.
- Abandon does not return `attached` when the intent's asset exists. This is
  reachable through the API only.
- The staging PUT does not bind the content type to the grant; finalize
  re-checks the bytes.
- `uploadIntentsFor` is unused, and there is no cross-tab resume of pending
  intents.
- Finalize has no rate limiter; the coach-only route and bounded queue limit
  the impact.
- The content route's `req.destroyed` check is fragile if middleware ever
  consumes a GET body.
- The ClientDetail copy-editor save lacks the client-side `demoProblem`
  check; the server still rejects with a message.
- The IFrame API script tag is left behind after a timeout, and
  `processor_busy` shows the generic resume copy.

## Local launch recipes

Both recipes are owned, loopback-only and synthetic. Details are in
`docs/exercise-guides/local-runbook.md`.

**1. Photo + YouTube guides (default).** No worker or processor image.

```bash
npm --prefix backend run dev:media-local
```

Open `http://127.0.0.1:42771/__media-demo` and pick a fictional account.

**2. Preserved full owned-video regression.** This uses the FFmpeg worker
and needs the pinned image.

```bash
npm --prefix backend run dev:media-local:full
```

**Teardown and ownership:**

- `Ctrl+C` stops what the launcher started; `npm --prefix backend run
  dev:media-local:down` stops one left running elsewhere (pid-checked,
  label-scoped).
- Everything runs under the canonical lock `~/.cvfpt/disposable-db.lock`,
  which is never broken automatically.
- **Teardown proof** after the final sweep: the lock was released, and there
  were 0 `cvfpt` containers, 0 volumes and 0 owned ports listening
  (`evidence/logs/final2/teardown-proof.log`).

## Gates that remain

Each needs separate owner authorization (`docs/exercise-guides/hosted-gates.md`):

1. **SQL.** Exact application to Development, then Production. The new
   migration depends on the still-unapplied media migration. Reconcile with
   current `main` and the Quick repair `507d23d`, re-derive
   `create_quick_session`, and satisfy both migration labels. The backend
   reads the new column, so the migration must land before the backend
   deploys.
2. **Private photo store.** A new private Supabase media bucket, created and
   keyed by the owner, with limits, flags, rollback and a real-role
   integration run. The adapter is not activated.
3. **Cost and hosting plan.** The sizing model is in the gates doc. YouTube
   demos need no new paid service. Any Vercel plan question is separate.
4. **Content.** CVF channel videos and captions, owned or permissioned photos
   and accurate cues. Replace synthetic and third-party seed ids. Unlisted is
   not private.
5. **Owner visual/content acceptance and cold visibility.** Not
   self-certified.
6. **Real devices.** iPhone Safari, Android Chrome and desktop Safari/Firefox
   are untested. The manual matrix is in the runbook. Headless Chromium is not
   a real-phone codec test.
7. **Publication, CI, merge and exact deployment verification.** Not
   authorized here.

## Legacy-reference behavior

- **No rewrites.** Existing rows keep `video_link_mode` NULL, and their
  `video_url` bytes are untouched.
- **Display.** A nonempty safe legacy link keeps showing that link, labelled
  Legacy in the editor. An empty legacy row follows the library.
- **Leaving legacy.** A row leaves legacy only by an explicit coach choice,
  or when duplicated: the copy gets the explicit mode with the same effective
  demo.
- **Rolling deploys.** An old browser can reclassify an inheriting row as
  legacy during a rolling deploy; this is documented.

## Return packet

The portable packet is in `../return/`:

- this RETURN and the manifest;
- `exercise-guides-branch.bundle`, a git bundle of the branch from
  `f3c063c`;
- the evidence: raw logs for every milestone and both sweeps, provider-proof
  JSON, integration results, footprint TSVs, the review package and report,
  the docs and visual review, and the ledger;
- `SHA256SUMS`.

Logs were scanned for credential-like strings and contain only test names.
All data is synthetic.
