# AGENTS.md: CVF PT
What it is: Core Value Fitness's personal training app.
Shared handoff rules: /Users/jav/Projects/WORKFLOW.md
Repo rules: read CLAUDE.md fully. For strategist/executor work, run
.agentic/validate-contract-version.sh . and read .agentic/protocol.md,
.agentic/EXECUTOR.md and .agentic/PROJECT_POLICY.md.
Other PT lanes (Look A, Board, Lean C) keep their own worktrees and owners.
## Edit here
- frontend/ and backend/. Never import across the two; duplicate instead.
## Generated (never edit by hand)
- `frontend/dist/`, `frontend/playwright-report/`, and `frontend/test-results/`.
## Run and check
- Backend: `(cd backend && npm test)`.
- Frontend: `(cd frontend && npm run test:unit && npm run build)`.
- Local browser: `(cd frontend && npm run test:e2e:preview && npm run test:e2e:series)`.
- Cross-project boundaries: `scripts/check-boundaries.sh all`.
  Keep fixture-only browser checks separate from credentialed live tests and
  hosted integration checks, which require separate authorization.
- Screenshots: headless-check skill; Playwright for scripted flows (see CLAUDE.md).
## Never touch
- Applied migrations, backend/migration.sql, waiver records, real client
  data, keys (owner only).
