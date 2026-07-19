# Design QA — signature visual elevation

Audit date: 2026-07-19

## Run 1 — cold-baseline verdict

Before any bold-probe work, the owner reviewed the unlabeled desktop and
390×844 baseline captures for Login, Signup, coach dashboard greeting, client
dashboard greeting, the live Progress personal-record moment, and the shared
auth/dashboard entrance choreography. The owner classified the complete set as
**UNDERPOWERED — all around**: the implementation was contract-correct, but the
intended identity and signature motion were not cold-readable or distinctive
enough to ship as the completed visual objective.

That verdict is the required first link in this evidence chain. It triggered the
three-round bold-probe process and was not superseded or rewritten as a defect;
Run 2 below records the selected correction and its verification.

## Selected direction and source visuals

For Run 2, the owner selected the Poster backdrop, Medal personal-record moment,
and Surge entrance choreography from the approved bold-probe round. The active-
workout dock and selective glass recipe use the later owner-supplied pattern
references without copying their product layout or palette.

Selected visual targets:

- `/private/tmp/cvfpt-visual-revalidation-2026-07-19/bold-probes/login-poster-mobile-390x844.png`
- `/private/tmp/cvfpt-visual-revalidation-2026-07-19/bold-probes/coach-dashboard-poster-mobile-390x844.png`
- `/private/tmp/cvfpt-visual-revalidation-2026-07-19/bold-probes/progress-medal-mobile-peak-390x844.png`
- `/Users/javienchavez/Downloads/906084C3-6494-423C-845A-8ADD8CBA055B.jpg`
- `/Users/javienchavez/Downloads/AD6D8427-ED24-4C41-BDA3-A0F3106F13B3.jpg`
- `/Users/javienchavez/Downloads/C979A182-F4F1-499F-A0EE-F0DC6579E30F.jpg`

## Implementation evidence

- Login Poster, settled: `/private/tmp/cvfpt-implementation-qa/login-poster-desktop-1440x1000.png`
  and `/private/tmp/cvfpt-implementation-qa/login-poster-mobile-390x844.png`
- Signup Poster, settled: `/private/tmp/cvfpt-implementation-qa/signup-poster-mobile-390x844.png`
- Coach dashboard Poster, settled: `/private/tmp/cvfpt-implementation-qa/coach-dashboard-desktop-1440x1000.png`
  and `/private/tmp/cvfpt-implementation-qa/coach-dashboard-mobile-390x844.png`
- Client dashboard Poster, settled: `/private/tmp/cvfpt-implementation-qa/client-dashboard-mobile-390x844.png`
- Progress Medal, live PR peak/settled: `/private/tmp/cvfpt-implementation-qa/progress-medal-desktop-1440x1000.png`
  and `/private/tmp/cvfpt-implementation-qa/progress-medal-mobile-settled-390x844.png`
- Active-workout dock and rest timer: `/private/tmp/cvfpt-implementation-qa/workout-dock-mobile-390x844.png`
- Workout completion glass dialog, settled: `/private/tmp/cvfpt-implementation-qa/workout-completion-dialog-mobile-settled-390x844.png`

## Comparison and findings history

1. Poster comparisons at 390×844 matched the selected probes: the ridge and
   dual teal/gold atmosphere are immediately visible while form, greeting, and
   action contrast remain intact. Desktop 1440×1000 checks preserve the same
   hierarchy without turning the ridge into generic page decoration. Passed.
2. Medal comparison at 390×844 matched the selected hierarchy and footprint.
   The live improvement value changes with deterministic preview data, but the
   label, oversized delta, achievement ridge, gold border, and chart transition
   remain equivalent. Desktop 1440×1000 preserves the full-width achievement
   read without clipping. Passed.
3. Surge uses the selected 48px, 1.03→1 scale, 760ms duration, and 130ms stagger
   through the shared motion vocabulary. Reduced motion still skips spatial
   entrance transforms. Passed by code inspection and preview regression.
4. Initial active-workout QA found the rest-timer text inherited the default
   button foreground over a dark glass background. The running state now uses
   the readable foreground token, while the completed state has an explicit
   success glass modifier. Rechecked at 390×844; resolved.
5. Immediate dialog capture showed the expected entrance fade/zoom in progress.
   The settled 300ms capture is opaque enough for reading, preserves background
   context, keeps both actions visible, and avoids clipping at 390×844. Passed.
6. The control dock stays scoped to the active workout and does not replace app
   navigation. The glass recipe is also limited to the PR moment, workout dock,
   rest timer, and completion dialog; reading cards remain matte. Passed.
7. Reference and implementation images were reviewed together in paired
   comparison inputs. No broken crop, overflow, obscured action, incorrect
   radius, or unintended global glass treatment remained after iteration.

## Verification

- Frontend production build: passed.
- Preview Playwright regression suite: passed.
- Responsive visual checks: passed at 390×844 and 1440×1000.
- Real auth routes: Login and Signup checked outside preview mode.
- Reduced-motion dialog/select/dropdown regression: passed.
- `git diff --check`: passed.

final result: passed
