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
coach/client dashboard greetings, and a live personal-record moment on Progress.
Do not place the ridge as generic page decoration.

The system has three calibrated intensity variants: `restrained`, `cinematic`,
and `spectacle`. Cinematic is the product default; the preview toolbar exposes
all three for review. These are strength settings within one brand system, not
separate themes.

The current target is the no-photo fallback. Approved photography may later be
added at `frontend/src/assets/photos/login-bg.jpg` and
`frontend/src/assets/photos/dashboard-header.jpg`. Missing files intentionally
produce no network request or console error. Final image crop, overlay, and
duotone tuning waits until the real consented assets exist.
