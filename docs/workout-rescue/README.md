# Workout Rescue — initial fixture slice

**Historical first-slice description:** the integrated backend/local-test continuation is documented in [DURABLE-CONTINUATION.md](DURABLE-CONTINUATION.md). The fictional preview below remains available; its earlier fixture-only completion boundary is superseded.

This is an isolated demonstration built from main `84b47186ba8a1adf7559ff96a16eca265a0e4461` (PR122). No backend route, migration, dependency, workflow or production setting changes are included. The existing double preview gate remains authoritative and production force-disables it.

## Review

Run the existing frontend `npm run dev:preview -- --host 127.0.0.1 --port 58414 --strictPort` from `frontend/` after installing the locked dependencies. Open `/coach/programs`, choose Programs, then Foundation Strength → Define demo fallbacks. This authoring surface only exists for the fictional Foundation Strength day1. Coach/admin can name up to six complete branches, state intent/tradeoff, estimate minutes, choose required equipment, retain/reduce sets or drop rows, and enable/disable options. Reset discards unsaved edits; Cancel returns to the unchanged builder.

Switch to Client using the existing preview toolbar, then open My training → Foundation Strength day1 → Find a demo option. SPA role switching keeps the in-memory choices; a page reload resets fixtures. Provide time and available equipment, select a complete option, inspect every retained/reduced/dropped exercise, then use it in the existing guided tracker. The original Start workout path remains available without an extra step. Time/equipment edits clear the selection; Cancel keeps the original. An active workout blocks choosing a different Rescue option.

Seeded authoring examples are estimates and fictional coaching notes, explicitly labeled demonstration data.25 minutes with dumbbells+cable fits the gym option;40+ minutes with dumbbells fits the equipment option.25 minutes with dumbbells alone has no matching option until the coach authors a combined branch. Empty/disabled options, insufficient time/equipment, pain/injury, stale originals and stale branch revisions fail closed. The client never authors a branch or receives coach-only controls. No catalog inference, generated substitutions, medical advice, source-backed assertions or model calls are added. Existing single-exercise substitutions remain in the tracker.

## Contract and boundaries

`workoutRescue.js` contains pure matching, validation, diff and resolution functions. `previewMode.js` owns the in-memory fixture approval data and gates authoring by coach ownership / admin and reads by assignment. These are **preview boundaries**, not proof of hosted authorization. The production service-role API remains unchanged; real rollout needs authoritative server enforcement.

A start sends only branch id, original freshness token, branch revision, minutes and equipment through the existing preview start adapter. It re-resolves the saved choice against the current source, validates it, and snapshots a new workout using existing load resolution and tracker set creation. It never patches an existing log, prescription or completed record. Retained reps, load overrides, RPE, rest, tempo and cues come from the original. Only set counts and omissions are authored in this slice. The token is an opaque noncryptographic fixture freshness checksum; it is not an auth proof or a production revision design.

Original edits invalidate approvals; if the original day is removed/replaced, the fixture route returns an unavailable state. For an existing changed day, the coach can explicitly start fresh from the current source and save newly reviewed branches. Concurrent option edits reject stale revision saves. Requests for incompatible/missing/stale choices cause no workout creation. A chosen branch cannot replace an active or completed workout.

## Handoff to Program Change History

New demo logs carry `rescue_snapshot`: branch id/name, original_version, revision, intent and a per-exercise changes array. The existing source-workout-exercise identity is retained on the snapshotted log exercises. Keep this separate from future program edit history: a one-session Rescue choice is not a program edit. No history UI, schema or audit ledger is invented here. A production design must include assignment-specific load revisions and immutable authored branch receipts, server-side ownership, atomic start validation, idempotent start/retry and durable history. Preserve completed workout snapshots and original exercise identity.

## Handoff to Cue Retry

Rescue does not change instruction/media resolution, cue loading, retry, source attribution, metrics/outbox/replay or guided next-set/outline/repeat behavior. Retained exercise identities and cues feed the existing tracker; Cue Retry should extend those existing surfaces. Do not infer coaching sources from these fictional notes. No additional model/API service is needed for this slice.

## Verification

`npm run test:unit` includes pure Rescue regressions. `frontend/e2e/workout-rescue.spec.mjs` imports the existing guarded preview test fixture and exercises desktop/mobile review, coach authoring/cancel/reset, combined choices into the guided tracker, missing and stale fallbacks, ownership masking and active-workout protection. The existing preview regression suite remains applicable. Rendered proof is synthetic Chromium, not real-client/device or hosted-service certification. There is no dedicated TypeScript check or lint command in this JavaScript frontend; JSX production build and targeted ESLint checks complement units/browser validation.
