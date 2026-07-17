# Centralize the shared motion vocabulary without flattening semantic timing families

Written against: 9113f9e

## Evidence chain

- Surface: Dashboard and authentication entrances in `frontend/src/components/Choreography.jsx`; the personal-record moment in `frontend/src/pages/client/Progress.jsx`; metric chart drawing and highlight timing in `frontend/src/components/common.jsx`; interaction motion tokens in `frontend/src/index.css`.
- Problem: Motion values are owned independently by `MOTION_RECIPES`, `ACHIEVEMENT_MOTION`, `CHART_DURATIONS`, and repeated inline easing/duration literals. The identical expressive curve `[0.22, 1, 0.36, 1]` is repeated, related intensity values can drift, and future interaction plans have no named duration/easing owners to consume.
- Design evidence: `docs/design-principles.md` permits expressive page-load and achievement sequences while requiring purposeful, reduced-motion-safe motion. The animation audit requires curves and durations to live as shared tokens and specifies `160ms` with `scale(0.97)` for press feedback plus `200ms` and `cubic-bezier(0.23, 1, 0.32, 1)` for concise UI state feedback.
- Owner: Add `frontend/src/lib/motion.js` as the JavaScript motion-vocabulary owner and extend `frontend/src/index.css` as the CSS interaction-token owner. Existing surface components remain consumers.
- Scope and affected surfaces: Coach/client dashboard entrances, Login/Signup entrances, the client Progress personal-record moment, metric charts on client Progress and coach Client Detail, and CSS tokens consumed by plans 003–005.
- Uncertainty: None about the chart-duration intent. Git history confirms `MOTION_RECIPES`, `ACHIEVEMENT_MOTION`, and `CHART_DURATIONS` were introduced together in commit `dfe8f8d` (`feat: choreograph dashboards and progress achievements`). The chart values `650/820/1000ms` drive both the Recharts line draw and the delay before the highlight circles begin, while the shorter entrance values drive spatial page/achievement transitions. The longer chart scale is therefore intentional explanatory timing, not accidental drift, and must remain a separately named family.

## Design decision

Create one shared vocabulary with distinct semantic families rather than forcing every animation onto one duration scale. Preserve the current rendered feel: page entrance durations remain `340/520/680ms`; achievement durations remain `350/520/700ms`; chart drawing remains intentionally longer at `650/820/1000ms`; chart highlight durations remain `700ms` for the pulse and `320ms` for the final-dot expansion; and the existing branded expressive curve remains `[0.22, 1, 0.36, 1]`. Preserve the authentication `120ms` duration offset and the dashboard stagger-delay ceiling of `550ms` as named values. Add interaction tokens `--motion-duration-press: 160ms`, `--motion-duration-state: 200ms`, and `--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for plans 003–005. Store JavaScript durations in milliseconds and use one `msToSeconds` helper at Framer Motion call sites so units are explicit.

## Reuse

- Reuse `VISUAL_INTENSITIES` and `useVisualIntensity` from `frontend/src/lib/visualIntensity.js`; motion recipes must continue to use the existing `restrained`, `cinematic`, and `spectacle` keys.
- Exemplar: `frontend/src/index.css` already owns global visual tokens under `:root, .dark`; add the CSS interaction motion tokens there rather than hardcoding them in component classes.
- A new `frontend/src/lib/motion.js` owner is required because no current module can express shared JavaScript recipes across Choreography, Progress, and common components without creating cross-component imports. It is frontend-local and does not cross the frontend/backend deploy boundary.

## Changes

1. `frontend/src/lib/motion.js`
   - Change: Add the shared JavaScript vocabulary. Export `MOTION_EASINGS` with the existing `expressiveOut: [0.22, 1, 0.36, 1]`, Recharts `chartOut: 'ease-out'`, Framer highlight `highlightOut: 'easeOut'`, and rare PR `highlightPop: 'backOut'`; export `PAGE_ENTRANCE_MOTION`, `ACHIEVEMENT_MOTION`, and `CHART_MOTION`; export `msToSeconds(ms)`.
   - Preserve: `PAGE_ENTRANCE_MOTION` values per intensity: durations `340/520/680ms`, distances `5/11/18px`, staggers `45/75/110ms`, and scales `1/0.995/0.985`, plus named `authDurationOffsetMs: 120` and `maxStaggerDelayMs: 550`. Preserve `ACHIEVEMENT_MOTION` durations `350/520/700ms` and distances `5/12/22px`. Preserve `CHART_MOTION.drawDurationMs` at `650/820/1000ms`, `pulseDurationMs` at `700`, and `dotDurationMs` at `320`.
   - Verify: The module contains semantic names and explicit units; it does not collapse chart drawing onto entrance timing or alter any value.

2. `frontend/src/components/Choreography.jsx`
   - Change: Remove local `MOTION_RECIPES`; import `PAGE_ENTRANCE_MOTION`, `MOTION_EASINGS`, and `msToSeconds`. Convert `durationMs` and `staggerMs` only at the Framer transition boundary.
   - Preserve: Session-based one-time dashboard behavior, reduced-motion branching, the `0.55s` maximum delay, intensity selection, distance/scale behavior, and authentication’s existing `+120ms` duration relationship. Express the maximum delay as `msToSeconds(550)` and the authentication increment as `120ms` from the shared vocabulary rather than leaving unitless local literals.
   - Verify: Dashboard and auth entrances have the same timing, distance, scale, order, and reduced-motion behavior as before.

3. `frontend/src/pages/client/Progress.jsx`
   - Change: Remove local `ACHIEVEMENT_MOTION`; import it with `MOTION_EASINGS` and `msToSeconds` from the shared owner.
   - Preserve: Achievement enter/exit direction, scale values, intensity behavior, `AnimatePresence`, live-region behavior, and the existing branded expressive curve.
   - Verify: Each intensity produces the same PR timing and displacement as before.

4. `frontend/src/components/common.jsx`
   - Change: Remove local `CHART_DURATIONS`; import `CHART_MOTION`, `MOTION_EASINGS`, and `msToSeconds`. Continue passing chart draw durations to Recharts in milliseconds, and derive highlight delays/durations from the same chart family.
   - Preserve: The intentionally longer `650/820/1000ms` chart draw, the highlight beginning only after the draw completes, `700ms` pulse, `320ms` dot expansion, `ease-out`/`easeOut`/`backOut` library-specific easing values, data-keyed replay, and reduced-motion behavior.
   - Verify: No chart or highlight begins earlier or ends later than the current implementation.

5. `frontend/src/index.css`
   - Change: Add `--motion-duration-press: 160ms`, `--motion-duration-state: 200ms`, and `--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1)` beside the existing root visual tokens.
   - Preserve: Existing color, typography, radius, shadow, and backdrop tokens.
   - Verify: Plans 003–005 can consume the named CSS tokens without repeating duration or curve literals.

## Scope

- Inherit: Current consumers of `DashboardChoreography`, `AuthEntrance`, `AchievementMoment`, and `MetricChart` inherit centralized values without a visual change. Later shared Button, Accordion, Dialog, Select, and Dropdown work consumes the CSS vocabulary.
- Verify: Restrained, cinematic, and spectacle variants; reduced motion; coach/client dashboards; Login/Signup; a new client personal record; client and coach metric charts.
- Exclude: Changing the approved intensity values, normalizing chart durations to entrance durations, adding new animation, changing Framer transform implementation, booking-row exit motion O1, coach-dashboard booking markup, backend/PDF code, and dependencies.

## Validation

- Product: In preview mode, compare dashboard/auth entrances and a new PR at all three intensity levels; confirm the chart finishes drawing before its highlight starts and all behavior matches the pre-refactor baseline.
- Interface: Record normal and 10% playback before/after clips for cinematic dashboard entrance and PR creation. Expected totals remain page `520ms`, achievement `520ms`, chart `820ms`, pulse `700ms`, and dot expansion `320ms`; reduced motion still removes spatial movement and chart animation.
- System: `rg -n "const (MOTION_RECIPES|ACHIEVEMENT_MOTION|CHART_DURATIONS)|\[0\.22, 1, 0\.36, 1\]|duration: 0\.7|duration: 0\.32" frontend/src/components/Choreography.jsx frontend/src/pages/client/Progress.jsx frontend/src/components/common.jsx` returns no local vocabulary definitions or duplicated target literals after imports are wired.
- Repository: `npm --prefix frontend run build` -> the Vite production build succeeds; `npm --prefix frontend run test:e2e:preview` -> the preview regression suite passes.

## Stop conditions

- Stop before execution unless `design-plans/001-responsive-coach-dashboard-booking-requests.md` has been implemented and merged, with the coach dashboard booking row visibly using the approved mobile-stack/desktop-row composition. Stop if history or runtime evidence contradicts the confirmed chart timing relationship, if Recharts cannot consume the preserved easing value, or if centralization would require crossing the frontend/backend deploy boundary.

## Design documentation

- After acceptance and validation: Update the Motion intent section of `docs/design-principles.md` to name `frontend/src/lib/motion.js` as the JavaScript recipe owner and `frontend/src/index.css` as the CSS interaction-token owner, and record that chart drawing intentionally uses a longer explanatory timing family than page and achievement entrances.
