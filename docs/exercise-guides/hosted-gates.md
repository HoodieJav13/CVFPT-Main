# Exercise guides — hosted, cost, access, content and release gates

This branch is a **local build**. Nothing in it is hosted, provisioned,
applied, published, pushed, merged or deployed. Each gate below needs its own
explicit owner authorization; one gate does not imply the next. These gates
supplement, and do not replace, the accepted media gates in
[../exercise-media/integration-release-gates.md](../exercise-media/integration-release-gates.md)
and [../exercise-media/production-gates.md](../exercise-media/production-gates.md).

## What runs today, and what does not

- **Media stays disabled by default.** Local mode still requires its explicit
  absolute root. The Oct17 locally verified increment adds complete, explicit
  hosted photos-only opt-in, including a stable owner-managed secret and a
  dedicated private bucket. No hosted flags have been set and no hosted photo
  proof has run. See [local readiness and the concrete Development request](hosted-photo-readiness-20261017.md).
- **YouTube demos need no infrastructure.** They are ordinary `video_url`
  metadata plus a browser-side player. They still need the reference-mode
  migration before the mode-aware writers exist hosted.
  - Without that migration, a release must not ship this backend at all:
    it **reads** `video_link_mode` on workout and log reads (those queries
    would fail) as well as writing it. The migration must land on each
    database before its backend deploys.
  - **Rolling deploys.** A browser still running the released editor can save
    an inheriting row with the copied library link and no mode key. The
    shared writer then records it as unclassified legacy: the demo it shows
    does not change, but it stops following later library replacements. Ship
    both roots together, and ask coaches to reload open editors.
- **The Supabase private-image adapter** is now wired locally and tested through
  synthetic provider responses and the installed SDK. Uploads keep10MiB; source
  readback uses bounded1MiB API ranges. Without the complete exact opt-in,
  `EXERCISE_MEDIA_STORE=supabase` still reports `requires_separate_activation`
  and stays off. Actual Development storage/native runtime/auth/CORS proof
  remains a gate; local acceptance is not hosted readiness.

## Gate 1 — exact SQL, Development then Production

- **Candidate.** `supabase/migrations/20261016170000_exercise_guides_photo_youtube.sql`,
  SHA-256 `69ec99a0049d68f05dffff3ec6f37a7d9c6055d78819e83db3d80f15f52ba0ae`
  (local, unapplied).
- **Dependencies:**
  - it depends on the accepted, still unapplied media migration
    `20261015213431_exercise_media_library.sql` (SHA-256
    `54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c`);
  - both follow the 43 released migrations, which are unchanged.
- **What it contains:**
  - the nullable `workout_exercises.video_link_mode` column and its checks;
  - the upload-intent table, its guard and functions;
  - the leased claim function;
  - four writer replacements (`sync_workout_exercises`, `clone_workout`,
    `commit_program_import`, `create_quick_session`), copied from their latest
    definitions.
- **What it does not do:** no backfill of existing rows; no grants to `anon`
  or `authenticated`.
- **Before asking:**
  1. Reconcile with then-current `main` and the separate Quick repair
     (`73aa3897` / `507d23d`, not included here). Both touch
     `create_quick_session` and `backend/src/routes/programs.js`, so the
     replaced function bodies must be re-derived from the then-latest
     definitions. Rerun the Quick golden vectors and committed replay.
  2. Reserve a migration version later than any then-applied version.
- **Request:** exact-file application to **Development only**, with ledger,
  catalog and grant verification and bounded fictional rollback probes; then a
  separate Production request.
  - Satisfy the `migration-applied` and `prod-migration-applied` labels
    before any merge, because merging deploys Production immediately.
  - Never migrate after an incompatible automatic deploy.

## Gate 2 — private photo store activation

- **Store.** The preferred store is a **new private Supabase media bucket** on
  existing approved infrastructure, not the PDF-only Resource Library bucket.
- **Owner-only actions.** Create the bucket, set its size/MIME limits and
  private access, and create or rotate service keys. Agents never copy raw
  credentials.
- **The future activation request must name:**
  - the exact bucket and limits;
  - the runtime flags (`EXERCISE_MEDIA_STORE=supabase`, the mode, the link
    secret source);
  - a rollback (flag off; data stays);
  - a real-role integration run on Development with fictional actors: grant →
    upload → finalize → inline process → review → publish → client
    GET/HEAD/Range, plus withdrawal/reassignment refusals.
- **Upload grants.** The provider's signed upload URL is documented as valid
  for 2 hours. The app's own read capabilities remain at most 5 minutes.
  Recheck current provider documentation at activation time.
- **Retention.** No physical purge, retention countdown or shared-source
  deletion exists. Abandoned staging objects and archived revisions remain
  until an owner-approved retention and purge policy is designed.

## Gate 3 — cost and access

These figures come from the handoff's sizing model. They are not a quote and
have not been re-queried.

| Stage | Exercises | Clients | Monthly poster impressions | Retained photos | Cold monthly delivery |
|---|---|---|---|---|---|
| Image-first beta | 100 | 30 | 1,440 | ~0.217 GB | ~0.415 GB |
| Growth | 400 | 200 | 14,400 | ~0.810 GB | ~2.652 GB |

- **Usage.** The account showed low rounded aggregate usage at one point in
  time (16:16 UTC); that does not guarantee future headroom.
- **No new paid video infrastructure is needed for YouTube demos,** and no API
  key or OAuth is required for embedding.
- **Hosting plan.** If commercial use applies and Vercel remains the host, its
  Hobby policy requires a commercial-eligible plan; Pro starts at
  $20/team/month. That is a separate app-hosting decision, not a media fee.
  No upgrade is authorized here.
- **Privately hosted video vendors** and the optional `full` mode stay later
  decisions, not default infrastructure.

## Gate 4 — content and channel

- **Demo video.** Full demos are coach-reviewed videos on CVF's own YouTube
  channel, uploaded manually there, with coach-reviewed captions.
  - The agent creates no channel, uploads nothing and adds no Data API key or
    OAuth.
- **Link privacy.** Public or unlisted links are shareable; unlisted is not
  CVF-private. Withdrawing a demo in CVF cannot revoke a link already shared.
- **No client footage.** Client-specific or health footage never uses this
  route.
- **Photos.** Photos must be owned or permissioned, with accurate alt text
  and cues. All media here is synthetic test content, labelled as such; no
  exercise demonstration accuracy is certified.
- **Seed data.** Before release, replace the synthetic YouTube ids
  (`SYNTHdemo01`/`SYNTHdemo02`) and pre-existing third-party preview-fixture
  ids with CVF channel links or neutral placeholders.

## Gate 5 — visual and owner acceptance

- **Evidence so far.** Paired baseline/proposed captures exist at 320px,
  390px and desktop (`visual-review/`).
- **Owner review needed.** Visual and content acceptance and cold visibility
  are **not** self-certified, and wait for the owner's review.

## Gate 6 — real-device and provider proof

- **What exists.** Headless Chromium covers the mocked suite, the real-local
  suite and a real-provider proof with a public sample.
- **Not yet done.** iPhone Safari, Android Chrome and desktop Safari/Firefox
  have not been tested. Run the manual matrix in
  [local-runbook.md](local-runbook.md) with an approved CVF channel link.

## Gate 7 — publication, CI and release

- **Not authorized here:** push, PR, CI dispatch, preview or Production
  deployment, and merge. A push or PR can auto-deploy previews; inspect that
  behavior before any future publication request.
- **A later release must:**
  - reconcile with current `main` and the then-approved Quick tip;
  - validate both hosted ledgers and catalogs and satisfy the migration labels
    and ordering;
  - get owner visual/content/release approval;
  - verify exact deployment hashes for both roots.
