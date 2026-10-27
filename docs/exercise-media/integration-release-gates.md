# Exercise Media integration — later decisions and release authority

The code is integrated and locally accepted onto released PT `433784a`; no publish, CI, deployment, hosted data, migration, bucket, worker, credential or cost action is authorized by this task. Integration RETURN and the independent review identify exact tested source `98a839b5` and unchanged SQL. This file makes the remaining work concrete; it is not an execution request granted by the current task.

## What the current code can and cannot run

The owned local system accepts labeled synthetic image/video files, validates/probes them, processes them with the pinned FFmpeg container, explicitly reviews/publishes them, and serves current guides through authorized exercise/workout contexts. R1 recoverable bytes/retry idempotency and R2 selected source/frame/crop/output validity are preserved. Existing external HTTP(S) resources remain separate and optional.

`mediaConfig` enables storage only for an absolute local root plus `EXERCISE_MEDIA_STORE=local`, outside Vercel and production mode. Production/default configuration stays disabled: quiet discovery returns `{enabled:false}`, other media routes 503 and ordinary workout payloads do not perform media queries. Do not enable a local path, run FFmpeg in Vercel request functions or claim that pushing this branch makes the feature usable by production clients. A hosted adapter still needs implementation, tests and review after the choices below.

## Bounded decision A: approve a hosted-adapter design brief, not provisioning

Proposed brief: retain the current stable exercise identity, private authorization, exact rights/variant/content review, immutable ready revisions/current pointer and recoverable processing state. Design private object storage with backend-authorized short-lived direct upload grants, server-side byte/fact verification, a bounded job worker using the pinned safe processor, and short-lived private reads. Sources remain uploader/admin-only and clients receive only approved derivative reads through authorized contexts. Existing YouTube URLs are optional external links, never a download/frame source.

Owner inputs needed to make that brief concrete:

1. Approved worker hosting/location and permitted provider; prefer an existing approved container host if available. No provider is silently selected or purchased here.
2. Monthly storage/egress/compute spending ceiling and who receives usage alerts. Local synthetic measurements are sizing evidence, not a quote or a real-footage estimate.
3. Raw-source and archived-revision retention periods, restore expectations and who may authorize an actual reference-counted purge. Until approved, do not delete retained media or business records.
4. Whether initial instruction audio is allowed and the coach process for accurate alt text/captions/transcripts and variant/rights review. The existing explicit attestation is not validation of synthetic or AI exercise instruction.

**Precise future authorization request:** approve only a hosted-adapter design document and local adapter implementation plan using the selected inputs; no resource creation, hosted SQL, credentials, real media, deployment or spend. Once reviewed, implementation/provisioning would need another bounded authorization. Owner handles credential creation/rotation; agents never copy raw keys. A small approved sample of owned footage can be supplied later for measurement; recording the entire catalog is not a prerequisite.

## Bounded decision B: exact SQL application, separate from runtime activation

Current local SQL candidate: `supabase/migrations/20261015213431_exercise_media_library.sql`, SHA-256 `54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c`. The 43 released migration files, including Quick, are unchanged. SQL adds media-only tables/functions/triggers/grants; it does not rewrite workout/history/Quick receipt semantics. Independent integration review and local reset/grant/race evidence must be attached to the later request.

**Precise future authorization request:** after hosted-adapter source/design approval and a fresh version/ledger reconciliation, authorize an exact-file **Development-only** migration with ledger/catalog/permissions verification and bounded fictional rollback probes, no Production, real client changes, seeds, bucket/worker provisioning or deployment. Only if that succeeds request Production application/verification separately. Do not infer hosted migration completion from GitHub merge or local reset. Do not reapply/change previously applied bytes. At that later point both targets and exact SQL require explicit authority and verified migration labels before owner merge.

## Bounded decision C: publication, CI and release sequencing

A source push/PR may trigger automatic Vercel previews. **No push, CI dispatch or preview deployment occurs in this task.** Before a future publication request, inspect the exact automatic deployment behavior and identify how the owner-authorized path will respect the requested boundaries; do not silently publish and call preview deployment incidental.

Keep the parallel Quick repair `507d23d` separate until its own review/approval. Expected common file is `backend/src/routes/programs.js` (media hydration/resource validation versus Quick sanitizer/hydration error handling). Quick request recovery and ClientDetail loader files stay exactly released here. Reconcile only the then-approved repair tip in a new isolated tree and rerun overlapping route/browser/receipt tests. No cherry-pick is pre-approved.

The owner separately approves the compact-vs-Larger visual direction/cold visibility and real coaching content. A merge to main auto-deploys both roots, so hosted migration-first requirements must be satisfied before merge, or the owner must explicitly pause automatic deployment before any incompatible sequence. Never promise to migrate after an automatic deploy. Exact-head CI, owner merge, deployments and activation/rollback verification are later gates. Media remains disabled until a reviewed hosted adapter and explicit runtime activation exist.

## Documentation provenance limits

GitHub commit/deployment-status metadata at the start of this task identifies `433784a` and successful frontend/backend Production statuses. No production page/client data or hosted database ledger is queried. Current Supabase changelog/security docs were checked: the upcoming legacy TLS cipher removal and Postgres minor-update cautions do not require a local source or migration change for this additive service-only integration. Existing service-role-only/RLS/no browser policies are preserved; no public grants are introduced.

## 2026-10-16 addendum — Photo + YouTube guides (local build)

The owner's 2026-10-16 direction makes pasted YouTube links/embeds the long-term default for full demos; the owned-video pipeline above is preserved as the explicit `full` mode, not the default. The later local build on branch `claude/youtube-exercise-guides-20261016` (baseline `f3c063c`) adds an image-only `photos` default, a direct-upload photo transport, a locally contract-tested (never activated) Supabase private-image adapter, explicit demo reference modes and a click-to-load player, plus one further additive local migration `20261016170000_exercise_guides_photo_youtube.sql`. The text above remains the historical record for the accepted media integration; the gates for the guides build — including the second migration's dependency on the media migration and on Quick reconciliation — are in [../exercise-guides/hosted-gates.md](../exercise-guides/hosted-gates.md). Nothing in that build is hosted, applied, pushed or deployed.
