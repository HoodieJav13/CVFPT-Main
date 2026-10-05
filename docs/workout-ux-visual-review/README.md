# Workout UI: actual before/after review

**Local only. Publication/merge held for owner visual review.**

Open [index.html](index.html). Nine comparison pages retain complete viewport
frames. The portable HTML additionally embeds full-page context and the capture
manifest; PDF includes the compact pages. The key PNG is page 1. Attachment IDs
and the final documentation head are in the external handoff, avoiding a
self-referential commit hash in this document.

- Before: freshly rendered released main `cda1beae5857bb1ce98b44b596ada6def085edce`.
- After: independently reviewed `256676fefbe3d847eca5251ed27a0793ef0f360e`.
- Application source exactly equals initial reviewed `363cd58e`; the intervening
  change only corrects computed-font measurement in a browser test.
- Phone: 320 × 640 and 390 × 844. Desktop: 1440 × 900.
- Chromium 149, dark theme, reduced motion, en-US, UTC; frozen Date.now at
  2026-10-05 12:00 UTC; synthetic start time 11:55 UTC.
- [manifest.json](manifest.json): 36 viewport captures, extra full-page context,
  source/state/rects/scroll offsets, all 46 screenshot SHA-256 hashes, no page
  errors and no unexpected API requests. [screenshots](screenshots/) retain
  original PNGs. No real client data or stale Claude audit images.

## Reproduction

Use separate worktrees at the exact Before and After source SHAs. Start normal
Vite (not preview fixture mode) on 127.0.0.1:42744 for Before and :42742 for After,
with the existing locked frontend dependencies. Do not reuse another server on
these ports. Run `node docs/workout-ux-visual-review/capture.mjs` from the After
worktree. This script imports its committed synthetic fixture and Playwright,
intercepts every API request, and writes only this evidence directory. It does
not submit real client changes. Run `python3
docs/workout-ux-visual-review/make-packet.py /absolute/output/directory`, then
`node docs/workout-ux-visual-review/render-packet.mjs
/absolute/output/directory/CVFPT-Workout-UI-Before-After` to regenerate the
portable HTML, PDF and key PNG. Inspect images and the printed document; the packet's measured
values are fixed to this source, not a generic promise for future changes.

## What the evidence means

320px weight: baseline document 352px, input usable 10px versus actual text
38.26px. After: document 320px and input usable 106px. Builder content width:
baseline 588px versus 318px/388px after at the phone widths. Start/PDF controls:
32px before versus 44px after. Field labels, inline association and rest-dock
placement are visible in their paired states. Duration/distance targets and
units already existed in Before; their behavior is unchanged.

Rest-overlay page deliberately shows both versions obscuring a secondary
control at one matched logical position. Grouping rest controls does not remove
all shared sticky-dock/content overlap. Numeric scroll offsets differ because
layout heights changed; logical anchors are held equal. Full-page context is
additional evidence, not a substitute for viewport frames. Intercepted API
responses verify frontend rendering, not live backend authorization/persistence.
Physical keyboards, Safari and installed PWA were not tested. Optimistic offline
detail snapshot remains deferred. Production and migration state are unchanged.

## Inspection and review

The HTML loaded all images without errors. Print layout checks found no overflow
in any of nine sheets. PDFKit independently decoded the PDF to nine PNG pages;
rendered pages and original phone/desktop captures were visually inspected.
Independent code review reran UX 11/11, unit 69/69 and typed outbox 1/1; no
verified in-scope product bugs. Its test font measurement advisory was corrected
and decimal checks rerun independently 3/3. Existing full suite/build/backend
counts and their boundaries remain in the linked
[implementation handoff](../workout-ux-followup-2026-10-05.md).
