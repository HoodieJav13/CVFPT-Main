# Add shared tactile press feedback to buttons

Written against: 9113f9e

## Evidence chain

- Surface: `frontend/src/components/ui/button.jsx` and every Button or `buttonVariants` consumer across coach, client, admin, authentication, dialogs, calendars, and alert dialogs.
- Problem: The shared button primitive transitions color only. Pressing primary, secondary, destructive, outline, ghost, icon, or link-backed buttons provides no immediate physical feedback even though buttons are the application’s highest-frequency interactive primitive.
- Design evidence: `docs/design-principles.md` requires purposeful motion that does not delay tasks. The animation audit specifies `transform: scale(0.97)` with a `160ms` strong ease-out transition for button press feedback, while reduced-motion users should retain color feedback without spatial movement.
- Owner: `frontend/src/components/ui/button.jsx`; consume `--motion-duration-press` and `--motion-ease-out` created by `design-plans/002-shared-motion-vocabulary.md`.
- Scope and affected surfaces: All existing `Button` variants and `buttonVariants` consumers, including `asChild` links rendered through the shared primitive, the client Workout Tracker and Programs surfaces, coach Notifications, and shared Workout Detail.
- Uncertainty: None. The primitive is the established owner, transform does not affect layout, and the shared vocabulary fixes the exact scale, duration, and curve.

## Design decision

Give every enabled shared button subtle tactile feedback by transitioning `transform` alongside the existing color properties and applying `scale(0.97)` only while active. Use `--motion-duration-press: 160ms` and `--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1)` from plan 002. Under `prefers-reduced-motion: reduce`, suppress the scale while retaining the existing color response and focus treatment.

## Reuse

- `Button`, `buttonVariants`, existing variants/sizes, `cn`, and Tailwind arbitrary-property utilities already used by the frontend.
- Exemplar: `frontend/src/components/ui/switch.jsx` keeps state movement on the transform channel with `transition-transform`; the Button change follows that compositor-only pattern while consuming the shared tokens from plan 002.

## Changes

1. `frontend/src/components/ui/button.jsx`
   - Change: Replace `transition-colors` in the base `buttonVariants` class with an explicit transition-property list containing `color`, `background-color`, `border-color`, `text-decoration-color`, `fill`, `stroke`, and `transform`. Set transition duration from `var(--motion-duration-press)`, timing from `var(--motion-ease-out)`, add `active:scale-[0.97]`, and add a reduced-motion override that keeps transform at `none`.
   - Preserve: Variant colors, shadows, sizing, rounded-corner overrides, focus rings, disabled pointer behavior and opacity, icon sizing, `asChild` behavior, labels, and all consumer markup.
   - Verify: Enabled pointer/touch presses compress subtly without shifting adjacent content; release retargets smoothly; disabled buttons do not respond; reduced-motion mode has no scale but retains color/focus feedback.

## Scope

- Inherit: All current and future components using `Button` or `buttonVariants`, including calendar and alert-dialog actions, receive the same tactile grammar.
- Verify: Default, destructive, outline, secondary, ghost, link, icon, touch, and `asChild` buttons with mouse, touch emulation, keyboard focus, disabled state, and reduced motion. Include Workout Tracker set completion, add/remove set, completion-dialog actions, Programs start/resume, Notifications read actions, and Workout Detail navigation/message actions.
- Exclude: Plain HTML buttons that do not consume `buttonVariants`, navigation links, cards, dropdown items, changing touch-target sizes, new hover lift, ripple effects, springs, button markup, booking-row exit transition O1, and coach-dashboard booking layout.

## Validation

- Product: Exercise representative high-value actions—coach New session, booking Approve/Decline, client check-in, dialog submit/cancel, icon edit, and authentication submit—without executing destructive or payment actions against live data.
- Interface: At normal speed the press should feel immediate and quiet. At 10% playback, confirm scale reaches exactly `0.97`, transform lasts `160ms`, release retargets from the current scale, no layout box changes, and reduced-motion mode removes scale entirely.
- System: Confirm `buttonVariants` remains the only owner of shared button press behavior and no consumer adds a competing active transform.
- Repository: `npm --prefix frontend run build` -> the Vite production build succeeds; `npm --prefix frontend run test:e2e:preview` -> the preview regression suite passes.

## Stop conditions

- Stop before execution unless plans 001 and 002 have been implemented and merged. Stop if a consumer already relies on an active transform that would compose incorrectly, if plan 002’s token names or values changed, or if applying feedback requires altering button markup or product behavior.

## Design documentation

- After acceptance and validation: None. Plan 002 records the shared motion ownership, and the existing purposeful-motion principle already governs this feedback.
