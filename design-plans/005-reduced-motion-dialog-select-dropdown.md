# Provide fade-only reduced motion for dialogs, selects, and dropdown menus

Written against: 9113f9e

## Evidence chain

- Surface: Shared Dialog overlay/content in `frontend/src/components/ui/dialog.jsx`, SelectContent in `frontend/src/components/ui/select.jsx`, DropdownMenuContent and DropdownMenuSubContent in `frontend/src/components/ui/dropdown-menu.jsx`, and their coach/client/admin consumers.
- Problem: These reachable Radix primitives always apply Tailwind `animate-in`/`animate-out` with zoom and directional slide variables. The bespoke Framer surfaces and skeleton shimmer respect reduced motion, but dialogs, selects, and dropdowns still move and scale when the operating system requests less motion.
- Design evidence: `docs/design-principles.md` requires every sequence to respect reduced-motion preferences while preserving the same information. The animation audit specifies that reduced motion should remove position changes while retaining a gentle opacity transition, using a `200ms` fade for comprehension rather than eliminating all feedback.
- Owner: Add one fade-only reduced-motion utility in `frontend/src/index.css`; consume it from the shared Dialog, Select, and Dropdown content owners. Use `--motion-duration-state` and `--motion-ease-out` from plan 002.
- Scope and affected surfaces: All current shared Dialog, Select, DropdownMenuContent, and DropdownMenuSubContent instances across coach, client, admin, shell user/session menus, and the client Workout Tracker completion dialog and weight-unit select.
- Uncertainty: None. `tailwindcss-animate` keyframes combine opacity and transform, so a reduced-motion override must replace the animation with opacity-only keyframes rather than merely zeroing translate variables, which could disturb component positioning transforms.

## Design decision

Keep existing full-motion behavior unchanged for users without a reduced-motion preference. Under `prefers-reduced-motion: reduce`, replace each selected primitive’s zoom/slide animation with an opacity-only enter/exit fade lasting `var(--motion-duration-state)` (`200ms`) and using `var(--motion-ease-out)` (`cubic-bezier(0.23, 1, 0.32, 1)`). The reduced keyframes must animate opacity only so Dialog centering and Select/Dropdown popper offsets remain entirely owned by their existing base transforms.

## Reuse

- Existing Radix `data-state`, Tailwind animation classes, transform-origin variables, and the CSS vocabulary from plan 002.
- Exemplar: `frontend/src/index.css` already places the skeleton reduced-motion override beside the animation it governs; add the shared fade-only utility in the same frontend token/utility owner.
- A new `.motion-reduce-fade-only` utility is required because the same reduced-motion contract applies to three primitive owners and Tailwind’s current enter/exit keyframes combine opacity with transform. Duplicating per-component overrides would recreate the drift this plan is preventing.

## Changes

1. `frontend/src/index.css`
   - Change: Add `motion-reduced-fade-in` and `motion-reduced-fade-out` keyframes that change opacity only. Inside `@media (prefers-reduced-motion: reduce)`, define `.motion-reduce-fade-only[data-state='open']` and `[data-state='closed']` to override animation name, duration, and timing with the opacity-only keyframes, `var(--motion-duration-state)`, and `var(--motion-ease-out)`. Use `!important` only on those animation properties so the Tailwind state utilities cannot reintroduce transform keyframes; do not override `transform`, transform origin, or positioning.
   - Preserve: Existing skeleton reduced-motion handling, all visual tokens, and normal-motion Tailwind animations.
   - Verify: The utility has no effect outside reduced-motion media and never changes transform or layout properties.

2. `frontend/src/components/ui/dialog.jsx`
   - Change: Add `.motion-reduce-fade-only` to DialogOverlay and DialogContent.
   - Preserve: Normal fade/zoom/slide behavior, centered transform, close button, overlay opacity, portals, focus management, and duration outside reduced motion.
   - Verify: Reduced motion fades the overlay and centered content without zooming, sliding, or jumping away from `left: 50%; top: 50%` centering.

3. `frontend/src/components/ui/select.jsx`
   - Change: Add `.motion-reduce-fade-only` to SelectContent.
   - Preserve: Normal side-aware slide/zoom, Radix transform origin, popper positioning, trigger-width viewport behavior, scrolling controls, and selection behavior.
   - Verify: Reduced motion keeps the content anchored to its trigger and fades only; top/right/bottom/left placements do not shift during the fade.

4. `frontend/src/components/ui/dropdown-menu.jsx`
   - Change: Add `.motion-reduce-fade-only` to both DropdownMenuContent and DropdownMenuSubContent so primary and nested menus share the same reduced-motion path.
   - Preserve: Normal side-aware slide/zoom, trigger-derived transform origins, alignment, collision handling, keyboard navigation, item states, and portals.
   - Verify: Reduced motion fades menus in place without scale or directional movement; reopening and submenu placement remain correct.

## Scope

- Inherit: Every consumer of the selected shared primitives receives the reduced-motion path without page-level edits.
- Verify: Coach/client/admin dialogs; client/coach form selects; Workout Tracker completion dialog and weight-unit select; AppShell user dropdown; coach session action dropdown; all supported menu sides and viewport sizes; normal and reduced motion.
- Exclude: AlertDialog, Popover, Tooltip, HoverCard, ContextMenu, Menubar, NavigationMenu, Sheet, Drawer/Vaul behavior, normal-motion interruptibility finding #5, accordion motion handled by plan 004, button feedback handled by plan 003, booking-row exit O1, and product markup.

## Validation

- Product: Open representative dialogs, selects, and dropdown menus in coach, client, and admin preview roles; confirm interaction, focus, selection, dismissal, and positioning are unchanged.
- Interface: With normal motion, confirm the existing side-aware zoom/slide remains. With reduced motion enabled, record at 10% playback and confirm each surface changes opacity for exactly `200ms`, never changes scale/position, remains anchored throughout, and provides the same information and controls.
- System: Confirm `.motion-reduce-fade-only` is the only new reduced-motion owner for these primitives and that no component duplicates the keyframes or literal `200ms`/curve values.
- Repository: `npm --prefix frontend run build` -> the Vite production build succeeds; `npm --prefix frontend run test:e2e:preview` -> the preview regression suite passes.

## Stop conditions

- Stop before execution unless plans 001–004 have been implemented and merged in order. Stop if plan 002’s token names or values changed, if `tailwindcss-animate` no longer uses transform-bearing enter/exit keyframes, if opacity-only keyframes disturb Radix positioning, or if fixing another primitive would widen the selected finding.

## Design documentation

- After acceptance and validation: None. Plan 002 records shared ownership, and the existing reduced-motion principle already states the product requirement.
