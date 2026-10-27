# RETURN — exercise media, local build (2026-10-15)

```text
Completion state:      COMPLETE-LOCAL
Protocol version:      v1.1
Baseline SHA:          8d68a7893f7a84a658ff6545bb0b2b70a0df91ce (tree 004fbfe3f1faf1785f3af25f6c81fb7110f12d0d)
Head SHA:              see "Final head" below (tested functional head 9dc347d2fa6dd602f3f39e7b08aed8ff8de0a9a8, tree 410e8bf4e9366d764ff315bcf960f0cc07881a39; later commits are documentation only)
Branch and upstream:   claude/exercise-media-local-20261015 -> NOT PUSHED (no upstream; origin push URL is the DISABLED-LOCAL-ONLY guard, left untouched)
Authority used:        CLAUDE-STARTER.md (ROLE: EXECUTOR, DIAL: EXECUTE, local build only): read/inspect; scoped local
                       product edits; one additive local migration draft created with `supabase migration new`;
                       a task-built, digest-pinned FFmpeg container; disposable owned local DB/PostgREST/API/worker;
                       tests; headless browser captures; disposable baseline and PR114 compatibility clones under the
                       task folder; scoped local commits after checks.
Commits:               19 local commits on the branch (listed below)
Files changed:         144 files vs baseline: 70 added and 17 modified, plus 57 added evidence PNGs; full list: `git diff --name-status 8d68a78 HEAD`
Migrations/deps:       1 new local migration draft supabase/migrations/20261015213431_exercise_media_library.sql
                       (SHA-256 54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c), applied only to
                       disposable local databases. No npm dependency or lockfile change (package.json scripts only).
                       Local tool: cvfpt-media-ffmpeg:6.1.2-r2-a322 (FFmpeg 6.1.2, Alpine 3.22 digest-pinned base).
Checks passed:         backend 577/577 (baseline 540); backend test:media 34/34; frontend unit 103/103 (baseline 95);
                       build; both boundary guards; contract validator; media SQL 4 groups + 5 committed races;
                       media stack guard 18; real-services integration 21/21; media mocked browser 7/7; media
                       real-local browser 4/4; preview 86 passed / 8 skipped (baseline 80/8); workout-UX 25/25;
                       invites 17, auth 4, analytics 6, series 23, metrics 3; session-series SQL + guards 18/11,
                       client-invites SQL, workout-metrics SQL; production-build gate check; PR114 composition matrix
                       (below).
Checks failed/not run: test:e2e:live and every hosted check — not-applicable (not authorized; local build only).
                       Safari/WebKit rendering — unavailable (WebKit not in the local browser cache; download not
                       authorized). PR114's invite-quick-local.cjs — not-applicable (its launcher lives outside the
                       repository; media changes no invite/claim code). ESLint — not-applicable (no ESLint config).
                       The 8 skipped preview tests are the credential-gated live-auth specs (baseline-unrelated,
                       unchanged).
External actions:      none (no push, PR, workflow, deploy, hosted migration, bucket/worker/provider change,
                       credential use, email or message)
Known gaps:            owner gates (visual direction, cold visibility, real instruction accuracy and rights); hosted
                       storage/worker/budget design (Gate 2); Quick free-text video_url composition follow-up;
                       deferred minors from the final review (listed below); Safari unverified.
Push/deploy state:     everything is local in this checkout and in two disposable clones under the task folder;
                       nothing is pushed, published or deployed.
```

## Final head

The tested functional head is `9dc347d` (app code byte-identical to `a0c28c0`,
the last functional commit). Commits after it change only documentation
(`docs/exercise-media/validation.md`, `production-gates.md`, `CLAUDE.md`,
`RETURN.md`, `exercise-media-return-manifest.json`). Run
`git log --oneline 8d68a78..HEAD` for the exact tip.

## What was built

- **Durable model** (one additive local migration): revisions with draft CAS
  versions, assets with server-generated storage keys and per-source rights,
  a current pointer per library exercise (composite FK, monotonic version,
  stale publish returns 409), lease-based jobs. Service-role only, RLS enabled
  with no policies, no DELETE grants, every function `SECURITY INVOKER` with an
  empty `search_path`. Published revisions and all assets are immutable;
  archiving is soft.
- **Real local pipeline**: local filesystem store (`O_NOFOLLOW`, staged `wx`
  writes), byte sniffing then FFprobe/FFmpeg in a network-less, read-only,
  capability-dropped container with CPU/memory/pid limits and inner+outer kill
  timers; worker with lease recovery and bounded retries; outputs are a 640×360
  JPEG poster and optional end still, a 1–8 s silent preview, an optional
  normalized full instruction (fast-start MP4), and WebVTT captions generated
  from bounded coach-entered cues.
- **APIs** (`/api/exercise-media`): coach drafts, uploads (ownership checked
  before any byte), recipe edits, processing, frame previews, explicit
  three-part review attestation, publish/withdraw; client and coach link
  issuance derived from an authorized workout/assignment/log context; HMAC
  capability bytes re-authorized on every request including Range/HEAD.
  Fails closed unless the local adapter is configured; while disabled the two
  discovery reads answer `{enabled:false}` and everything else 503.
- **Coach editor**: exact identity confirmation, image upload with keyboard
  16:9 crop and live preview, video poster scrub, 1–8 s preview in/out, start
  and end stills, caption cues and transcript, review attestations and
  deliberate publish; readiness filter, summary and badges in the library.
- **Client experience**: compact inline poster (active and next exercise only)
  with cues, preview only on tap (muted, one player, pauses offscreen, data
  saver shows size), separate **Full instruction** dialog with captions and
  transcript, **Current exercise guide** on completed history, External video
  links kept (workout override before library fallback). Media never blocks
  logging; failures, expiry and replaced guides recover with a Retry.
- **Preview mode**: an opt-in "Exercise media demo" scenario on Sarah (off by
  default; fixtures unchanged) with labelled simulated processing.
- **Fixtures**: five synthetic identities, eight generated files (seed
  20261015), each marked "SYNTHETIC TEST MEDIA — NOT INSTRUCTION".

Design: [docs/exercise-media/design.md](docs/exercise-media/design.md).
Runbook: [docs/exercise-media/local-runbook.md](docs/exercise-media/local-runbook.md).
Validation and raw evidence: [docs/exercise-media/validation.md](docs/exercise-media/validation.md).
Production gates: [docs/exercise-media/production-gates.md](docs/exercise-media/production-gates.md).
Visual review: [docs/exercise-media/visual-review/index.html](docs/exercise-media/visual-review/index.html).

## Run, stop, resume the local demo

```bash
docker build -f scripts/exercise-media/ffmpeg.Dockerfile -t cvfpt-media-ffmpeg:6.1.2-r2-a322 scripts/exercise-media
```

```bash
npm --prefix backend run dev:media-local
```

Open `http://127.0.0.1:42771/__media-demo` and choose a fictional account.
Stop with Ctrl+C, or from another shell:

```bash
npm --prefix backend run dev:media-local:down
```

Resume by running `dev:media-local` again (fresh reset; all data is
synthetic). Ownership: database project `cvfpt-media-test` (ports 58320–58329;
the Supabase CLI publishes the DB on `0.0.0.0:58322`, fictional data only),
PostgREST container `cvfpt-media-test-postgrest` on a free loopback port,
gateway/API/worker child processes carrying `--cvf-media-run=<id>`, frontend
on `127.0.0.1:42771`. Every stack-owning command takes the host-wide lock
`~/.cvfpt/disposable-db.lock`.

## Commits

```text
c919bd3 Add local exercise media schema draft with owned SQL tests
8c2efb5 Add pinned local FFmpeg processor image definition
35541f7 Add local exercise media service, processor, worker and routes
83b2f6f Hydrate current exercise guides into workout reads
0b95bd8 Refuse new unsafe external video links at library and workout writes
b54f364 Add owned local exercise media harness and real-services integration
d06a52d Add browser exercise media helpers with actor-scoped link cache
3ce883f Add coach media editor, inline workout guides and full instruction
8e00a3d Add local media demo launcher and Quick compatibility check
80a4557 Refine media layout from rendered review at 320/390/1440        (visual)
fcb0784 Keep coach library cards within a 320px phone with the media action   (visual fix)
a2eee2a Add paired exercise media visual evidence and review packet    (evidence)
434b274 Honor the host-wide disposable database lock in the media test stack
f83764f Document exercise media design, local runbook and production gates
e15a635 Fix final-review findings on the media server side
a0c28c0 Recover the media UI from replaced guides and expired links
9dc347d Refresh paired visual evidence on the reviewed head           (evidence)
+ documentation commits (validation, gates, CLAUDE.md status, RETURN, manifest)
```

## Measurements (synthetic fixtures, this machine)

| Item | Measured | Budget |
|---|---|---|
| Photo upload (66 KB JPEG) | ~0.35–0.46 s | — |
| Photo processing | ~0.6–0.9 s | — |
| Poster | 20,028 B | 160 KiB |
| 6 s 720p video job | ~2.6–3.5 s | — |
| 2 s preview / 6 s instruction / captions | 13,367 B / 44,708 B / 159 B | preview ≤ 2 MiB |
| 90 s 1080p30 source (56.7 MB) | instruction 5.77 MB, preview 48 KB; survived a forced worker crash | source ≤ 100 MiB, ≤ 120 s |
| Workout read hydration | 9 PostgREST requests for 7 and for 50 exercises | bounded, batched |
| 50-exercise log JSON | 75,865 B | — |
| Initial tracker load | 2 poster requests (27,963 B), 0 video requests | active+next ≤ 400 KiB, 0 video |

## Authorization matrix outcome

Directly verified by mounted-route tests with the real auth middleware and by
the real-services integration (21 cases): missing/invalid auth 401; clients get
403 on every coach route; coach B cannot read, edit, process, review or publish
coach A's draft or sources, nor withdraw or replace A's current guide (admin
can); forged owner/reviewer/status/storage fields are rejected; clients get
links only through their own active assignment or nonarchived log (another
client's log or assignment is a 404 in the integration run; archived and
revoked contexts are invisible in the authorization tests; reassignment and an
archived client stop existing capabilities in the integration run); fabricated
or out-of-context asset ids come back as `missing` without bytes; capabilities
expire and are re-checked per request, including Range and HEAD; logs carry no capability, storage key, media text,
rights note or client identity. Raw sources stay with their uploader or an
admin, including drafts seeded from another coach's guide.

## PR114 compatibility (local evidence only)

Disposable clone `../compat-pr114-media-20261015`, pinned PR114
`a8a6a4958697c4d2d663ac9cc147a9b1ecc813b3` verified, composition
`2716f7e99ae770aa82284d40ebefe0b257f86fd8` (parents `a8a6a495` + `9dc347d2`,
tree `16e62c407eb52c5b111db634f1b8f214a41685f7`). Four mechanical conflicts,
resolved by keeping both features (details in validation.md). PR114's
migration stays byte-identical (`8842d98e…2119`); both migrations apply in
order. Backend 602/602, unit 140/140, build, boundaries, Quick SQL `--all`
(parity identical across 26 rows, 71 behavior/grant and 21 race assertions),
media SQL, Quick×media API 5/5 (receipt rows and request hashes byte-stable
across media replacement, started prescriptions frozen while the guide stays
live, provenance and media coexist), media integration 21/21, preview 106/8
skipped, Quick mocked 30/30, media mocked 7/7, media real-local 4/4. This
proves compatibility only and conveys no Quick release approval. PR114 itself
was not changed, pushed or dispatched.

## Visual evidence

[docs/exercise-media/visual-review/index.html](docs/exercise-media/visual-review/index.html)
pairs actual baseline (`8d68a78`, disposable clone `../visual-baseline-8d68a78`)
and proposed renders under identical synthetic responses at 320, 390 and 1440
px: 18 baseline and 39 proposed images with hashes in its `manifest.json`. The
compact default (96×54 poster) and the Larger probe are measured exactly: the
first set input moves down 108 px (compact) or 216/255/334 px (Larger at
320/390/1440); the workout control dock never moves and no capture scrolls
sideways. The headless Chromium media-controls loading arc on the instruction
frame is a capture artifact, not product UI.

## Numbered judgment calls

1. **R1 FFmpeg in a task-built container** (digest-pinned Alpine 3.22, signed
   `ffmpeg=6.1.2-r2`) instead of a host binary: provenance and sandboxing
   without global installs. Cost if wrong: processing needs Docker (already
   required for the DB).
2. **R2 schema fields beyond the plan's list** (`create_request_id`,
   `based_on_revision_id`, `preview_crop`, `include_instruction`,
   `caption_cues`, `review_attestation`): needed for idempotent creation,
   photo→video without re-upload, explicit crops, captions and deliberate
   review. Cost: extra columns to drop at hosted review if unwanted.
3. **R3 storage keys are not unique**: copied drafts reference the same
   immutable blob; nothing is purged. Cost: a later purge must ref-count.
4. **R4 fail-closed configuration**: enabled only with the local adapter and
   never on Vercel; hydration makes no query when disabled.
5. **R5 link lifetimes**: 60 s for posters/stills/previews/captions, 300 s for
   the full instruction and coach source scrubbing, with one automatic refresh
   and resume.
6. **R6 test order**: authorization/serialization/route tests were written
   after their implementation; compensated with recorded mutation checks
   (`history/raw/m1/mutation-*.log`). Weaker RED evidence for those files.
7. **R7 client DTO extras** for the instruction (captions asset, language,
   size, dimensions) to request the captions track and show data-saver sizes.
8. **R8 images use `-noautorotate` plus explicit EXIF transposes** for
   deterministic orientation including mirrored cases.
9. **R9 caching**: content `private, max-age ≤ remaining TTL`; link/resolve/text
   responses `private, no-store`.
10. **R10 widened an existing source-text test regex**
    (`tracker-exercise-videos.test.js`) to accept the new `{ media }` option;
    the invariant it guards is unchanged.
11. **R11 bounded upload-limit override** `EXERCISE_MEDIA_UPLOADS_PER_WINDOW`
    (1–1000, default 10) so the owned integration run can exceed 10 uploads;
    the default is proven by a 429 case.
12. **R12 preview media scenario is opt-in** on Sarah; off by default, existing
    fixtures unchanged.
13. **R13 no ESLint run**: the repository has no ESLint configuration.
14. **R14 visual pairs** use the normal-mode mocked API with identical fixture
    JSON and real processed synthetic assets for both sides; the baseline clone
    uses a copy-on-write copy of `node_modules` (a symlinked copy shared a Vite
    cache and broke the baseline render). Nothing was invented for the
    baseline.
15. **R15 the media test stack adopts PR114's host-wide disposable-database
    lock** so media runs never break another agent's Quick SQL run (guard tests
    13→18).
16. **Disabled discovery answers 200 `{enabled:false}`** (auth- and
    coach-gated) instead of 503, so environments without media log no 5xx on
    every coach library visit; every other route still fails closed.
17. **Seeded drafts by a non-uploader copy only alt text and cues**, not
    sources, source-timed recipe, captions or transcript — the plan's
    "raw sources readable only by their uploader or admin" wins over R2's
    convenience for other coaches.
18. **Clearing alt text is refused** (validator) and review/publish re-check
    alt text, so a published guide can never be invisible to clients.
19. **The refresh budget for the coach source scrubber lives in the editor**
    because the scrubber remounts while a fresh link loads; one refresh per
    successful load everywhere.
20. **Baseline-era SQL suites ran under the host lock taken as
    `cvfpt-media-test`**, because their runners predate the lock.
21. **PR114 composition r2 reused the r1 conflict resolutions byte-for-byte**;
    neither side changed those four files between compositions.
22. **The Quick `video_url` defense-in-depth gap is documented, not patched**,
    because PR114 must not change; rendering is safe either way.

Final-review items set aside, with reasons (details in the ledger,
`.exercise-media-local/evidence/history/ledger.md`): content route rate
limiting and per-Range query cost, multi-worker derivative keys, Linux
bind-mount permissions and WebM files without a container duration are
hosted-design (Gate 2) or unverified edge cases; hex literals exist only in the
dev-only demo login page and the preview canvas painter; capability payloads
are signed, short-lived and never logged; `instruction_audio` relies on coach
attestation as the plan intends.

## Deferred minors (from the final review)

- Changing `poster_mode` alone through the API can keep a crop validated
  against the other source (the UI resets the crop).
- `POST /programs/import/commit` still writes free-text `video_url`
  (render-safe).
- A failed rename after a committed attach discards the only staged copy;
  recovery runs only at worker start.
- `design.md` overstates a global lock order (preconditions prevent deadlock
  today).
- `processorAvailable()` blocks the event loop with a synchronous Docker
  inspect (cached for 30 s).
- Editor status polling stops after 5 minutes.
- Fast-start is computed but not enforced by the worker.
- The inline preview does not pause when the active exercise changes.
- Publish takes `FOR UPDATE` on the exercise row (`FOR NO KEY UPDATE`
  suffices); an invalid byte range returns 416 rather than 200; frame-preview
  work-dir names can collide within one millisecond; expired link-cache
  entries are not evicted; one mocked spec title says "one batched link
  request" while asserting two; the review poster can render before its link
  arrives.

## Limitations

- Chromium headless only; Safari/iOS playback is unverified.
- Local measurements use small synthetic geometry; real coach footage will be
  larger.
- Fixture review is not coach approval of real movement instruction, rights or
  accessibility content; the synthetic identities are test labels.
- The executor cannot certify cold visibility or the default footprint; both
  are owner decisions.
- Preview mode verifies UI behavior only; authorization, storage and processing
  are proven by the backend, SQL and real-services lanes.
