# Residual R2 — crop selection change, paired evidence

Same test-only harness sequence (`frontend/e2e/harness`, labelled synthetic
moving-geometry clip) for the pinned follow-up baseline and the fix, at
320×740, 390×844 and 1280×900 with reduced motion:

1. open the poster crop at a saved 0.5 s;
2. change the saved poster time to 3.0 s with the crop still open;
3. edit the crop by keyboard.

| Variant | Source | After step 2 and 3 |
|---|---|---|
| before | `c64d17cb9596a700515d17f9c514ca9f1dab5060` (tree `d476d551…`), disposable clone `../r2-before-c64d17c` | crop still shows the **old 0.5 s frame** labelled 0:00.5; keyboard edits write into the 3.0 s selection (all 3 viewports) |
| after | `7627fbac728f382558930bf86d9fb44d953982c5` | crop shows the **new 3.0 s frame** labelled 0:03.0; edits apply to it (all 3 viewports) |

`capture-records.json` holds each image's SHA-256, viewport, source
commit/tree, label, saved time, crop rectangle, overflow flag and the frame
classification. Open `index.html` for the rendered comparison. Regenerate with
`CVF_R2_BEFORE_DIR=<pinned clone> npx playwright test --config playwright.exercise-media-r2-selection.config.mjs`
from `frontend/`. Chromium headless only; functional bug evidence, no
visual-direction change.
