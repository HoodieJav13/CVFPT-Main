# Preview-only Quick rejection harness

Goal: prepare an explicit, one-shot HTTP 400 in the fictional preview adapter
so the released rejected-draft discard behavior can be checked on a new preview.
This is test instrumentation, not a change to the repair or a backend feature.

Baseline: current main `b3129d2f51ed2abac47e14d2b659f8a9aa47f9c4` (includes
owner-merged PR115 and PR117). Work only in `codex/pt-preview-400-harness`.

Authority: inspect/edit/local tests/scoped local commit allowed by this task and
repository policy; push, CI triggers, publication, deployments, hosted settings,
real data, raw credentials, and migrations forbidden in this preparation pass.

## Implementation and verification

- [x] Add failing adapter tests: exact Quick POST only, HTTP 400 before any
  fixture mutation, atomically consumed once, other requests unaffected.
- [x] Add failing browser coverage using the actual preview adapter and toolbar:
  cancelled discard retains the rejected form and recovery; accepted close,
  type change, and navigation discard only the target recovery record.
- [x] Add the `quick-400-once` option to the existing preview failure control
  and adapter. Keep the existing 503 and read failures unchanged.
- [x] Verify the real preview gate leaves the adapter unchanged outside fixture
  mode, including Production builds with opt-in flags requested.
- [x] Run frontend unit/preview/Quick suites, Production/Preview builds, and
  deployment-boundary checks. Preserve raw outputs outside the source tree.
- [x] Have an independent reviewer inspect the exact diff, requirements, and
  evidence. Resolve material findings, pin the local diff, and leave unpushed.

Review focus: requests to similar paths must not consume the switch; concurrent
Quick saves must consume it once; a rejection must add no fixture workout,
assignment or receipt; cancelled discard must retain its UUID; accepted discard
must preserve unrelated client/actor/environment records. Reload must not revive
the discarded record. The fixture-only implementation must remain absent from
the Production entry bundle.

Publication remains one separate decision: publish this exact reviewed commit
to an explicitly non-Production fixture preview for the approved browser check.
Any future result proves that instrumented build, not the earlier deployment or
real authenticated backend behavior. No publication is performed here.
