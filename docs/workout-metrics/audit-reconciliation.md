# Audit reconciliation — local metric branch, 2026-10-05

This records the original local audit reconciliation. The later owner-approved release performed rollback-only fictional probes on both hosted schemas; see `hosted-release-2026-10-05.md`. Historical local-only statements below describe the evidence available at the audit checkpoint. Actual-device, live-client and broader UI findings remain open.

The supplied audit reviewed main `3886fef15db67b1177a0d4cf468fd8d654d42b3e` and parked design `1d6de310356fe0378c96cc3a55b3d6c722c4f314`, not this implementation. Its statement that the metric branch was unavailable is historically accurate. This reconciliation applies to the changes following local feature commit `95e960f9b0213776155266ce2b8bcfc79f9ccf79`; the final handoff records the exact final head.

## Artifact provenance

Materialized the exact supplied Library IDs using current unchanged helpers and retained Library metadata:

| Library identity | Actual filename | Inspection |
| --- | --- | --- |
| `libfile_4e2ad6dc5924819187b5063dd1c6ad71` | `cvf-workout-ux-audit-2026-10-05-cited.zip` | ZIP readable; safely extracted; read `audit/REPORT.md`; inspected supplied clipping, read-failure and quick-completed detail pixels |
| `libfile_78337e294604819195d52142bf5bcf08` | `cvf-workout-ux-audit-fixture-AUDIT-ONLY.diff` | Readable 6,311-byte fixture diff; never applied to the worktree |
| `libfile_a18753448b08819196cb8e046f55d133` | `IMG_1453.JPG` | Materialized; not the audit report; not used as evidence for logging conclusions |

Original screenshots remain evidence of the stated old local preview builds only. The ZIP contains 33 screenshot members, although REPORT.md describes 104; absent listed screenshots were not inspected or assumed available. This branch's four metric screenshots and PDF rendering were independently inspected. No production/hosted preview, actual device keyboard, iOS Safari, installed PWA or live client data was checked.

## Finding disposition

| Finding / original evidence class | Current disposition and evidence |
| --- | --- |
| U2, usability judgment backed by old preview fixture | Duration/distance ambiguity addressed: coach selects explicit duration, distance or combined mode; targets labelled; actual fields start blank; entered units persist into history. Bodyweight remains legacy reps/weight. No name/category/null-load inference. Side semantics remain excluded by owner scope. |
| D1, old preview UI reproduction | Typed metric inputs use labelled rows rather than squeezing metrics into reps. Inspected current 390 px metric tracker and completed review. Existing reps/weight grid remains; old superset weight clipping and 320 px overflow are not claimed fixed. |
| D2, old preview UI reproduction | Core invalid-entry defect reproduced and fixed: shared client validation rejects RPE 11/reps 8.5 before enqueue/rest. Synthetic normal-build browser proves no request/rest and no completion toggle. Inline `aria-invalid`/described errors and full layout redesign remain follow-ups; current error uses existing toast. |
| D3(a), old preview UI reproduction; D3(b), simulated read failure | Persistent sync banner survives read failure/loading; normal-build synthetic read-failure regression passes. Queue retains values and syncs FIFO after reconnect. Local optimistic snapshot rendering on detail is still pending; stale fetched status/body or load-error body can remain below the honest banner. This is not a full D3 fix or proof of installed-PWA behavior. |
| S1, source hypothesis in §3B | Reproduced against disposable real SQL: normal start/complete-all retain planned load defaults. Fixed fresh quick-completion with service-only atomic RPC; all actuals null, completed flag true. Edited actuals/notes preserved on refusal. Mounted API rejects resumed log. Concurrent extra INSERT is serialized and rejected after completion. No hosted DB probe was authorized or run. Historical quick-completed rows are not rewritten. |
| D10, preview-only | Existing quick-complete preview semantics remain a mock discrepancy; no production inference. Synthetic SQL/mounted-route checks provide the separate quick-complete contract evidence. |
| D13, preview-only | Coach-start unsupported mock/preview-toolbar overlap remain separate preview follow-ups. Normal-build synthetic API and backend authorization tests cover metric writes; no claim of coach preview-start support. |
| D4–D9, D12, old preview UI reproductions | Existing builder overflow/placeholder labels, small targets, rest overlays, detail alignment, archive confirmation and navigation name remain for separate design work. New tracking controls have explicit labels; no blanket correction claim. |
| D11 and focused-entry observations, design-only | Parked branch code not imported or changed; no new-head conclusion from those screenshots. |
| U1, U3–U12 and §3D | Usability judgments/preferences remain design follow-ups. Preserve established weight initialization; duration/distance actuals stay blank. Matching-mode history handles repeated library occurrences. No sides, analytics, stepper redesign or rest-layout changes added. |

## Reconcile §5 and implementation-plan step 8

Tracking belongs to each workout exercise, not a shared library default, so the same library entry can have different prescriptions. Modes are `reps_weight`, `duration`, `distance`, `duration_distance`. Optional load remains useful for timed loaded holds/carries; hiding all load for non-reps types would remove that supported use. Recommendation: preserve optional load, and let the separate layout review consider its prominence.

Units are per entered target/set: s/min and m/km/mi/yd. Selecting a unit reinterprets the numeric entry, with visible guidance, preserving corrections such as “2 mi” to “2 km”; it does not silently convert or round. This is safe as an explicit entry contract, but users accustomed to conversion may expect otherwise. Recommendation: retain the documented contract for this entry form; add an explicit conversion action only if desired separately.

Legacy free-text “45s”, “500m”, “AMRAP” and “8/side” prescriptions/history remain untouched; coaches explicitly choose new modes for future starts. Existing active/completed logs keep their snapshots. No migration suggestion engine or side flag is in scope. No volume/PR/delta or other analytics additions.

Step 8's time/distance-aware fields, typed target displays, Program Draft duplication, CSV/import metadata and PDF/log-sheet changes are implemented. Its “/side” acceptance criterion is out of scope. Separate David metric scenario keeps Sarah unchanged. Focused-entry steppers/themes on the stale design branch are not part of this implementation.

## Additional adversarial review

Red tests verified then fixed: old server silently ignoring metric fields, repeated-library occurrences collapsing into one history entry, and floating-point upper bounds disagreeing with PostgreSQL exact decimal arithmetic. A real two-transaction probe found then fixed the completed-log extra-set INSERT race. Final independent read-only reviewer found no remaining verified defect in these revised changes; it did not independently run the shared database stack. See `validation.md` for executed checks and release gates.
