# Exercise media — production gates (decisions deliberately NOT made here)

The local build is complete as a working local system. Each gate below needs
its own explicit owner authority; none is implied by this branch. Nothing has
been pushed, published, migrated on a hosted project, provisioned or deployed.

## Gate 1 — Owner review of the local UX direction and real content

- Review the paired visual evidence ([visual-review/index.html](visual-review/index.html)):
  compact 96 px inline poster (default) versus the larger full-width slot.
  Choose a direction; cold visibility is not self-certified.
- Confirm or adjust the proposed ownership policy (design.md): uploader/admin
  own drafts and sources; replacing or withdrawing another coach's current
  guide requires an admin; self-review allowed only through the explicit
  three-part attestation.
- Real exercise media requires coach review of variant matching, cues, rights
  and accessibility text. The five synthetic fixtures prove plumbing only; they
  are not instruction and must never be seeded into a hosted catalog.
- Recording "most/all exercises" by year-end or beta graduation is conditional
  timing, not a prerequisite for anything here.

## Gate 2 — Hosted storage, transport, worker, budgets and retention

The local adapter (`LocalMediaStore` + container FFmpeg + local worker) is not
a production solution: Vercel's isolated deploy roots, request-size/duration
limits and ephemeral filesystem cannot host 100 MiB streaming uploads or FFmpeg
jobs unchanged. A hosted design must choose and approve:

- **Upload transport** — likely short-lived, per-draft upload grants directly
  to private storage (no proxying 100 MiB through a serverless function), with
  the same byte limits re-checked server-side before any job.
- **Private bucket** — a new private `exercise-media` bucket accessed only by
  the backend service role (never the PDF `resource-library` bucket or its
  limits), signed reads with a short TTL. Hosted signed URLs cannot be recalled
  once issued; pointer changes stop *new* links only. Default TTL 60 s.
- **Worker placement** — a container/VM/queue worker running the pinned FFmpeg
  build with the same sandbox flags; licensing review for the GPLv3 build.
- **Costs** — storage and egress using the measurements below, with an
  explicit monthly budget and alerting.
- **Retention/purge** — today nothing is purged (archived blobs are retained
  for restoration). Decide retention for archived/withdrawn revisions and raw
  sources; any purge must reference-count copied source keys.
- **Monitoring** — job failure rates, processing times, queue depth (no media
  text, names or links in logs).

### Local measurements to size the decision (synthetic fixtures, this machine)

| Item | Measured |
|---|---|
| Photo upload (66 KB JPEG) | ~0.4–0.5 s round trip |
| Photo processing (decode, EXIF orient, crop, 640×360 JPEG) | ~0.7–0.8 s |
| Poster/still size | ~20 KB (budget 160 KiB) |
| 6 s 720p video job (poster + 2 s preview + instruction + captions) | ~2.6–3.5 s |
| 2 s preview | ~13 KB (budget 2 MiB) |
| 6 s full instruction | ~45 KB |
| 90 s 1080p30 source (56.7 MB) | instruction 5.77 MB, preview 48 KB; job completed after a forced worker crash on attempt 2 |
| Workout read with media | 9 PostgREST requests for both 7 and 50 exercises (one batched lookup) |
| Initial tracker media | 2 poster requests, 0 video requests |

Real coach footage will be larger than synthetic geometry; re-measure with
consented sample clips before budgeting.

## Gate 3 — Migration sequencing and Quick Sessions

- The media migration is a **local draft** (`20261015213431_exercise_media_library.sql`,
  sha256 recorded in RETURN.md). Before any hosted use: reconcile onto the
  then-released `main` after Quick Sessions (PR114) lands, reserve a newer
  migration timestamp if needed, and obtain an independent exact-file SQL and
  permission review. Never edit an applied migration.
- At most one unapplied migration PR may be published at a time.
- The PR114 compatibility evidence in RETURN.md is a local composition check
  only; it conveys no Quick release approval.

## Gate 4 — Release authority

Publishing a migration PR, applying and verifying it on both hosted projects
(development and `cvfpt-production`, labels `migration-applied` and
`prod-migration-applied`), exact-head CI, the owner's merge and verification of
both Production deployments are separate authorities. Merging deploys both
roots immediately, so hosted migration verification must precede merge. The
media routes stay fail-closed (503) on any deployment until Gate 2 provides a
hosted adapter and an explicit enablement.
