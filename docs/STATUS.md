# CVF PT: older status history from local main

These completed feature/status notes were moved verbatim from the
`CLAUDE.md` at local main `720ad16`. Paths inside the notes still refer to
the repository root. These are historical receipts, not current rollout
authorization. Active gates and newer rollout notes stay in `CLAUDE.md`.

- Toolchain/scaffolding cleanup, brand token foundation, and visual elevation pass: **done**.
- High Desert visual system: **implemented and passed the visual-quality gate
  for the no-photo target** (see `docs/design-principles.md` and
  `design-qa.md`). The owner's first cold-baseline review classified all six
  signature surfaces UNDERPOWERED; the selected Poster, Medal, and Surge
  corrections then passed paired desktop/mobile comparison and preview
  regression. The implementation retains the shared BrandBackdrop and its
  restrained/cinematic/spectacle recipes, spectacle fixed as the active
  runtime intensity, one-time reduced-motion-safe dashboard/auth
  choreography, data-keyed Progress chart drawing, and genuine
  direction-aware PR celebration. Optional consented photography remains
  intentionally absent and is documented in `frontend/src/assets/photos/README.md`.
- Session "past"-bucketing bug (client + coach Sessions pages): **fixed**.
- Training Builder import/export (deterministic pasted text, CSV/PDF import, `commit_program_import` transactional RPC, branded PDF export): **done for the approved deterministic scope**. Paste import uses the same Program Draft review/edit and atomic commit path, supports one to five days, reuses normalized exercise matches, and tags new exercises `source='manual'` with `review_status='needs_review'`. CSV/PDF draft behavior remains three to five days. AI-assisted PDF parsing is explicitly deferred and remains safely disabled without OpenAI preview configuration.
- Resource Library: **done** — coaches/admins globally manage private-bucket PDF handouts, categories, public visibility, and soft-state client assignments; clients can list/download only public or actively assigned resources through 60-second signed URLs. Storage paths remain backend-only, uploads require PDF MIME plus signature and are capped/rate-limited at 10 MB/10 per 15 minutes, and preview mode contains deterministic public/assigned fixtures.
