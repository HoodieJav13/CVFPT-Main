# Project Policy — CVF PT

**Protocol version:** v1.1

Repository-specific policy for the orchestrated build loop. These rules bind
agents working in CVF PT; they are house style, not universal executor law.
They supplement `AGENTS.md` and `CLAUDE.md` and override protocol defaults
where they are more specific.

## Authority defaults

- Inspect, edit, test, and make scoped commits when the current task requests
  implementation.
- Push every verified completed task to its stated upstream. Local-only work is
  `COMPLETE-LOCAL`, never remotely complete.
- Never merge. The owner performs merges manually on GitHub.
- Deploys and hosted migrations require explicit task authorization and the
  sequencing defined in `CLAUDE.md` or the approved plan.
- A merge to `main` triggers both Vercel Production projects through Git
  integration. For any migration-bearing PR, disclose that consequence before
  asking the owner to merge. If the approved release requires migration-first
  ordering, apply and verify the backward-compatible migration before merge or
  explicitly pause/disable automatic deployment; do not promise a post-merge
  migration-first sequence that the Git trigger makes impossible.
- Never expose or manipulate raw credentials. Existing authenticated tooling
  may be used only for an explicitly authorized action.

## Commits

- Functional and visual changes never share a commit.
- Keep commits small and scoped with honest messages.
- Multi-part prompts use one commit per part when the prompt or approved plan
  establishes that boundary.

## Migrations and data

- `supabase/migrations/` is authoritative and forward-only. Never edit, rename,
  delete, reorder, or replace an applied migration. Change applied functions in
  a new migration. `backend/migration.sql` is frozen history.
- Passing a local clean reset does not prove hosted application. State exactly
  which environment received a migration and verify hosted state separately.
- Preserve the active retirement and historical-data invariants recorded in
  `CLAUDE.md`; dormant payment-era schema and source are not cleanup targets.
- Snapshot promised money or entitlement behavior at agreement time. Keep
  shared reference data live only when propagation is intentional. If the
  product choice is unspecified and material, stop for the owner.

## Deployment boundary

Frontend and backend deploy as separate Vercel roots. Never import across the
boundary or from a repository-root shared module. Duplicate small shared code
inside both deploy roots with sync notes and record the duplication in
`CLAUDE.md`.

## Feature retirement

Retire rather than delete: unmount runtime routes, remove reachable UI,
neutralize behavior with forward changes, preserve dormant source and history,
and date the parked decision in `CLAUDE.md`. Deletion requires a separate,
explicit owner decision.

## Design and visual work

- Use the tokens and canonical motion vocabulary named in `CLAUDE.md` and
  `docs/design-principles.md`; do not introduce point-of-use magic values.
- Genuine visual-direction work follows the three-outcome quality gate,
  cold-visibility floor, bold-probe comparison, and owner decision process in
  `docs/design-principles.md`.
- Separate visual commits from functional changes. Routine bug and
  accessibility corrections do not require manufactured design variants.

## Credentials and legal content

- Credential creation, retrieval, rotation, and disabling are owner-only in
  provider dashboards. Do not print or copy raw secrets into prompts, logs, or
  repository files.
- Do not invent waiver, policy, or other legal text. Stop for approved content.

## Context documentation

Read `CLAUDE.md` completely at the start of repository work. When an authorized
implementation makes its status or dated decisions stale, update it in the
same scoped pass; otherwise identify the stale line as a known gap.
