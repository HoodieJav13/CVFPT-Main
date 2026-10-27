# Quick Session Integration Repairs Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; owner has explicitly assigned Dot/Codex as the single writer. No parallel executor or new approval pause.

**Goal:** Correct the two independently reproduced Quick card/frozen-builder defects at d6fad27 without changing product or SQL contracts.

**Architecture:** Reuse the existing Quick hook's current actor/session/client context and live controller identity to fence card follow-up responses, including reload state updates. Apply the existing frozen builder flag to nested typed controls through a Quick-only disabled fieldset. Preserve ordinary card behavior.

**Tech Stack:** Existing React, Axios, Playwright, Node unit tests; cached dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-09-quick-sessions-design.md` (R1/A5 response fences and immutable save body); independent review `task-42/quick-integration-review-d6fad27/REVIEW.md` R1/R2.

## Global Constraints

- Preserve the sealed original return packet, all42 applied migrations, accepted Quick SQL and controller bytes, existing sources and the original branch head.
- No new feature, dependency, Preview implementation, SQL, hosted mutation, push/PR, merge/deploy, email or cost.
- Test first; separate functional and visual-evidence commits; return for independent re-review.

## Review Focus

- Late Start success, conflict and generic failure after switching client/page must have no navigation, toast or busy-state effect.
- Late card library success/failure must not toast or reload a replacement context, including an already-started delayed reload.
- Same actor with a new auth epoch, account changes and unmount invalidate card follow-ups; newer assignment/operation owns current effects.
- All typed selectors, values and units remain disabled in saving/uncertain/checking/unrecovered states and retain the submitted values.
- Current card success/failure and ordinary cards still work; no repeated create or follow-up dispatch is introduced.

### Task1: Card response fences

Files: `frontend/src/components/training/QuickSessionBuilder.jsx`, `frontend/src/pages/coach/ClientDetail.jsx`; tests in both existing Quick browser specs.

- [ ] Add real rendered-card tests holding API replies across client/page/session changes, covering success/conflict/error, library reload and operation supersession. Observe required failures before code changes.
- [ ] Expose a card-operation guard from the existing Quick hook; capture actor/session/client/live controller plus operation/assignment token. Guard all Quick-only effects and chained reload updates; leave ordinary handler behavior intact.
- [ ] Run new cases plus existing Quick/controller and affected shared-page regressions. Commit only after required checks pass.

### Task2: Frozen typed controls

Files: QuickSessionBuilder and existing mocked Quick browser spec.

- [ ] Hold create / drop its reply / hold recovery and assert every typed selector/value/unit is disabled with literal60s/20m values matching the posted body. Observe failure first.
- [ ] Wrap only Quick's nested ExerciseTrackingFields in a disabled fieldset driven by the existing lock; no shared component/API change.
- [ ] Run complete frontend units, build, Quick mocked suite, Preview, Invite and auth suites plus boundaries. Preserve exact accepted SQL review rather than resetting unchanged databases.

### Task3: Evidence and re-review

- [ ] Capture affected frozen states before/after at320/390/desktop, inspect actual pixels and retain original paired evidence; separate visual commit.
- [ ] Verify all SQL/controller/source preservation hashes, original411-entry seal, clean new head/tree and bundle prerequisite. Seal a new packet with failure/green evidence and retained-check provenance; readiness is not independent acceptance or release approval.
