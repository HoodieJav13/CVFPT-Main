# Remove accordion height-keyframe animation while preserving state feedback

Written against: 9113f9e

## Evidence chain

- Surface: Shared Accordion in `frontend/src/components/ui/accordion.jsx`, its `accordion-down`/`accordion-up` definitions in `frontend/tailwind.config.js`, client Programs, and the coach Training Builder.
- Problem: Accordion content animates `height` between `0` and `var(--radix-accordion-content-height)` using keyframes. Height animation performs layout/paint work, and rapidly reversing an open/close action restarts a keyframe instead of retargeting from the current visual state. This is concentrated in repetitive program-building and program-reading surfaces that the design contract says should remain calm.
- Design evidence: `docs/design-principles.md` keeps builders and repetitive task surfaces calm. The animation audit restricts performance-sensitive motion to transform/opacity and treats keyframes on reversible expand/collapse UI as non-interruptible. The current chevron already provides a concise transform-based state cue.
- Owner: `frontend/src/components/ui/accordion.jsx` and the now-single-purpose accordion animation entries in `frontend/tailwind.config.js`; consume `--motion-duration-state` and `--motion-ease-out` from plan 002 for the retained chevron cue.
- Scope and affected surfaces: Client assigned-program and standalone-workout accordions, including the expanded workout start/resume surface, plus coach Training Builder accordions and their multi-panel day and exercise groups.
- Uncertainty: None. Repository search confirms `animate-accordion-down` and `animate-accordion-up` are consumed only by the shared AccordionContent owner.

## Design decision

Remove content-height animation entirely so expanded content enters and leaves immediately, without layout animation or restart artifacts. Preserve state communication through the existing chevron rotation, calibrated to `--motion-duration-state: 200ms` and `--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1)` from plan 002. In reduced-motion mode, the chevron changes orientation immediately.

## Reuse

- Existing Radix Accordion state, `AccordionTrigger`, `AccordionContent`, the open-state `rotate-180` selector, and shared motion tokens from plan 002.
- Exemplar: `frontend/src/components/ui/switch.jsx` uses `transition-transform` for a compositor-only state cue; the retained chevron follows the same channel without animating layout.

## Changes

1. `frontend/src/components/ui/accordion.jsx`
   - Change: Remove `data-[state=closed]:animate-accordion-up` and `data-[state=open]:animate-accordion-down` from AccordionContent, leaving its overflow and typography responsibilities intact. Replace the chevron’s literal `duration-200` with `var(--motion-duration-state)`, apply `var(--motion-ease-out)`, and make the transform transition instantaneous under reduced motion.
   - Preserve: Radix open/closed state, keyboard behavior, multi/single/collapsible modes, content mounting semantics, padding, borders, hover treatment, open-state chevron orientation, and all consumer markup.
   - Verify: Content appears/disappears immediately; the chevron alone rotates for `200ms`; rapidly toggling never restarts a height animation or leaves a partially clipped panel.

2. `frontend/tailwind.config.js`
   - Change: Remove the `accordion-down` and `accordion-up` keyframe and animation extensions after confirming there are no remaining consumers.
   - Preserve: All color, radius, spacing, and plugin configuration, including `tailwindcss-animate` for other primitives.
   - Verify: Generated CSS no longer contains the project-defined accordion height keyframes.

## Scope

- Inherit: Every current AccordionContent consumer receives immediate content changes and the tokenized chevron cue.
- Verify: Client Programs single/multiple program and standalone-workout accordions, including start/resume cards; coach Training Builder workout, program-day, import-review, and exercise accordions; rapid repeated toggles; keyboard activation; reduced motion.
- Exclude: Dialog/select/dropdown keyframes, other `tailwindcss-animate` utilities, accordion markup or data state, content padding, tab transitions, new opacity/scale animation, booking-row exit O1, and dashboard booking markup.

## Validation

- Product: Open and close several client program days and coach Training Builder panels in quick succession; confirm content and controls remain usable and no state is lost.
- Interface: At normal and 10% playback, content must not animate height, clip midway, or leave blank animated space. The chevron rotates exactly `200ms` with the shared strong ease-out; reduced motion changes the chevron orientation instantly.
- System: `rg -n "animate-accordion-(down|up)|accordion-(down|up)" frontend/src frontend/tailwind.config.js` returns no matches after the removal.
- Repository: `npm --prefix frontend run build` -> the Vite production build succeeds; `npm --prefix frontend run test:e2e:preview` -> the preview regression suite passes.

## Stop conditions

- Stop before execution unless plans 001, 002, and 003 have been implemented and merged in that order. Stop if another consumer of the Tailwind accordion keyframes appears, if Radix state behavior has changed, or if product direction now requires animated expansion rather than the audited calm-builder behavior.

## Design documentation

- After acceptance and validation: None. The existing calm repetitive-surface principle already records the governing decision.
