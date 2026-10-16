const test = require('node:test');
const assert = require('node:assert/strict');
const { parseContext, resolveContext, allowedAssets } = require('../src/lib/exerciseMedia/authorization');
const { clientMediaDto, mediaMap, coachRevisionDto, libraryStatusDto } = require('../src/lib/exerciseMedia/serialization');

const id = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COACH_A = { role: 'coach', coach: { id: id(901) } };
const COACH_B = { role: 'coach', coach: { id: id(902) } };
const ADMIN = { role: 'admin', coach: { id: id(903) } };
const CLIENT_1 = { role: 'client', client: { id: id(801) } };
const CLIENT_2 = { role: 'client', client: { id: id(802) } };
const EX = { squat: id(1), split: id(2), row: id(3) };

function world() {
  const state = {
    logs: { [id(501)]: { id: id(501), client_id: id(801), archived: false, client: { id: id(801), coach_id: id(901), archived: false } } },
    logExercises: { [id(501)]: new Set([EX.squat, EX.split]) },
    workoutAssignments: { [id(601)]: { id: id(601), client_id: id(801), workout_id: id(701), archived: false, client: { id: id(801), coach_id: id(901), archived: false } } },
    programAssignments: { [id(651)]: { id: id(651), client_id: id(801), program_id: id(751), archived: false, client: { id: id(801), coach_id: id(901), archived: false } } },
    programWorkouts: { [id(751)]: [id(701), id(702)] },
    workouts: { [id(701)]: { id: id(701), is_template: true, archived: false }, [id(702)]: { id: id(702), is_template: false, client_owner: { coach_id: id(901) }, archived: false } },
    workoutExercises: { [id(701)]: [EX.squat], [id(702)]: [EX.row] },
    exercises: { [EX.squat]: { id: EX.squat, archived: false }, [EX.split]: { id: EX.split, archived: false }, [EX.row]: { id: EX.row, archived: true } },
    revisions: { [id(301)]: { id: id(301), exercise_library_id: EX.squat, uploaded_by_coach_id: id(901), archived: false } },
    bundle: {
      [EX.squat]: { exercise_library_id: EX.squat, revision_id: id(311), version: 2, alt_text: 'Synthetic', cues: [], assets: [{ id: id(401), role: 'poster', width: 640, height: 360 }] },
      [EX.split]: { exercise_library_id: EX.split, revision_id: id(312), version: 1, alt_text: 'Synthetic', cues: [], assets: [{ id: id(402), role: 'poster', width: 640, height: 360 }] },
      [EX.row]: { exercise_library_id: EX.row, revision_id: id(313), version: 1, alt_text: 'Synthetic', cues: [], assets: [{ id: id(403), role: 'poster', width: 640, height: 360 }] },
    },
    revisionAssets: { [id(301)]: [{ id: id(404), role: 'source_image', revision_id: id(301) }, { id: id(405), role: 'poster', revision_id: id(301) }] },
  };
  const repo = {
    workoutLog: async (key) => state.logs[key] || null,
    logExerciseLibraryIds: async (key) => new Set(state.logExercises[key] || []),
    workoutAssignment: async (key) => state.workoutAssignments[key] || null,
    programAssignment: async (key) => state.programAssignments[key] || null,
    programWorkoutIds: async (key) => state.programWorkouts[key] || null,
    liveWorkoutIds: async (ids) => ids.filter((w) => state.workouts[w] && !state.workouts[w].archived),
    workout: async (key) => state.workouts[key] || null,
    workoutExerciseLibraryIds: async (ids) => new Set(ids.flatMap((w) => state.workoutExercises[w] || [])),
    exercise: async (key) => state.exercises[key] || null,
    revision: async (key) => state.revisions[key] || null,
    assetsFor: async (ids) => ids.flatMap((r) => state.revisionAssets[r] || []),
    bundle: async (ids) => ids.map((e) => state.bundle[e]).filter(Boolean),
  };
  return { state, repo };
}

const assets = async (repo, user, context) => [...(await allowedAssets(repo, await resolveContext(repo, user, parseContext(context)))).keys()].sort();

test('contexts: malformed input is a 400, never a lookup', () => {
  for (const bad of [null, 'x', [], { type: 'workout_log' }, { type: 'workout_log', id: 'nope' }, { type: 'sql', id: id(1) },
    { type: 'workout_log', id: id(1), extra: 1 }, { type: 'library', id: id(1) }, { type: 'library', exercise_id: "1' or 1=1" }]) {
    assert.throws(() => parseContext(bad), /invalid_context/);
  }
  assert.deepEqual(parseContext({ type: 'WORKOUT_LOG'.toLowerCase(), id: id(5).toUpperCase() }), { type: 'workout_log', id: id(5) });
});

test('client reads: only their own active log/assignments; another client, archived or revoked contexts are invisible', async () => {
  const { state, repo } = world();
  assert.deepEqual(await assets(repo, CLIENT_1, { type: 'workout_log', id: id(501) }), [id(401), id(402)]);
  assert.deepEqual(await assets(repo, CLIENT_2, { type: 'workout_log', id: id(501) }), [], 'other client');
  assert.equal(await resolveContext(repo, CLIENT_2, parseContext({ type: 'workout_log', id: id(501) })), null);
  assert.deepEqual(await assets(repo, CLIENT_1, { type: 'workout_assignment', id: id(601) }), [id(401)]);
  // Program assignment: template + private instance workouts; archived exercise has no current guide.
  state.bundle[EX.row] = undefined;
  assert.deepEqual(await assets(repo, CLIENT_1, { type: 'program_assignment', id: id(651) }), [id(401)]);
  // Revoked assignment (archived rows are filtered by the repo) and unknown ids.
  delete state.workoutAssignments[id(601)];
  assert.equal(await resolveContext(repo, CLIENT_1, parseContext({ type: 'workout_assignment', id: id(601) })), null);
  assert.equal(await resolveContext(repo, CLIENT_1, parseContext({ type: 'workout_log', id: id(999) })), null);
  // Coach-only contexts are never resolved for clients.
  for (const context of [{ type: 'library', exercise_id: EX.squat }, { type: 'workout', id: id(701) }, { type: 'revision', id: id(301) }]) {
    assert.equal(await resolveContext(repo, CLIENT_1, parseContext(context)), null, context.type);
  }
});

test('coach reads follow current client ownership; reassignment removes access immediately', async () => {
  const { state, repo } = world();
  assert.deepEqual(await assets(repo, COACH_A, { type: 'workout_log', id: id(501) }), [id(401), id(402)]);
  assert.deepEqual(await assets(repo, COACH_B, { type: 'workout_log', id: id(501) }), []);
  assert.deepEqual(await assets(repo, ADMIN, { type: 'workout_log', id: id(501) }), [id(401), id(402)]);
  state.logs[id(501)].client.coach_id = id(902);
  assert.deepEqual(await assets(repo, COACH_A, { type: 'workout_log', id: id(501) }), [], 'former coach loses access');
  assert.deepEqual(await assets(repo, COACH_B, { type: 'workout_log', id: id(501) }), [id(401), id(402)]);
  // Private instances: only the client's current coach; templates: any coach.
  assert.deepEqual(await assets(repo, COACH_B, { type: 'workout', id: id(701) }), [id(401)]);
  assert.equal(await resolveContext(repo, COACH_B, parseContext({ type: 'workout', id: id(702) })), null);
  // Library: any active coach, but never archived exercises.
  assert.deepEqual(await assets(repo, COACH_B, { type: 'library', exercise_id: EX.squat }), [id(401)]);
  assert.equal(await resolveContext(repo, COACH_B, parseContext({ type: 'library', exercise_id: EX.row })), null);
});

test('draft/source assets: uploader and admin only; another coach cannot read A\'s draft', async () => {
  const { repo } = world();
  assert.deepEqual(await assets(repo, COACH_A, { type: 'revision', id: id(301) }), [id(404), id(405)]);
  assert.deepEqual(await assets(repo, ADMIN, { type: 'revision', id: id(301) }), [id(404), id(405)]);
  assert.equal(await resolveContext(repo, COACH_B, parseContext({ type: 'revision', id: id(301) })), null);
  // A valid asset id of another exercise is not reachable through an unrelated context.
  const allowed = await allowedAssets(repo, await resolveContext(repo, CLIENT_1, parseContext({ type: 'workout_assignment', id: id(601) })));
  assert.equal(allowed.has(id(402)), false);
});

test('read failures propagate (5xx/retry), never "not found"', async () => {
  const { repo } = world();
  repo.workoutLog = async () => { throw Object.assign(new Error('db down'), { code: 'PGRST000' }); };
  await assert.rejects(resolveContext(repo, CLIENT_1, parseContext({ type: 'workout_log', id: id(501) })), /db down/);
});

test('client DTO: explicit allowlist, no storage/owner/rights/job fields, kind derived from derivatives', () => {
  const item = {
    exercise_library_id: EX.squat, revision_id: id(311), version: 3, alt_text: 'Synthetic goblet squat setup', end_frame_alt_text: 'Synthetic end',
    cues: ['Synthetic cue', 7, 'b', 'c', 'd'], transcript_available: true, caption_language: 'en', storage_key: 'sources/x.jpg', uploaded_by_coach_id: id(901),
    rights_note: 'private', assets: [
      { id: id(401), role: 'poster', width: 640, height: 360, storage_key: 'derivatives/x', sha256: 'f'.repeat(64) },
      { id: id(406), role: 'end_frame', width: 640, height: 360 },
      { id: id(407), role: 'preview', width: 720, height: 404, duration_ms: 2000, bytes: 90000 },
      { id: id(408), role: 'instruction', width: 1080, height: 608, duration_ms: 6000, bytes: 500000, has_audio: true },
      { id: id(409), role: 'captions' },
      { id: id(410), role: 'source_video', storage_key: 'sources/y.mp4' },
    ],
  };
  const dto = clientMediaDto(item);
  assert.deepEqual(Object.keys(dto).sort(), ['alt_text', 'cues', 'end_frame', 'exercise_id', 'instruction', 'kind', 'poster', 'preview', 'revision_id', 'transcript_available', 'version']);
  assert.equal(dto.kind, 'video');
  assert.deepEqual(dto.cues, ['Synthetic cue', 'b', 'c']);
  assert.deepEqual(dto.poster, { asset_id: id(401), width: 640, height: 360 });
  assert.deepEqual(dto.instruction, { asset_id: id(408), duration_ms: 6000, width: 1080, height: 608, bytes: 500000, has_audio: true, captions_available: true, captions_asset_id: id(409), caption_language: 'en' });
  const text = JSON.stringify(dto);
  for (const forbidden of ['storage_key', 'sha256', 'rights', 'uploaded_by', 'source_video', id(410), 'derivatives/', 'sources/']) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(clientMediaDto({ ...item, assets: item.assets.filter((a) => a.role === 'poster') }).kind, 'photo');
  assert.equal(clientMediaDto({ ...item, assets: item.assets.filter((a) => ['poster', 'end_frame'].includes(a.role)) }).kind, 'frames');
  assert.equal(clientMediaDto({ ...item, assets: [] }), null, 'no poster, no guide');
  assert.equal(mediaMap([item, { ...item, exercise_library_id: EX.split, assets: [] }]).size, 1);
});

test('coach DTO: rights notes only for their uploader/admin; publish needs admin over another coach\'s current', () => {
  const revision = { id: id(301), exercise_library_id: EX.squat, uploaded_by_coach_id: id(901), status: 'ready', review_status: 'approved', version: 5, recipe_version: 2, archived: false, published_at: null, cues: [], caption_cues: [] };
  const assetsRows = [{ id: id(404), revision_id: id(301), role: 'source_image', uploaded_by_coach_id: id(901), rights_basis: 'owned', rights_note: 'Fictional consent note', archived: false, storage_key: 'sources/a.jpg' }];
  const own = coachRevisionDto(revision, { assets: assetsRows, actor: COACH_A, current: { revision_id: id(311), owner_id: id(902), version: 1 } });
  assert.equal(own.sources.image.rights_note, 'Fictional consent note');
  assert.equal(own.permissions.can_publish, false); assert.equal(own.permissions.publish_requires_admin, true);
  assert.equal(JSON.stringify(own).includes('sources/a.jpg'), false, 'no storage key');
  const admin = coachRevisionDto(revision, { assets: assetsRows, actor: ADMIN, current: { revision_id: id(311), owner_id: id(902), version: 1 } });
  assert.equal(admin.permissions.can_publish, true); assert.equal(admin.sources.image.rights_note, 'Fictional consent note');
  const other = coachRevisionDto(revision, { assets: assetsRows, actor: COACH_B, current: null });
  assert.equal(other.sources, null); assert.equal(other.permissions.can_edit, false); assert.equal(other.permissions.can_archive, false);
  const copied = coachRevisionDto({ ...revision, uploaded_by_coach_id: id(902) }, { assets: [{ ...assetsRows[0], copied_from_asset_id: id(1) }], actor: COACH_B, current: null });
  assert.equal(copied.sources.image.rights_note, null, 'a copied source keeps its original uploader\'s private note');
});

test('library summary counts each readiness filter from server rows', () => {
  const rows = [
    { exercise_library_id: EX.squat, current_kind: 'photo', current_owner_id: id(901), drafts_needs_review: 1, drafts_processing: 0, drafts_failed: 0 },
    { exercise_library_id: EX.split, current_kind: 'video', current_owner_id: id(902), drafts_needs_review: 0, drafts_processing: 1, drafts_failed: 1 },
    { exercise_library_id: EX.row, current_kind: 'none', drafts_needs_review: 0, drafts_processing: 0, drafts_failed: 0 },
  ];
  const { items, summary } = libraryStatusDto(rows, COACH_A);
  assert.deepEqual(summary, { total: 3, no_media: 1, photo_only: 1, frames: 0, ready_video: 1, needs_review: 1, processing: 1, processing_failed: 1 });
  assert.equal(items[0].current_owned_by_you, true); assert.equal(items[1].current_owned_by_you, false);
  assert.equal('current_owner_id' in items[0], false);
});
