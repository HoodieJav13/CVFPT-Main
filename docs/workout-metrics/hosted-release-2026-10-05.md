# Typed workout metrics — hosted schema verification, 2026-10-05

Owner authorized the reviewed migration in development, then Production, with schema/grant checks and rollback-only fictional probes. Owner separately authorized merging the completed PT code; merging main deploys both Vercel roots. No email/push send, telemetry activation, credential change or unrelated feature release is part of this scope.

## Exact migration and targets

Reviewed source: local feature/review head `4dc6b2ac0dba307a86b6ad5e2763e730824b1b54`, originally based on main `3886fef15db67b1177a0d4cf468fd8d654d42b3e`. Integration preserves the migration bytes exactly.

File: `supabase/migrations/20261005165134_workout_duration_distance.sql`

SHA-256: `22f230bc5d2a59f05ab1784687362793bb6cb6600665cbff894d5ae918b63f23`

| Target | Before | Application and verification |
| --- | --- | --- |
| Development `CVFPT-Main` / `hhzpzcxcurmhpmfgriqb` | 40 migrations through `20261001120000`; no metric columns or new RPCs | Exact file applied first; 41/41 ledger, no pending migration; schema/grants and all 29 rollback-only assertions passed; zero fixture/quiet-trigger leftovers |
| Production `cvfpt-production` / `dacqdoohqqcqgtpacerk` | 40 migrations through `20261001120000`; no metric columns or new RPCs | Applied only after development verification and its own preflight; 41/41 ledger, no pending migration; same checks and all 29 assertions passed; zero fixture/quiet-trigger leftovers |

Installed CLI v2.118.0 was inspected via `--help` before use. Already-configured authenticated CLI tooling required no key/password handling. Every command used an explicit target; checkout links were unchanged. For each target:

```sh
supabase migration list --project-ref <target>
supabase db push --project-ref <target> --skip-vault --dry-run
supabase db push --project-ref <target> --skip-vault --yes
supabase migration list --project-ref <target>
supabase db push --project-ref <target> --skip-vault --dry-run
```

Preflight reported exactly the reviewed migration. Apply outputs report no seeds or role changes; `--skip-vault` excludes vault updates. Post-apply dry runs return `upToDate: true` with an empty migrations list. No applied historical migration was edited or normalized.

## Schema and probe evidence

- Fourteen metric columns and six validated pair/range constraints present in each target.
- Both new history/atomic-quick RPCs are security invoker; `anon` and `authenticated` cannot execute them; `service_role` can.
- Existing RLS and all three completed-workout immutability triggers remain; new snapshot/set-check triggers are present.
- `hosted_probe.sql` exercises explicit save/clone/private copy, session start, blank actuals, resume, wrong-mode rejection, source snapshot preservation, completion/history, template/program/import, repeated-library identities, exact decimal bounds and atomic quick-complete preservation. Its synthetic legacy weight remains 42.5 lb.
- Probe identity collision checks run before inserts. All fictional business writes run inside an explicit transaction ending in rollback, with 2-second lock / 20-second statement bounds. No auth user/account provisioning or application API call occurs. A transaction-local BEFORE INSERT guard returns null for notifications; an assertion proves zero probe notification rows. The guard itself rolls back.
- Separate post-rollback catalog/data checks prove the fixed fictional coach/client/library/workout/log identities and temporary notification trigger are absent. No real client values were returned or edited by these probes.
- Security advisors report the expected 46 RLS-without-policy informational notices for the locked service-role architecture, and the existing unrelated [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No privacy/auth/provider setting was changed.

## Integration/release gates

Email PR105 merged at `00b77dd3518e7d6f5eaa3abcb0ffa1132070bc1e`; both Production deployments were verified READY on that exact SHA. Its actual Yahoo sanitization retest remains unperformed; no test email was sent. PostHog PR106 then merged at `f7e32a56d8b6e17e93c098f226cf76ab33839742`; Production backend `dpl_CUekPiGzQtzAVCtDgQsSvT96BJCh` and frontend `dpl_HwaWKncKKsuVqr5qvwM3dQPcz7X7` independently verified READY at that exact SHA with their Production aliases. Production collection stays hard-disabled. The unpublished metric integration rebased onto that freshly fetched main with an identical code tree; fresh backend499/unit67/build checks passed. Metric integration retains both status notes in `CLAUDE.md` and both independent changes in `previewMode.js`; original worktrees remain intact.

Before metric merge, the release PR must carry both `migration-applied` and `prod-migration-applied` labels and pass all remote code/database/recovery checks. Then independently verify both Production deployments at the exact metric merge SHA. The hosted schema is already converged; no post-merge migration is promised.

Fresh combined integration checks: 499 backend tests, 67 frontend unit tests, Production build, 79 preview browser tests (eight credential-dependent live checks skipped), five fixture analytics tests, 19 mocked recurring-session browser tests, and one dedicated offline/reload/ambiguous-response recovery browser test passed. The owned typed-metric database runner passed its legacy/new lifecycle assertions against both a simulated legacy upgrade and a clean reset, plus the concurrent extra-set/completion regression, and removed its disposable stack. The existing recurring-session SQL suite and both concurrency races also passed in their separately owned stack, with teardown verified. Dependency audits reported zero vulnerabilities. Deploy-boundary and protocol checks, 18 stack guards, 11 isolation guards, and ten mocked provisioning guards passed. These are code/fixture checks; no actual Yahoo test email or real-client browser session was run.

The race assertion uses portable `grep`, so its CI runner requires no ripgrep installation. The full owned metric SQL suite and concurrency check also passed locally with `rg` deliberately unavailable; the owned stack was removed. This test-harness correction changes no application code or applied migration bytes.

Rollback: revert application code while retaining the additive columns/RPCs and all recorded values. No down migration or rewrite of legacy/history rows is proposed. Remaining UI audit items are documented separately in `audit-reconciliation.md`; this release does not claim they are all implemented.
