# Workout layout/accessibility follow-up — 2026-10-05

Completion: **COMPLETE-LOCAL**. Protocol v1.1. Branch
`codex/workout-ux-followup`, no upstream and no push. Freshly verified main/base:
`cda1beae5857bb1ce98b44b596ada6def085edce`. Implementation commit:
`9f036df729f04ee91286a50b14c730ad9510e5b6`; the following documentation commit
contains this handoff. This is a frontend-only correction to the released typed
logging implementation, not a new tracking feature or visual direction.

Authority: inspect/edit/test/scoped local commits allowed by the implementation
request and repository policy. Push, merge, deploy, hosted migrations, live data
writes, sends, collection activation, costs and new credentials forbidden for
this follow-up. Other worktrees, including the PostHog source branch and parked
PR99, were not changed. Backend, outbox, sync logic, snapshots, schema, dependencies
and metric validation contracts have no changes.

## Owner visual review and independent review

Publication and merge are **on hold for owner visual review**. Actual paired
renders of released baseline `cda1beae5857bb1ce98b44b596ada6def085edce` and
reviewed head `256676fefbe3d847eca5251ed27a0793ef0f360e` are in
[`workout-ux-visual-review/index.html`](workout-ux-visual-review/index.html),
with capture hashes, states and measurements in the adjacent manifest.
The later documentation commit does not change the captured application source.
The nine-page packet covers 320/390px weight fields, editor top/lower fields,
unchanged duration/distance targets, clear and obscured rest states, adjacent
validation, start/PDF targets and 1440px desktop sanity. No prior Claude audit
images were used. Full viewport and additional full-page context are retained.

The independent reviewer found no verified in-scope product bugs, reran all 11
UX cases, 69 frontend unit cases and the typed outbox case, and independently
checked extra narrow large-set and simultaneous typed-error fixture cases.
One measurement advisory was corrected in `256676fe`: build the canvas font
from computed font style/weight/size/family rather than its empty shorthand
when tabular numerals are set. This is test-only; application source is exactly
the reviewed `363cd58e` source. Corrected decimal checks pass 3/3, independently
rerun. Actual `135.5` width is 38.26px in the phone font; 320px usable width is
106px after, versus 10px before. The reviewer confirmed shared-dock overlap
remains at some scroll positions. The packet shows it rather than claiming D7
universally closed. Optimistic offline detail rendering remains deferred.

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
| D7 rest overlay | Independently fixed-position timer reproduced overlapping Same as last time. Timer now occupies its own row inside the existing workout dock. Add set and Same as last time can scroll clear and pass hit tests with rest running. The established sticky dock remains; scrolling content can pass behind the shared dock. Timer timestamp, ±15s adjustment, reload, dismissal, expiry and opt-in cues are preserved. |

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
   existing dock instead of becoming a second overlay. These are layout
   corrections, not new completion/rest behavior.
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
- Final normal-mode synthetic browser suite: **11 passed**. Covers
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
- Backend metric parity/validation and design-token contracts: **16 passed**.
- Vite production build passed; `git diff --check` and protocol v1.1 validation
  passed. Existing bundle-size advisory remains a baseline-unrelated warning.
- Settled synthetic Chromium screenshots captured at 320/390/1440px. Inspected
  tracker decimals, inline error, rest/secondary controls, populated builder
  top/lower fields, desktop pane and phone library dialog. Capture reports zero
  page errors and zero unexpected API requests across six contexts.

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

The initial inline-error addition caused one **introduced** test-selector
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
