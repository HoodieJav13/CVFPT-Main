# P2 correction R2 — paired crop-frame evidence

Actual renders of the same test-only harness state (`frontend/e2e/harness`,
labelled synthetic moving-geometry clip) by the pinned candidate and by the
corrected tree, at 390×844 and 1280×900, reduced motion:

- **poster-crop** — saved poster 0.5 s, source scrubbed to 3.0 s, then *Crop poster*.
- **end-still-crop** — saved end still 3.5 s, source scrubbed to 1.0 s, then *Crop end still*.

| Variant | Source | Crop editor shows |
|---|---|---|
| before | `335588ec0c00a8c6ec65a9b13526f3bfd80688bd` (tree `3a857e68…`), disposable clone `../p2-before-335588e` | the **scrub-position** frame (all 4 captures) |
| after | `18985499a804f4be8ea4396bec1f0d1cf85f2c75` on `claude/exercise-media-local-20261015` | the **saved** frame, labelled with its time (all 4 captures) |

The saved time is unchanged in every capture. `capture-records.json` holds each
image's SHA-256, viewport, source commit/tree and the frame classification
(crop data URL hash compared with fresh draws of the saved-time and
scrub-position frames in the same browser). This is a functional bug
correction: no visual-direction change, no new variant, owner visual gates
unchanged. Regenerate with
`CVF_P2_BEFORE_DIR=<pinned clone> npx playwright test --config playwright.exercise-media-p2-frame.config.mjs`
from `frontend/`. Chromium headless only.
