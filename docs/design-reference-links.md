# Design reference links

Curated external references vetted for CVF PT (2026-08-11). Two rules frame
everything here: the brand system and tokens are locked (see `CLAUDE.md` and
`design-principles.md`), so **references inform judgment — they never inject
styles**. Anything that generates aesthetics wholesale was deliberately
excluded (uiverse, taste-skill, cloner templates).

## Adopted tooling (installed in this repo)

| Tool | What it does here | Where |
|------|-------------------|-------|
| [Agentation](https://agentation.com) | Click-to-annotate overlay in dev/preview builds — feedback arrives as exact selectors + component paths instead of prose. Used for owner phone passes and partner demo feedback. | `agentation` devDependency, mounted in `App.js` for dev/preview only |
| [Impeccable](https://impeccable.style) | Design-audit skill for Claude Code (`/impeccable audit`, slop checks). **Audit-only discipline**: findings are proposals; CVF tokens and `design-principles.md` always take precedence, and restyling still goes through the visual gate. | Claude Code plugin |

## QA references (use during audits)

- [checklist.design](https://www.checklist.design/) — per-element/page UX
  checklists; the seed for `docs/design-qa-surface-audit.md`. Consult when a
  new surface type appears (e.g. first table, first wizard).

## Working references (use at the moment of need)

- [easing.dev](https://www.easing.dev/) — visual easing-curve reference.
  Reach for it when adding **new** motion; existing choreography and
  attention recipes are already tuned and gated.
- [shadowLab](https://shadowlab.mocarski.design/) — layered box-shadow
  builder. Only relevant if the elevation tokens (`--app-elev*`) are ever
  retuned — output must be translated into tokens, never pasted inline.
- [oklch.fyi](https://oklch.fyi/) — OKLCH color picker/converter. Relevant
  only if we ever migrate the HSL token palette to OKLCH or need
  perceptually-even gradient stops.

## Browsing / inspiration (owner reading list)

- [recent.design](https://recent.design) — curated current web design.
  Input for future visual-direction decisions; feeds the cold-review
  process, never bypasses it.
- [desengs.com](https://desengs.com) — design-engineering resource
  directory; good periodic skim for new tools worth vetting here.

## Evaluated and passed on (so we don't re-litigate)

- **uiverse.io** — copy-paste elements with hardcoded styles; collides with
  tokens-only rule and signature-identity work.
- **penpot.app** — mockup canvas; our process is code-first variants behind
  preview, reviewed cold.
- **ai-website-cloner-template** — fresh Next.js scaffold for cloning
  external sites; wrong toolchain and wrong philosophy for this repo.
- **rams.ai** — automated design scoring; private-repo tier is paid and its
  headline checks duplicate our conventions + review.
- **designsystemchecklist.com** — scaled for org-wide design-system teams;
  our app-level needs are covered by the surface audit.
- **tasteskill.dev** — aesthetic-direction framework for new designs; would
  fight the established High Desert identity. Reconsider only for a future
  standalone marketing site.
- **flornkm/skills** (prefer-container-queries) — assumes Tailwind v4 /
  container-queries plugin; we're on Tailwind 3.4 with stable responsive
  layouts. Revisit on a Tailwind 4 migration.
