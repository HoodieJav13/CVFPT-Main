// Preview-mode exercise media: a SEPARATE synthetic scenario, off by default so
// Sarah's baseline fixtures and every existing preview screen are unchanged.
// Turn it on from the preview toolbar ("Exercise media demo"). Posters and
// clips are generated in the page (canvas/MediaRecorder) — no media files ship
// in the build — and every "processing" step here is a labelled SIMULATION.
// Real upload/processing/authorization is proven by the local server lane
// (backend test:media:integration, frontend test:e2e:media:local).

export const MEDIA_SCENARIO_KEY = 'cvf_preview_media_scenario';
export function mediaScenarioEnabled() {
  try { return localStorage.getItem(MEDIA_SCENARIO_KEY) === '1'; } catch { return false; }
}

const LABEL = 'SYNTHETIC PREVIEW MEDIA — NOT INSTRUCTION';
const blobs = new Map(); // asset id -> Promise<blob url>

function paint(canvas, { title, hue, progress = 0 }) {
  const g = canvas.getContext('2d');
  const { width, height } = canvas;
  g.fillStyle = '#1d1a17'; g.fillRect(0, 0, width, height);
  g.fillStyle = `hsl(${hue}, 45%, 32%)`; g.fillRect(width * 0.08, height * 0.12, width * 0.84, height * 0.5);
  const x = width * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(progress * Math.PI * 2)));
  g.fillStyle = `hsl(${hue}, 70%, 62%)`; g.beginPath(); g.arc(x, height * 0.37, height * 0.13, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, height * 0.72, width, height * 0.28);
  g.fillStyle = '#ffd166'; g.font = `bold ${Math.round(height / 17)}px sans-serif`; g.fillText(LABEL, width * 0.04, height * 0.83, width * 0.92);
  g.fillStyle = '#ffffff'; g.font = `${Math.round(height / 20)}px sans-serif`; g.fillText(title, width * 0.04, height * 0.94, width * 0.92);
}

function stillUrl(title, hue) {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  paint(canvas, { title, hue });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), 'image/jpeg', 0.85));
}

function clipUrl(title, hue, ms) {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  paint(canvas, { title, hue });
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return Promise.resolve('blob:unavailable');
  return new Promise((resolve) => {
    const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })));
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      paint(canvas, { title, hue, progress: elapsed / ms });
      if (elapsed >= ms) { clearInterval(timer); recorder.stop(); }
    }, 40);
    recorder.start(200);
  });
}

function captionsUrl(cues) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const time = (ms) => `00:${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}`;
  const body = cues.map((cue, i) => `${i + 1}\n${time(cue.start_ms)} --> ${time(cue.end_ms)}\n${cue.text}\n`).join('\n');
  return Promise.resolve(URL.createObjectURL(new Blob([`WEBVTT\n\n${body}`], { type: 'text/vtt' })));
}

const EX = {
  goblet: 'lib_media_goblet', split: 'lib_media_split', row: 'lib_media_row', plank: 'lib_media_plank', shuttle: 'lib_media_shuttle', wall: 'lib_media_wall',
};
const LIBRARY = [
  [EX.goblet, 'Synthetic Goblet Squat', 'Kettlebell', 'Quads'], [EX.split, 'Synthetic Split Squat', 'Dumbbells', 'Quads'],
  [EX.row, 'Synthetic Band Row', 'Band', 'Back'], [EX.plank, 'Synthetic Plank', 'Bodyweight', 'Core'],
  [EX.shuttle, 'Synthetic Shuttle Walk', 'None', 'Conditioning'], [EX.wall, 'Synthetic Wall Sit (no media)', 'Bodyweight', 'Quads'],
];
const HUES = { [EX.goblet]: 28, [EX.split]: 190, [EX.row]: 140, [EX.plank]: 260, [EX.shuttle]: 330 };

export function createPreviewExerciseMedia({ state, iso, ok, fail, currentCoachId }) {
  const enabled = mediaScenarioEnabled();
  const assets = new Map();    // id -> { role, revision_id, width, height, duration_ms, bytes, has_audio, make: () => Promise<url>, broken? }
  const revisions = new Map(); // id -> revision row
  const current = new Map();   // exercise id -> { revision_id, version }
  let seq = 0;
  const nextId = (prefix) => `${prefix}_${++seq}`;

  function addAsset(revisionId, role, extra) {
    const id = `asset_${revisionId}_${role}`;
    assets.set(id, { id, revision_id: revisionId, role, archived: false, ...extra });
    return id;
  }

  function seedRevision(exerciseId, { id, kind, owner = 'coach_marcus', published = true, status = 'ready', review = 'approved', instruction = false, brokenPoster = false, failure = null }) {
    const title = LIBRARY.find(([libraryId]) => libraryId === exerciseId)[1];
    const hue = HUES[exerciseId] || 30;
    const revision = {
      id, exercise_library_id: exerciseId, uploaded_by_coach_id: owner, status, review_status: review, version: 3, recipe_version: 1,
      failure_code: failure, published_at: published ? iso(-3) : null, archived: false, created_at: iso(-4), updated_at: iso(-3),
      text: { alt_text: `${title}: synthetic preview photo`, end_frame_alt_text: kind === 'frames' ? `${title}: synthetic end position` : null, cues: ['Synthetic cue — not instruction'], transcript: instruction ? 'Synthetic transcript for a preview clip. Not exercise instruction.' : null, caption_language: instruction ? 'en' : null, caption_cues: instruction ? [{ start_ms: 0, end_ms: 1500, text: 'Synthetic caption one' }, { start_ms: 1500, end_ms: 2400, text: 'Synthetic caption two' }] : [], instruction_audio: false },
      recipe: { include_instruction: instruction, poster_mode: kind === 'photo' ? 'uploaded_image' : 'video_frame', poster_frame_ms: kind === 'photo' ? null : 300, poster_crop: { x: 0, y: 0, width: 1, height: 1 }, preview_start_ms: kind === 'video' ? 0 : null, preview_end_ms: kind === 'video' ? 2000 : null, preview_crop: null, end_frame_ms: kind === 'frames' ? 4000 : null, end_frame_crop: kind === 'frames' ? { x: 0, y: 0, width: 1, height: 1 } : null },
      sources: { image: kind === 'photo' || kind === 'video' ? { asset_id: addAsset(id, 'source_image', { width: 1280, height: 720, bytes: 64000, make: () => stillUrl(`${title} (source)`, hue) }), width: 1280, height: 720, bytes: 64000, mime_type: 'image/jpeg', display_name: 'synthetic.jpg', rights_basis: 'owned', rights_note: null, uploaded_by_you: owner === currentCoachId(), copied: false } : null,
        video: kind !== 'photo' ? { asset_id: addAsset(id, 'source_video', { width: 1280, height: 720, duration_ms: 6000, bytes: 900000, make: () => clipUrl(`${title} (source)`, hue, 2400) }), width: 1280, height: 720, duration_ms: 6000, has_audio: false, bytes: 900000, mime_type: 'video/mp4', display_name: 'synthetic.mp4', rights_basis: 'owned', rights_note: null, uploaded_by_you: owner === currentCoachId(), copied: false } : null },
      simulation: true,
    };
    if (status === 'ready') {
      addAsset(id, 'poster', { width: 640, height: 360, bytes: 21000, make: () => stillUrl(title, hue), broken: brokenPoster });
      if (kind === 'frames') addAsset(id, 'end_frame', { width: 640, height: 360, bytes: 20000, make: () => stillUrl(`${title} — end`, hue + 40) });
      if (kind === 'video') addAsset(id, 'preview', { width: 640, height: 360, duration_ms: 2000, bytes: 14000, has_audio: false, make: () => clipUrl(title, hue, 1600) });
      if (instruction) {
        addAsset(id, 'instruction', { width: 1280, height: 720, duration_ms: 2400, bytes: 45000, has_audio: false, make: () => clipUrl(`${title} — full instruction`, hue, 2400) });
        addAsset(id, 'captions', { bytes: 120, make: () => captionsUrl(revision.text.caption_cues) });
      }
    }
    revisions.set(id, revision);
    if (published) current.set(exerciseId, { revision_id: id, version: 1 });
    return revision;
  }

  if (enabled) {
    for (const [id, name, equipment, muscle] of LIBRARY) {
      if (!state.exerciseLibrary.some((row) => row.id === id)) state.exerciseLibrary.push({ id, name, category: 'Synthetic', equipment, primary_muscle: muscle, secondary_muscles: '', video_url: id === EX.row ? 'https://www.youtube.com/watch?v=synthetic-library-link' : null, notes: 'Synthetic preview identity — not coaching instruction.', archived: false, created_at: iso(-10), updated_at: iso(-10) });
    }
    seedRevision(EX.goblet, { id: 'rev_media_goblet', kind: 'photo' });
    seedRevision(EX.split, { id: 'rev_media_split', kind: 'frames' });
    seedRevision(EX.row, { id: 'rev_media_row', kind: 'video', instruction: true });
    seedRevision(EX.plank, { id: 'rev_media_plank', kind: 'photo', brokenPoster: true });
    // Coach-side drafts: one awaiting review, one slow to process, one failed.
    seedRevision(EX.goblet, { id: 'rev_media_goblet_draft', kind: 'video', published: false, review: 'needs_review' });
    const slow = seedRevision(EX.split, { id: 'rev_media_split_draft', kind: 'frames', published: false, status: 'processing', review: 'needs_review' });
    slow.pollsLeft = 3;
    seedRevision(EX.shuttle, { id: 'rev_media_shuttle_draft', kind: 'video', published: false, status: 'failed', review: 'needs_review', failure: 'source_missing' });
    if (!state.workouts.some((row) => row.id === 'workout_media_session')) {
      state.workouts.push({ id: 'workout_media_session', coach_id: 'coach_marcus', name: 'Synthetic media session', description: 'Preview scenario for exercise guides (synthetic media).', goal: 'Preview', is_template: true, hidden: false, archived: false, created_at: iso(-2), updated_at: iso(-2) });
      const rows = [[EX.goblet], [EX.split], [EX.row, 'https://www.youtube.com/watch?v=synthetic-coach-override'], [EX.plank], [EX.shuttle], [EX.wall], [null]];
      rows.forEach(([libraryId, video], position) => state.workoutExercises.push({ id: `wex_media_${position}`, workout_id: 'workout_media_session', exercise_library_id: libraryId, custom_name: libraryId ? null : 'Synthetic custom move (no library id)', sets: '2', reps: '8', target_rpe: '7', rest: '60s', rest_seconds: 60, tempo: '', default_load_value: null, default_load_unit: null, notes: '', video_url: video || null, position, archived: false, created_at: iso(-2) }));
      state.workoutAssignments.push({ id: 'wa_media_session', client_id: 'client_sarah', workout_id: 'workout_media_session', assignment_mode: 'active', assigned_for: null, notes: 'Exercise media preview scenario.', archived: false, created_at: iso(-1) });
    }
  }

  const byRole = (revisionId) => Object.fromEntries([...assets.values()].filter((a) => a.revision_id === revisionId && !a.archived).map((a) => [a.role, a]));

  function clientDto(exerciseId) {
    const pointer = current.get(exerciseId);
    const revision = pointer && revisions.get(pointer.revision_id);
    if (!revision || revision.archived) return null;
    const a = byRole(revision.id);
    if (!a.poster) return null;
    return {
      exercise_id: exerciseId, revision_id: revision.id, version: pointer.version,
      kind: a.preview ? 'video' : a.end_frame ? 'frames' : 'photo', alt_text: revision.text.alt_text, cues: revision.text.cues,
      poster: { asset_id: a.poster.id, width: 640, height: 360 },
      end_frame: a.end_frame ? { asset_id: a.end_frame.id, width: 640, height: 360, alt_text: revision.text.end_frame_alt_text } : null,
      preview: a.preview ? { asset_id: a.preview.id, duration_ms: a.preview.duration_ms, width: 640, height: 360, bytes: a.preview.bytes } : null,
      instruction: a.instruction ? { asset_id: a.instruction.id, duration_ms: a.instruction.duration_ms, width: 1280, height: 720, bytes: a.instruction.bytes, has_audio: false, captions_available: Boolean(a.captions), captions_asset_id: a.captions?.id || null, caption_language: a.captions ? 'en' : null } : null,
      transcript_available: Boolean(revision.text.transcript),
    };
  }

  function coachDto(revision) {
    const pointer = current.get(revision.exercise_library_id);
    const owner = revision.uploaded_by_coach_id === currentCoachId();
    const isAdmin = state.coaches.find((c) => c.id === currentCoachId())?.is_admin;
    const currentOwner = pointer ? revisions.get(pointer.revision_id)?.uploaded_by_coach_id : null;
    const editable = !revision.archived && !revision.published_at && revision.status !== 'processing' && (owner || isAdmin);
    const a = byRole(revision.id);
    return {
      id: revision.id, exercise_id: revision.exercise_library_id, status: revision.status, review_status: revision.review_status, version: revision.version,
      recipe_version: revision.recipe_version, failure_code: revision.failure_code, based_on_revision_id: null, owned_by_you: owner,
      owner_name: state.coaches.find((c) => c.id === revision.uploaded_by_coach_id)?.name || null, published_at: revision.published_at,
      is_current: pointer?.revision_id === revision.id, archived: revision.archived, created_at: revision.created_at, updated_at: revision.updated_at,
      text: revision.text, recipe: revision.recipe, reviewed: revision.review_status === 'approved' ? { at: revision.updated_at, by_you: owner } : null,
      sources: owner || isAdmin ? revision.sources : null,
      derivatives: ['poster', 'end_frame', 'preview', 'instruction', 'captions'].filter((role) => a[role]).map((role) => ({ asset_id: a[role].id, role, width: a[role].width || null, height: a[role].height || null, duration_ms: a[role].duration_ms || null, bytes: a[role].bytes, has_audio: a[role].has_audio ?? null })),
      job: null, simulation: true,
      permissions: {
        can_edit: editable, can_upload: editable, can_process: editable && ['draft', 'failed'].includes(revision.status),
        can_review: !revision.published_at && revision.status === 'ready' && revision.review_status === 'needs_review' && (owner || isAdmin),
        can_publish: !revision.published_at && revision.status === 'ready' && revision.review_status === 'approved' && (owner || isAdmin) && (isAdmin || !currentOwner || currentOwner === currentCoachId()),
        publish_requires_admin: !isAdmin && Boolean(currentOwner) && currentOwner !== currentCoachId(), can_archive: !revision.archived && (owner || isAdmin),
      },
    };
  }

  async function imageDims(file) {
    try { const bitmap = await createImageBitmap(file); const dims = { width: bitmap.width, height: bitmap.height }; bitmap.close?.(); return dims; } catch { return null; }
  }
  function videoFacts(url) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata'; video.muted = true; video.src = url;
      video.onloadedmetadata = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, duration_ms: Math.round((video.duration || 6) * 1000) });
      video.onerror = () => resolve({ width: 1280, height: 720, duration_ms: 6000, undecodable: true });
    });
  }

  async function handle(config, method, path, payload) {
    if (!path.startsWith('/exercise-media/')) return undefined;
    if (!enabled) return Promise.reject({ response: { data: { error: 'Exercise media is not available in this environment.', code: 'media_unavailable' }, status: 503, statusText: 'Unavailable', headers: {}, config }, config });
    const refuse = (status, code) => Promise.reject({ response: { data: { error: code, code }, status, statusText: 'Error', headers: {}, config }, config });
    if (path === '/exercise-media/capabilities' && method === 'get') return ok({ processing_available: true, simulation: true, limits: {} }, config);
    if (path === '/exercise-media/library-status' && method === 'get') {
      const items = state.exerciseLibrary.filter((e) => !e.archived).map((e) => {
        const dto = clientDto(e.id);
        const drafts = [...revisions.values()].filter((r) => r.exercise_library_id === e.id && !r.archived && !r.published_at);
        return {
          exercise_id: e.id, current_version: current.get(e.id)?.version || 0, current_revision_id: current.get(e.id)?.revision_id || null,
          current_kind: dto?.kind || 'none', current_has_instruction: Boolean(dto?.instruction), current_owned_by_you: true, drafts_open: drafts.length,
          drafts_needs_review: drafts.filter((r) => r.status === 'ready' && r.review_status === 'needs_review').length,
          drafts_ready_to_publish: drafts.filter((r) => r.status === 'ready' && r.review_status === 'approved').length,
          drafts_processing: drafts.filter((r) => r.status === 'processing').length, drafts_failed: drafts.filter((r) => r.status === 'failed').length,
        };
      });
      const summary = { total: items.length, no_media: 0, photo_only: 0, frames: 0, ready_video: 0, needs_review: 0, processing: 0, processing_failed: 0 };
      for (const item of items) {
        summary[{ none: 'no_media', photo: 'photo_only', frames: 'frames', video: 'ready_video' }[item.current_kind]] += 1;
        if (item.drafts_needs_review) summary.needs_review += 1;
        if (item.drafts_processing) summary.processing += 1;
        if (item.drafts_failed) summary.processing_failed += 1;
      }
      return ok({ items, summary }, config);
    }
    let match = path.match(/^\/exercise-media\/exercises\/([^/]+)\/revisions$/);
    if (match && method === 'get') {
      const exercise = state.exerciseLibrary.find((e) => e.id === match[1] && !e.archived);
      if (!exercise) return refuse(404, 'not_found');
      const pointer = current.get(exercise.id);
      const mine = [...revisions.values()].filter((r) => r.exercise_library_id === exercise.id && !r.archived && !r.published_at)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return ok({ exercise: { id: exercise.id, name: exercise.name, equipment: exercise.equipment, category: exercise.category, primary_muscle: exercise.primary_muscle, hidden: false }, current: pointer ? coachDto(revisions.get(pointer.revision_id)) : null, current_version: pointer?.version || 0, drafts: mine.map(coachDto), next_before: null }, config);
    }
    match = path.match(/^\/exercise-media\/exercises\/([^/]+)\/drafts$/);
    if (match && method === 'post') {
      if (payload.confirm_exercise_id !== match[1]) return refuse(400, 'exercise_confirmation_required');
      const base = payload.base_revision_id ? revisions.get(payload.base_revision_id) : null;
      const id = nextId('rev_media_new');
      const revision = { id, exercise_library_id: match[1], uploaded_by_coach_id: currentCoachId(), status: 'draft', review_status: 'needs_review', version: 1, recipe_version: 1, failure_code: null, published_at: null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        text: base ? { ...base.text } : { alt_text: null, end_frame_alt_text: null, cues: [], transcript: null, caption_language: null, caption_cues: [], instruction_audio: false },
        recipe: base ? { ...base.recipe } : { include_instruction: false, poster_mode: null, poster_frame_ms: null, poster_crop: null, preview_start_ms: null, preview_end_ms: null, preview_crop: null, end_frame_ms: null, end_frame_crop: null },
        sources: base ? JSON.parse(JSON.stringify(base.sources)) : { image: null, video: null }, simulation: true };
      if (base) {
        for (const role of ['image', 'video']) {
          if (!revision.sources[role]) continue;
          const original = assets.get(revision.sources[role].asset_id);
          revision.sources[role].asset_id = addAsset(id, `source_${role}`, { ...original, id: undefined });
          revision.sources[role].copied = true;
        }
      }
      revisions.set(id, revision);
      return ok({ revision: coachDto(revision), replayed: false }, config, 201);
    }
    match = path.match(/^\/exercise-media\/revisions\/([^/]+)(\/[a-z-/]+)?$/);
    const revision = match ? revisions.get(match[1]) : null;
    if (match && !revision) return refuse(404, 'not_found');
    const action = match?.[2] || '';
    const bump = () => { revision.version += 1; revision.updated_at = new Date().toISOString(); };
    if (match && action === '' && method === 'get') {
      // Simulated processing finishes after a few status polls.
      if (revision.status === 'processing') {
        revision.pollsLeft = (revision.pollsLeft ?? 2) - 1;
        if (revision.pollsLeft <= 0) {
          const title = state.exerciseLibrary.find((e) => e.id === revision.exercise_library_id)?.name || 'Synthetic';
          const hue = HUES[revision.exercise_library_id] || 30;
          const posterSource = revision.recipe.poster_mode === 'uploaded_image' ? assets.get(revision.sources.image?.asset_id) : null;
          addAsset(revision.id, 'poster', { width: 640, height: 360, bytes: 21000, make: posterSource?.file ? () => cropUrl(posterSource.file, revision.recipe.poster_crop) : () => stillUrl(`${title} (simulated)`, hue) });
          if (revision.recipe.end_frame_ms != null) addAsset(revision.id, 'end_frame', { width: 640, height: 360, bytes: 20000, make: () => stillUrl(`${title} — end (simulated)`, hue + 40) });
          if (revision.recipe.preview_start_ms != null) addAsset(revision.id, 'preview', { width: 640, height: 360, bytes: 14000, has_audio: false, duration_ms: revision.recipe.preview_end_ms - revision.recipe.preview_start_ms, make: () => clipUrl(`${title} (simulated)`, hue, 1600) });
          if (revision.recipe.include_instruction) addAsset(revision.id, 'instruction', { width: 1280, height: 720, bytes: 45000, has_audio: false, duration_ms: 2400, make: () => clipUrl(`${title} — full (simulated)`, hue, 2400) });
          revision.status = 'ready'; bump();
        }
      }
      return ok(coachDto(revision), config);
    }
    if (match && action === '/sources' && method === 'post') {
      const role = new URL(config.url, 'http://preview.local').searchParams.get('role') || config.params?.role;
      const form = config.data;
      const file = form?.get?.('file');
      if (!file || !['source_image', 'source_video'].includes(role)) return refuse(400, 'file_required');
      if (form.get('rights_confirmed') !== 'true') return refuse(422, 'rights_confirmation_required');
      const url = URL.createObjectURL(file);
      const facts = role === 'source_image' ? await imageDims(file) : await videoFacts(url);
      if (!facts) return refuse(415, 'unsupported_image_type');
      const key = role === 'source_image' ? 'image' : 'video';
      const assetId = addAsset(revision.id, `${role}_${Date.now()}`, { ...facts, bytes: file.size, file, make: () => Promise.resolve(url) });
      revision.sources[key] = { asset_id: assetId, ...facts, has_audio: false, bytes: file.size, mime_type: file.type, display_name: file.name, rights_basis: form.get('rights_basis'), rights_note: form.get('rights_note') || null, uploaded_by_you: true, copied: false };
      if (!revision.recipe.poster_mode) revision.recipe.poster_mode = role === 'source_image' ? 'uploaded_image' : 'video_frame';
      revision.status = 'draft'; revision.review_status = 'needs_review'; revision.recipe_version += 1; bump();
      return ok({ revision: coachDto(revision), replayed: false }, config, 201);
    }
    if (match && action === '/sources/remove' && method === 'post') {
      revision.sources[payload.role === 'source_image' ? 'image' : 'video'] = null; bump();
      return ok(coachDto(revision), config);
    }
    if (match && action === '/recipe' && method === 'patch') {
      if (payload.expected_version !== revision.version) return refuse(409, 'stale');
      const { expected_version: _v, ...patch } = payload;
      if (typeof patch.alt_text === 'string' && patch.alt_text.length > 240) return refuse(422, 'alt_text_too_long');
      if (patch.preview_start_ms != null && patch.preview_end_ms != null && (patch.preview_end_ms - patch.preview_start_ms < 1000 || patch.preview_end_ms - patch.preview_start_ms > 8000)) return refuse(422, 'invalid_preview_range');
      for (const [key, value] of Object.entries(patch)) {
        if (key in revision.text) revision.text[key] = value;
        else revision.recipe[key] = value;
      }
      revision.review_status = 'needs_review';
      if (Object.keys(patch).some((key) => key in revision.recipe || key === 'caption_cues')) revision.status = 'draft';
      bump();
      return ok(coachDto(revision), config);
    }
    if (match && action === '/process' && method === 'post') {
      if (!revision.text.alt_text) return refuse(422, 'alt_text_required');
      revision.status = 'processing'; revision.pollsLeft = 2; revision.failure_code = null; bump();
      return ok(coachDto(revision), config);
    }
    if (match && action === '/frame-preview' && method === 'post') {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      paint(canvas, { title: `Server frame at ${(payload.time_ms / 1000).toFixed(2)} s (simulated)`, hue: 200 });
      return new Promise((resolve) => canvas.toBlob((blob) => resolve(ok(undefined, config).then((response) => ({ ...response, data: blob }))), 'image/jpeg', 0.85));
    }
    if (match && action === '/review' && method === 'post') {
      if (!(payload.variant_confirmed === true && payload.rights_confirmed === true && payload.content_confirmed === true)) return refuse(422, 'attestation_required');
      revision.review_status = 'approved'; bump();
      return ok(coachDto(revision), config);
    }
    if (match && action === '/archive' && method === 'post') {
      revision.archived = true;
      const pointer = current.get(revision.exercise_library_id);
      if (pointer?.revision_id === revision.id) current.set(revision.exercise_library_id, { revision_id: null, version: pointer.version + 1 });
      return ok({ archived: true }, config);
    }
    match = path.match(/^\/exercise-media\/exercises\/([^/]+)\/publish$/);
    if (match && method === 'post') {
      const target = revisions.get(payload.revision_id);
      const pointer = current.get(match[1]);
      if ((pointer?.version || 0) !== payload.expected_current_version) return refuse(409, 'stale');
      if (!target || target.status !== 'ready' || target.review_status !== 'approved') return refuse(409, 'not_ready');
      target.published_at = new Date().toISOString();
      current.set(match[1], { revision_id: target.id, version: (pointer?.version || 0) + 1 });
      return ok({ current_version: current.get(match[1]).version, revision: coachDto(target) }, config);
    }
    if (path === '/exercise-media/links' && method === 'post') {
      const links = [];
      const missing = [];
      for (const { asset_id: assetId } of payload.assets || []) {
        const asset = assets.get(assetId);
        if (!asset) { missing.push(assetId); continue; }
        if (asset.broken) {
          // Simulates a 404/expired poster once; an explicit Retry recovers.
          asset.broken = false;
          links.push({ asset_id: assetId, url: 'blob:preview-broken-link', expires_at: new Date(Date.now() + 60_000).toISOString() });
          continue;
        }
        if (!blobs.has(assetId)) blobs.set(assetId, asset.make());
        links.push({ asset_id: assetId, url: await blobs.get(assetId), expires_at: new Date(Date.now() + 60_000).toISOString() });
      }
      return ok({ links, missing }, config);
    }
    if (path === '/exercise-media/resolve' && method === 'post') {
      return ok({ media: Object.values(EX).map(clientDto).filter(Boolean) }, config);
    }
    if (path === '/exercise-media/text' && method === 'post') {
      const dto = clientDto(payload.exercise_id);
      if (!dto) return refuse(404, 'not_found');
      return ok({ exercise_id: payload.exercise_id, revision_id: dto.revision_id, transcript: revisions.get(dto.revision_id).text.transcript, caption_language: 'en', cues: dto.cues }, config);
    }
    return undefined;
  }

  function cropUrl(file, crop) {
    return createImageBitmap(file).then((bitmap) => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const c = crop || { x: 0, y: 0, width: 1, height: 1 };
      canvas.getContext('2d').drawImage(bitmap, c.x * bitmap.width, c.y * bitmap.height, c.width * bitmap.width, c.height * bitmap.height, 0, 0, 640, 360);
      return new Promise((resolve) => canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), 'image/jpeg', 0.85));
    });
  }

  // Hydration for workout reads: only while the scenario is on, mirroring a
  // server where media is enabled (every row gains a media field).
  function hydrate(rows, libraryIdOf) {
    if (!enabled) return rows;
    return rows.map((row) => ({ ...row, media: libraryIdOf(row) ? clientDto(libraryIdOf(row)) : null }));
  }

  return { enabled, handle, hydrate };
}

export const PREVIEW_MEDIA_SAVE_ROUTES = [
  ['post', /^\/exercise-media\/exercises\/([^/]+)\/drafts$/],
  ['post', /^\/exercise-media\/revisions\/([^/]+)\/sources$/],
  ['post', /^\/exercise-media\/revisions\/([^/]+)\/sources\/remove$/],
  ['patch', /^\/exercise-media\/revisions\/([^/]+)\/recipe$/],
  ['post', /^\/exercise-media\/revisions\/([^/]+)\/process$/],
  ['post', /^\/exercise-media\/revisions\/([^/]+)\/review$/],
  ['post', /^\/exercise-media\/exercises\/([^/]+)\/publish$/],
  ['post', /^\/exercise-media\/revisions\/([^/]+)\/archive$/],
];
export const PREVIEW_MEDIA_READ_LIKE_POSTS = [
  /^\/exercise-media\/links$/, /^\/exercise-media\/resolve$/, /^\/exercise-media\/text$/, /^\/exercise-media\/revisions\/([^/]+)\/frame-preview$/,
];
