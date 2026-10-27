> Saved independent report. The final reviewed functional tree959eaf56 is now committed ascb0e5d52; the commit maps exactly to the reviewed tree. Later documentation changes contain no runtime changes.

# Independent hosted-photo wiring review

Completion state: COMPLETE-LOCAL (independent scoped review complete)
Protocol version: v1.1
Baseline SHA: 5e9d099a58fd789ac9139b93be6231f76c6fd862
Head SHA: unchanged baseline; implementation is staged, not committed at review time
Accepted staged tree: **959eaf56dffaf5a504d63ea3b8df6e89b01233ed**
Branch and upstream: integrate/youtube-guides-release-20261017; NOT PUSHED
Authority used: independent local code/security review and synthetic tests explicitly requested by the owner/parent; report/repro files outside checkout only.
Commits: none by reviewer
Files changed: reviewed increment **18 files, +530/-70**; no implementation edits by reviewer.
Migrations/deps: none changed in this increment.
Checks passed: direct backend focused 37/37 plus final lease/upload rerun 11/11, source-loader units 3/3, browser source/actor regressions 4/4, independent provider-fault fix proof 2/2, staged diff whitespace check and clean unstaged diff.
Checks failed/not run: historical red findings below are resolved; broader final suites remain the author's execution responsibility; hosted execution unavailable under current authority.
External actions: public official Vercel documentation read only; no application/provider hosted API request, mutation, deployment, publication, or secrets.
Known gaps: actual private bucket, configured hosted runtime, packaging and hosted real-role proof remain separate activation/release gates.
Push/deploy state: local staged candidate only; no hosted-photo readiness or activation claimed.

## Judgment

**Accept this exact staged tree for the scoped local hosted-photo wiring increment. No unresolved substantive code/security finding remains from this review.** This acceptance is independent of, and does not replace, final broader checks or Development activation authority.

The configuration requires the explicit Supabase photo flag, bucket identity and a supplied stable signing secret; incomplete or full-video hosted configuration fails closed. Runtime constructs the existing private image adapter and image-only processor. Hosted multipart and video-frame routes are refused before unsupported operations. Existing local full-video wiring remains separate, and no YouTube player/parser/resource logic changes in this increment.

Source uploads bypass the API body using one app-issued provider upload grant. Finalization continues to check actor/draft ownership, declared versus actual bytes, server-sniffed type, complete decoder validation and digest before recording; immutable source installation and same-request recovery remain intact. The adapter checks metadata before downloading and counts actual streamed bytes with cancellation, so lying metadata cannot create an unbounded retained body. Provider redirects and caches are disabled for source downloads. The existing configured Supabase transport retains secret-key normalization/default timeouts while validating HTTP 206 and exact requested start/end before storage-js discards response metadata. API HEAD performs authorization and metadata only. Oversized GET/open ranges are rejected before opening bytes. Every actual GET/HEAD/Range re-resolves the embedded principal, current context membership and revision/assets.

The editor reconstructs originals through sequential exact ranges, rejects wrong/ignored ranges and partial/oversize bodies, and offers a manual retry without displaying a partial photo. It aborts pending reads and revokes owned blob URLs on unmount/link/actor changes. Link state now includes actor and clears URLs/missing entries on a changed actor/context/assets key; same-key refresh alone may retain prior URLs.

## Findings corrected during review

1. **P2, resolved — previous actor capability retained during replacement links.** Initial tree `b8b1272e0f4b3790d96cf97e9ef82d3de42ac3e6` returned the prior actor's links while new links loaded. The first correction `53fc45e3247e4b3f6ab0bc0cf225b05796d60af6` added actor to the key but still spread old URLs into the new-key state; the reviewer identified that remaining defect. Final tree adds both render-key isolation and changed-key state clearing. A real AuthProvider/useMediaLinks browser repro showed coach-b displaying coach-a's capability while the new links were blocked; it now shows no capability until coach-b's links arrive. Directly rerun successfully by reviewer. Historical evidence: `red-actor-link.log`, `green-actor-link.log`; focused browser command below.

2. **P2, resolved — exact-length wrong provider range accepted.** Initial `asStream()` usage lost HTTP metadata; provider HTTP 200 and HTTP 206 with a wrong offset were accepted if length matched. Reviewer reproduced both with the installed SDK and synthetic fetch. The new narrow configured fetch validator rejects both before consuming/relabeling them, while leaving PostgREST item pagination and existing authentication handling intact. Directly verified installed-SDK negatives and independent repro with `--validated`. Evidence: `red-provider-range-metadata.log`, `green-provider-range-metadata.log`, `reviewer/provider-range-repro.cjs`.

3. **P2, resolved — 60-second source lifetime incompatible with sequential mobile chunks.** The photo source now gets the existing source/video maximum 300-second capability; derivatives stay at 60 seconds. The synthetic-clock route test advances 100 seconds across ten chunks, verifies exact reconstruction, then changes revision ownership and verifies the next GET and HEAD are denied before opening bytes. Each browser fetch remains independently bounded at 15 seconds. This avoids the systematic one-minute expiry without bypassing current access checks or claiming arbitrarily slow connections always succeed. Directly rerun by reviewer. Evidence: `green-slow-source-ttl.log`, `reviewer/backend-focused.log`.

4. **Test synchronization, resolved — preview crop action before async source readiness.** Existing preview upload/crop test acted as soon as source facts appeared; controls are intentionally disabled until the source finishes loading. Final test waits for the move control to be enabled before typing. That preserves the loading/error disabled state. The author is rerunning the full preview suite; this review does not label its earlier 119 pass/1 fail run as a final pass.

## Direct evidence for final tree

- Reviewed full baseline-to-staged implementation/test diff plus both correction deltas; exact index tree rechecked after tests; no unstaged implementation changes.
- Repository/ancestor instructions read; contract validator passed.
- `reviewer/backend-focused.log`: **37/37** across config, installed SDK, secret-key normalization, photo store, upload/finalize/processing and real loopback auth/content routes.
- `reviewer/frontend-source.log`: **3/3**, covering exact 10 MiB reconstruction, revocation, ignored/mismatched/oversize response bodies, and oversized HEAD rejection.
- Separate-port Playwright execution of the actual final browser regressions: **4/4 in 6.7 seconds**, using `reviewer/playwright.review.config.mjs`. Command: `./node_modules/.bin/playwright test --config ../../hosted-photo-evidence/reviewer/playwright.review.config.mjs --grep 'actor switch|exact 10 MiB|source authorization failure'`. Synthetic API interception only. Both 320/390px ten-chunk crop reads, close/revoke lifetime, failed-read retry/no partial crop and actor-switch delayed-link isolation pass.
- Independent SDK/provider repro with `--validated`: HTTP 200 and wrong-offset HTTP 206 both rejected. Without that flag the script intentionally models the initial unvalidated transport, not the final configured runtime.
- `git diff --cached --check` and `git diff --quiet` passed. No applied migration bytes or dependency manifests changed. No new provider, key generation, paid service or source media introduced.

## 10 MiB feasibility and release boundary

**No smaller upload limit is required by the examined Vercel payload ceiling for this design.** Direct upload can retain the existing 10 MiB bound; finalize and internal image processing read that bounded object server-side; the crop editor receives it through ten 1 MiB API bodies; HEAD has no source body; derived posters stay at most 160 KiB. Direct tests validate decoding/rendering and attachment retry at exactly 10 MiB, and browser tests validate exact-size readback and mobile crop use.

[Official Vercel limits](https://vercel.com/docs/functions/limitations#request-body-size), read during this review, specify a 4.5 MB request/response body maximum. The design does not depend on an unproven streaming exemption. This conclusion concerns local code/tests and documented limits. It does not prove the real Vercel build artifact, installed native sharp runtime, provider bucket configuration, actual provider CORS/range semantics, workload costs or hosted current-role authorization. Bounded Development verification of those remains necessary after approval; local acceptance must not be presented as already activated hosted photos.

No optional minor needs to delay the local increment. Existing retention/no-purge and explicit storage/cost gates remain unchanged. No scope expansion into owned video or third-party/AI instructional assets occurred.

Judgment calls: (1) review remained scoped to this adapter increment; (2) all repros used fixed synthetic test configuration and no provider network; (3) 300 seconds reuses the existing accepted maximum and retains per-request revocation; (4) focused independent tests were selected to cover the changed trust/transport boundaries, while the author runs wider regression suites; (5) public documentation reading grants no hosted execution authority.

## Final bounded lease follow-up

The parent identified one additional runtime issue before committing: the previous inline photo lease was 30 seconds although hosted processing includes sequential network operations. Independent inspection confirms the revision-job SQL allows an expired running lease to be reclaimed and fences completion by token; the inline job does not extend its lease. A legitimate slow request could therefore lose its claim after 30 seconds, trigger overlapping work and consume attempts.

Final tree **959eaf56dffaf5a504d63ea3b8df6e89b01233ed** changes only the inline photo lease/comment and one regression relative to the previously accepted tree `f2aa10a0e4e4f174f3bd33474552a3f11a9fd517`. The lease is now **120 seconds**, within the existing SQL accepted range 5–900; no SQL changes. Source metadata, bounded download, decoder scheduling, derivative upload and completion can each use a 15-second budget (75 seconds), plus up to 15 seconds of claim-response lag and failure-recording headroom. The correction preserves bounded recovery after a terminated request and does not alter full-local video worker behavior.

The held-render test uses synthetic time to advance 80 seconds, verifies that an authorized competing Resume remains processing and that the same job still has one attempt, then releases/awaits the original request. The existing expired-lease recovery test remains. The historical RED output confirms the old 30-second lease let Resume steal and finish another attempt; final GREEN confirms the correction. Reviewer directly inspected those raw outputs and reran the entire photo-upload suite: **11/11 pass**, saved in `reviewer/lease-photo-uploads.log`. Final staged tree and whitespace checks were rechecked. The prior independent tests remain relevant because this delta changes no source transport, authorization, browser, SDK, or decoder implementation.

**Final judgment remains accept, now specifically for tree 959eaf56dffaf5a504d63ea3b8df6e89b01233ed.** This fourth runtime finding is resolved. Hosted activation remains unperformed and requires its separate gate.
