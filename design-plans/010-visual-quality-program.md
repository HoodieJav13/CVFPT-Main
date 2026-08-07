# 010 — Visual quality program (owner-revised, 2026-08-07)

Origin: the 2026-08-07 visual quality audit (11 preview-mode captures, client-mobile
390×844 and coach-desktop 1280×800) rated the daily surfaces **UNDERPOWERED** on the
owner-named axes *generic/template-y*, *flat/lifeless*, *unrefined details* — zero
contract violations. The owner approved the audit direction with revisions; this
document is the revised program of record. Reference bar unchanged: WHOOP (data
gravitas), Ladder (execution confidence), Future (coach presence). Runna and Hevy
were scouted and rejected.

Core owner corrections to the original audit, binding on all levels:

1. **Dominant purpose, not hero object.** Each screen's dominant element follows the
   client's situation (before training → upcoming workout; during → active set +
   rest; after → completion + next step; rest day → recovery/check-in; Progress →
   latest meaningful result + trend; coach dashboard → attention items). "Up Next"
   leads Home only when it is genuinely the next action.
2. **Quality lives in states, not screenshots.** Pressed/selected/focused/disabled,
   loading/skeleton, empty/first-use, success, validation recovery, set-completion
   and rest-timer transitions, the completion moment, reduced-motion parity.
3. **Workout execution is its own design problem** (not a set-row restyle): dominant
   active set; completed sets quiet/collapsed; weight primary; sticky thumb-reach
   completion; integrated rest timer; previous/current/upcoming distinction;
   non-disruptive confirmation; a deliberate completion screen. Ladder informs
   execution *focus*, not just type.
4. **Coach presence is a product layer**, built from existing data (no photography
   required): coach note/identity on Today, "Reviewed by <name>" + timestamp,
   feedback attached to completed workouts, coach-authored observations, a clear
   next coaching action, one consistent coach identity treatment (name/initials).
5. **Data-visualization system**: line/comparison/goal-band hierarchy,
   selected-point behavior, sparse/no-data states, unit + precision rules,
   time-range controls, **direction-aware deltas** — color and achievement styling
   derive from goal direction (`improvement_direction`), never from the sign.
6. **Elevation = three surface roles** — recessed (supporting/inactive), standard
   (subtle luminance separation), raised (current action/attention only). Most
   content stays quiet so raised means something. No gradient-on-everything.
7. **Four action tiers**: hero / standard / quiet / **destructive-consequential**.
   Abandon workout, Cancel session, Withdraw request get deliberate placement,
   confirmation behavior, and recovery — not merely reduced weight.
8. **Gold**: do NOT change the shared Leagues-synced `--gold` token or the PDF hex.
   Introduce product-local `--achievement-gold` (test hue ~45) and
   `--achievement-gold-foreground`, applied to PRs/positive achievements only.
   Synchronizing the brand token later is a separate owner decision.
9. **Level 2 prototypes cover three archetypes** with identical data/viewports:
   Home (prioritization + coach presence), Tracker (high-frequency execution),
   Progress (data density + visualization). Judge whole screens, not cards.

## Level 1 — Refinement and behavior (green-lit 2026-08-07)

Audit findings 5–9 and 11–13, plus: complete control-state definitions;
destructive-action treatment; empty/loading/error/success coverage checks;
touch-target and wrapping fixes; mobile header-density reduction; semantic delta
rules; coach-presence treatment from existing data; motion + reduced-motion checks.
Classification: refinement within the approved direction (stated per the
directional-variant rule) — except the achievement-token hue, which the owner has
chosen to evaluate via the local token before any brand decision.

## Level 2 — Visual-direction prototypes

Baseline + bold-probe versions of Home, Tracker, Progress; identical preview data,
390×844 and 1280×800. Bold probes test: stronger surface depth, more confident type
hierarchy, dynamic dominant purpose, reworked tracker execution, meaningful coach
presence, stronger progress visualization. Exact value deltas recorded per variant.
Owner picks cold from screenshot pairs; variants stay branch-local until then.

## Level 3 — Propagation and quality control (after the pick)

Propagate through Sessions and coach surfaces; verify normal/empty/loading/error/
active/completed states; same-viewport comparisons; focus visibility, contrast,
touch targets, reduced motion; final consistency pass on spacing, radii, icon
sizes, labels, number formatting.
