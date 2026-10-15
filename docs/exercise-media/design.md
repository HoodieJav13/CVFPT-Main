# Exercise media — design (local build, 2026-10-15)

Status: **local build only.** Hosted storage, a hosted worker, the hosted
migration, real coaching content and the production visual direction are later
gates ([production-gates.md](production-gates.md)). Nothing here is deployed.

## What it does

- **Inline guide in the workout.** The active exercise card shows a compact,
  reserved 16:9 poster (96 px wide by default, "Larger" expands to a bounded
  full-width slot) and up to three brief cues. A short movement preview (1–8 s,
  silent) plays only after **Play preview** — muted, inline, never autoplayed,
  never looped, one player at a time, paused when scrolled away, when the page
  is hidden, on exercise change and on unmount.
- **Full instruction is separate.** **Full instruction** opens an accessible
  dialog with native controls, a captions toggle (WebVTT from coach-entered
  cues), an on-demand transcript, cues and focus return to the opener.
- **External video links stay.** The existing optional `video_url` keeps its
  precedence (workout override, then library) and renders as **External video**
  (new tab, `noopener noreferrer`). Owned media is an additional channel.
- **Upload image is first-class.** A coach can publish a photo with no video,
  later add a video (new draft seeded from the current guide, photo kept),
  replace the photo, or use a custom uploaded poster with a video.
- **Video recipe.** Scrub to a poster frame, optionally pick a movement preview
  in/out and an end still (paired start/end stills), crop each to 16:9, add
  alt text and cues, optionally offer the full video with captions/transcript.
- **Deliberate review.** Upload success is never approval. Approval requires
  three explicit confirmations (exact exercise/variant, rights, content
  accuracy) on a revision whose outputs were actually generated.

## Identity and history

- Media binds to the canonical `exercise_library.id`. Variants never share
  media automatically; the editor shows the exact name/equipment/category and
  requires an explicit "this exact exercise and variant" confirmation before a
  draft exists. Import/paste never assigns media.
- Custom workout exercises without a library id show text and any external
  link only.
- Replacement updates the **current guide** for every template, private copy,
  assignment, active log and history view that references the exercise. It
  never rewrites prescriptions, performed sets, log identity or completion.
  History screens label it **Current exercise guide** — today's guide, not a
  record of what was shown during that workout. No seen-revision snapshot is
  stored (a separate future decision).
- Workout copy/start SQL is untouched: media is resolved from a per-exercise
  current pointer at read time, so no workout/log row carries a media id.

## Data model (migration `20261015213431_exercise_media_library.sql`)

| Table | Role |
|---|---|
| `exercise_media_revisions` | One draft/revision per proposal. Owner, status (`draft→processing→ready/failed`), review (`needs_review→approved`), CAS `version`, `recipe_version`, text (alt/cues/transcript/captions) and recipe (poster mode/frame/crops, preview in/out, end still). Immutable once published except archive fields. |
| `exercise_media_assets` | Source (`source_image`, `source_video`) and generated (`poster`, `end_frame`, `preview`, `instruction`, `captions`) objects: server-generated storage key, sniffed MIME, bytes, dims, duration, audio, SHA-256, rights record (sources). Archive-only, immutable. |
| `exercise_media_current` | One pointer per exercise: `revision_id` (nullable after withdrawal) + monotonic `version`; composite FK keeps the revision on the same exercise; a trigger admits only published/approved/ready revisions. |
| `exercise_media_jobs` | One job per `(revision, recipe_version)`, leased claims, bounded attempts, safe error codes. |

All four tables: RLS enabled, no policies, no browser grants, no DELETE grant;
every helper is `security invoker` with `search_path=''`, executable by
`service_role` only. State transitions are SQL functions with row locks in one
global order (exercise → pointer → jobs → revision): create/attach/update/
process/claim/extend/complete/fail/review/publish/archive, plus batched
`exercise_media_current_bundle` and `exercise_media_library_status` reads.

## Ownership policy (proposed build default — owner to confirm before hosted use)

- Any active coach/admin may read the approved current guide.
- Drafts and raw sources are readable/editable only by their uploader or an admin.
- A coach may publish their reviewed draft when there is no current guide or
  the current guide is theirs; replacing another coach's current guide needs an admin.
- Admin may review, publish and withdraw any revision.
- Any coach may create an alternative under their own ownership; it never
  overwrites the current guide.
- A coach may self-review their own owned/permissioned content only through the
  explicit three-part attestation.
- Rights notes are visible only to the source's uploader and admins; a source
  carried into a new draft keeps its original uploader and rights record.
- The actor always comes from `req.user.coach.id`, never the request body.

## Client access

Clients never browse the library. A client (or coach) names a workout
**context** — `workout_log`, `workout_assignment`, `program_assignment`
(clients) or additionally `workout`, `library`, `revision` (coaches) — and the
server derives which canonical exercises that context contains under the
actor's current access (current client ownership, non-archived rows, current
pointer). A valid asset id outside the context is indistinguishable from a
missing one. Archived exercises and withdrawn guides return nothing (text
fallback). Read failures are 5xx/retry, never "not found".

Bytes are served only by `GET/HEAD /api/exercise-media/content/:capability`.
A capability is an HMAC-signed, short-lived token naming principal, context,
asset and revision; **every** request (including each Range request)
re-resolves the principal, the context and the current pointer, so
reassignment, archive, withdrawal or replacement stops old links immediately
in the local adapter. TTL 60 s (posters, stills, previews, captions), 300 s for
full instruction and coach source scrubbing (a long video issues later range
requests); the player refreshes once and resumes on expiry.

## API (`/api/exercise-media`, fail-closed)

Disabled (503 `media_unavailable`, and no media query during workout reads)
unless `EXERCISE_MEDIA_STORE=local` with an absolute `EXERCISE_MEDIA_ROOT`,
and never on Vercel/production.

| Route | Who | Purpose |
|---|---|---|
| `GET /capabilities` | coach | limits + processor availability |
| `GET /library-status` | coach | per-exercise readiness + summary (one SQL query) |
| `POST /exercises/:id/drafts` | coach | create (idempotent `request_id`, exact `confirm_exercise_id`, optional `base_revision_id`) |
| `GET /exercises/:id/revisions` | coach | current guide + own drafts (admin: all), paginated 30/100 |
| `GET /revisions/:id` | coach | status (owner/admin; others only the current guide) |
| `POST /revisions/:id/sources?role=` | owner/admin | multipart upload, ownership checked before bytes |
| `POST /revisions/:id/sources/remove` | owner/admin | remove a source |
| `PATCH /revisions/:id/recipe` | owner/admin | CAS text/recipe update |
| `POST /revisions/:id/process` | owner/admin | queue the real job |
| `POST /revisions/:id/frame-preview` | owner/admin | server still for browsers that cannot decode the source |
| `POST /revisions/:id/review` | owner/admin | explicit attestation |
| `POST /exercises/:id/publish` | owner/admin | CAS pointer swap |
| `POST /revisions/:id/archive` | owner/admin | discard draft / withdraw current |
| `POST /links` | any role | ≤20 assets for one context → short-lived URLs |
| `POST /resolve`, `POST /text` | any role | metadata retry, transcript |
| `GET/HEAD /content/:capability` | capability | bytes, single Range, nosniff |

Status mapping: 400 malformed, 401 no auth, 403 wrong role/`replace_requires_admin`,
404 inaccessible/missing, 409 CAS/idempotency/state, 413 too large, 415
unsupported bytes, 422 invalid recipe/media, 429 limited, 503 unavailable.
Client DTO fields are an explicit allowlist (see `serialization.js`).

## Files and processing

`LocalMediaStore` keeps objects outside any web root (`.exercise-media-local/…`
in the harness), stages uploads in quarantine, validates bytes, records the
asset row, then renames atomically; reads refuse symlinks; a bounded sweep
removes only expired quarantine parts and stale worker scratch. The worker
finishes renames interrupted by a crash on start.

`FfmpegMediaProcessor` runs FFmpeg/FFprobe 6.1.2 from a task-built container
(official Alpine digest + signed `ffmpeg=6.1.2-r2`) with `--network none`, a
read-only root, no capabilities, an unprivileged user, CPU/memory/PID limits,
an in-container kill timer and a host-side kill. Arguments are arrays (no
shell); inputs are explicit read-only file mounts; protocols are `file` only;
demuxers are named explicitly. Images run with `-noautorotate` and explicit
EXIF transposes. Outputs: 640×360 JPEG posters/end stills (≤160 KiB, metadata
stripped), H.264 yuv420p silent fast-start previews (≤720 px wide, ≤24 fps,
1–8 s, ≤2 MiB), H.264 fast-start full instruction (≤1080 px long edge, ≤30 fps,
AAC when present, ≤25 MiB), escaped WebVTT (≤64 KiB). Every output is probed
again before the database may mark the revision ready.

Limits (local acceptance values, mirrored in the browser for early feedback
with a parity test): images JPEG/PNG/static WebP ≤10 MiB, 160–8192 px per
edge, ≤32 MP; video MP4/MOV/WebM ≤100 MiB, ≤120 s, 160–3840 px, ≤8.3 MP,
≤60 fps, one video + at most one audio stream, h264/hevc/vp8/vp9/av1 only if
decodable; text: alt ≤240, ≤3 cues ≤160, transcript ≤12 000, ≤500 caption cues;
10 admitted uploads per coach per 15 minutes.

## Frontend loading, caching and privacy

- Workout reads hydrate media in **one** batched lookup (measured: 9 PostgREST
  requests for both a 7- and a 50-exercise log detail).
- Only the active exercise and the next exercise with media load a poster;
  other cards show a text "Show photo/preview" control. No preview or
  instruction bytes load until requested (measured: zero video requests).
- Links live only in an in-memory, actor-scoped cache (batched ≤20, shared
  in-flight requests, one refresh near expiry, failures never cached, cleared
  on account change). Nothing goes to localStorage, the workout outbox or the
  service worker (cross-origin API bytes are never intercepted; same-origin
  `/api` is excluded).
- Failure never blocks logging: metadata failure shows "Exercise guide
  unavailable · Retry"; a failed poster shows "Preview unavailable · Retry";
  both retries are explicit and single.

## Preview mode

A separate **Exercise media demo** scenario (preview toolbar switch, off by
default; `cvf_preview_media_scenario`) adds synthetic identities, a media
workout and coach drafts. Posters/clips are generated in the page; processing
is labelled simulation. With the switch off the media routes answer 503 like a
production build and all existing fixtures are unchanged.
