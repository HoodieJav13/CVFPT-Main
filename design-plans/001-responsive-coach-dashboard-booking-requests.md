# Preserve booking-request content on narrow coach dashboards

Written against: 9113f9e

## Evidence chain

- Surface: `frontend/src/pages/coach/Dashboard.jsx`, `/coach`, pending booking request state at a 390px viewport.
- Problem: The booking request keeps metadata and both decision buttons in one horizontal row at every breakpoint. At 390px, the action group reduces the metadata column to 89px in the rendered preview, clipping `Sarah Martinez` and `"Late morning works best."` before either string reaches the available card width.
- Design evidence: `docs/design-principles.md` requires mobile-first layouts, denser desktop expansion, reuse of established interaction patterns, and preservation of useful content and actions at narrow widths. `frontend/src/pages/client/Programs.jsx` already stacks card summary content at the base breakpoint and restores a horizontal layout at `sm`.
- Owner: `frontend/src/pages/coach/Dashboard.jsx`, specifically the composition inside `data-testid="booking-request-row"`.
- Scope and affected surfaces: The pending booking request rows on the coach dashboard only.
- Uncertainty: None for the selected surface. The coach Sessions page has a separate booking-row composition and is intentionally outside this plan because it was not part of the selected audit finding.

## Design decision

Make each coach-dashboard booking request mobile-first: stack its metadata above its action group below `sm`, then restore the current horizontal metadata/action relationship at `sm` and wider. This removes action-induced text compression while preserving the existing card, typography, semantic colors, controls, and desktop density.

## Reuse

- Existing Tailwind responsive composition utilities and the current `Card`, `SectionLabel`, and `Button` owners; do not introduce a new component or variant.
- Exemplar: `frontend/src/pages/client/Programs.jsx`, `ProgramAssignmentCard` and `WorkoutAssignmentCard`, which use `flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between` for mobile-first card summaries.

## Changes

1. `frontend/src/pages/coach/Dashboard.jsx`
   - Change: Replace the always-horizontal inner booking-request layout with a base `flex-col` layout and `sm:flex-row sm:items-center sm:justify-between`. Keep a compact gap between metadata and actions. Leave the action buttons grouped together and non-shrinking.
   - Preserve: Existing request data, copy, truncation behavior for content that exceeds the full metadata width, button variants and sizes, approve/decline handlers, test IDs, semantic colors, outer card styling, and the current horizontal presentation from `sm` upward.
   - Verify: At 390px, the preview fixture displays the complete `Sarah Martinez` name and `"Late morning works best."` note because the metadata receives the row width; Approve and Decline appear together below it. At `sm` and desktop widths, metadata and actions remain side by side.

## Scope

- Inherit: Every pending booking request rendered by the coach dashboard mapping receives the responsive composition.
- Verify: Empty pending-request state, one request, multiple requests, long client names, long notes, and both booking actions on `/coach`.
- Exclude: `frontend/src/pages/coach/Sessions.jsx`, client booking rows, shared button sizing, touch-target changes, typography, palette, dashboard statistics, hero density, motion, backend behavior, and preview fixtures.

## Validation

- Product: Open the preview as Coach with a pending booking request; confirm the client can still be identified and Approve/Decline remain available and functional.
- Interface: Check `/coach` at 390x844, 640x900, and 1440x1000 with one and multiple requests. Confirm no horizontal overflow, no action-induced clipping below `sm`, intentional full-width truncation for genuinely long content, stable button grouping, and unchanged desktop hierarchy.
- System: Confirm the change uses the established base-column/`sm`-row pattern directly in the dashboard composition and does not add a parallel primitive or alter global `Button` or `Card` variants.
- Repository: `npm --prefix frontend run build` -> the Vite production build succeeds; `npm --prefix frontend run test:e2e:preview` -> the preview regression suite passes.

## Stop conditions

- Stop if the booking-request composition is moved into a shared owner before implementation, if preserving the content requires changing booking data or behavior, or if the requested scope expands to the separate coach Sessions booking row; re-audit the new owner or surface before proceeding.

## Design documentation

- After acceptance and validation: None. The existing mobile-first and narrow-content principles already govern this decision.
