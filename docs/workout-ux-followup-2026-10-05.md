# Workout layout/accessibility follow-up — 2026-10-05

> **Owner approval — 2026-10-06:** the revised comparison is approved and the
> visual hold is cleared. The already authorized PT UI release now includes
> PR publication, mandatory CI, merge and exact Production verification.
> This document retains the preceding local-review checkpoint; its former
> release hold describes that checkpoint. Current release evidence is in
> [the release ledger](workout-ux-release-2026-10-06.md).

**COMPLETE-LOCAL**, protocol v1.1. Branch `codex/workout-ux-followup`, no
upstream/push. Released main/base:
`cda1beae5857bb1ce98b44b596ada6def085edce`. Reviewed app/capture commit:
`770e7139c8442983d7189be33f328cd4bae84521`; later documentation commits do not change the captured app.
Publication, merge and deployment remain **on hold for owner review**.

Authority covers local implementation, tests, scoped commits and actual visual
comparison. No hosted changes, migrations, live client data, sends, costs,
credentials or collection activation. PostHog and parked PR99 worktrees were
not touched. This is a frontend correction to already released typed logging.

## Owner feedback revision — 2026-10-06

The owner liked the existing changes but requested the previous pinned timer /
Finish convenience, calmer validation (#6) and the original compact workout
card title layout (#7). The preceding `5f83541` correction had removed sticky
positioning because the enlarged dock still covered exercise actions. It fixed
obstruction but lost pinned convenience. The current revision supersedes that
tradeoff with a reserved region, rather than a floating overlay.

1. `WorkoutViewport.jsx` reserves separate entry and control rows. It measures
   the viewport, existing shell bottom clearance and actual control height.
   Entries scroll above the pinned timer/progress/Finish row; they cannot extend
   beneath it. The shell/navigation are unchanged. Rest entering/leaving resizes
   the content region; timestamp, ±15 seconds, reload, dismissal and alerts
   retain their existing behavior. The cost is less visible entry content during
   rest. A region needs at least120px; very short windows or a panned keyboard
   viewport use document scrolling, keeping focused fields/buttons clear of
   the actual header/navigation and visual viewport. This fallback deliberately
   relaxes pinned visibility so entries stay usable.
2. #6: validation rules still come from `performedSet`; no numeric limits or
   persistence behavior changed. Presentation maps technical errors to guidance
   such as “Use RPE 1–10 in 0.5 steps, or leave blank.” Inline text uses neutral
   foreground (computed CSS contrast12.3:1 in both captured phone states) with an information icon and polite status, retaining
   `aria-invalid` / `aria-describedby`. Toasts use the same softer guidance.
   Invalid values stay editable and never enqueue a write or start rest.
3. #7 is the standalone workout card's PDF / Start buttons. The prior switch
   from `sm` to `touch` raised height32→44px but also increased font/padding:
   Start51.64→64.25px and PDF79.44→91.34px. Their combined extra24.5px made
   “Synthetic phone workout” wrap1→2lines at390px and2→3 at320px. That wrapping
   was unnecessary. The current buttons retain44px height with the previous
   12px text/padding and original51.64 /79.44px widths and title line counts.

Functional copy/status changes and visual/layout changes have separate commits.
No backend, outbox, sync, snapshots, schema, dependencies or tracking-type/unit
contracts changed. Rollback is local commit reversion; there is no migration.

## Verification and independent review

Test-first regressions: original six owner checks failed on `c99c025` (three
unpinned docks, two oversized button widths, urgent feedback styling). They
then passed. Independent review found short-window48px input clipping, focus
beneath fixed navigation, successive fallback resize, simulated visual-viewport
shrink/pan and Tab focus cases. Each new regression failed before its fix.
The final UX suite passes25/25, covering reserved geometry, original571/271
entry scroll offsets, strict nine-point action hits, timer persistence, title
widths, labels, invalid/offline input, resize and keyboard focus.

Fresh final source: frontend unit69/69; typed mocked outbox1/1 (reload,
ambiguous extra-set response, older server ignoring metrics, FIFO completion);
full preview79 passed /8 live-auth skipped; Vite production build; diff and
protocol checks pass. Existing build chunk-size advisory remains. First
cross-suite runs caught two stale validation-copy assertions and a toast/inline selector collision; only
those presentation expectations and the field-associated selector changed, retaining persistence assertions.
The final full preview run starts after the app source is frozen.

Independent reviewer checked client and coach at320×640,390×844,1440×900,
normal/fallback focus, keyboard and synthetic visual-viewport states. Verified
issues were corrected and rechecked; final findings/evidence are retained in
external `evidence/workout-ux/owner-revision/`. No app change follows final
independent review. These are Chromium/synthetic checks, not physical Safari,
keyboard or installed-PWA proof. Live auth checks are skipped, not claimed.

## Actual visual evidence and scope

[The numbered comparison](workout-ux-visual-review/index.html) retains #6 /#7
and refreshes timer and obstruction views. Before is actual released main;
After is actual reviewed app source. Identical synthetic data/theme/viewport
states,40 viewport captures plus14 full-document images, source hashes, image
hashes, requested/actual anchors, both document and regional scroll offsets,
rectangles and hit tests are recorded in the adjacent manifest. No stale audit
images or real client data are used.

The reserved region changes scroll geometry. Requested lower action anchors
clamp upward to the entry-region boundary; baseline390px also clamps at document
top. Captions disclose actual positions. Full-document images show the actual
page extent; they do not expand all content inside the regional scroller.
Nine PDF sheets and decoded printed pages are inspected. Portable HTML embeds
images/manifest and is opened in a new dedicated owner-review window because
the prior review window had been closed; existing tabs are unchanged.
Library upload remains blocked by unavailable `prepare_uploads` tooling;
no successful save or Library ID is claimed.

Existing accepted D1 decimal-load fit, D4 narrow-editor containment, D5 durable
labels and scoped D6 touch targets are preserved. D2 guidance and D7 reserved
controls are revised here. D3 optimistic detail snapshots and D8–D13 /wider
product preferences remain separate. Existing typed modes `reps_weight`,
`duration`, `distance`, `duration_distance`, units s/min and m/km/mi/yd,
blank actual metrics, unit reinterpretation and legacy history stay unchanged.

No push: Git integration can auto-deploy branch previews and main merges deploy
both Vercel projects. Owner sign-off and separate hosted release authority are
still required. Exact final documentation head, full baseline-to-head footprint,
artifact hashes and owner-tab metadata are in the external release handoff.
