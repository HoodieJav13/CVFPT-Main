# PR115 integration onto released PR117 main

Local integration verification is complete before publication. Current published-head CI and Preview results belong on PR115 and the publication handoff; earlier repair documents and captures remain historical evidence, not current integration acceptance.

## Scope and preservation

- Original PR115: codex/pr114-p2-local-repairs at 73aa3897f5be463613a9203a4938c9c60783940d. Original checkout was clean and remains untouched during integration.
- Current main: 3baea7c2f5eb4c3514e5905b9a12773b5dbc9cbe, the merge of PR117, including PR116 authoring work.
- Isolated integration: /workspace/CVFPT-Main-pr115-integrated, codex/pr115-main-integration. Merge main into the existing PR115 history; never rebase/force-push away published commits.
- Keep four PR115 repairs: normal archive sanitizer; throw workout query failures so postcommit create/status return retryable failures; recheck vanished pending storage entries through authorized status requests and account/session fences; truthful exercise-library error/retry and cancellation of stale replies.
- Keep two distinct PR117 repairs: shared canonical normalization for catalog match/coalescing/stale-name guards; explicit confirmed discard of definitively rejected Quick records on close/type/route changes, preserving uncertain/in-flight records.

Two textual conflicts only: ClientDetail state declarations and Quick mocked router. Resolution retains both the library error/attempt state and rejected-draft discard callback; retains the fault/delay-injecting library handler and the week-rhythm fixture. Other merged source is unchanged. Normalization files, UnsavedChangesContext and catalog unit regression are byte-identical to main. The final diff against main contains the prior PR115 changes plus this status/evidence update.

## Authority ledger

Inspect, scoped integration edits, fictional/local tests, scoped commit and normal push to PR115: allowed by parent-delivered owner standing authorization. Existing automatic non-Production previews: allowed only at no new cost. Paired preview connection configuration: separate task 01a11f11-af1d-741a-a780-0cb1ae9ef036, coordinate through parent at exact head; no configuration changes made here. Merge/auto-merge, Production deployment, hosted data/migrations, raw credentials, new costs, feature expansion and destructive history changes: forbidden in this task.

## Fresh verification

Fresh backend 569/569, frontend unit 139/139, production-mode build, both production-dependency audits (zero vulnerabilities), boundary guards, provisioning 10, migration-inflight fixtures 4, fake-Docker guards 18+11+25 and protocol v1.1 pass. The combined Quick browser suite passes 43/43. All three mandatory owned local database suites and the workout-metric rollback/lifecycle/race suite pass; Quick parity matches 26 report rows and owned stacks/volumes/coordination lock are removed. The full serial preview rerun passes 112 with 14 existing skips; series 23, invites 17, fictional auth 4, fictional analytics 6, and metric browser 3 all pass with zero retries/failures/flaky results. The failed-pair rerun passes 2/2. No application/test source changed between the first failed preview run and the successful serial rerun. Raw execution evidence is stored outside Git under /workspace/cvfpt-pr115-integration-evidence.

Local browser wrappers use repository Playwright with installed system Chromium and a separate output directory per suite. They retain zero retries and a single worker, never reuse a foreign server, and provide only explicit non-secret fixture/test environment values to avoid environment dumps in JSON reports. Tracked browser configurations are unchanged. Earlier before/after images retain their original source hashes and remain historical; this integration introduces no new visual direction.

Database runs use the repository-pinned Supabase CLI 2.118.0, fetched as the exact public @supabase/cli-linux-x64 package under /tmp. A fresh SUPABASE_HOME and empty inherited environment prevent passing hosted credentials/linked state. The known cloud vfs environment uses the official same-version slim image via the CLI's supported SUPABASE_USE_SLIM_IMAGES=1; this does not establish CI's default-image result. Only repository-owned disposable local stacks and fictional fixtures are used, serially, with explicit teardown and isolation checks. No SQL bytes or hosted schemas change.

## Independent review and judgments

1. Use a merge commit rather than rewrite published PR115 history, so a later normal push preserves all existing work and includes current main ancestry.
2. Combine both conflict sides according to their separate responsibilities; do not select an entire side and lose a repair. Independent pending-merge review found no actionable issue and directly passed routes 15/15, controller/catalog units 42/42, syntax/diff checks and byte-preservation checks. Exact final-head review is required before push and will be recorded in the publication handoff.
3. Reuse installed dependencies only after comparing both lockfiles byte-for-byte. Temporary node_modules links are not part of any commit; remove the backend untracked link before commit.
4. An exec-server transport disconnect occurred before the CLI extraction command began. Checked preserved files/process progress before continuing; no push had been attempted. The environment recovered. A direct CLI version check initially hit the read-only default home; a fresh temporary SUPABASE_HOME fixed it without changing HOME or accessing credentials.
5. The first full preview run was 110 passed/14 existing skips/2 timeouts and is not acceptance. Both preserved traces directly show local module requests failing with ERR_NETWORK_CHANGED before their expected controls could render (9 script failures at 15:42:33Z, 17 at 15:46:57Z). Database Docker lifecycle ran alongside that first browser run; timing supports interference but Docker causation remains inferred. Classification: unavailable environment failure. All database work was stopped before an unchanged failed-pair rerun (2/2 pass), followed by a fresh full serial browser rerun with zero retries. Independent review verified raw traces, counts and the classification. No application/test assertion/timeout was changed to hide a failure. The preserved first-run artifacts and JSON remain separate from final results.

No merge, Production action, hosted mutation, credential retrieval, billable add-on/upgrade or feature expansion has been performed. Fresh published CI and exact Preview records must be recorded after authorized push; old green checks are not current acceptance.

## Fresh check commands and limits

- Backend `npm test`: 569 passed; frontend `npm run test:unit`: 139 passed; `npm run build`: pass (existing large-chunk warning).
- Frontend/backend `npm audit --omit=dev`: zero vulnerabilities. Boundary guards, provisioning 10, migration-inflight fixtures 4, stack/isolation guards 18+11+25, protocol v1.1 and diff checks pass.
- Repository Playwright through external wrappers: preview 112 passed/14 existing skips, Quick 43, series 23, invites 17, auth 4, analytics 6, metrics 3. Final raw JSON has zero unexpected/flaky cases. Eight live-auth and six opt-in visual cases remain intentionally skipped (not-applicable to this no-hosted-data integration).
- Local repository scripts: session_series/run.sh --down, client_invites/run.sh, quick_sessions/run.sh --all --down and workout_metrics/run.sh: pass against owned disposable PostgreSQL. Official slim image limitation remains; fresh default-image CI is required after push. No historical default-image CI receipt is reused as current acceptance.
- Local raw artifacts and reproducible wrappers: /workspace/cvfpt-pr115-integration-evidence, including browser-final-stats.json, per-suite JSON/logs, database logs/parity reports, preserved first-failure traces, network evidence and attachment hash mapping.
- Hosted API/auth/business data and real devices: not run/not-applicable; no authority for those data flows here. Paired preview connection/readiness remains the separate parent-coordinated task. Merge/Production release remain gated even after code/CI success.
