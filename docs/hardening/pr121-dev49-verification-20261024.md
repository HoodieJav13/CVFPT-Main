# PR121 Development 49 verification — 2026-10-24

## Identity and authority

Owner approved the exact Development-only round described in the prepared packet: reviewed candidate `03ebb6fc1588cbf041cf0a5c3a6312c132cb1df0`, existing draft PR121 and repair branch, only migration49, normal CI/paired Previews, temporary exact-branch real-API settings and short-lived matching-origin Vercel authentication, existing fictional accounts, then cleanup. No Production SQL/data/config, merge, promotion, automatic-assignment restoration, new accounts/permanent credentials, paid activation or photos.

Authoritative reviewed pin: **03ebb6fc1588cbf041cf0a5c3a6312c132cb1df0**, tree **38a3fbf15646aebc443dad399cae29e49ab44aa7**. Temporary hosted test head: **411ddd93a50460d037231e1b5189bbe4fc0ee27b**. The cleanup commit changes only restoration of the Vite fixture gate and dated evidence documentation; runtime source and every migration match the reviewed pin. The independent local review is distinct from implementation and from these hosted checks. Frozen P1 `ee2e8c7e` remains separate.

## Migration

Development **hhzpzcxcurmhpmfgriqb**, CVFPT-Main: exact48 baseline was established first. Official Supabase CLI2.118 dry run listed only `20261024180520_pr121_program_substitution_concurrency.sql`; applied once, ledger49 verified. SHA256 **26f33c440d0ce0058bcd8f6dbbdf509e67282451b90225e083b88f2b9fcce7b9**. Live function body matched reviewed SQL; invoker security, empty search_path, no PUBLIC/anon/authenticated execution, service execution retained. Earlier48 files remain unchanged. Pre-existing leaked-password protection warning and intentional no-policy RLS informational findings were unchanged; no security setting changed. Production was not queried with SQL or migrated in this cycle.

## Hosted evidence at temporary head411ddd93

Team cvf, projects cvfpt-frontend and cvfpt-backend. Verified deployment IDs:
- Frontend `dpl_HEABTwwPADpfXaf8nrH8DBSXJ2NW`.
- Backend `dpl_5dyuiJoWWRHibB1dtB4zw2LSpzaP`.

Exact branch aliases:
- https://cvfpt-frontend-git-release-pt-seven-repairs-20261024-cvf.vercel.app
- https://cvfpt-backend-git-release-pt-seven-repairs-20261024-cvf.vercel.app

Authentication preflight rendered the actual CVF login page, verified compiled backend URL and exact CORS origin, and passed health with no app credentials or writes. Real coach A, coach B and client logins used existing fictional credentials only inside the test process; Development issuer was checked before writes. No injected app authentication, copied owner cookies, API mocks, trace/video, token/password/header/request-body artifacts or new access.

**Program phase22 checks:** actual client UI start/request, actual coach UI approval, unrelated-coach refusal, real concurrent HTTP calls to two assignments sharing one physical workout yielding one applied/one stale refusal, same-application concurrent replay yielding applied/replayed success, exactly one physical replacement, preserved logged original snapshot. These HTTP observations do not certify separate hosted database connections or lock waits; the earlier real local PostgreSQL races provide that separately attributed evidence.

**Recovery phase26 checks:** newer failed entry/event survives while an earlier real mirror response is held; same-device writes serialize with no self409; five queued edits drain with no further edit; real extra creation commits but its reply is lost, a separate extra creation never reaches server; a separately simulated coach device finishes the real workout; actual409 adoption and reload retain the original pending event and both operation IDs; visible Retry hydrates committed extra by operation ID, creates late-event conflicts and makes no new extra POST on completed history; genuinely absent extra remains explicit failed/unresolved with values/operation ID; selected completed set fields remain unchanged. The history comparison projects IDs/status/reps/load/revision, not every workout field.

Fault assistance is explicit: real HTTP responses are delayed after commit; one set PATCH and one extra POST are aborted before delivery; a different extra POST response is aborted after the real server reply. Remote completion/copy setup uses existing authenticated Development API, never browser storage mutation. Normal logging/retry controls are exercised in the actual frontend. No gameplay/app semantics changed to help capture tests.

## Review and harness corrections

Independent pre-run harness review found two mistaken test expectations, both fixed before product testing: initial in-flight saved text is a last-acknowledged indicator, and the existing five-extra cap must be honored. Synchronization now polls actual account content, and the drain begins with a prescribed-set save plus exactly five extras. Later finished-copy reconciliation uses an unvisited-station amendment, preserving the failed event.

A pre-run hash assertion did not halt the coordinator orchestration before launch. Its mismatch was independently reconciled after launch: one receipt-only line captured fictional recovery entries/IDs/states before final assertions, with no extra requests or product mutation; removing it exactly reproduced the statically reviewed hash. Actual result and cleanup assertions, not that capture, established PASS. No product source correction was needed in this hosted round.

Fresh locked CI at411ddd93: CI40123820931 and Workout metric regressions40123820923 passed. Migration guard40123820924 failed only for the intentionally absent prod-migration-applied label; migrations-in-flight passed. PR121 had no substantive reviews/threads at the checkpoint; absence is not approval. Reconcile current findings and cleanup-head checks before any release recommendation.

## Cleanup and limitations

Both phases completed owned-fixture soft archival, retained log/event/conflict history, normal logout, closed contexts/browser and process token clearing; no uncertain write or cleanup error remained. The archived/unclaimed secondary fictional profile returned to its original archive/auth/invitation state. Unresolved synthetic extra state is retained in the private test receipt; no real browser queue was accessed or cleared.

Only own three exact repair-branch Preview overrides were deleted: frontend CVF_REAL_API_VERIFY/REACT_APP_BACKEND_URL, backend CORS_ORIGINS. No baseline entry was removed. Metadata matches frontend7/backend21 baseline, no values decrypted. Vite restored byte-identical SHA256 **5f36bd19cab18c0e8264f2446807f123301e4a1dd5766b7ee5aa2c82e0b80218**. Final cleanup-head CI and READY fixture-only Previews must be verified separately; temporary-head success cannot substitute.

The saved label can remain last-acknowledged during the first in-flight request. Truly absent extras after completion remain unresolved rather than fabricated or created on history. Broad Notes/privacy/metric/legacy/offline proof was carried forward from the prior authorized cycle because those paths are unchanged; current selected history checks supplement it. No dedicated runtime console collector, physical-device/Safari, cold-service-worker/PWA, load, all-writer plan merge or hosted multi-connection certification is claimed. Fresh CI uses locked dependencies/Node22, closing the prior reused local dependency/Node26 qualification for CI coverage only.

## Production gate

Keep PR121 draft/unmerged. Current live rollback is the verified b3129d2 pair; automatic custom-domain assignment remains paused. Last prior Production ledger receipt is47; later approval must first recheck it, preserve/apply forward migration48 then49, verify access/compatibility, and only then prepare owner merge. Paired live promotion and any restoration of automatic assignment are separately authorized actions. No release-ready or Production permission is inferred from this Development report.
