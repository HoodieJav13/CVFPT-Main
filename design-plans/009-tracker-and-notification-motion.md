# Add earned and functional motion to workout completion, rest expiry, and notification arrivals

Written against: 1f51ba3

## Evidence chain

- Surface: The active client tracker in `frontend/src/pages/client/WorkoutTracker.jsx:69-162,182-455`; the shared completed-workout destination in `frontend/src/pages/WorkoutLogDetail.jsx:12-86`; coach notification counts in `frontend/src/context/NotificationsContext.jsx:7-49` and `frontend/src/components/layout/AppShell.jsx:62-137`; the coach notification list in `frontend/src/pages/coach/Notifications.jsx:24-112`.
- Current motion owner: `frontend/src/lib/motion.js:1-34` is the canonical JavaScript vocabulary; `frontend/src/index.css:54-56` owns the shared CSS interaction duration and easing. `frontend/src/lib/visualIntensity.js:3-16` retains all three intensity tiers but forces every runtime read to `spectacle`.
- Existing achievement exemplar: `AchievementMoment` in `frontend/src/pages/client/Progress.jsx:22-57` uses the shared achievement duration/distance family, the branded expressive ease, `useVisualIntensity()`, and `useReducedMotion()` for a rare earned result. It is the family reference for workout completion, not markup to copy literally.
- Existing high-frequency feedback: `frontend/src/components/ui/button.jsx:7-8` gives every shared Button a `160ms` `scale(0.97)` press response through the plan 002 CSS tokens and suppresses the transform under reduced motion. Workout set toggles and add/remove actions already consume that primitive at `WorkoutTracker.jsx:389-405`.
- Existing reduced-motion primitive coverage: The finish Dialog and unit Select already receive plan 005’s fade-only path from `frontend/src/index.css:134-156`; this plan must not replace or duplicate it.
- Product evidence: `docs/design-principles.md:59-70` reserves expressive motion for rare achievements, keeps forms and repetitive task surfaces calm, forbids motion that delays work, and requires the same information under reduced motion.
- Frequency evidence: Set toggles, weight changes, save-state changes, and timer ticks can occur dozens of times in one workout. Workout completion is once per workout. Rest expiry is a functional attention event, while notification-count increases are occasional polling results. Frequency therefore supports one earned entrance and two concise state cues, not blanket choreography.
- Scope and affected surfaces: Client completion navigation and the existing completion summary; active tracker rest-timer expiry and reduced-motion saving feedback; unread-count hydration metadata plus desktop/mobile coach badges; focused preview and hosted browser regressions.
- Structural issue found while auditing: `NotificationsContext.jsx:27-31` polls only `/notifications/unread-count`. `Notifications.jsx:30-41` loads the list on mount, and again only after mark-all-read. A new list row cannot arrive through the current polling path while the page remains open. Adding list polling is a functional data-refresh change, not motion-only work; this plan records the gap and does not add list-arrival animation or silently widen scope.

## Current-state audit

### Shared vocabulary before plan 009

- `MOTION_EASINGS` (`motion.js:1-6`): `expressiveOut: [0.22, 1, 0.36, 1]`, Recharts `chartOut: 'ease-out'`, Framer `highlightOut: 'easeOut'`, and rare highlight `highlightPop: 'backOut'`.
- `PAGE_ENTRANCE_MOTION` (`motion.js:8-14`): restrained/cinematic/spectacle durations `340/520/680ms`, distances `5/11/18px`, staggers `45/75/110ms`, scales `1/0.995/0.985`, auth offset `120ms`, and maximum stagger delay `550ms`.
- `ACHIEVEMENT_MOTION` (`motion.js:16-20`): restrained/cinematic/spectacle durations `350/520/700ms` and distances `5/12/22px`.
- `CHART_MOTION` (`motion.js:22-30`): intentionally separate draw durations `650/820/1000ms`, pulse `700ms`, and dot expansion `320ms`.
- CSS interaction vocabulary (`index.css:54-56`): press `160ms`, state `200ms`, and strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`.
- No current shared recipe expresses the intensity-dependent amplitude of a one-shot attention pop. No new duration, easing, or stagger is needed for this plan.

### Workout Tracker

- The outbox changes among `saved`, `saving`, and `not_saved` and exposes explicit text/icon states in an `aria-live="polite"` region (`WorkoutTracker.jsx:69-162,332-337`). Saving uses a looping `animate-spin`; offline and retry states are otherwise immediate.
- A weight edit updates directly, then queues persistence on blur (`WorkoutTracker.jsx:225-244,360-386`). There is no motion and no spatial discontinuity to explain.
- Set completion optimistically changes button variant and row background, queues the write, and may start the rest timer (`WorkoutTracker.jsx:246-260,356-401`). The shared Button already supplies tactile feedback.
- Extra-set add/remove optimistically inserts or removes a grid row (`WorkoutTracker.jsx:40-65,262-275`). Adding layout animation would reintroduce the same height/reversal costs removed from repetitive accordions by plan 004.
- The rest timer updates `timerNow` every `250ms`, displays a changing whole-second clock, and is rendered only while `restSeconds > 0` (`WorkoutTracker.jsx:211-215,223,431-435`). At expiry it disappears without a visible or announced “rest complete” state.
- Successful completion posts the workout and immediately replaces the tracker with the completed detail route (`WorkoutTracker.jsx:297-312`). The destination renders an ordinary header and status badges with no indication that the client just earned the result (`WorkoutLogDetail.jsx:37-47`).

### Notifications

- The unread-count owner fetches on coach activation, every `30s`, window focus, and visibility restoration (`NotificationsContext.jsx:12-37`). An unchanged response passes the same primitive count to React; there is currently no badge motion.
- Desktop renders a static dot plus numeric pill; mobile renders a static numeric pill (`AppShell.jsx:107-137`). A first-page hydration, a decrement, and an increase above the visible `99` cap must not masquerade as a new visible arrival.
- Individual read awaits the server and navigates immediately after success (`Notifications.jsx:43-51`), leaving no useful dwell time for a read-state animation. On failure the row remains unread.
- Mark-all-read awaits the server, reloads, and removes unread dots (`Notifications.jsx:53-60,70-104`). A row stagger would decorate a bulk administrative action, delay visual settlement, and add noise proportional to list size.
- `ChatThread` provides the relevant polling guard exemplar: its smooth scroll effect depends on `messages.length`, so a poll returning the same list produces no new motion (`frontend/src/components/Chat.jsx:11-17`). Notification arrival feedback must be equally change-keyed.

## Design decision

| Motion moment | Decision | Normal-motion behavior | Reduced-motion behavior |
| --- | --- | --- | --- |
| Workout completion | **Add real motion.** Rare and earned. | Only after a successful client finish, animate the existing completion header and summary badges as one group from the workout-completion intensity recipe. Live `spectacle` uses the existing achievement `700ms`, `22px`, and expressive-out curve with a recipe-owned initial scale of `0.98`. Do not add a backdrop, overlay, confetti, loop, delay, or auto-dismiss. | Render the same header, counts, completed timestamp, and polite “Workout complete” announcement immediately with no opacity, scale, or position animation. |
| Set-completion toggle | **No additional motion needed.** | Keep the existing shared Button press response and immediate success color/variant change. Do not animate the row, check icon, or background. | Plan 003 already removes press scale; the semantic button variant, row color, label, and completed count still change. |
| Weight edit/unit change | **No motion needed.** | Keep direct input/select interaction and save-state copy. No number rolling, field pulse, or success flash. | Identical information and control behavior. Select retains plan 005’s fade-only primitive treatment. |
| Extra-set add/remove | **No additional motion needed.** | Keep immediate optimistic insertion/removal and shared Button press feedback. Do not add presence, height, or layout animation. | Immediate insertion/removal and labels remain sufficient. |
| Save/saving/not-saved/offline | **No state choreography.** | Keep the explicit text/icons and current saving spinner; do not crossfade or slide a state that changes repeatedly. | Stop the saving spinner with `motion-reduce:animate-none`; `Saved`, `Saving`, `Not saved yet`, and `Offline` text/icons remain visible and announced. |
| Retry/reconnect | **No additional motion needed.** | Allow the existing state text to move from not-saved to saving to saved as the outbox retries. Do not add shake, progress travel, or “back online” celebration. | Same text/state sequence with no rotating spinner. |
| Rest timer start | **No motion needed.** | The fixed timer appears immediately when a completed set starts rest. Its dismiss action should consume the existing shared Button press primitive rather than duplicating press values. | Immediate appearance and static press treatment; no spatial entrance. |
| Rest timer tick | **No motion needed.** | Keep tabular digit replacement only. Never animate, pulse, or announce each tick. | Identical clock updates with no animation. |
| Rest timer expiry | **Add real motion.** Functional, single-fire attention cue. | Keep the timer visible, change its persistent content to `Rest complete` with success semantics, and fire one compositor-only attention pop using the recipe-owned live scale `1.05`, existing `200ms` state duration, and existing strong ease-out. It remains until tapped; it never loops. | Suppress the pop entirely. Persistent `Rest complete` text/icon/color plus a dedicated assertive live announcement communicate expiry without motion. |
| Notification badge increment | **Add real motion.** Occasional, single-fire. | Pop the numeric desktop/mobile pill once with the same attention recipe and `200ms` state token only when the visible capped count increases after the component’s baseline mount. No animation on initial hydration, equal polls, decreases, zero/unmount, or increases that remain visually capped at `99`. Do not pulse the bell or loop the badge. | Count and accessible label update immediately; no pop. |
| Notification item read | **No motion needed.** | Keep server-first behavior and immediate navigation. Do not animate the unread dot on a surface the user is leaving. | Identical state and error recovery. |
| Mark all read | **No stagger and no motion needed.** | Keep one Button press response and settle all dots immediately after the successful reload. | Identical result without spatial motion. |
| New list item from polling | **No implementation in this plan.** | The list does not currently poll, so there is no list insertion event to animate. The count badge is the polling arrival cue. If functional list refresh is later approved, key any future entrance by a newly observed notification ID; an equal poll must produce zero motion. | Any future list refresh must insert content immediately and preserve the same information. |

## Shared vocabulary decision

Extend only `frontend/src/lib/motion.js`, its one canonical JavaScript owner:

- Add `WORKOUT_COMPLETION_MOTION`, derived from each existing `ACHIEVEMENT_MOTION` tier so duration and distance are reused, not copied as new literals. Add only intensity-owned initial scale: restrained `1`, cinematic `0.99`, spectacle `0.98`.
- Add `ATTENTION_FEEDBACK_MOTION` with one shared intensity-owned `scale`: restrained `1`, cinematic `1.03`, spectacle `1.05`. Both rest expiry and notification badge increment consume this same amplitude owner.
- Add no duration, easing, or stagger values. Completion reuses `ACHIEVEMENT_MOTION` and `MOTION_EASINGS.expressiveOut`; attention feedback reuses `--motion-duration-state: 200ms` and `--motion-ease-out`. No stagger is approved anywhere in plan 009.
- Do not modify `PAGE_ENTRANCE_MOTION`, `ACHIEVEMENT_MOTION`, `CHART_MOTION`, existing CSS tokens, or any current intensity values.

## Reuse

- Reuse `useVisualIntensity()` and the retained `restrained`/`cinematic`/`spectacle` structure. `spectacle` remains the only live runtime tier; do not bypass `visualIntensity.js` or revive its picker.
- Reuse `AchievementMoment`’s one-time, reduced-motion-branched Framer pattern, but animate the existing workout-detail summary rather than copying its gold card or `BrandBackdrop`. The design principles restrict the achievement backdrop to the live PR moment.
- Reuse `Button`/`buttonVariants` for set, add/remove, finish, and rest-timer dismissal feedback; do not restate `160ms`, `scale(0.97)`, or its easing at consumers.
- Reuse one CSS attention utility for rest expiry and notification badge arrival. The utility consumes the existing CSS state duration/ease and accepts only the intensity-owned scale through a CSS custom property.
- Reuse `ChatThread`’s “animate only when meaningful cardinality changes” principle for unread arrivals; do not key animation to a refresh call or a new response object.

## Changes

1. `frontend/src/lib/motion.js`
   - Change: Export `WORKOUT_COMPLETION_MOTION` by spreading the matching `ACHIEVEMENT_MOTION` tier and adding `initialScale` values `1/0.99/0.98` for restrained/cinematic/spectacle. Export `ATTENTION_FEEDBACK_MOTION` with `scale` values `1/1.03/1.05` for the same tiers.
   - Preserve: Every existing duration, distance, easing, stagger, chart family, helper, and consumer.
   - Verify: No new duration/easing/stagger literal appears in plan 009 consumers; both additions remain keyed by all three `VISUAL_INTENSITIES` values.

2. `frontend/src/index.css`
   - Change: Add one `motion-attention-pop-once` keyframe/utility that animates only `transform: scale(1)` to `scale(var(--motion-attention-scale))` and back once. Its duration is `var(--motion-duration-state)` and timing function is `var(--motion-ease-out)`. Under `prefers-reduced-motion: reduce`, set this utility’s animation to `none`.
   - Preserve: Plan 005 fade-only keyframes, skeleton handling, all visual tokens, and element positioning. Do not animate size, inset, shadow, layout, or color.
   - Verify: Generated motion is `200ms`, one iteration, transform-only, and has no effect unless a component explicitly applies the utility.

3. `frontend/src/pages/client/WorkoutTracker.jsx`
   - Change: After successful `/complete`, navigate with replace-state containing only the completed workout ID as a one-use celebration signal. Do not delay navigation for animation.
   - Change: Render the rest-timer control whenever `restEndsAt` exists, including at zero. Stop its `250ms` interval after expiry; before expiry retain the current clock and tap-to-stop label. At expiry retain the control until tap, swap to `Rest complete` and success semantics, add a dedicated assertive live-region announcement, and apply `motion-attention-pop-once` with `--motion-attention-scale` from `ATTENTION_FEEDBACK_MOTION[useVisualIntensity()]`.
   - Change: Render the timer control through the shared Button primitive while preserving its fixed placement, 64px minimum size, typography, colors, z-index, and tap-to-dismiss behavior. This inherits plan 003 rather than duplicating press motion.
   - Change: Add `motion-reduce:animate-none` to the save-state spinner. Keep the explicit `Saving` text; do not crossfade or animate save/offline/retry copy.
   - Preserve: Outbox ordering, optimistic state, retry delays, completion gating, completion Dialog, weight/unit behavior, set status, extra-set identity, sticky actions, and every API payload.
   - Explicit non-changes: Do not add motion to set rows, weight fields, notes, add/remove, completed-count text, save-state swaps, timer start, or timer ticks.

4. `frontend/src/pages/WorkoutLogDetail.jsx`
   - Change: Read the one-use completed-workout ID from React Router location state only for the client role. Capture it for the current `id`, immediately replace the history entry without the signal so reload/back/direct detail navigation cannot replay it, and clear the captured signal if the route ID changes.
   - Change: Wrap only the existing `PageHeader` plus completed/skipped/status badges in a Framer motion section. When the captured client signal matches the route, consume `WORKOUT_COMPLETION_MOTION[useVisualIntensity()]`, `MOTION_EASINGS.expressiveOut`, and `msToSeconds()`. Use a full transform string for the initial translate/scale and animate to the identity transform; do not animate the exercise cards, feedback, Message Client, or page layout.
   - Change: During the signaled completion only, expose a polite `Workout complete` status announcement. Under `useReducedMotion()`, use `initial={false}` so the summary appears immediately with identical content.
   - Preserve: Shared coach/client authorization, data loading, back behavior, timestamps, counts, cards, feedback/notes, coach Message Client action, and direct/history/reload rendering.
   - Verify: Only a successful client finish animates. Coach notification navigation, existing history links, direct URLs, refresh, and retry renders produce zero completion motion.

5. `frontend/src/context/NotificationsContext.jsx`
   - Change: Add an `unreadInitialized` boolean that remains false until the first successful unread-count response for the active coach/admin. Set it true after that response and reset it to false when leaving a coach/admin role; expose it beside `unread`, `setUnread`, and `refresh`.
   - Purpose: Distinguish initial server hydration from a later real increase. Do not infer hydration from the current `0` default, because a valid first response of zero would otherwise make the first later arrival look like initial load.
   - Preserve: The `/notifications/unread-count` endpoint, `30_000ms` interval, focus/visibility refreshes, error silence, role gate, and unread value semantics. Do not add a revision counter, list polling, or animation logic to the context.

6. `frontend/src/components/layout/AppShell.jsx`
   - Change: Track the previous displayed `Math.min(unread, 99)` count and one arrival revision in the always-mounted shell. When `unreadInitialized` first becomes true, record a baseline without animating. After that, increment the revision only when the displayed count strictly increases; reset the baseline when notification hydration resets or the authenticated user identity changes.
   - Change: Add a small local `NotificationCountBadge` renderer for the existing desktop and mobile numeric pills. It reads `ATTENTION_FEEDBACK_MOTION[useVisualIntensity()]` and receives the shell-owned arrival revision.
   - Change: Apply `motion-attention-pop-once` and the intensity-owned CSS scale to the revision-keyed pill; preserve the existing desktop/mobile classes and visible number. Add stable desktop/mobile count test IDs.
   - Guard: First successful hydration, same-value focus/interval/path refreshes, decreases after reads, zero/unmount/remount, account changes, and increases that remain visually capped at `99` do not change the arrival revision and must produce zero motion.
   - Preserve: All navigation, shell layout, bell icons, desktop dot, aria labels, count cap, and role gates.

7. `frontend/e2e/preview-critical.spec.mjs`
   - Change: Extend the existing client workout test to prove the completion signal animates the client summary once at live spectacle values (`700ms`, `22px`, initial scale `0.98`), is cleared before reload, and is absent after the coach opens the same detail from Notifications.
   - Change: Use Playwright clock control or an equivalent deterministic clock to prove timer start and whole-second ticks have no animation, expiry changes to persistent `Rest complete`, the normal-motion attention utility runs once for `200ms` at scale `1.05`, and tap dismisses it.
   - Change: Repeat the completion and timer-expiry assertions under reduced motion: summary/timer have no spatial animation, but completion copy/counts, `Rest complete`, success styling, and the expiry live announcement remain.
   - Preserve: Existing offline ordering, extra-set removal, partial completion, immutable detail, notification navigation, and responsive geometry assertions.

8. `frontend/e2e/live-auth.spec.mjs`
   - Change: Extend the focused hosted notification flow so the coach shell is mounted before a new client completion. Record animation starts on the numeric badge, trigger the existing focus/refresh path, and assert one visible count increase produces exactly one attention animation. Trigger another unchanged refresh and assert the count and animation-start total do not change.
   - Change: Assert initial hydration and count decreases after successful reads produce no arrival animation. Keep existing read-failure recovery and recipient-boundary checks. Verify the `99` visible-cap guard through the shell’s deterministic comparison logic rather than manufacturing 100 hosted notifications.
   - Preserve: Hosted authorization, concurrent completion, idempotency, deduplication, immutability, Message Client, and unchanged-credit assertions.

## Scope

- Inherit: Successful client Workout Tracker completion, the existing shared completed-detail summary, active rest timers, and coach/admin desktop/mobile numeric notification pills.
- Verify: Live fixed spectacle mode plus direct recipe checks for restrained and cinematic; mouse/touch/keyboard; normal and reduced motion; 390×844, 768×1024, and 1440×1000; online, offline, retry, and reconnect states.
- Notification owner boundaries: `NotificationsContext.jsx` gains hydration metadata only; its endpoint, cadence, error behavior, and unread semantics stay unchanged. `frontend/src/pages/coach/Notifications.jsx` remains behaviorally and structurally unchanged. Neither owner gains list polling or row animation.
- Exclude: Notification-list polling, push/email/Realtime, sound or haptics, tracker/card/list layout changes, exercise-row presence/layout animation, new loading sequences, new dependencies, global toast animation, Progress PR redesign, Plan 008 credit/payment retirement, booking-row exit O1, backend/API/schema changes, and preview fixture expansion unrelated to deterministic motion verification.
- Structural note: The notification list’s lack of live polling should be tracked separately if the owner wants rows to appear while the page stays open. Do not solve it inside plan 009.

## Validation

- Product: Complete a real preview workout from the tracker. Navigation must remain immediate; the destination summary gets one earned entrance and never replays on refresh, history, direct URL, or coach view. Complete a set with prescribed rest and verify the timer remains calm until one unmistakable, persistent expiry state.
- High-frequency feel check: During one workout, rapidly toggle sets, edit/blur weights, switch units, add/remove extras, type/blur notes, and move offline/online. Confirm shared press feedback remains the only spatial motion, save-state swaps never queue choreography, rows never animate height, and interaction is never blocked by motion.
- Completion feel check: Record at normal speed and 10% playback. Live spectacle must use exactly `700ms`, `22px`, `0.98`, and `[0.22, 1, 0.36, 1]`; the movement applies only to the existing summary group and never delays content or navigation.
- Rest feel check: Timer start is immediate, digits do not animate, and expiry fires one `200ms` transform-only pop to `1.05` then remains as `Rest complete` until dismissed. It never loops or restarts on subsequent timer renders.
- Notification feel check: After baseline hydration, one visible unread increase pops both applicable numeric pills once. Repeated equal polls, focus events, pathname refreshes, read decrements, initial mount, and changes beyond the visible `99` cap produce zero motion. Mark-all-read has no row/dot stagger.
- Reduced motion: Emulate `prefers-reduced-motion: reduce` before each trigger. Completion has no opacity/position/scale entrance; attention utilities report `animation-name: none`; saving rotation stops. Copy, icons, colors, live announcements, controls, counts, and navigation remain complete.
- System: `rg -n "duration:|durationMs:|stagger|cubic-bezier|animation-duration" frontend/src/pages/client/WorkoutTracker.jsx frontend/src/pages/WorkoutLogDetail.jsx frontend/src/components/layout/AppShell.jsx` must show no new local duration/easing/stagger literals. `rg -n "motion-attention-pop-once" frontend/src` must resolve to one CSS owner and only the approved rest/badge consumers.
- Repository: `npm --prefix frontend run build` succeeds; `npm --prefix frontend run test:e2e:preview` passes; the focused hosted workout/notification test passes; `git diff --check` passes.
- Done when: The three approved moments behave exactly as specified, every listed no-motion moment remains unanimated, reduced motion preserves state comprehension without spatial movement, and the notification list has not acquired an undeclared functional polling change.

## Stop conditions

- Stop if `frontend/src/lib/motion.js` or the fixed-intensity mechanism no longer matches this audit, if spectacle is no longer the only live tier, or if plans 002–005/007 are reverted or renamed; re-audit vocabulary ownership first.
- Stop if workout completion no longer navigates directly from `WorkoutTracker` to `WorkoutLogDetail`, if the detail route remount/capture behavior cannot guarantee one-use playback, or if navigation-state cleanup would alter back/history semantics.
- Stop if rest expiry requires sound, vibration, background notifications, or automatic dismissal; those require an explicit product/accessibility decision and potentially a new dwell-time token.
- Stop if the owner wants the Notifications page to live-refresh rows. Write and approve a separate functional polling/data-consistency plan before specifying any list-item arrival motion.
- Stop if implementation requires tracker/list structural layout changes, backend/schema work, a new animation library, duplicated duration/easing/stagger literals, or modification of Plan 008 surfaces.

## Design documentation

- After acceptance and validation: Update `docs/design-principles.md` Motion intent to name workout completion as the second approved rare achievement-family entrance and to record that rest expiry and visible unread-count increase use one-shot, reduced-motion-safe attention feedback. Keep the explicit rule that equal polls, timer ticks, repetitive tracker edits, and bulk notification reads do not animate.
