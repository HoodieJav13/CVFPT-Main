# Workout UI: actual before/after review

**Local only. Publication/merge held for owner visual review.**

Open [index.html](index.html). Nine comparison pages retain complete viewport
frames. Portable HTML additionally embeds full-page context and the manifest;
PDF contains the compact pages. The key PNG is page 8, the D7 obstruction comparison. Final documentation head
and artifact upload status are in the external handoff.

- Before: freshly rendered released main `cda1beae5857bb1ce98b44b596ada6def085edce`.
- After: independently reviewed `5f835410275f0091f1c375341608d50e8c81c60e`.
- This replaces the earlier packet at `256676fe` that exposed D7 as partial.
  Original-state red regressions `f0487e7` caught the obstruction; `5f83541`
  removes only sticky/bottom/z positioning from the existing controls container.
- Phone: 320 × 640 and 390 × 844. Desktop: 1440 × 900.
- Chromium 149, dark theme, reduced motion, en-US, UTC; frozen Date.now at
  2026-10-05 12:00 UTC; synthetic start time 11:55 UTC.
- [manifest.json](manifest.json): 40 viewport captures plus 14 full-page context
  images, exact source/state/rects/scroll offsets, all 54 PNG SHA-256 hashes,
  no page errors and no unexpected API requests. No real client data or stale
  audit images. [screenshots](screenshots/) retain original PNGs.

## Reproduction

Use separate worktrees at exact Before and After source SHAs. Start normal
Vite (not preview fixture mode) on 127.0.0.1:42744 for Before and :42742 for After,
with existing locked frontend dependencies. Never reuse another server on those
ports. From the After worktree run:

```sh
node docs/workout-ux-visual-review/capture.mjs
python3 docs/workout-ux-visual-review/make-packet.py /absolute/output/directory
node docs/workout-ux-visual-review/render-packet.mjs /absolute/output/directory/CVFPT-Workout-UI-Before-After
```

Capture imports the committed synthetic fixture and Playwright, intercepts
every API request, and writes only this evidence directory. It submits no real
client changes. Inspect images and the printed document afterward. Numeric
captions are specific to these source SHAs, not promises for future changes.

## What the evidence means

320px weight: baseline document 352px, input usable 10px versus actual text
38.26px. After: document 320px and input usable 106px. Builder content width:
baseline 588px versus 318px/388px after at phone widths. Start/PDF controls:
32px before versus 44px after. Duration/distance targets and units already
existed in Before; their behavior remains unchanged.

D7 originally remained partial after timer grouping: the sticky dock still
covered Add set/Same as last time. Final controls are in normal document flow
after exercises. At 320×640 scrollY571 both exercise actions are fully visible
and hit-testable; at 390×844 scrollY271 both are clear at y650. The manifest
records nine interior hit-test points per control. Regression tests retain
stronger rectangular-action points at 10/50/90%; capture uses 20/50/80% interior
points so it does not falsely count the outside corners of circular timer
buttons as obstruction. No clipping, smaller targets or nested scroll area.

The visible tradeoff is explicit: timer and finish actions no longer stay
pinned during logging; ordinary scrolling reaches them at the workout end.
Page 5 shows their end-of-document state; page 8 shows the previously obscured
exercise actions. End controls are clear of mobile navigation. Timer state,
±15 seconds, reload, dismissal, expiry and opt-in cues remain unchanged.

Requested logical anchors match, but actual numeric offsets differ when
content heights change. At 390px rest-overlay, Before clamps at document top:
actual action y633, scrollY0, versus requested y650. After reaches y650 at
scrollY271. This 17px alignment difference is captioned and recorded. At 320px
both anchors are y446 (Before scrollY283, After571). Full-page captures retain
additional context; viewport frames are the comparison evidence.

Synthetic API interception proves frontend rendering, not live backend
authorization/persistence. Physical keyboards, Safari and installed PWA were
not tested. Optimistic offline detail rendering remains deferred. No production
or migration state changed.

## Verification and review

Fresh correction checks: UX14/14; frontend unit69/69; typed outbox1/1; full
preview79 passed/8 live-auth skipped; Vite production build; diff/protocol v1.1.
Red D7 regression on the unfixed source: two phone hit-test failures and one
desktop pass. Independent exact-head review reran new regressions/timer4/4,
then verified ordinary scroll-to-end, all timer/finish controls, Finish dialog,
±15/reload/dismissal at all three sizes. No verified bug, page error or
unexpected API request. The material unpinned-visibility tradeoff was confirmed.

HTML images/load/layout and all nine print sheets were checked. PDFKit decoded
the final PDF to nine PNG pages for visual inspection. Image hashes are verified.
A first capture probe failed on outside corners of circular buttons; corrected
interior probes passed without any application change. Historical evidence is
retained by Git; this refreshed packet supersedes the partial-D7 comparison.
See the [implementation handoff](../workout-ux-followup-2026-10-05.md).
