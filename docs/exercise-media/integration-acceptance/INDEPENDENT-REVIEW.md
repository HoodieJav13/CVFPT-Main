# Independent review — released Quick PT × Exercise Media

```text
Completion state:      COMPLETE-LOCAL
Protocol version:      v1.1
Baseline SHA:          433784a42287a8d7049b8df5de4fca6a9a00bbad
                       tree bcc0a3c7cb97a386985fd4b2530538b9d58ce541
Head SHA:              98a839b5d848838b1fb4d001d7c3d0fa40ed31ca
                       tree 0e3f281f82e6de98b208ef9cb1477dd55db07d48
Parents:               433784a42287a8d7049b8df5de4fca6a9a00bbad
                       92a54240eab315f884157e8489ad20912463e516
Branch and upstream:   integrate/exercise-media-release-20261016; NOT PUSHED
Authority used:        Delegated independent READ-ONLY code/exact-file SQL review;
                       local source/evidence reads, non-mutating Git checks, report write only
Commits:               none by reviewer
Files changed:         reviewer: only this report, outside candidate checkout
                       candidate vs released base: 194 files, +18283 / -35
Migrations/deps:       existing unapplied media draft retained byte-for-byte;
                       all 43 released migrations unchanged; no new dependency/lockfile change
Checks passed:         directly verified Git identity, clean status, source/migration comparisons,
                       contract v1.1, diff whitespace, absence of source conflict markers
Checks failed/not run: no failing static acceptance check; runtime suites not rerun by reviewer
External actions:      none
Known gaps:            preserved prior media debt and separate Quick P2 work; runtime acceptance
                       continues under parent; hosted and owner gates remain separate
Push/deploy state:     local integration only; no reviewer push, CI, deployment or hosted access
```

**ACCEPTED-LOCAL for the reviewed code and SQL integration. No actionable introduced defect or local code/SQL blocker was found.** This is an independent static review of the exact merge above. It is not an independently executed runtime test matrix, a production activation approval, or a claim that either hosted database has this migration.

## Identity, complete composition and preservation

Direct Git reads confirmed the head, tree, both parents and clean status. Released `433784a` is tree-identical to pinned PR114 `a8a6a4958697c4d2d663ac9cc147a9b1ecc813b3`. The accepted media parent has tree `0f729990b90f7325267be4af1e8ee398e914aaa3`.

I compared **every file under `backend/src/`, `frontend/src/` and `supabase/migrations/`** to the prior accepted composition `990a42b1bd0b51fd08d7408df53eedbb6dba88f6`, tree `7d6741c09873bcce0e94c02eaaf8af04d9486dd5`. Only `backend/src/routes/programs.js` differs: exactly the three new URL-guard lines at 696–697 and 1112. `workoutLogs.js`, `previewMode.js` and `playwright.config.mjs` match that composition exactly. The automatically composed `trainingLibrary.js` and `WorkoutLogDetail.jsx` also match it. This catches missing or unintended merge changes beyond the five declared conflict files.

I independently compared the seven protected source files rather than relying solely on `source-invariants.json`: `quickSessionRequest.js`, `ClientDetail.jsx` and backend `quickSessions.js` equal released PT; media `service.js`, `localStore.js`, `worker.js` and `VideoSelectionEditor.jsx` equal accepted media `92a54240`. The original accepted media checkout and prior compatibility checkout were both still clean at their stated heads. No candidate or original source was edited.

The broader 194-file footprint includes inherited media implementation, tests, synthetic fixtures, visual evidence and historical returns. It is not three lines of newly written feature code. The final frame test and synthetic SQL fixture differ from accepted media only by the disclosed trailing-EOF whitespace normalization. No assertion or migration semantics were changed by that formatting adjustment.

## New guard behavior and Quick compatibility

- At `backend/src/routes/programs.js:1112`, Quick checks the incoming exercise list before normalization, fingerprinting or `create_quick_session`. `unsafeExternalVideoUrls` only examines values; it does not mutate the body. Accepted safe inputs therefore retain the released normalization, request UUID, actor derivation, payload fields and hash version. The mounted tests at `backend/test/quick-session-routes.test.js:297` and `:309` assert no RPC for unsafe resources and unchanged normalized exercises/hash for accepted optional resources.
- At `backend/src/routes/programs.js:694`, import first validates/normalizes the draft, then flattens **all days' exercises** before `commit_program_import`. That order covers `library_exercise.video_url` fallback as well as a direct `video_url`, because `backend/src/lib/programDraft.cjs:407` resolves both into the normalized field. Paste/CSV/PDF source selection and the normalized RPC payload are untouched.
- The shared validator at `backend/src/lib/externalVideo.js:8` accepts optional HTTP(S) links without userinfo, rejects unsupported schemes and oversized/non-string values, and never downloads their contents. The existing legacy-value exceptions on edit routes are retained. The new-create boundaries intentionally have no previous-row exception.
- `programs.js:1191` hydrates already allowlisted assigned exercises; the Quick assignment allowlist still exposes only `kind` and its completion flag in addition to the released client fields. Media contributes its own explicit DTO, not raw revision/source rows. `workoutLogs.js:398` retains Quick provenance alongside media; start, receipt lookup, completion and historical snapshot SQL are unchanged.

The saved RED receipt records **13 pass / 2 fail**, with both the import and Quick cases returning 201 where 400 was required. The GREEN receipt records **15/15**, including safe payload/hash assertions. I inspected these raw outputs; I did not execute them.

## Exact SQL, permissions and transition review

Reviewed file: `supabase/migrations/20261015213431_exercise_media_library.sql`, all 802 lines. Independently computed SHA-256:

```text
54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c
```

All 43 released migration blobs match the released parent. The added draft is later than `20261009200000_quick_sessions.sql`; no applied migration was renamed, replaced or edited. Its four tables and 25 functions use the `exercise_media_` namespace. It adds references to existing canonical exercise/coach identities and media objects; it does not replace released workout, Invite or Quick functions/triggers, or alter their stored snapshots.

- Lines 172–178 enable RLS without browser policies and revoke table privileges from PUBLIC/anon/authenticated. The released `20260711060556_restrict_data_api_to_service_role.sql` already removes destructive default grants for future postgres-owned tables; media grants only SELECT/INSERT/UPDATE. The local grant suite also checks absence of DELETE/TRUNCATE. This conclusion is grounded in the composed migration history, not merely the new GRANT statement.
- Every media function is SECURITY INVOKER with an empty search path. Lines 775–802 explicitly cover all 25 helper signatures, revoke browser execution and grant only service-role execution. Actor IDs passed by HTTP come from authenticated server actors. Worker helpers are service-only trusted operations, not browser-authorized RPCs.
- Lines 147, 181–236 enforce exercise/revision linkage, published revision immutability, immutable asset records and increasing current-pointer versions. Source/recipe mutation resets review and invalidates prior derivatives. Lines 607–675 require current version, required outputs and explicit review before publication; one source upload or successful processing job cannot publish itself.
- First publish locks the canonical exercise before the pointer/revision (646–652), so competing first publishers serialize even before a pointer exists. Withdrawal follows exercise → pointer → active jobs → revision (690–693), clears the current pointer with its version check and does not resurrect older media. Worker claim/completion use job → revision locks and lease tokens (515–519, 555–561); stale worker results cannot promote a superseded revision. These media operations do not introduce a reverse lock dependency on Quick receipt/workout objects.
- `exercise_media_current_bundle` (713–735) serves approved, published, non-archived current revisions and only derivative metadata. Its result contains no source keys, hashes, rights notes or uploader/reviewer identities. Stable exercise IDs link current guides to old workouts; the historical prescription/performance rows remain untouched.

This accepts the unchanged draft's composition with released Quick. It does not reclassify prior accepted media limitations as newly introduced findings or assert that every possible pre-existing concurrency issue has been eliminated.

## Authorization, R1/R2 and deployment boundaries

`authorization.js:29` derives allowed exercise IDs from an authorized workout/log/assignment context. Revision contexts are coach-only and owner/admin-only. `repository.js:80` prefers snapshotted exercise identity, with the existing legacy source fallback. Client bundle serialization (`serialization.js:8`) is an explicit allowlist. Source metadata remains restricted to owner/admin (`:107`), and ordinary current-guide contexts can obtain only derivative asset IDs. `service.js:343` verifies a signed capability and re-resolves the principal, current authorization, context membership and revision on every content request. Context-free arbitrary source reads are not introduced by this merge.

R1's preservation logic is unchanged and present: `service.js:217–227` retains staging after committed/uncertain attach; `:73–89` finalizes the original recorded key on a replay; `localStore.js:130–146` verifies bytes/hash and installs before removing staging. R2's component still binds a crop to source + target + saved timestamp (`VideoSelectionEditor.jsx:92–100`), invalidates/recaptures on selection changes (`:152–167`), and refuses stale crop writes (`:190–198`). No integration edit weakened those corrections.

Default configuration remains fail-closed at `config.js:12`: local store, absolute root, non-Vercel and non-production are all required. Disabled hydration returns without media I/O (`hydration.js:18–19`); enabled lookup failures yield unavailable media while retaining the workout (`:22–30`). Write authorization paths explicitly use `{media:false}`. Authenticated coach discovery returns disabled status, while other disabled media endpoints return 503 (`routes/exerciseMedia.js:64–104`). No hosted adapter, public storage path or FFmpeg-in-Vercel enablement was added. Frontend/backend roots remain separate and package lockfiles are unchanged.

## Runtime evidence inspected; not independently executed

These are **author-executed receipts read firsthand**, not reviewer-run suites:

| Evidence in this folder | Recorded result |
|---|---|
| `integrated-backend.log` | 611 passed, 0 failed/skipped |
| `integrated-unit.log` | 140 passed, 0 failed/skipped |
| `integrated-build.log` | build succeeds; chunk-size warning |
| `video-boundaries-red.log` / `video-boundaries-green.log` | meaningful 2-failure RED → 15/15 GREEN |
| `r1-focused.log` | 7/7 |
| `media-browser.log` | 25/25, including frame-selection regressions |
| `quick-browser.log` | 30/30 |
| `media-sql.log` | 4 SQL groups + 5 committed races; owned stack removed |
| `quick-sql.log` | `--all` succeeds; 26-row parity reports identical; owned stack removed |

The Quick `parity.diff` is empty. The parent continues remaining serialized integration/browser acceptance. Those unfinished lanes are not silently counted as passed here. Runtime reruns by this reviewer are **not-applicable to this delegated static-review lane**, intentionally omitted to respect the parent's single DB/browser owner. Hosted, production, real-client, live-auth and real-footage checks are outside the authorized local scope.

Receipt hashes inspected at review time:

```text
video-boundaries-red.log    e68dfcaa5101d3ec5fa474c6afed35e00bf69ec68d2cb567768767e17123f999
video-boundaries-green.log  3cb0559675a99275c3846134728c4ec8ea401ed86ad6931a616944f9c7650ed7
integrated-backend.log      2294eac0b866321128d8189d58c0b9528d499fed20cf9551171e140a8c515273
integrated-unit.log         a2758c5b392595930ce858432372374d1b8fb3887445f46693296a4262339747
media-sql.log              1f31fe9cc85abdc1ad6b6ad2f39e1a012c71efec01736f4302c0de11e74bd694
quick-sql.log              68bb814e31f977f6bde67debbeee592d01a25585a3858546ffd0029a089b7f26
```

## Existing debt, later reconciliation and authority

The separate unapproved Quick repair `507d23d` is excluded. Its known archive-receipt sanitizer, committed-create hydration-error, cross-tab vanished-key warning and ClientDetail retry findings are **baseline issues**, not new media regressions. Later reconciliation must account for shared `backend/src/routes/programs.js`: media URL guards/hydration overlap with Quick sanitizer/error handling. `quickSessionRequest.js` and `ClientDetail.jsx` stay byte-identical to released PT here.

The prior media return's API crop revalidation, synchronous processor check, finite editor polling, fast-start enforcement, preview pause, cache eviction and small-race debt remains inherited. The explicitly named Quick/import URL follow-up is addressed by this integration. The inherited root `RETURN.md` is historical media provenance; the parent's integration return should be the authoritative current packet. No inherited debt was quietly fixed or promoted to an integration blocker.

Hosted storage/worker/transport, budget/retention, real coaching content/rights/accessibility, owner visual direction, exact hosted migration application and publication/release remain the separate decisions in `integration-release-gates.md` and `production-gates.md`. A deliberately disabled production runtime is the intended local result. It is not missing requested hosted implementation.

Numbered judgments: (1) scope the verdict to exact local code/SQL composition; (2) inspect the prior composition in its immutable local checkout because its unrelated object is absent from the fresh anchor; (3) independently compare all runtime/migration blobs and all seven protected files; (4) read existing runtime receipts without competing with serialized acceptance; (5) preserve inherited debt and the separately unapproved Quick repair; (6) make no source edits, network/hosted calls, credential reads, provider/cost decisions, Docker/browser/DB executions, commits, push, CI or deployments. The only written artifact is this report.
