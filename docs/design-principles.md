# CVF PT design principles

The source of truth for color values, typography values, radii, shadows, and other
visual tokens is [`frontend/src/index.css`](../frontend/src/index.css). Components
must consume those tokens instead of copying values into documentation or
hardcoding new ones.

These principles describe what good looks like. They are guidance, not a
checklist to pass: the owner's direction on a given screen always wins, and a
rule here that gets in the way of a better result should be raised and changed
rather than worked around. (Owner cleanup, 2026-10-01: the earlier review
gates, glass restrictions and motion limits were removed because they held the
design back.)

## Brand voice

CVF PT should feel athletic, direct, capable, and trustworthy without feeling
corporate. Coaches use it between sets and clients use it for quick decisions, so
clarity and speed come first, and the app should still be a pleasure to look at
and touch. Copy should be concise, human, and action-oriented.

## Semantic color usage

- Primary brand color identifies navigation, focus, and the main action.
- Gold is for achievement, emphasis, and pending states. It is not a
  general-purpose call-to-action color.
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
- Use cards and dashboard tiles for scanning, and give surfaces real depth
  (light, shadow, texture) where it helps them read as objects.
- Atmosphere, glow, glass and texture are welcome. The one limit is legibility:
  text and numbers must keep their contrast, and decoration must never hide
  information or make a control hard to find.
- Reuse established UI components and interaction patterns before introducing a
  new variant.

## Typography and content

Display typography should feel athletic and modern; body typography should favor
readability. Use short headings, plain labels, predictable terminology, and
tabular number treatment where comparisons matter. Do not use novelty emoji as
interface icons.

## Accessibility intent

These are the non-negotiables.

- Target WCAG AA contrast for text and interactive controls.
- Maintain visible keyboard focus and meaningful labels.
- Keep touch targets at least 44 pixels in both dimensions where practical.
- Do not rely on placeholders as labels.
- Present validation errors next to the affected control and explain recovery.
- Preserve useful content and actions at narrow widths and zoomed layouts.
- Every animation respects the reduced-motion setting and the screen works the
  same without it.

## Motion intent

Motion should make the app feel alive and responsive: ambient scenery, entrances,
press feedback, menus that spring open, numbers that count, and celebrations for
real achievements are all in scope. Two rules keep it useful:

- Motion never delays a task. A coach or client can always act immediately; an
  animation in progress never blocks a tap.
- Steady surfaces stay steady while people type or log sets. Repeated edits,
  timer ticks and polling updates do not animate on every change.

JavaScript motion recipes are owned by `frontend/src/lib/motion.js`; CSS
interaction durations and easing are owned by `frontend/src/index.css`.

## Signature scenery

The shipped app uses `BrandBackdrop` (Sandia ridge, glow, optional photo slots;
see `frontend/src/assets/photos/README.md`). The approved next direction is Sky
Field (owner, 2026-10-01): the real Sandia skyline computed from elevation data,
a sunrise light theme and a sunset dark theme, glass floating controls, and a
single corner menu on phones. It replaces `BrandBackdrop` when it is built.

## How visual work gets approved

- The owner approves a visual direction from mockups or a live prototype before
  it goes into production code. Show it on a phone and a desktop, in both
  themes, with real sample data.
- A passing build is not evidence that a design is done; show screenshots.
- Offering a bolder alternative is encouraged when it helps the decision, not
  required.
- Routine bug and accessibility fixes need no mockup round.

## Reference points

Useful for inspiration, never as templates to copy:

- **Future Pro**: visible human-coach presence and accountability.
- **WHOOP**: performance data that reads as guidance, not admin.
- **Ladder**: focused, premium strength-workout execution.
