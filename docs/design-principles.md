# CVF PT design principles

The source of truth for color values, typography values, radii, shadows, and other
visual tokens is [`frontend/src/index.css`](../frontend/src/index.css). Components
must consume those tokens instead of copying values into documentation or
hardcoding new ones.

## Brand voice

CVF PT should feel athletic, direct, capable, and trustworthy without feeling
corporate. Coaches use it between sets and clients use it for quick decisions, so
clarity and speed matter more than decoration. Copy should be concise, human, and
action-oriented.

## Semantic color usage

- Primary brand color identifies navigation, focus, and the main action.
- Gold is reserved for credits, achievement, emphasis, and pending states. It is
  not a general-purpose call-to-action color.
- Success color communicates confirmed or completed states.
- Destructive color is reserved for errors, warnings that need intervention, and
  destructive actions.
- Muted colors support hierarchy but must remain readable in bright gym
  environments.

Do not encode meaning through color alone. Pair status color with text, an icon,
or another accessible indicator.

## Layout philosophy

- Design mobile-first for one-handed use, then expand into denser desktop layouts.
- Prefer clear hierarchy, compact groups, and generous separation between groups
  over an undifferentiated wall of controls.
- Keep primary actions easy to reach and secondary actions visually quieter.
- Use cards and dashboard tiles for scanning, but avoid nesting surfaces without a
  clear information reason.
- Keep reading areas matte and calm. Decorative glow, texture, or gradient may
  appear sparingly outside text-heavy content; it must never impair contrast or
  dominate the viewport.
- Reuse established UI components and interaction patterns before introducing a
  new variant.

## Typography and content

Display typography should feel athletic and compact; body typography should favor
long-form readability. Use short headings, plain labels, predictable terminology,
and tabular number treatment where comparisons matter. Do not use novelty emoji
as interface icons.

## Accessibility intent

- Target WCAG AA contrast for text and interactive controls.
- Maintain visible keyboard focus and meaningful labels.
- Keep touch targets at least 44 pixels in both dimensions where practical.
- Do not rely on placeholders as labels.
- Present validation errors next to the affected control and explain recovery.
- Preserve useful content and actions at narrow widths and zoomed layouts.

## Motion intent

Motion should be purposeful and choreographed. A small number of page-load and
achievement sequences may be expressive; personal records and a just-completed
workout are the approved rare achievement-family entrances. Forms, builders,
and repetitive task surfaces remain calm. Avoid decorative loops, heavy
parallax, and animation that delays a coach's task. Every sequence must respect
reduced-motion preferences and provide the same information without animation.

Rest-timer expiry and a visible unread-count increase use the same concise,
one-shot attention feedback. Equal notification polls, timer ticks, repetitive
tracker edits, and bulk notification reads do not animate.

JavaScript motion recipes are owned by `frontend/src/lib/motion.js`; CSS
interaction durations and easing are owned by `frontend/src/index.css`. Chart
drawing intentionally uses a longer explanatory timing family than page and
achievement entrances, while shared controls use the shorter interaction tokens.

## Signature backdrop and intensity

`BrandBackdrop` is the single visual grammar for the Sandia ridge, atmospheric
glow, and future owner-supplied photography. Use it only on Login/Signup,
coach/client dashboard greetings, and a live personal-record moment on
Progress. Do not place the ridge as generic page decoration.

The system has three calibrated intensity variants: `restrained`, `cinematic`,
and `spectacle`. **Spectacle is the fixed runtime intensity as of 2026-07.**
The preview toolbar's intensity picker has been retired; all three recipes
remain in code for reversibility, but only spectacle renders in any live
environment. These are strength settings within one brand system, not
separate themes.

The current target is the no-photo fallback. Approved photography may later be
added at `frontend/src/assets/photos/login-bg.jpg` and
`frontend/src/assets/photos/dashboard-header.jpg`. Missing files intentionally
produce no network request or console error. Final image crop, overlay, and
duotone tuning waits until the real consented assets exist.

Any element introduced as a deliberate identity or signature marker is subject
to the visual quality review below, not to restraint language alone. "Don't
clutter" and "sparingly" describe density, not permission to be invisible.

## Visual quality review

Correctness and distinctiveness are different questions. A visual deliverable
is reviewed against three outcomes, not two:

- **FAIL** — violates a correctness, accessibility, product, or design
  contract requirement in this document.
- **UNDERPOWERED** — passes every contract check, but the intended visual
  effect is not cold-readable, distinctive, or strong enough to satisfy the
  stated visual objective. This is not a defect. It is a stop-ship result for
  the objective under review, and it must never silently resolve to PASS.
- **PASS** — both contract-correct and sufficiently distinctive against the
  approved reference bar (below).

Defect severity (blocking bug vs. minor polish) is tracked separately from
this outcome. A finding can be simultaneously "zero defects" and
"UNDERPOWERED."

### Directional variants

Whether a given change qualifies as a "genuine visual-direction decision"
under this section is not a judgment the executing agent makes silently. It
must be stated explicitly, every time, with reasoning — and resolved toward
triggering this process whenever genuinely uncertain. An agent quietly
deciding something doesn't qualify is the same failure this document exists
to prevent, one level earlier.

Any genuine visual-direction decision — not a bug fix, not an accessibility
correction, not backend/integrity work — requires two materially different
alternatives before production implementation:

- **Baseline / compliant** — the disciplined interpretation that safely
  satisfies this document as written.
- **Bold probe** — a deliberately stronger exploration that pushes a relevant
  value (size, weight, contrast, opacity, crop, spatial footprint, motion
  amplitude) past the executor's default comfort level, while still meeting
  accessibility and clarity requirements.

Both variants must state exact deltas, not adjectives — e.g. "ridge opacity
0.28 → 0.42," not "make the ridge more visible."

Produce at least one genuinely distinct bold probe before a direction is
considered settled. If the baseline and bold probe are not visibly different
at the same viewport and state, revise the bold probe once. Further rounds
are owner-directed rather than automatic. If materially different probes
still fail to land, reconsider the direction itself instead of continuing to
tune execution.

Do not maintain both as permanent production code — a temporary mockup,
branch-local variant, or screenshot-only comparison is sufficient. The owner
picks the direction before either becomes the shipped implementation.

### Cold-visibility floor

Any element meant to read as a deliberate identity or signature marker must be
recognizable in an ordinary screenshot, at normal size, with no prior
knowledge of where to look. The executing agent cannot certify this itself —
it already knows where the element is, which makes it structurally unable to
judge cold-visibility. Certification requires the owner (or a reviewer with
no foreknowledge of the target), shown only the screenshot, product name,
viewport, and user task, asked what establishes the product's identity and
what decorative/identity elements they notice unprompted.

If the intended element is not noticed or described in semantically
equivalent terms — for example, "mountain landscape" counts as recognizing
the Sandia ridge — or if it does not materially change the screen's
character, the result is UNDERPOWERED. Accessibility and content clarity
remain mandatory throughout — visibility is not permission to obscure
information.

### Reference bar

Comparisons use named products, each for one specific axis — never as a
template to copy layout, color, typography, or brand assets from:

- **Future Pro** — visible human-coach presence; personalized programming and
  accountability; the connection between assigned work, coach communication,
  and visible progress.
- **WHOOP** — performance-data hierarchy; translating raw metrics into clear
  guidance; making progress and readiness feel consequential, not
  administrative.
- **Ladder** — focused strength-workout execution; confident coaching hierarchy;
  making the active workout feel guided, premium, and immediately actionable.

Pull current screenshots of the relevant reference at review time — these
apps' own UIs change, and a comparison against a stale memory of one isn't a
real comparison. For each review, record: what the reference makes
immediately legible, what gives it recognizable character, what CVF PT
should match in clarity or presence, and what CVF PT must keep uniquely its
own. Never optimize toward looking like the reference — optimize toward
matching the specific quality it's cited for.

Secondary pattern references can sharpen a component-level decision without
joining the product reference bar. Current approved patterns are modular mobile
cards for fast scanning, selective glass for rare elevated controls, a compact
floating control dock during an active workout, and contrast-aware signature
colors that remain legible over atmospheric backdrops. These are local patterns,
not permission to copy another product's navigation, layout, palette, or visual
theme. Reading surfaces remain matte; glass is reserved for the live personal-
record moment, active-workout controls, and the workout-completion dialog.

### Effort vs. impact accounting

Applies to styling, choreography, and identity proposals only — not to
schema, authorization, data-integrity, migration, or security work, which is
judged on correctness alone. Every such proposal states:

- Exact current → proposed visual delta (values, not adjectives).
- Expected user-visible effect.
- Files and components touched; any new dependency or asset.
- Responsive and accessibility regression surface.
- Implementation effort: S / M / L / XL.
- Expected visual impact: 1–5.
- Confidence and verification method.

Any proposal scored L or XL effort with expected impact of 1–2 is flagged for
an explicit owner decision — it is never presented as already-completed work.
The effort and impact scores themselves are reviewed by the owner at the same
decision point as the baseline/bold-probe choice, not self-certified by the
executing agent and checked later.
