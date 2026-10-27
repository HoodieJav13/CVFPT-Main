# Quick sessions: actual paired visual evidence

Fresh capture on2026-10-14; local integration evidence, not an independent review or owner approval. Open [index.html](index.html).

- Baseline: `8d68a7893f7a84a658ff6545bb0b2b70a0df91ce` (released Invite main).
- Proposed: `d661b146c796cb28df1f7f2431246d0954a2f76a` (verified local integration functional commit).
- Both served from clean `git archive` exports in preview mode, headless Chromium,
  320×640, 390×844 and 1440×900, dark, reduced motion, en-US, America/Denver,
  clock fixed 2026-10-09T17:00:00Z. Fictional fixtures only.
- [manifest.json](manifest.json) records all 60 viewport captures (SHA-256, image
  dimensions, URL, scroll/overflow state, console results) and the hashes of 60
  full-page context images kept in the local review packet.
- Re-run: see the header of [capture.mjs](capture.mjs); rebuild the page with
  `node build-index.mjs`.

## What the pairs show

- Shared states (Sarah fixtures): coach Programs tab, client Home and coach
  history are **pixel-identical** at all three widths. The Assign type menu
  differs only by the added "Quick session" option. The Assign → Standalone form
  is pixel-identical on phones; at 1440px 1,050 pixels differ by at most 2 levels
  inside the dialog fields (the dialog is now a capped scroll container) —
  visually identical.
- New-only states (proposed only, captioned as such): builder, More/validation,
  confirmed save with independent Start/library actions, coach cards with the
  Quick session label, reload recovery (unrecoverable + corrupt), Start conflict,
  library failure/retry, client Home and Programs labels, and log-detail
  provenance. The existing Assign → Standalone flow is the honest creator
  baseline; no earlier quick-session screen is fabricated.

## Visual-direction classification

Extension of existing Assign / client-copy patterns plus one semantic type label
(existing `Badge` with `primary` accent tokens; recovery notices reuse the existing
gold attention treatment used by the waiver alert). No new identity/signature
direction is proposed, so no directional variants were produced. This is the
implementer's classification only: cold review and owner direction are not
self-certified, and any reviewer who reads a genuine direction change here should
route it through `docs/design-principles.md`.

## Capture provenance

These60 viewport images and the manifest were freshly captured from the two exact Git exports above. The later visual-only commit adds evidence without changing runtime source. All60 captures report no horizontal document overflow or unexpected console errors. Shared comparison was independently computed from decoded RGBA pixels by a local Chromium canvas; it confirms the values above. The capture script and comparison-page generator are unchanged accepted tools. Original October9 Quick evidence is preserved in the external sealed packet under `evidence/inherited-quick-visual/`; none is relabeled as a new capture. Full-page context images and the rendered comparison check are retained there too. Implementer inspection covers phone selector/builder/More, recovery and library failure, plus desktop confirmation; cold visual/owner acceptance remains pending.
