# Workout UI: actual before/after review

**Owner approved the revised comparison on2026-10-06.** The captured images and
PDF retain their original local-review labels as historical evidence. PR/CI/merge
and exact Production verification are now authorized; see the
[release ledger](../workout-ux-release-2026-10-06.md).

Open [index.html](index.html). Nine numbered pages preserve #6 validation,
#7 workout Start/PDF and timer views. Portable HTML embeds all images/manifest;
PDF contains the compact sheets. Page8 is the obstruction key PNG.

- Before: actual released main `cda1beae5857bb1ce98b44b596ada6def085edce`.
- After: independently reviewed app `770e7139c8442983d7189be33f328cd4bae84521`.
- Supersedes the owner-reviewed `5f83541` packet, which cleared obstruction by
  unpinning controls. The owner requested pinned convenience, calmer #6 guidance
  and compact #7 title layout. Historical packets remain in Git.
- Phone320×640 /390×844, desktop1440×900; Chromium149, dark, reduced motion,
  en-US /UTC, Date.now frozen2026-10-05T12:00Z, workout start11:55Z.
- [manifest.json](manifest.json) schema3 records40 viewport and14 full-document
  images, all54 PNG hashes, exact source/rectangles, requested/actual anchors,
  document and entry-region offsets, hit tests and interception results.
  No page errors, unexpected API calls or real client data.

## What changed

The existing responsive rows, editor containment, durable labels and44px targets
remain. Timer/progress/Finish now occupy a separate reserved row; workout entries
scroll above it and cannot extend underneath. This preserves pinned controls at
normal sizes, with less content visible during rest. Very short or panned
keyboard viewports use document scrolling with focused-field clearance, so
inputs remain reachable. The shell and navigation are unchanged.

#6 uses neutral foreground text, an information icon, polite status and the same
softer guidance in its toast. Field associations, values and validation limits
are preserved. #7 raises button height32→44px while retaining previous12px text
and horizontal padding: Start51.64px /PDF79.44px wide; title stays2lines at320
and1line at390. The prior wider button style had added an unnecessary title line.

The reserved region changes scroll geometry. Requested lower action anchors
clamp upward to the entry boundary; Before390px also clamps at document top.
Actual positions and both scroll offsets are disclosed under each image and in
the manifest. Nine interior control hit points pass after the revision. Tests
use stricter10/50/90% points for rectangular actions; capture uses20/50/80% to
avoid counting outside corners of circular timer buttons as obstruction.
Full-document images show the actual page extent; they do not expand all content
inside the regional scroller. Viewport images are the paired evidence.

## Reproduction

Use isolated worktrees at the exact Before and After app SHAs, existing locked
frontend dependencies, normal Vite mode (not preview fixture mode), and strict
loopback ports42744 /42742. Never reuse a foreign server. From After:

```sh
node docs/workout-ux-visual-review/capture.mjs
python3 docs/workout-ux-visual-review/make-packet.py /absolute/output/directory
node docs/workout-ux-visual-review/render-packet.mjs /absolute/output/directory/CVFPT-Workout-UI-Before-After
```

Capture intercepts every API call with the committed synthetic fixture. It
submits no real changes. Caption measurements apply to these exact sources.
Inspect both rendered HTML and decoded PDF pages afterward.

## Verification and limits

Final source: UX25/25, frontend unit69/69, typed outbox1/1, full preview79 passed /
8 live-auth skipped, production build, diff/protocol checks. Independent reviewer
ran UX25/25, unit69/69 and typed outbox1/1; directly checked both roles, timer
behavior, nine-point hits, compact buttons, short-window resize, Tab navigation
and synthetic visual-viewport shrink/pan. All verified issues were corrected and
rechecked; the captured app is unchanged after final independent review.

All9 print sheets and54 screenshot hashes are checked. PDFKit decodes the PDF
into9 actual page images for inspection. The build's existing chunk-size
advisory remains. Physical phone keyboard, Safari and installed PWA are not
verified; synthetic interception proves frontend behavior, not hosted persistence
or authorization. Optimistic offline detail snapshots stay deferred. No backend,
metric/unit/outbox/schema/dependency contract changed. No push, migration,
merge or deployment occurred.

Library upload remains blocked before preparation by unavailable tooling; no
Library file ID/save is claimed. The portable HTML is opened in a new
dedicated owner-review Chrome window because the previous window was closed;
existing tabs are unchanged. Exact doc head, artifact hashes and external
review logs are in the local handoff. See [implementation notes](../workout-ux-followup-2026-10-05.md).
