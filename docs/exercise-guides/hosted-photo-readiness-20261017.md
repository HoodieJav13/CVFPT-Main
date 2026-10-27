# Hosted photo adapter: local readiness, 2026-10-17

This increment implements and locally verifies the previously missing private-photo wiring. **No hosted photos are enabled or proven.** Nothing has been pushed, migrated, provisioned, configured or deployed. Production remains excluded. The earlier release-preparation packet at `5e9d099a` is historical; this document supersedes its unfinished-local-wiring prerequisite.

## Transport and the 10 MiB decision

Keep the accepted **10 MiB upload limit**. No smaller limit is necessary to satisfy the documented payload ceiling in this design. The existing Express entrypoint (`backend/api/index.js`, rewrites in `backend/vercel.json`) becomes one Vercel Function; [Vercel documents a 4.5 MB request/response body limit](https://vercel.com/docs/functions/limitations), including [Express applications](https://vercel.com/docs/frameworks/backend/express).

- Photo bytes upload directly to the private provider under a server-issued, no-upsert staging grant. App intent/finalize/process requests are small JSON, never a 10 MiB proxy upload.
- Finalize and rendering read at most 10 MiB **inside** the backend from storage. Metadata is checked before downloading; the actual stream is counted, aborted on overflow and given a 15-second download deadline. Recorded source size/hash, sniffed format, full native decode and pixel/crop checks still decide acceptance.
- The crop editor first sends an independently authorized HEAD. It reconstructs the original using sequential exact ranges of at most **1 MiB**. A 10 MiB source needs HEAD + ten GETs. Every GET/HEAD/Range rechecks the embedded principal, current ownership/context, revision and asset before accessing bytes. No public object URL or signed-read redirect bypasses that check.
- A hosted full GET or oversized range exceeding 1 MiB returns a small 413 response before opening bytes. Ordinary <=160 KiB posters still use one image GET. HEAD reads metadata only. `Content-Range` is exposed to the approved frontend origin under the existing CORS policy.
- Provider HTTP 206 and exact Content-Range offsets are checked at the existing configured Supabase fetch boundary **before** storage-js discards response metadata. The adapter then counts and verifies the returned byte length. Ignored/wrong-offset ranges fail closed. Existing timeout and current secret-key API authentication normalization are preserved; no new Supabase key is introduced.
- Inline photo jobs use a120-second lease above the bounded hosted I/O/decoder/completion budget; an overlapping Resume cannot steal still-running work. A terminated request remains resumable after expiry, without changing SQL.
- The browser rejects wrong status/range/type/size, uses no persistent cache or credentials for capability reads, aborts on editor close/change, and revokes its temporary blob URL. Crop controls wait for the complete source, with explicit retry on failure. Link state clears synchronously and in the effect when the actor/context changes.
- Source-image capabilities use the existing source-media maximum of **300 seconds** (as source video already did); current posters remain 60 seconds. The bounded 11-request sequence has at most 165 seconds of per-request timeout budget, so a 60-second systematic expiry is removed. A synthetic clock test simulates ten 10-second ranges and proves revocation still denies the next GET and HEAD. This is a lifetime bound, not a promise of completion under every connection outage.

**Evidence boundary:** local tests prove byte correctness, authorization decisions, SDK behavior with synthetic provider responses, native decode and browser composition. The design keeps each Vercel-facing body below the documented cap without relying on a streaming exemption. Actual Development provider behavior, deployment packaging, latency, capacity and browser CORS on the real Preview remain a separately approved proof gate. If that proof fails, disable the flag and investigate; do not silently lower limits or expose storage.

## Explicit configuration (prepared, not set)

Backend Preview only, following separate approval:

| Name | Required value/source |
|---|---|
| `EXERCISE_MEDIA_STORE` | `supabase` |
| `EXERCISE_MEDIA_HOSTED_PHOTOS` | `enabled` (exact opt-in) |
| `EXERCISE_MEDIA_MODE` | `photos` |
| `EXERCISE_MEDIA_BUCKET` | `exercise-media` |
| `EXERCISE_MEDIA_LINK_SECRET` | Owner-managed stable server-only value, at least 32 characters; enter directly through the approved provider UI; never paste/retrieve/copy it into chat or artifacts |

Missing/invalid opt-in, bucket or secret leaves media disabled. The PDF `resource-library` bucket is explicitly refused. Hosted `full` or unknown media modes remain disabled; this does not activate FFmpeg or owned-video processing. The existing configured backend Supabase service access is reused. Tests use fixed clearly synthetic values only. No persistent real credential was generated, retrieved or configured.

Private bucket settings: name/id `exercise-media`, `public=false`, size limit `10485760`, allowed MIME types exactly `image/jpeg`, `image/png`, `image/webp`. No browser SELECT/read policies or public URL. Coach upload ownership/finalize uses existing backend role/ownership checks; clients receive only current derivatives for currently authorized assigned/log contexts; original sources are uploader/admin-only. Signed upload grants are provider-documented two-hour capabilities scoped to one server-issued staging path and never permit upsert. Storage paths remain backend metadata.

Rollback: remove/disable `EXERCISE_MEDIA_HOSTED_PHOTOS` in Preview. Hydration stops media queries and missing media falls back to text/YouTube resources. Data, immutable sources, staging and archived revisions remain; no destructive rollback or purge is included. Already-enabled code must not be presented as live until the exact Preview proof passes.

## Verification and review

Functional commit **`cb0e5d52eb3c1c0fd5e1890cc6ed1f8d5bbd3346`**, tree **`959eaf56dffaf5a504d63ea3b8df6e89b01233ed`**, was independently accepted. Fresh full backend683/683, frontend units169/169, guide browser34/34, media browser25/25 and full preview120pass/14skip (8unavailable live-auth +6opt-in captures) pass, along with build, boundaries and protocol. The eight dedicated actual before/after capture cases pass4+4. Full scoped source, raw outputs, exact checks and independent review are recorded in the accompanying `hosted-photo-evidence/RETURN.md` and manifest. New regressions cover exact-limit 10 MiB source validation/finalize/retry/render, metadata oversize before I/O, lying metadata, actual overflow cancellation, ignored/wrong-offset provider ranges through installed SDK 2.110.0, 1 MiB API bounds, metadata-only HEAD, current authorization/revocation, synthetic 100-second transfer, actor-switch stale capabilities, mobile 320/390 readback, failure/manual retry and blob cleanup. No migration or dependency bytes changed.

Independent review found three issues in the first candidate: stale actor links, provider range metadata loss and the 60-second source lifetime. Each was corrected with a regression. A final runtime-budget check also raised the inline job lease from30 to120 seconds; a held-render synthetic-clock test proves an80-second active job cannot be stolen, while the existing expired-lease recovery test remains green. The initial full preview also exposed a keyboard-test synchronization assumption; it now waits for the newly asynchronous source controls to become usable. This preserves the loading/error protection. A pre-existing source-regex assertion in backend tests was preserved by keeping the original timeout-wrapper composition.

Actual [paired loaded/error screenshots](hosted-photo-visual-review/index.html) at320/390 were captured from archived baseline `5e9d099a` and the revised candidate, using identical synthetic fixtures, in the evidence directory. The failed-source after state explains the failure and provides a 44px retry action, with disabled crop controls; loaded geometry remains contained. These are implementation evidence, not owner visual/content acceptance or real device proof.

Unchanged earlier SQL/grant/race evidence and accepted native Linux package proof are reused because this increment adds no SQL/dependencies and retains the decoder binary/version. Local adapter/SDK/browser checks are fresh. No live-auth/hosted test was run; those are unavailable under this task's authority, not successful checks.

## Minimal Development activation request

Approve only the following next stage, after accepting the exact local candidate:

1. Apply and verify, in order, on Development **`hhzpzcxcurmhpmfgriqb`**:
   - `20261015213431_exercise_media_library.sql`, SHA256 `54028175f398c6367e8cbea18fb40abe56d965c4bc4843db7936d89ba18edc9c`: durable media revisions/assets/current pointers/jobs and validators/RPCs, service-only RLS/grants.
   - `20261016170000_exercise_guides_photo_youtube.sql`, SHA256 `69ec99a0049d68f05dffff3ec6f37a7d9c6055d78819e83db3d80f15f52ba0ae`: nullable reference mode with legacy semantics retained/no backfill, upload intents/leased jobs and four mode-aware writers preserving Quick v1.
   Refresh both ledgers/current source first; expected Development canonical ledger after these exact files is45. Verify catalog, functions and service-only grants with bounded fictional probes. A current-state conflict stops application.
2. Provision/verify the private Development bucket and configure **backend Preview only** with the exact settings above. Owner-reserved bucket/secret actions remain owner-only unless bucket creation is expressly delegated. Raw credential creation/retrieval/copying/rotation stays owner-only.
3. Once schema is compatible, publish the reviewed non-main candidate as a **draft PR**, allowing its normal GitHub CI and **both** automatic frontend/backend Vercel Preview builds. Verify exact SHA/READY and native image import/runtime. Run fictional real-role grant→upload→finalize/retry→crop/process→review→publish→client-read, replacement/withdrawal/reassignment and GET/HEAD/Range refusal proof, including an exact 10 MiB source and mobile display. Fixture preview behavior is separate from authorization proof.

Bound the initial proof to **three fictional exercises, up to two revisions each, <=64 MiB newly retained storage**, one exact10MiB source and five <=1MiB sources (staging + immutable source + posters remain below the bound). Recheck current quota before work; no bulk library population or purge. The earlier observed Oct16 storage0.00/1GB, uncached egress0.019/5GB, cached0/5GB is dated, rounded evidence, not current capacity or a no-cost guarantee. Provider storage/egress and Vercel CPU/memory usage can increase; source authoring now uses up to11 API invocations, but storage ranges prevent repeatedly downloading the full original. No paid upgrade/service is allowed; stop if limits/costs require one.

**Excluded:** Production DB/storage/env changes (`dacqdoohqqcqgtpacerk`), merge, Production deployment, PR115 inclusion, owned-video hosting/processing, real client/health records and paid services. Keep the Production migration label absent. Schema must precede the incompatible backend Preview; main merge would auto-deploy Production and remains a later owner action. Quick PR115 stays separate; refresh current main/PR115 and reconciliation order before any publication.

YouTube-only links/embeds can be an explicitly approved partial release without a photo bucket, but this integrated backend still needs both migrations before deployment. It must not be described as completing uploaded-photo activation.

## Sources checked

- [Vercel Function limits](https://vercel.com/docs/functions/limitations) and [Express runtime](https://vercel.com/docs/frameworks/backend/express).
- [Supabase private download and cancellation parameters](https://supabase.com/docs/reference/javascript/storage-from-download), [object info](https://supabase.com/docs/reference/javascript/storage-from-info), [signed-upload grants](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl).
- Current official [Storage GET handler](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts) and [asset renderer passing Range](https://github.com/supabase/storage/blob/master/src/storage/renderer/asset.ts); these support the design, not a receipt from the actual Development project.
- Installed source: storage-js2.110.0 `StorageFileApi.ts`, `BlobDownloadBuilder.ts`, `StreamDownloadBuilder.ts`, `BaseApiClient.ts`; supabase-js2.110.0 authenticated fetch. No package update.
- Changelog scanned from the already fetched current Oct17 index; [TLS deprecation](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) remains relevant to old clients, with no inferred modern-runtime blocker.
