// Explicit allowlist DTOs. Clients never receive storage keys, hashes, source
// objects, rights notes, owner/reviewer ids, job metadata, internal errors or
// links; links come only from authorized short-lived /links responses.

const DERIVATIVE_ROLES = ['poster', 'end_frame', 'preview', 'instruction', 'captions'];

// bundle item (exercise_media_current_bundle) -> ClientMediaDTO | null
function clientMediaDto(item) {
  if (!item || !Array.isArray(item.assets)) return null;
  const byRole = Object.fromEntries(item.assets.filter((a) => DERIVATIVE_ROLES.includes(a.role)).map((a) => [a.role, a]));
  if (!byRole.poster || typeof item.alt_text !== 'string') return null;
  return {
    exercise_id: item.exercise_library_id,
    revision_id: item.revision_id,
    version: item.version,
    kind: byRole.preview ? 'video' : byRole.end_frame ? 'frames' : 'photo',
    alt_text: item.alt_text,
    cues: Array.isArray(item.cues) ? item.cues.filter((cue) => typeof cue === 'string').slice(0, 3) : [],
    poster: { asset_id: byRole.poster.id, width: byRole.poster.width, height: byRole.poster.height },
    end_frame: byRole.end_frame
      ? { asset_id: byRole.end_frame.id, width: byRole.end_frame.width, height: byRole.end_frame.height, alt_text: item.end_frame_alt_text || item.alt_text }
      : null,
    preview: byRole.preview
      ? { asset_id: byRole.preview.id, duration_ms: byRole.preview.duration_ms, width: byRole.preview.width, height: byRole.preview.height, bytes: byRole.preview.bytes }
      : null,
    instruction: byRole.instruction
      ? {
        asset_id: byRole.instruction.id,
        duration_ms: byRole.instruction.duration_ms,
        width: byRole.instruction.width,
        height: byRole.instruction.height,
        bytes: byRole.instruction.bytes,
        has_audio: Boolean(byRole.instruction.has_audio),
        captions_available: Boolean(byRole.captions),
        captions_asset_id: byRole.captions ? byRole.captions.id : null,
        caption_language: byRole.captions ? item.caption_language || null : null,
      }
      : null,
    transcript_available: Boolean(item.transcript_available),
  };
}

function mediaMap(bundle) {
  const map = new Map();
  for (const item of bundle || []) {
    const dto = clientMediaDto(item);
    if (dto) map.set(dto.exercise_id, dto);
  }
  return map;
}

function sourceDto(asset, actor) {
  if (!asset) return null;
  const mayReadRights = actor.role === 'admin' || asset.uploaded_by_coach_id === actor.coach?.id;
  return {
    asset_id: asset.id,
    mime_type: asset.mime_type,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    duration_ms: asset.duration_ms ?? null,
    has_audio: asset.has_audio ?? null,
    display_name: asset.display_name || null,
    rights_basis: asset.rights_basis,
    rights_note: mayReadRights ? asset.rights_note || null : null,
    uploaded_by_you: asset.uploaded_by_coach_id === actor.coach?.id,
    copied: Boolean(asset.copied_from_asset_id),
  };
}

// Coach view of one revision. Rights notes only reach their uploader/admin.
function coachRevisionDto(revision, { assets = [], actor, current = null, job = null, ownerName = null }) {
  const active = assets.filter((a) => a.revision_id === revision.id && !a.archived);
  const role = (name) => active.find((a) => a.role === name) || null;
  const isOwner = revision.uploaded_by_coach_id === actor.coach?.id;
  const isAdmin = actor.role === 'admin';
  const isCurrent = Boolean(current && current.revision_id === revision.id);
  const editable = !revision.archived && !revision.published_at && revision.status !== 'processing' && (isOwner || isAdmin);
  const currentOwnedByOther = Boolean(current?.revision_id && current.owner_id && current.owner_id !== actor.coach?.id && current.revision_id !== revision.id);
  return {
    id: revision.id,
    exercise_id: revision.exercise_library_id,
    status: revision.status,
    review_status: revision.review_status,
    version: revision.version,
    recipe_version: revision.recipe_version,
    failure_code: revision.failure_code || null,
    based_on_revision_id: revision.based_on_revision_id || null,
    owned_by_you: isOwner,
    owner_name: ownerName,
    published_at: revision.published_at || null,
    is_current: isCurrent,
    archived: revision.archived,
    created_at: revision.created_at,
    updated_at: revision.updated_at,
    text: {
      alt_text: revision.alt_text, end_frame_alt_text: revision.end_frame_alt_text, cues: revision.cues || [],
      transcript: revision.transcript, caption_language: revision.caption_language, caption_cues: revision.caption_cues || [],
      instruction_audio: revision.instruction_audio,
    },
    recipe: {
      include_instruction: revision.include_instruction, poster_mode: revision.poster_mode, poster_frame_ms: revision.poster_frame_ms,
      poster_crop: revision.poster_crop, preview_start_ms: revision.preview_start_ms, preview_end_ms: revision.preview_end_ms,
      preview_crop: revision.preview_crop, end_frame_ms: revision.end_frame_ms, end_frame_crop: revision.end_frame_crop,
    },
    reviewed: revision.review_status === 'approved' ? { at: revision.reviewed_at, by_you: revision.reviewed_by_coach_id === actor.coach?.id } : null,
    sources: (isOwner || isAdmin) ? { image: sourceDto(role('source_image'), actor), video: sourceDto(role('source_video'), actor) } : null,
    derivatives: active.filter((a) => DERIVATIVE_ROLES.includes(a.role) && a.recipe_version === revision.recipe_version).map((a) => ({
      asset_id: a.id, role: a.role, width: a.width, height: a.height, duration_ms: a.duration_ms ?? null, bytes: a.bytes, has_audio: a.has_audio ?? null,
    })),
    job: job && job.recipe_version === revision.recipe_version ? { state: job.state, attempts: job.attempts, error_code: job.error_code || null } : null,
    permissions: {
      can_edit: editable,
      can_upload: editable,
      can_process: editable && ['draft', 'failed'].includes(revision.status),
      can_review: !revision.archived && !revision.published_at && revision.status === 'ready' && revision.review_status === 'needs_review' && (isOwner || isAdmin),
      can_publish: !revision.archived && !revision.published_at && revision.status === 'ready' && revision.review_status === 'approved' && (isOwner || isAdmin) && (isAdmin || !currentOwnedByOther),
      publish_requires_admin: !isAdmin && currentOwnedByOther,
      can_archive: !revision.archived && (isOwner || isAdmin),
    },
  };
}

function libraryStatusDto(rows, actor) {
  const items = (rows || []).map((row) => ({
    exercise_id: row.exercise_library_id,
    current_version: row.current_version,
    current_revision_id: row.current_revision_id || null,
    current_kind: row.current_kind,
    current_has_instruction: Boolean(row.current_has_instruction),
    current_owned_by_you: Boolean(row.current_owner_id && row.current_owner_id === actor.coach?.id),
    drafts_open: row.drafts_open,
    drafts_needs_review: row.drafts_needs_review,
    drafts_ready_to_publish: row.drafts_ready_to_publish,
    drafts_processing: row.drafts_processing,
    drafts_failed: row.drafts_failed,
  }));
  const summary = { total: items.length, no_media: 0, photo_only: 0, frames: 0, ready_video: 0, needs_review: 0, processing: 0, processing_failed: 0 };
  for (const item of items) {
    if (item.current_kind === 'none') summary.no_media += 1;
    if (item.current_kind === 'photo') summary.photo_only += 1;
    if (item.current_kind === 'frames') summary.frames += 1;
    if (item.current_kind === 'video') summary.ready_video += 1;
    if (item.drafts_needs_review > 0) summary.needs_review += 1;
    if (item.drafts_processing > 0) summary.processing += 1;
    if (item.drafts_failed > 0) summary.processing_failed += 1;
  }
  return { items, summary };
}

module.exports = { clientMediaDto, mediaMap, coachRevisionDto, libraryStatusDto, DERIVATIVE_ROLES };
