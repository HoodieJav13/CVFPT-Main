# Local integration acceptance — 2026-10-17

Functional integration commit: `e0bce8bb18d36d9aab5770d6ceca5ad3d3317f55`, tree `872b54909afb92234b9e5311da8e59f19120c0ce`. Fresh independent static review found no substantive blocker at that exact tree. Local checks: backend674/674, frontend166/166, builder13/13, guides30/30, Quick37/37, full preview120passed/14skipped (8 credential-based live-auth and6 opt-in visual captures), build/boundaries pass. No hosted mutation/publication occurred; uploaded photos remain local-only pending the activation increment and approval sequence below. The original accepted source remains clean at7f754444.

# Release sequence and bounded approval bundle

DIAL: local integration + release preparation. No hosted mutation or publication has been authorized/executed in this task. Production DB changes, merge and Production deployment remain explicitly excluded.

## What is concrete now

- Accepted guide source: 7f7544442e39df8cbd5b7e60791b03f6849090e3 (including independently accepted 320/390px correction).
- Current GitHub main, independently observed READY in both Production deployment records: 3baea7c2f5eb4c3514e5905b9a12773b5dbc9cbe, PR117, following PR116's workout-builder changes.
- Isolated integration checkout: /Users/jav/Documents/Codex/2026-10-15/task-4/youtube-guides-release-integration-20261017/checkout, branch integrate/youtube-guides-release-20261017; own objects.git, no hardlinks/alternates, no upstream, push disabled. The managed worktree API was inapplicable to this caller, so a local bare-clone/linked-worktree fallback was used.
- Three UI conflicts are resolved by composing released canonical matching with guide-reference helpers and retaining released removal/undo. No released controller, client page, backend or SQL logic was replaced with older versions.
- PR115 remains OPEN/DIRTY at73aa3897f5be463613a9203a4938c9c60783940d and is excluded. No deferred-minor cleanup is included.
- Both hosted migration lists have43 entries through20261009200000. Read-only catalog checks: no exercise_media tables, no workout_exercises.video_link_mode. Only existing storage bucket is private PDF-only resource-library (10MiB).
- Both Vercel roots auto-deploy pushed preview branches; merging main auto-deploys Production. Existing branch exceptions do not cover this new integration branch. Therefore pushing even a draft PR is a consequential Preview/CI action.

## Required SQL, exact bytes and ordering

1. supabase/migrations/20261015213431_exercise_media_library.sql
   SHA25654028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c
2. supabase/migrations/20261016170000_exercise_guides_photo_youtube.sql
   SHA25669ec99a0049d68f05dffff3ec6f37a7d9c6055d78819e83db3d80f15f52ba0ae

Both are still unapplied and byte-identical to the accepted source. All43 released migration files stay unchanged. The second depends on the first. Its four writer replacements are compared with the latest released definitions; current PR116/117 and PR115 add no SQL definition changes. Do not edit any applied migration. Refresh the hosted ledgers immediately before approved application; a newer concurrent migration may require a reviewed new candidate/version rather than applying blindly.

Development project: hhzpzcxcurmhpmfgriqb.
Production project: dacqdoohqqcqgtpacerk (NOT authorized now).

Development schema must precede the new backend Preview: the backend reads video_link_mode even while hosted photos remain off. A Preview pushed beforehand would have incompatible workout/log reads. After application, verify ledger45/45, catalog columns/tables/functions, service-role-only grants/RLS and byte-identical intended function definitions; use only separately authorized bounded fictional rollback probes. Do not seed a hosted Production database.

Migration guard requires migration-applied AND prod-migration-applied labels before merge. The Production label must remain absent until a later exact Production application and verification is separately authorized. A draft PR may legitimately show that one expected guard failure during Development-only proof. The open-PR inventory currently contains no other migration PR; recheck before opening one.

## Important readiness gap: hosted photos are not just a dashboard switch

The accepted source deliberately enables media only through the local adapter. config.js rejects hosted Supabase activation, runtime.js constructs LocalMediaStore, and SupabaseImageStore is fake-client contract-tested only. Merely creating a bucket/setting EXERCISE_MEDIA_STORE=supabase will not make uploaded photos work. Do not call a YouTube-only Preview the complete agreed release.

Before photo-enabled Development proof, complete a separately bounded hosted-photo activation increment in this isolated branch (local code/tests first), with independent review. It must:

- wire the existing Supabase image store behind explicit fail-closed opt-in configuration, private bucket identity and an owner-managed stable capability secret; preserve the existing service-role Express boundary;
- keep mode=photos and video source/FFmpeg worker activation off; no third-party video hosting or paid service;
- validate object metadata before materializing bytes and bound actual byte reads; maintain authoritative decode/MIME/pixel/crop validation, durable upload/finalize recovery and existing queue/deadline limits;
- preserve authorization on each actual API GET/HEAD/Range and uploader/admin-only source access. Never solve source delivery by publishing the bucket or redirecting to an independently reusable public/private-storage read URL;
- prove the10MiB source-authoring path on the actual Preview runtime, including source crop readback and failure recovery. The official Vercel limits page documents a4.5MB request/response payload ceiling; the existing direct-to-storage upload avoids the upload proxy but does not itself prove large authenticated source responses. Establish a supported streaming delivery path (and verify it) or return an explicit reviewed alternative; do not silently lower accepted limits or weaken access;
- prove sharp0.35.5 native packaging in the isolated Node backend deploy root, then exact Preview deployment/import/runtime behavior;
- retain archived revisions/staging bytes; no purge or new retention policy without owner approval. Publish the storage sizing/limits and a flag-off rollback before activation.

These are named activation prerequisites, not claims that activation code or hosted proof already passed. This preparation task preserves the accepted hosted-off contract.

Official references checked:
- [Vercel payload/runtime limits](https://vercel.com/docs/functions/limitations)
- [Supabase signed-upload URLs, two-hour lifetime](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- [Private bucket creation and limits](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
- [Supabase current TLS deprecation notice](https://supabase.com/changelog/cbc-tls-ciphers-deprecated): modern supported clients should use the currently supported TLS suites; no legacy-client compatibility promise was added.

## One concise next-stage approval bundle, with individually named effects

Recommended request after the exact local integration head is accepted:

> Approve the Development-only next stage: complete/review the bounded hosted-photo activation increment using existing Supabase infrastructure; apply the two exact migrations above to Development and verify them; provision/verify a new private exercise-media bucket in Development capped at10MiB with image/jpeg,image/png,image/webp only; configure the Development/Preview photo flags and owner-managed secret; then publish the reviewed integration branch as a draft PR, allowing its automatic GitHub CI and both Vercel Preview deployments, and run fictional real-role upload→crop/process→review→publish→client-read/revocation proof there. No paid service or plan upgrade, Production database/storage/env change, merge or Production deployment is included.

Do not interpret the owner's general “toward live release” as approval for an unnamed hosted file or environment. Do not execute any listed consequential action before approval.

The exact activation diff/commit must be prepared and reviewed before the hosted portion proceeds; if it materially changes accepted limits/access/costs, return that concrete decision rather than treating this bundle as permission to redesign it.

Bucket/credential handling follows the recorded owner-only gate. Agent can prepare every exact setting and perform approved verification. Under the current gate the owner creates the private bucket and enters any required secret in the provider UI; alternatively an explicit delegation may authorize the existing connector to create that named bucket. Credential creation, copying/retrieval, rotation and raw values remain owner-only and must never enter prompts/logs/artifacts. No new credential is requested until the actual runtime wiring identifies what is required; reuse configured backend service access through existing provider mechanisms without exposing it.

## Release sequence after the bundle

1. Finish local integration + bounded activation readiness; no hosted flag is enabled just because local tests pass.
2. Recheck currentmain and PR115 status. Recommended: reconcile/land the already-reviewed Quick repair separately first, then refresh this candidate and rerun affected Quick/catalog/guide checks. If the owner elects Guides first, keep PR115 excluded and provide its later rebase map; don't silently import it. Current overlap: backend/src/routes/programs.js; client/Quick controller files differ from currentmain in PR115; no shared migration body is changed by PR115.
3. With exact Development authority, apply and verify both migrations in order and create/configure the private photo bucket.
4. After that schema is ready, with exact publication authority, push the reviewed non-main branch and create a draft PR. Push/PR automatically start CI and two Previews. Verify actual SHA/READY/root settings and native image imports; use Preview-only flags. Leave Production flags/settings untouched.
5. Perform approved fictional real-role Development API/browser proof, including malformed/oversize files, authoritative decode/crop, ambiguous finalize, replacement/withdrawal/reassignment, source privacy, GET/HEAD/Range, inline photo with YouTube click-to-load/fallback, 320/390 sizing, and ordinary logging. Record exact source, migrations, bucket settings and deployments. This requires bounded synthetic Development records; no actual client/health data.
6. Owner judgment/physical actions: approve CVF-owned/permissioned photos/cues and approved channel demos/captions, review paired actual visuals, and do the physical-device checks. No requirement to record all exercises first; missing media stays usable. Replace synthetic/third-party demonstration fixture links with neutral placeholders or owner-approved content; do not invent CVF videos.
7. Only a later separate Production approval may apply the same exact SQL and provision/activate Production photo storage/settings, with repeat catalog/grant/budget verification. Apply schema before incompatible backend deploy; add prod-migration-applied only after verification.
8. Owner merge is a distinct later action and automatically deploys both Production roots. Verify exact merge SHA/READY and bounded post-deploy read-only checks. No merge, Production migration or deployment is authorized now.

## Rollback and stop criteria

Before any hosted activation, rehearse flag-off while data stays. Source rollback must remain compatible with additive schemas; do not drop tables/functions or erase uploads. Stop on unexpected ledger/function/bucket identity, public access, missing native decoder, broken authorization, mismatched source SHA, quota/cost decision, or essential missing authority. Preserve the prior working current guide during processing failures. No new paid infrastructure or credentials is an automatic fallback.

## Who executes what

- Agent-executable now: isolated integration, local tests, exact source/SQL/approval packet and independent review (this task).
- Agent-executable after explicit authority: Development exact SQL verification/application via available connector, draft PR/push/CI/Preview, named config changes through approved mechanisms, and bounded fictional hosted proof.
- Requires owner judgment/physical action: content/visual acceptance, real devices, raw credential actions and currently owner-reserved bucket creation; later Production and merge decisions.
- Deferred: owned full-video hosting/worker, paid service/hosting changes, deferred-minor cleanup, purge policy, and unrelated projects.

