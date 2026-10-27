# Program Change History Implementation Plan

**Goal:** Read-only coach history for a program or client copy with explicit provenance.
**Architecture:** Existing role/ownership checks protect a read endpoint returning unavailable (no stored program revisions exist). An independent, memory-only preview journal captures successful future program/workout saves; a pure diff compares stored allowlisted snapshots. Reuse Card, Dialog, Button and existing tokens.
**Tech Stack:** Express, React, Node test runner, Playwright; no dependencies or schema changes.
**Spec:** Parent delegation, 2026-10-27.

Authority: inspect/edit/test/isolated commit allowed; push/CI/merge/deploy/hosted changes/credentials forbidden. Baseline main verified via read-only remote query: 84b47186ba8a1adf7559ff96a16eca265a0e4461. Source checkout /Users/jav/Projects/cvf/cvfpt has older user work and is untouched; isolated object store copied from preserved release candidate.

- [x] Test first: actual revision field diffs, additions/removals/reordering, missing metadata and history, detached snapshots, scope boundaries.
- [x] Implement pure allowlisted snapshot/diff and preview journal. Never infer prior values, author or time from current rows. Capture only after successful fixture saves; no completed log access.
- [x] Test and mount coach-only read endpoint with current client ownership masking and error state; no history database/table reads or writes.
- [x] Add reusable history dialog to program cards and client assigned program cards, explicit unavailable/loading/retry, source labels and revision pairs.
- [x] Verify fixture browsers at 320/390/desktop, actual baseline/after captures, real save/reopen, missing history, read-only behavior, role denials, failure and stale-response fencing.
- [x] Run unit/backend/build/boundary and preview regression checks, review actual diff, document integration and local launch, commit only locally.

Review focus: new identity IDs are displayed as removed/added (no fuzzy matching); reads must not create baselines; no author/date attribution from program creator; source template and client copy never share history; older completed logs remain unchanged.

Ruling 1: Native managed worktree tools cannot target the authoritative repo from this projectless task. Use an independent local bare object copy and linked worktree entirely within task-15, avoiding writes to any active checkout.
Ruling 2: No stored program revision schema exists. Real API returns unavailable; forward capture is fictional memory-only preview, reset on reload, not an audit trail. Durable capture is a later explicitly authorized transactional database task.
Ruling 3: Execute the already-approved slice directly, no extra agents or approval round, as required by delegation.

Implementation complete: pure snapshot/diff plus literal fixture revisions; role/current-owner-protected unavailable API; fixture-only successful-save capture; reusable UI with session/reply fencing; responsive paired evidence. Full backend (716 pass/4 platform skips), frontend units270, focused history8, build and boundaries pass. Final frozen-source preview suite:135 passes/14 designed skips/0 failures. Source committed113ed4b; documentation/evidence committed separately. Author self-review only, no additional agents per delegation.

Ruling 4: Row IDs are authoritative; replaced IDs display conservative removal/addition, never guessed edits. Cost: recreated rows can be verbose.
Ruling 5: Capture covers only named successful preview program/workout saves, excluding assignment overrides/import/copy/archive/library paths. Cost: not comprehensive history; UI/docs disclose this, and durable work is deferred.
Ruling 6: The initial full preview run was invalidated by live HMR module identity differences (baseline probe passes). Restart the frozen server and report the fresh full run; do not alter shared test helpers or product code to conceal an environment artifact.
