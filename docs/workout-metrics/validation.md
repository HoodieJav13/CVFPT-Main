# Local validation and release handoff — 2026-10-05

Isolated branch: `codex/workout-duration-distance`, based on freshly verified main `3886fef15db67b1177a0d4cf468fd8d654d42b3e`. No pre-existing changes. No hosted migration, push, PR, merge or deployment. No credentials created/copied, real client reads/writes, notifications or email sends. Dependencies and lockfiles are unchanged.

## Evidence

| Check | Result | Evidence basis |
| --- | --- | --- |
| Backend `npm test` | 493/493, zero skipped/failed | Pure contracts and mounted Express routes with synthetic Supabase; includes client/own coach/admin attribution, foreign client/coach, archived/completed masking, invalid writes before mutation, legacy omission preservation, and private-copy access |
| Frontend `npm run test:unit` | 49/49 | Existing unit regressions; backend suite also checks duplicated frontend metric/draft helpers and optimistic metric reconciliation |
| Frontend `npm run build` | Passed | Production build; existing chunk-size/module-type warnings retained |
| Full `npm run test:e2e:preview` | 79 passed, 8 skipped, zero failed | Existing preview regression plus two new metric flows; skipped specs require separately configured real-auth environments |
| Targeted metric preview specs | 2/2 passed after final helper changes | Mobile blank actuals, explicit targets, offline queue, resume, completion/review; desktop coach save/reopen with units |
| Normal-build recovery browser | 1/1 passed | Synthetic API persists across real page reload; offline edits/extra set, lost committed add response, same-operation retry without duplication, FIFO completion, units in completed review, no unexpected API requests or page errors |
| Disposable local DB runner | Passed twice within one run: transactional migration rollback and actual local application | 22 lifecycle/grant/RLS assertions per phase; pre-migration legacy fixture retains 42.5 lb and prior reps; rollback removes new columns while preserving legacy data |
| Boundary, whitespace, shell syntax, protocol | Passed | `scripts/check-boundaries.sh`, `git diff --check`, `bash -n`, protocol v1.1 consistency |
| Rendered PDF/browser QA | Inspected locally | Synthetic printable log sheet with all four modes; coach targets and mobile tracker/completed review; no broad visual-quality claim |

The DB runner targets only fixed project `cvfpt-metrics-test`, port range 563xx and label-verified owned resources. It never uses the repository's linked project. It proves save, clone/private assignment, explicit session linkage, start snapshots, blank actuals, repeated start/resume, wrong-mode rejection/data preservation, repeated completion, immutable completed history, source changes, save-as-template, private program/day, import, history grants and existing RLS. Synthetic mutations are rolled back and the owned stack is torn down.

Reproduction:

```sh
cd backend && npm test
cd ../frontend && npm run test:unit && npm run build
npm run test:e2e:preview
npx playwright test --config playwright.metrics.config.mjs
cd .. && bash scripts/check-boundaries.sh
bash supabase/tests/workout_metrics/run.sh
```

`CVF_METRICS_EVIDENCE_DIR` optionally captures screenshots outside the repository. New dedicated workflow `.github/workflows/workout-metrics.yml` runs the DB and normal-build recovery regressions; existing CI discovers the backend and preview tests. Remote CI has not run because this branch was not pushed. Hosted integration/real-auth tests are intentionally unrun under the delegated local-only scope; local simulation is not evidence of hosted authorization or live release success.

## Decisions and review notes

1. Tracking belongs to the coach-configured workout exercise, allowing the same library exercise to be prescribed differently. The default remains reps/weight, including bodyweight. No inference from name, null load or category.
2. Four explicit modes support time and distance separately or together. Optional load and existing RPE remain available; no sides, new health fields or analytics.
3. Preserve entered s/min and m/km/mi/yd. Changing the unit keeps the number, with UI guidance. Both actual/target pairs validate positive finite values, at most 24 hours or 1,000 km. Actual API writes require numbers; coach authoring accepts numeric input strings. Prototype property names are rejected as units.
4. Targets and actuals remain optional, consistent with existing reps/RPE logging. Missing performed values honestly remain unrecorded. Recommendation: retain this behavior for launch; mandatory metric completion would be a separate product decision.
5. Existing active/completed rows keep reps/weight. Only new log-exercise inserts snapshot the current mode/targets. Editing the source affects future starts; resume/history use immutable snapshots. Same-as-last-time fills only compatible modes and blank fields.
6. New history RPC preserves the old function for rollback/older callers. Modified save/clone/import definitions retain main's superset handling, exercise-selection validation and advisory-lock behavior. No start/completion RPC replacement or authorization relaxation.
7. Program Draft and explicit CSV columns preserve typed metadata through review/commit. Existing unstructured text/PDF parsing does not guess tracking modes; the coach chooses them in review. PDF export/log sheets display the typed prescription and unit labels.
8. Native managed-worktree tooling was unavailable, so a fresh local bare clone and linked worktree were created within the task workspace. The separate PostHog worktree and parked design branch were never edited or used as backend baselines.

## Release gates and coordination

- Additive migration: `supabase/migrations/20261005165134_workout_duration_distance.sql`. Apply and independently verify it in development and production under separate owner authorization, then obtain both `migration-applied` and `prod-migration-applied` labels before merging. Respect the repository's single unapplied migration PR gate.
- Inspect hosted migration ledgers afresh; no hosted state was queried here. Release backend/frontend only after schema convergence. Reverting app code is the data-preserving rollback; retain the additive schema and recorded values. No production down migration is proposed.
- Both Vercel roots can build branch previews; this branch is not excluded by their current deployment settings. Main merge auto-deploys both roots. **Do not push until the preview/deployment gate is resolved.**
- PostHog branch `codex/posthog-coach-first-slice`: known overlaps are `frontend/src/lib/previewMode.js` and the small `CLAUDE.md` duplication/status additions. Existing CI, Vite, AppShell, SessionEditorDrawer and SeriesComposer were not edited. Reconcile those two files when sequencing merges, then rerun preview and metric checks. Do not import the parked PR #99 mockup's stale backend assumptions.
- Parent-message tools returned transport errors during the task, including after shell/file tools recovered. Progress checkpoints were posted in task commentary; this handoff is also available through automatic completion notification.
