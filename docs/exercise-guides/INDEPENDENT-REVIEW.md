# Independent review: Photo + YouTube exercise guides

**Reviewer and scope.** A fresh-context reviewer (Claude Opus subagent, no
prior context) reviewed base `f3c063c` against head `fb5d06e`.

- The review was static and read-only: code, SQL, contracts and the
  then-uncommitted design docs.
- The reviewer ran no tests, builds or network calls.
- The package excluded the 84 PNG captures and summarized the backend
  lockfile.

**Verdict:** "With fixes", with no Critical findings. The two Important
findings were fixed test-first, as was one Minor re-graded by the executor.
See [Executor resolution](#executor-resolution) at the end.

## Reviewer report (transcribed by the executor; lightly condensed, every finding, reference, grade and the verdict preserved)

### Strengths
- Migration safety: `git diff f3c063c..fb5d06e -- supabase/migrations` touches only the new file; its SHA-256 matches the documented `69ec99a0…`; the media migration still hashes `54028175…`; `backend/migration.sql` untouched; base has 44 files (43 released + media).
- The four replaced functions are minimal edits of their latest definitions (I extracted and diffed each: `sync_workout_exercises`/`create_quick_session` vs `20261009200000`, `clone_workout`/`commit_program_import` vs `20261005165134`). Only the mode column, mode validation and Quick derivation `UPDATE` were added; signatures, `security invoker`, `search_path=''`, and grants are unchanged and restated (revoke public/anon/authenticated, grant service_role).
- Quick v1 is preserved: replay branch returns before workout insert and before mode derivation; `quickSessions.js`/`quickSessionRequest.js` untouched; golden v1 hashes pinned; API mode key still rejected; save-to-library goes through `save_workout_as_template`→`clone_workout`, which copies the mode.
- New intents table: RLS enabled, no policies, no DELETE grant, immutability/transition trigger, service_role-only functions.
- YouTube parsing is strict and identical in both roots with thorough accept/reject vectors; browser re-derives via `trustedDemo` (tampered `kind`/`video_id` cannot become an embed); fixed `youtube-nocookie` origin; origin-only `strict-origin-when-cross-origin`; zero provider requests before Play; singleton guard; destroy on close; ≥200×200 with 60dvh cap; Open on YouTube always visible with `noreferrer`. Vercel headers have no CSP that would block the embed; the service worker ignores cross-origin requests.
- Client allowlist adds `demo` but not `video_link_mode`; upload intents/staging keys never reach client DTOs; preview mock mirrors the allowlist.
- Upload transport: intent persisted before any grant; HMAC grant uses a distinct domain (`staging-grant.` prefix; capability bodies are base64url and can never contain that); UUID-only key regexes (no traversal); 1024-char token cap; timing-safe compare; staged files never overwritten (`link` + EEXIST handling); finalize decides from stored bytes (length, sniff, full decode, digest) and reuses accepted `exercise_media_attach_source` + `reconcileAttach` recovery. Every new authenticated route has requireCoach + ownership (`ownedRevision`, issuer-only `ownIntent`) + SQL editability.
- Image processor: `failOn:'warning'`, 32 MP, no animation, single decode slot, queue 4, 10 s/15 s deadlines, orientation-correct crop and metadata/ICC-stripping tests.
- Executor rulings (deadline semantics, focus-to-player-region, content-route `pipeline` fix) are reasonable and documented; the `pipeline` change leaves authorization untouched.
- Docs are disciplined about local-only status; hosted/provider/real-device/owner gates are separately labelled without overclaiming.

### Issues

#### Critical (Must Fix)
None found.

#### Important (Should Fix)

**1. Duplicating an exercise that carries a legacy link makes the whole workout unsaveable.**
`frontend/src/lib/supersets.js:178` (`duplicateExercise` sets `id: ''`) + `backend/src/lib/externalVideo.js:74-78` (`normalizeDemoModes`) + `frontend/src/lib/trainingLibrary.js:192` (`demoProblem`) + `frontend/src/components/training/DemoLinkField.jsx` (Legacy copy).
Legacy rows with a link (NULL mode, nonempty URL) will be common in production because the old editor materialized the library URL into every row picked from a library entry that had a video. When a coach duplicates such a row (`workout-exercise-duplicate-button`, available in Programs and the ClientDetail copy editor), the copy has an empty `id`, so `previous.get` finds nothing and the server rejects the entire save with 400 "Choose the library demo or a custom link for the edited demo link." `demoProblem` does not catch this, so there is no pre-save warning, and the copied row even says "It stays as is until you choose an option above", which is false for a copy. Before this change, duplicate-then-save worked. `exerciseDemoReferences.test.mjs` mentions "duplicating" in its header but has no test for it.
Fix: either have `duplicateExercise` (or the Programs wrapper) mark the copy and let `demoProblem`/DemoLinkField require a choice before save with accurate wording, or let the server accept a no-mode link on a new row only when it exactly equals a stored legacy row's link in the same workout (mirroring `clone_workout` copying legacy rows as is).

**2. A still can be delivered late, from the wrong clip, or after the selector closed (review focus 4).**
`frontend/src/components/training/media/LocalStillSelector.jsx:88-110` (`useFrame`) + `:112` (`close`) + `:125-126` (the file input stays enabled while busy).
`useFrame` awaits the seek and then `canvas.toBlob` with no check that nothing changed in the meantime. If the coach picks another clip mid-export, `invalidate()` is a no-op (nothing confirmed yet), and the export later calls `onStill(still)` with the old clip's frame and file name (or a blank frame if the source was already swapped). If the coach presses Close mid-export, the parent clears `stillFile` and closes, then the late `onStill` sets it again, so UploadControl shows "Ready to upload the still from your clip…" with the selector closed. The blob URL created after unmount is never revoked. The still spec only tests changes after confirmation.
Fix: a generation counter in a ref, bumped in `choose`, `close` and on unmount; check it after each await in `useFrame` and drop the result (revoking any URL just created); disable the file input and Close while busy.

#### Minor (Nice to Have)
3. `trainingLibrary.js:161`, `Programs.jsx:1489`: `chooseExercise` runs on every keystroke. Editing the name clears `exercise_library_id` to `''`, so re-matching the same exercise counts as a new pick and the row becomes inherit with an empty URL, silently dropping a custom or legacy link. The old editor also overwrote the link here, so this is not a regression. Compare against the row's last-saved library id and mode instead.
4. `frontend/src/lib/exerciseMedia.js:254,277`: a 409 from the staging PUT is treated as success. The local route returns 200 for identical bytes; 409 means different bytes are staged, and finalize then attaches the previously staged bytes, not the selected file. It is unlikely, because the request id resets per file. Surface `staging_conflict`. For the provider's ambiguous duplicate response, a client-sent digest could serve purely as an extra reason to refuse, never as trusted input.
5. Save-time and read-time checks disagree. `isSafeExternalVideoUrl` (`externalVideo.js:11`) accepts URLs containing `'`, `"`, backticks or encoded spaces; `parsedHttpUrl` (`exerciseDemo.js:18`, both roots) rejects them. A saved custom link such as `https://example.com/farmer's-walk` resolves to no demo for clients, and custom links do not fall back to the library. Legacy links with these characters also stop showing an "External video" link (the released `safeHttpUrl` allowed them). Use the same check on save, and have `demoProblem` flag these characters.
6. `supabaseImageStore.js:94` (`#bounded`) downloads the whole object before checking its size, and `open()` (`:143`) downloads the whole object for every Range request. The bucket size limit in Gate 2 mitigates this, but the adapter should call `info()` first. This is a hosted-gate item only.
7. Migration `:658`: abandon does not check for an already-recorded asset. If the attach outcome was unknown and the intent is then abandoned, finalize refuses with `upload_abandoned` even though the asset row exists, so same-request recovery is lost. Only reachable through the API (the UI never calls abandon). Return `attached` when the intent's asset exists, as the attach path does.
8. The staging PUT does not bind the request content type to the grant's `contentType` or the declared MIME. Not a security issue, since finalize re-checks the bytes.
9. `repository.js` `uploadIntentsFor` is unused. There is no cross-tab resume of a pending intent after the tab closes, and old staged bytes are retained indefinitely (no purge, by design).
10. Finalize has no rate limiter, and each call does a full decode. The coach-only route and the bounded queue mitigate this.
11. The content route's `req.destroyed` check is fragile: if middleware ever consumed a GET body (the stream is auto-destroyed after end), the route would return without ending the response. It works today, as the real-browser lanes show.
12. `ClientDetail.jsx:1086`: the copy-editor save lacks the client-side `demoProblem` check. The server still rejects with a message.
13. `loadYouTubeIframeApi` leaves its script tag behind after a timeout, so a retry can append a second one. A retryable inline failure (for example `processor_busy`) returns 200 with status "processing" and the "closed the tab" resume copy, which does not tell the coach it was busy.
14. Docs:
    - `docs/exercise-guides/design.md:7` links `TEST-MATRIX.md`, which does not exist.
    - `hosted-gates.md:18` says a release "must not ship code that writes `video_link_mode`". The backend also reads the column (`workoutLogs.js` selects `video_link_mode`), so without the migration every workout-log read would 500. Say reads or writes.
15. Plan-level: a CSV import that creates a new library exercise from a row URL puts the URL into the library and makes the workout row an override (the plan's old-draft rule), so later library replacements will not reach those imported workouts. Consider `inherit` for rows whose library exercise was just created from the same URL; this is the owner's or plan's call.

### Declined to judge
- Real-device iOS Safari / Android Chrome playback and codecs: outside local evidence; correctly listed as a gap.
- Supabase adapter behavior against the real provider (raw-body signed PUT, copy/duplicate error codes, 2 h lifetime): not activated; contract-tested against a fake only.
- Owner visual/content acceptance of DemoLinkField and the dialog, including the "not a new visual direction" classification: an owner gate.
- Reconciliation with the separate Quick repair (`507d23d`) and re-deriving `create_quick_session`: the plan defers it.
- `sharp` native bundle size in the Vercel backend function, and lockfile transitive advisories: a hosted packaging gate; no network.
- Accuracy of the test-count claims: I could not run anything, so I judged the tests by reading them.
- The 84 PNG captures and the rendered review page: not visually inspected.
- Retention or purge of abandoned staging objects: excluded by the plan.
- A stale cached old frontend saving an inherit row as legacy with the library URL: deliberate SQL behavior (unclassified legacy); a rolling-deploy concern.
- `cc_load_policy=1` forcing captions on for every viewer: a product choice the plan calls "captions preference".
- Inline processing time against hosted function duration limits: a hosted gate.

### Recommendations
1. Fix Important 1 and 2. Add a backend test (POST/PUT with a duplicated legacy row) and a test that changes the clip or closes the selector mid-export (a delayed `toBlob`/seek stub).
2. Make the save-time and read-time link checks match (Minor 5), and correct the two doc errors (Minor 14).
3. Before COMPLETE-LOCAL, write the guides `RETURN.md` and `exercise-guides-return-manifest.json`, and add the CLAUDE.md status entry.

### Assessment
**Ready to merge (for local acceptance)?** With fixes.
**Reasoning:** SQL, authorization, privacy and player boundaries are sound and match the spec. However, duplicating a common legacy-link row now blocks workout saves, and the still selector can hand over a still from the wrong clip or after close (review focus 4). Both should be fixed and tested before local acceptance.

## Executor resolution

One fix pass. Each fix was test-first, then the whole suite was rerun at the
final head (see [TEST-MATRIX.md](TEST-MATRIX.md)). There was no second
reviewer round, as the executing-plans process prescribes.

| Finding | Grade (re-graded by effect) | Resolution |
|---|---|---|
| 1 duplicate legacy-link row blocks save | Important | Fixed in `11b372e`, see detail below. |
| 2 late still or leaked URL | Important | Fixed in `d7b65fc`, see detail below. |
| 5 save/read link checks disagree | **Raised to Important** | Fixed in `49d30a6`, see detail below. |
| 14 docs | Corrected | (a) `TEST-MATRIX.md` was added in `6b2118c`. (b) `hosted-gates.md` now says the backend reads **and** writes the column, and adds the rolling-deploy note (`88b2d7a`). |
| 15 CSV import mode | Ruling: stands per plan | The owner may choose `inherit` later. Cost if wrong: those imported rows do not follow later library replacements. |
| 3, 4, 6–13 | Minor, deferred | Listed in RETURN under "Deferred minors". |
| Declined-to-judge lines | Each ruled | Each stands as a labelled gate or gap in [hosted-gates.md](hosted-gates.md) / RETURN; none is a local defect. `cc_load_policy=1` is kept (viewers can turn captions off). The rolling-deploy reclassification is now documented. |

**Finding 1, duplicate legacy-link row (`11b372e`):**

- A copy now takes the explicit mode that keeps its source's demo.
- Save flags a new row that still has an unclassified link.
- Tests:
  - `exercise-guides-editor.spec.mjs` drives the real editor and validates the
    saved body with the real backend rules: RED (server 400) → GREEN.
  - Two unit tests: RED → GREEN.

**Finding 2, late still or leaked blob URL (`d7b65fc`):**

- A generation guard drops stale exports, and the clip picker and Close are
  disabled while a frame exports.
- Tests (held-`toBlob` stub):
  - the controls-disabled test: RED (enabled) → GREEN;
  - the late-frame test: RED (blob URLs created 2, revoked 1) → GREEN.

**Finding 5, save and read link checks disagree (`49d30a6`):**

- **Why it was raised.** The effect is that legacy links which the released
  tracker rendered silently disappear for clients, and saveable custom links
  resolve to nothing.
- **Correction to the report.** Encoded `%20` was in fact accepted; only raw
  characters were affected.
- **Fix.** The character rule now bars embedding only. External links use the
  released rule, so every link the save path accepts resolves.
- **Test.** RED → GREEN, with both copies held to the same assertion.
