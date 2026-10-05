# Workout layout/accessibility follow-up — 2026-10-05

Completion: **COMPLETE-LOCAL**. Protocol v1.1. Branch
`codex/workout-ux-followup`, no upstream and no push. Freshly verified main/base:
`cda1beae5857bb1ce98b44b596ada6def085edce`. Implementation commit:
`5f835410275f0091f1c375341608d50e8c81c60e`; the following documentation commit
contains this handoff. This is a frontend-only correction to the released typed
logging implementation, not a new tracking feature or visual direction.

Authority: inspect/edit/test/scoped local commits allowed by the implementation
request and repository policy. Push, merge, deploy, hosted migrations, live data
writes, sends, collection activation, costs and new credentials forbidden for
this follow-up. Other worktrees, including the PostHog source branch and parked
PR99, were not changed. Backend, outbox, sync logic, snapshots, schema, dependencies
and metric validation contracts have no changes.

## Owner visual review and independent review

Publication and merge are **on hold for owner visual review**. The refreshed
nine-page packet pairs actual released baseline
`cda1beae5857bb1ce98b44b596ada6def085edce` and independently reviewed correction
`5f835410275f0091f1c375341608d50e8c81c60e`:
[`workout-ux-visual-review/index.html`](workout-ux-visual-review/index.html).
The adjacent manifest records exact scroll offsets, requested and actual action
positions, dock geometry, nine-point hit tests and all image hashes. Later docs
commits do not change the captured app. Phone 320×640/390×844 and desktop
1440×900 use identical synthetic data/theme. No prior audit images were reused.

The first comparison at `256676fe` exposed that moving the timer into the sticky
dock only partially addressed D7: the enlarged dock still covered Add set and
Same as last time at scrollY571/271. The owner requested correction before
sign-off. Regression `f0487e7` fails at both exact phone states on `3c651ee`
(2 failures; desktop passes). Correction `5f83541` removes only the dock's sticky,
bottom and z-index classes. It remains in normal document flow after exercises;
no clipping, reduced targets, nested scrolling, timer logic or navigation change.
The visible tradeoff is deliberate and shown: timer and finish controls no
longer stay pinned during logging; scroll to the end to use them.

All nine hit-test points on both exercise actions now pass at the original
phone scroll offsets, with active rest. The independent reviewer reran the new
regressions and timer case 4/4, then used ordinary mouse-wheel scrolling to the
end at all three sizes: timer/adjustment/finish controls fully visible and
unobscured; Finish opens its dialog; ±15s, reload and dismissal preserve timer
state. It found no verified bug. Earlier independent review also ran 11 UX,
69 unit and the typed outbox case, plus large-set/simultaneous typed-error probes.
Its font measurement advisory was corrected at `256676fe` and independently
rerun 3/3: actual phone `135.5` width 38.26px, versus 106px usable after and
10px before. Optimistic offline detail rendering stays deferred.

One baseline alignment limit is explicit: on the 390px obstruction page,
Before cannot scroll upward beyond document top. Its action is actually y633
at scrollY0 versus the requested y650. After reaches y650 at scrollY271. The
17px difference is captioned; neither screenshots nor measurements imply an
exact positional match there. At 320px both action anchors are y446.

## Current reproduction and disposition

The old audit covers main `3886fef` and parked UI `1d6de31`. It was reconciled
against deployed typed-logging main `cda1bea` using synthetic local API responses.
No audit fixture diff or parked design code was imported.

| Finding | Current evidence and bounded correction |
| --- | --- |
| D1 phone weight clipping / overflow | Reproduced 320px document width 352px; 320/390px decimal-load inputs were 28px wide with only 10px usable. Weight/unit now occupy a separate row below `sm`; desktop retains a table with balanced flexible columns. 320px input now 124px wide/106px usable; 390px input 194px/176px. `135.5` and `27.5` fit including native spinner allowance. Document widths equal 320/390/1440. |
| D2 invalid entry | Released code already rejects invalid values before enqueue, completion or rest. Added adjacent field-linked errors (`aria-invalid`, `aria-describedby`, alert text) while retaining values and the existing toast. Errors clear as a corrected or blank optional field is entered. Rules come from the existing persistence validator. |
| D3 waiting state | Released metric work already fixed persistent waiting/read-failure banner handling. The optimistic detail snapshot remains explicitly deferred; no detail/outbox behavior changed here. |
| D4 long-name builder overflow | Reproduced 388px dialog with 588px scroll width. Explicit zero-minimum grid column, shrinkable form/title/input containers and truncation now keep the dialog at 388/388; 320px also passes. Desktop editor pane remains usable. |
| D5 placeholder-only authoring | Added persistent associated labels to existing workout/library fields, including name, prescriptions, video and client/internal notes. Tracking mode and target controls remain explicit. |
| D6 small actionable controls | Start/PDF 32px, finish actions 36px, authoring inputs 36px and drag grip 28×44 reproduced. Scoped touch variants/minimum sizes now give checked controls 44px targets, including dialog close, builder save/add and drag grip. Both 320px and 390px Start/PDF paths fit. Shared UI defaults were not changed. |
| D7 rest overlay | Initial timer grouping was partial: the sticky dock still obscured Add set/Same as last time. The final correction removes sticky/bottom/z positioning from the same controls container. Both actions now pass viewport and nine-point hit tests at the documented 320×640 scrollY571 and 390×844 scrollY271 states with rest running. Timer and finish controls remain after exercises, no longer pinned; ordinary scrolling reaches them without navigation overlap. Timestamp, ±15s, reload, dismissal, expiry and opt-in cues are preserved. |

D8 detail alignment, D9 archive confirmation, D10 quick-complete preview
semantics, D11 parked design direction, D12 navigation name, D13 unsupported
coach preview-start and wider usability preferences are outside this pass.
This is not a blanket audit closure.

## Architecture and judgment calls

1. This is routine defect/accessibility correction. It uses existing UI
   components, typography, semantic colors and motion. No identity/signature
   direction, reference UI transplant or design variants were needed.
2. `workoutEntryErrors.js` asks the existing frontend `performedSet` validator
   about each field independently. It adds no parallel numeric rules or API
   changes and can expose simultaneous errors. Frontend/backend metric parity
   remains unchanged. Inline copy uses “leave blank” in place of technical
   “null”; the existing toast contract remains intact.
3. Narrow rows wrap weight and units instead of reducing the number text or
   shrinking touch targets. Desktop remains tabular. Rest controls join the
   existing container in normal document flow. Removing its sticky positioning
   fixes the obstruction at the source; it changes pinned visibility, while
   completion/rest persistence and actions remain unchanged.
4. Authoring labels apply to the shared workout editor, including existing
   template/private-copy callers. React-generated IDs preserve associations;
   rest/unit IDs retain the editor prefix. No authoring payload changed.
5. An existing preview test assumed a card had one alert and tried completion
   with a still-invalid first set. It now scopes the history alert and corrects
   that entry explicitly. Its pagination, failure/retry and write-independence
   assertions remain. No preview fixture or missing-mock guard was weakened.
6. The CLAUDE duration-release line still described a pending PR. Updated it
   from the existing closeout evidence for PR107/main `cda1bea`; no hosted check
   or release action was repeated.
7. Functional/accessibility and visual changes were committed separately.
   Additional test-only commits record the history adaptation and offline
   negative case. Unit choices, optional load, coach-configured modes, legacy
   reps/weight defaults and immutable snapshots remain the released contract.

## Directly verified checks

- Test-first scoped browser run: 7 failures / 1 pass on the old layout/error UI.
- Final normal-mode synthetic browser suite: **14 passed**. Added D7 red
  regression: **2 phone failures / 1 desktop pass** before the correction. Covers
  surfaces at 320/390/1440px, number visibility/overflow, associated labels,
  scalar and metric invalid values, blank correction, no invalid writes/rest,
  offline invalid rejection/corrected sync, rest adjustments/reload/dismissal,
  unobstructed secondary-control hit tests and 44px targets.
- Existing normal-mode typed outbox suite: **1 passed**. Includes reload,
  ambiguous/repeated add responses, old-server metric rejection, ordered
  reconnect/completion and completed history.
- Full secret-free preview suite: **79 passed, 8 skipped**. Includes workout
  start/completion/history, builder reorder/supersets/giant sets, saved copies,
  session/private-copy flows, rest expiry/reduced motion and typed targets.
- Frontend unit suite: **69 passed**, including independent simultaneous-field
  errors and legacy nullable/half-step behavior.
- Backend metric parity/validation and design-token contracts: **16 passed**
  in the earlier follow-up phase; not rerun for the one-line frontend layout correction.
- Vite production build passed; `git diff --check` and protocol v1.1 validation
  passed. Existing bundle-size advisory remains a baseline-unrelated warning.
- Settled synthetic Chromium screenshots captured at 320/390/1440px. Inspected
  tracker decimals, inline error, rest/secondary controls, populated builder
  top/lower fields, desktop pane and phone library dialog. Capture reports zero
  page errors and zero unexpected API requests across 40 refreshed contexts.
  The manifest retains 54 viewport/full-context image hashes. Printed packet
  inspection and reproduction evidence is in its adjacent README.

Reproduce from `frontend/`:

```sh
npm run test:unit
npm run build
npx playwright test --config playwright.workout-ux.config.mjs
npx playwright test --config playwright.metrics.config.mjs
npm run test:e2e:preview
```

The UX config owns a strict local port and synthetic API fixtures. It never
reuses another server. It uses normal mode because preview intentionally resets
on reload; existing preview tests retain their guarded preview fixture.

Raw logs, baseline/final numeric measurements and screenshots are in the task
artifact directory `evidence/workout-ux/`, outside the repository. Key files:
`baseline-probe.json`, `before-rest-overlap.json`, `after-probe.json`,
`final-browser-capture.json`, `final-tracker-{320,390,1440}.png`,
`final-invalid-390.png`, `final-rest-390.png`,
`final-builder-{320,390,1440}.png`, corresponding lower-field/library screenshots,
and `logs/`. The original audit still resides in `audit-evidence/`.

## Failures, non-runs and release gates

The first D7 correction was **introduced/incomplete**: timer grouping did not
remove shared-dock obstruction. Exact-state red regressions now pass after the
normal-flow correction; it is no longer described as merely a separate
pre-existing limitation. The initial inline-error addition caused one **introduced** test-selector
collision in the full preview suite; corrected and rerun, final 79/8 above.
The initial builder correction was insufficient until the dialog grid track
minimum was fixed; its red regression then passed. Initial missing local backend
packages were an **unavailable** setup condition, resolved by copying an existing
ignored dependency installation into this isolated worktree. No dependency or
lockfile changed. No check remains failing.

The eight live-auth entries are **not-applicable** to the authorized synthetic
local pass. Physical-device keyboard, iOS Safari and installed-PWA checks are
**unavailable** here; Chromium screenshots are not evidence for those platforms.
Hosted auth/DB probes and live-client tests are **not-applicable** because no
backend/schema contract changed and live writes were forbidden. No hosted state
is claimed newly verified by this follow-up.

Optimistic offline detail rendering remains a separate behavioral task; PostHog
production collection remains off. Yahoo/other actual mail-client delivery and
rendering are separate email-release checks, not covered by workout screenshots.
No migrations, schema changes, new dependencies or release labels are needed for
this branch. A future owner-authorized push may trigger Vercel Preview Git
integration (only another named branch is disabled in frontend config); merge to
main automatically deploys both Production roots. Push/merge/deploy therefore
remain separate gates. Nothing from this pass is remotely delivered.
