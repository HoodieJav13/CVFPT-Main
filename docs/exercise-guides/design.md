# Exercise guides — Photo + YouTube design (local build)

Status: **local build only** (branch `claude/youtube-exercise-guides-20261016`,
baseline `f3c063c`). Nothing here is hosted, applied, published or owner
accepted. Hosted activation steps are in [hosted-gates.md](hosted-gates.md);
how to run it is in [local-runbook.md](local-runbook.md); evidence is in
[TEST-MATRIX.md](TEST-MATRIX.md) and [visual-review/](visual-review/index.html).

Owner direction (2026-10-16): the long-term default for full exercise demos is
a YouTube link or embed. Privately hosted video stays an optional future
capability, preserved here as the explicit `full` mode.

## What a client sees

- In the workout tracker, an exercise with a current photo guide shows the
  identifying photo (compact, existing inline pattern) and up to three cues.
- An exercise with a demo shows one action in the slot the released
  "External video" link used:
  - **View demo** for a strictly parsed YouTube single-video link: opens a
    dialog;
  - **External video** for any other safe link: opens a new tab, as before.
- Missing photo or demo never blocks logging; timer, Finish, navigation and
  set entry are unchanged (paired captures show no layout shift).
- Workout history and the plan view use the same dialog. History labels it
  **Current demo**: today's demo, not a record of what was shown then.

## Click-to-load player (frontend `components/training/media/`)

`ExerciseDemoDialog` + `youtubePlayer.js`:

- **Before Play: first-party only.** Opening the dialog shows the
  CVF-served photo (or the exercise name), cues and a plain notice. There is
  no iframe, IFrame API script, YouTube thumbnail or preconnect, and zero
  requests to any provider host (asserted in the mocked browser suite and the
  real-provider proof).
- **Play: one fixed-origin iframe.** Play creates exactly one iframe at:
  - `https://www.youtube-nocookie.com/embed/<id>?playsinline=1&rel=0&cc_load_policy=1&enablejsapi=1&autoplay=1&origin=<app origin>`;
  - the id is re-derived from the URL by the strict parser, never taken from
    a DTO's `video_id`;
  - only the app **origin** is passed; no path, workout id, client name or
    token.
- **Iframe attributes.** `referrerpolicy="strict-origin-when-cross-origin"`
  (origin-only cross-origin referrer, never `no-referrer`), and
  `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`.
- **IFrame API.** `https://www.youtube.com/iframe_api` loads lazily once,
  only after Play, for ready/error events; there is a 10 s timeout.
- **Player states:**
  - *loading*, then *ready*;
  - *limited*: the API script is blocked, but the embed is still mounted;
  - *error*: 100 removed/private, 101/150 embedding refused, 153 missing
    identification, or other codes.
  Every state keeps **Open on YouTube**; the app never promises that link
  works. Error and limited states use the calm neutral treatment of the
  accepted media "unavailable" states. Try again remounts the player.
- **Size.** The player is at least 200×200 CSS px:
  - `playerFrameSize`: width clamps to 200–960, height is `max(200, 9/16·w)`;
  - on short windows the facade and player cap at 60% of the viewport height,
    but never below 200 px (200% zoom stays usable);
  - measured: 270×202 at 320px, 340×202 at 390px, 622×351 at desktop.
- **Lifecycle:**
  - `createActivePlayerGuard` keeps one active player; activating another
    destroys the previous one;
  - close, switch and unmount destroy the player and remove the iframe;
  - `visibilitychange` pauses it.
- **Focus:**
  - the dialog returns focus to its opener;
  - after Play, focus lands on a labelled player region in the app document
    ("<name> demo player"); Tab enters the player, and Escape still closes
    the dialog;
  - while focus is inside the cross-origin player, Escape belongs to YouTube;
    Shift+Tab returns to the dialog.
- **Captions and motion.** Captions use the provider's `cc_load_policy=1`
  preference; caption quality is the channel owner's responsibility. Nothing
  moves before Play, and the loading spinner is static under reduced motion.

YouTube is external, shareable content. An unlisted link is not CVF-private.
Withdrawing a demo in CVF cannot revoke a link already shared. YouTube may
show ads, branding or suggestions, and embedding can fail. Never put
client-specific or health footage on this route.

## URL parsing (`lib/exerciseDemo.js`, duplicated in both roots)

`parseYouTubeDemo(value)` returns `{ videoId, watchUrl }` or `null`.

- **Accepted:** HTTPS only, no credentials or port, and one of these hosts:
  - `youtube.com`, `www.youtube.com` or `m.youtube.com`, with
    `/watch?v=<id>` (exactly one `v`), `/shorts/<id>` or `/embed/<id>`;
  - `youtu.be/<id>`.
- **Video id:** exactly `[A-Za-z0-9_-]{11}`.
- **Rejected:**
  - whitespace, control or HTML-significant characters;
  - over 2048 characters;
  - deceptive hosts, playlist-only or channel URLs.
- **Output:** `watchUrl` is always the canonical
  `https://www.youtube.com/watch?v=<id>`. Unsupported but safe links stay
  external-only and are never rewritten.

`backend/test/exercise-demo.test.js` holds the shared accept/reject/resolve
vectors and checks that both copies agree. There is no server-side fetch,
oEmbed or YouTube API.

## Demo reference modes

The schema adds `workout_exercises.video_link_mode text NULL`. It allows
`inherit`, `override` or NULL, and the migration adds these checks:

| Mode | Stored URL | Resolves to | DTO `source` |
|---|---|---|---|
| `inherit` | must be NULL; needs `exercise_library_id` | the library exercise's current link, live | `library` |
| `override` | nonblank safe URL | that URL | `override` |
| NULL (legacy) | anything already stored | old precedence: nonempty safe row URL, else library | `legacy` (row URL) or `library` |

Rules:

- **No backfill.** NULL rows are never bulk-classified. Equality with an old
  library URL says nothing about intent.
- **Propagation.** Replacing the library link updates inheriting rows and
  empty legacy rows. Explicit overrides and nonempty legacy links never
  change.
- **Coach editor** (`DemoLinkField`):
  - choices: "Use library demo" or "Custom link for this workout";
  - a nonempty legacy row on a library exercise is labelled Legacy and stays
    as is until the coach chooses;
  - rendering never changes the row.
- **Picking a library exercise** inherits; the library URL is never copied
  into the row.
- **Server validation** (`normalizeDemoModes`) rejects contradictory new
  writes:
  - inherit on a custom row, or inherit with a URL;
  - override without a safe URL;
  - an invalid mode;
  - an explicit NULL whose URL changed.
- **Old request shapes** (no mode key) pass through unchanged.
- **Writers** (in the new migration; copied from their latest definitions):
  - `sync_workout_exercises` preserves the mode on update;
  - `clone_workout` copies it;
  - `commit_program_import` keeps an explicit mode or derives
    override/inherit from the draft URL.
- **Reads are mutation-free.** Workout and log reads resolve in batches and
  add `demo`; `video_link_mode` stays coach-only (it is not in the client
  allowlist).

**DemoDTO** (`demo` on workout exercises and log exercises):
`{ kind: 'youtube'|'external', url, video_id?, source: 'library'|'override'|'legacy', current_guide: true }`.
The browser re-derives it with `trustedDemo`: a tampered `kind`/`video_id`
never becomes an embed. Rows from an older API without `demo` fall back to
`video_url` (`demoForRow`). The existing `video_url` field remains the
resolved safe URL for older consumers.

### Quick create stays exactly v1

- **The wire schema does not change.** Quick's canonical fields, hash version
  and `v1:` prefix are unchanged. The browser projects the selection before
  freezing the body: inherit becomes an empty `video_url`, override becomes
  its URL. The internal mode key is omitted, and an API mode key is rejected.
- **Golden vectors** in `backend/test/exercise-guide-references.test.js` pin
  the pre-change hashes. The committed same-request replay passes on both the
  baseline export and the head. A different `video_url` still mismatches.
- **Only fresh rows get a mode.** `create_quick_session` derives a mode for
  newly inserted rows only, after the replay check returns:
  - a nonempty URL becomes `override`;
  - a linked empty URL becomes `inherit`;
  - an unlinked empty URL stays NULL.
  Existing rows and committed receipts are never touched.

## Photo guides (default `photos` mode)

- **Processor.** `ImageOnlyProcessor` (backend) uses `sharp` 0.35.5 with
  libvips 8.18.7:
  - input must be JPEG, PNG or static WebP, sniffed from bytes first;
  - decoding is strict: `failOn: 'warning'`, at most 32 MP, sequential read,
    first page only, no animation;
  - a full decode of every pixel runs through a 16×16 box filter, so
    truncation fails;
  - the pipeline is `autoOrient` → crop in oriented coordinates → 640×360
    sRGB JPEG, using a quality ladder 82→34 to stay ≤ 160 KiB;
  - resources are bounded: one decode at a time, a queue of 4 (`processor_busy`
    503), a 10 s decode / 15 s total deadline (`processor_timeout` 503), and a
    bounded sharp cache;
  - video methods throw `video_processing_unavailable`.
- **Measured.** A synthetic poster is 17,700 bytes from a 65,956-byte source,
  with inline processing in about 38 ms.
- **Transport** (bypasses the request-body ceiling):
  1. **Intent.** `POST /revisions/:id/uploads` persists a durable intent in
     `exercise_media_upload_intents`, keyed by actor, draft and request id,
     before it issues a grant for one app-issued key,
     `staging/<intent uuid>`.
  2. **Upload.**
     - **Local:** an HMAC-signed loopback `PUT /api/exercise-media/staging/:grant`,
       valid for 15 minutes and limited to image content types.
     - **Supabase adapter:** the provider's signed upload URL, documented by
       the provider as valid for 2 hours. That is not the app's
       read-capability TTL.
  3. **Finalize.** `.../finalize` re-authorizes the actor and current draft,
     then re-reads the stored bytes and checks length, sniff, full decode and
     digest. It attaches through the accepted
     `exercise_media_attach_source`, with intent id = asset id. No client
     facts are trusted.
  4. **Retry or cancel.** A same-request retry completes the same attachment.
     Abandon is a state change only: nothing is deleted or purged.
- **Inline leased processing.** `exercise_media_claim_revision_job` takes a
  30 s lease. A terminated request leaves a recoverable lease, and
  `POST /revisions/:id/process/resume` processes the same version once the
  lease expires (it never steals a live lease). The editor shows Resume to
  coaches who can archive the draft.
- **Unchanged from the accepted build:**
  - review and publication, current pointers and replacement (the old photo
    stays current until a new one is published);
  - R1 upload recovery and R2 selected-frame/crop/output validity;
  - per-request authorization on GET/HEAD/Range and the client allowlists.
- **One content-route fix.** The content route now uses `stream.pipeline`, so
  an aborted request cannot strand a file handle. That was fatal on Node 26;
  a regression test covers it.

### Optional still from a local clip (`LocalStillSelector`, `lib/localStill.js`)

- The coach picks a clip on the device. The browser decodes it from a blob
  URL, seeks, and exports one still (long edge ≤ 1920) through a canvas.
- Only that still goes through the normal photo upload. The clip is never
  uploaded or backed up, and the UI says so.
- The confirmed still is bound to the clip identity and time; changing either
  clears it. Blob URLs are revoked.
- An unreadable clip explains recovery, and photo upload keeps working.
- There is no server-verified frame provenance, and no YouTube extraction.

### Modes and configuration

- **Off by default.** Media is off unless `EXERCISE_MEDIA_STORE=local` and an
  absolute `EXERCISE_MEDIA_ROOT` are set. It is never on Vercel or when
  `NODE_ENV=production`.
- **`photos`** is the default.
- **`EXERCISE_MEDIA_MODE=full`** keeps the accepted FFmpeg video pipeline and
  background worker (100 MiB / 120 s video limits). The worker exits unless
  the mode is `full`.
- **`EXERCISE_MEDIA_STORE=supabase`** is recognized but never enabled: the
  configuration reports `hostedAdapter: 'requires_separate_activation'`.
- **The Supabase adapter** (`supabaseImageStore.js`) is contract-tested
  against a fake object client only. Provider errors map to
  `storage_unavailable` 503, and derivative uploads use `cacheControl:
  no-store`.
- **Capabilities.** `GET /capabilities` reports `mode`, `video_sources`,
  `upload_transport`, `processing` and `local_still_selection`. The editor
  hides video upload in photos mode.

## Limits (unchanged)

- **Images:** 10 MiB; JPEG, PNG or static WebP; edges 160–8192 px; at most
  32 MP; no animation.
- **Posters:** 640×360, ≤ 160 KiB.
- **Text:** alt text ≤ 240 characters; up to 3 cues of ≤ 160 characters.
- **Uploads:** 10 per 15 minutes.
- **Optional video:** 100 MiB / 120 s.
- **Practical targets** (not rejection limits): about 1–3 MB source photos and
  about 80 KB posters.

## Schema (local, unapplied)

- **New migration.** `supabase/migrations/20261016170000_exercise_guides_photo_youtube.sql`
  (SHA-256 `69ec99a0049d68f05dffff3ec6f37a7d9c6055d78819e83db3d80f15f52ba0ae`)
  is additive and service-role only. It adds:
  - the mode column and its checks;
  - four replaced writers (`sync_workout_exercises`, `clone_workout`,
    `commit_program_import`, `create_quick_session`), each copied verbatim
    from its latest definition with minimal edits;
  - the `exercise_media_upload_intents` table with its guard trigger;
  - `exercise_media_issue_upload_intent`, `exercise_media_mark_upload_intent`
    and `exercise_media_claim_revision_job`.
- **Unchanged migrations.** The accepted media migration
  `20261015213431_exercise_media_library.sql` keeps SHA-256
  `54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c`. All 43
  released migrations are byte-identical to the baseline.

## Duplication across deploy roots

These pairs are kept in sync by parity tests:

| Browser copy | Backend copy | Parity test |
|---|---|---|
| `frontend/src/lib/exerciseDemo.js` | `backend/src/lib/exerciseDemo.js` | `backend/test/exercise-demo.test.js` |
| `frontend/src/lib/programDraft.js` | `backend/src/lib/programDraft.cjs` | Program Draft mode rules: `backend/test/exercise-guide-references.test.js` runs the same vectors against both copies |

There are no cross-root imports.
