# Workout UI release — 2026-10-06

Status: owner-approved visual comparison; release verification in progress.

## Authority and exact reviewed source

The owner confirmed at2026-10-06 01:47:51UTC: “PT comparison looks good.”
The parent delegation explicitly clears the final visual hold and retains the
owner's earlier approval to finish PT and merge. Its current request authorizes
publishing the focused PR, waiting for all mandatory CI, merging and verifying
both exact Production deployments with non-mutating smoke checks.

This task-specific merge delegation overrides the repository's default that the
owner performs merges manually. It does not change that default for other work.
Protocol v1.1. DIAL: EXECUTE.

Authority ledger: inspect/edit/test/scoped commits/push/PR/merge and automatic
Production deployments are allowed for this UI release. Hosted migrations,
schema changes, production-data mutations, sends, costs, new/raw credentials,
PostHog activation and unrelated release work are forbidden.

- Approved documentation head: `8fd164f3d4b26f9020be0e3c6e419dd54a99f002`.
- Approved app/capture head: `770e7139c8442983d7189be33f328cd4bae84521`.
- Fresh main/base: `cda1beae5857bb1ce98b44b596ada6def085edce`; the release
  preflight fetched origin/main and found no intervening commits or conflict.
- Branch: `codex/workout-ux-followup`; other worktrees are preserved.

No application source changed after owner/independent review. New release
changes only update this status/authority documentation. The original
[numbered comparison](workout-ux-visual-review/index.html), manifest and all54
image hashes remain intact. The former local-review hold printed on those
artifacts is historical, superseded by the approval above.

## Release boundary and verification

Phone load fit, narrow builder containment, persistent field labels, accessible
entry guidance, scoped44px targets and reserved pinned timer/Finish space form
the complete reviewed UI scope. Existing tracking types, units, outbox, history,
API authorization, snapshots, backend, schema and dependencies are unchanged.
Very short/panned viewports use document scrolling with focus clearance. The
owner-approved tradeoff remains less visible entry content during rest.

The fresh exact-head run will cover backend/unit/build, normal-mode synthetic
UX and typed recovery, full preview and fixture analytics/series checks. GitHub
must pass every mandatory code, database, recovery and migration-guard job on
the PR head. Database CI uses only owned disposable stacks; no hosted database
operation is requested or performed. Credential-dependent live-auth tests and
physical Safari/keyboard/PWA remain unavailable and are not claimed.

Merge to main automatically deploys both Vercel roots. There is no new migration,
so no hosted migration or label is required. Production collection remains
hard-disabled; the analytics source and build gate are byte-identical to main.
Production smoke is limited to public login/static assets, backend health,
unauthenticated auth boundaries, exact-origin CORS and retired-route404 checks;
no real client login, logging, completion or other business write occurs.

Rollback, if needed, is the existing application deployment alias procedure;
no schema rollback or data rewrite is part of this UI release. Any material
blocker will be reported immediately. Exact PR head, CI receipts, merge SHA,
Production deployment identities/aliases and smoke results are written to the
external release handoff after verification, avoiding an extra post-release
commit/deployment solely to insert its own merge SHA.
