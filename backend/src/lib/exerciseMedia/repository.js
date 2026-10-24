// Data access for exercise media over the service-role client. Every method
// throws on a database error (callers answer 5xx/retry, never "not found").
// Rows returned here may contain backend-only fields (storage keys, hashes,
// rights notes); serialization.js decides what leaves the server.

const ASSET_COLUMNS = 'id,revision_id,role,storage_key,mime_type,bytes,width,height,duration_ms,has_audio,sha256,rights_basis,rights_note,display_name,uploaded_by_coach_id,copied_from_asset_id,recipe_version,archived,created_at';

function createRepository(db) {
  async function rows(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
  async function maybe(query) {
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
  }

  return {
    async rpc(name, args) {
      const { data, error } = await db.rpc(name, args);
      if (error) throw error;
      return data;
    },

    coach: (id) => maybe(db.from('coaches').select('id,name,is_admin,archived').eq('id', id).eq('archived', false)),
    client: (id) => maybe(db.from('clients').select('id,coach_id,archived,auth_user_id').eq('id', id).eq('archived', false)),
    exercise: (id) => maybe(db.from('exercise_library').select('id,name,category,equipment,primary_muscle,hidden,archived').eq('id', id)),
    revision: (id) => maybe(db.from('exercise_media_revisions').select('*').eq('id', id)),

    async revisionsForExercise(exerciseId, { ownerId = null, limit = 30, before = null } = {}) {
      let query = db.from('exercise_media_revisions').select('*').eq('exercise_library_id', exerciseId).eq('archived', false)
        .is('published_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
      if (ownerId) query = query.eq('uploaded_by_coach_id', ownerId);
      if (before) query = query.lt('created_at', before);
      return rows(query);
    },

    async assetsFor(revisionIds) {
      if (!revisionIds.length) return [];
      return rows(db.from('exercise_media_assets').select(ASSET_COLUMNS).in('revision_id', revisionIds).eq('archived', false));
    },

    asset: (id) => maybe(db.from('exercise_media_assets').select(ASSET_COLUMNS).eq('id', id)),

    // Photo direct-upload intents (backend-only rows: staging keys never leave the server).
    uploadIntent: (id) => maybe(db.from('exercise_media_upload_intents').select('*').eq('id', id)),
    async uploadIntentsFor(revisionId, actorId) {
      return rows(db.from('exercise_media_upload_intents').select('id,request_id,state,declared_bytes,declared_mime,created_at')
        .eq('revision_id', revisionId).eq('actor_coach_id', actorId).eq('state', 'issued').order('created_at', { ascending: false }).limit(5));
    },

    async current(exerciseId) {
      const pointer = await maybe(db.from('exercise_media_current').select('exercise_library_id,revision_id,version').eq('exercise_library_id', exerciseId));
      if (!pointer?.revision_id) return { revision_id: null, version: pointer?.version || 0, owner_id: null };
      const revision = await maybe(db.from('exercise_media_revisions').select('id,uploaded_by_coach_id').eq('id', pointer.revision_id));
      return { revision_id: pointer.revision_id, version: pointer.version, owner_id: revision?.uploaded_by_coach_id || null };
    },

    async bundle(exerciseIds) {
      const ids = [...new Set(exerciseIds.filter(Boolean))];
      if (!ids.length) return [];
      const { data, error } = await db.rpc('exercise_media_current_bundle', { p_exercise_ids: ids });
      if (error) throw error;
      return data || [];
    },

    async libraryStatus(actorId) {
      const { data, error } = await db.rpc('exercise_media_library_status', { p_actor: actorId });
      if (error) throw error;
      return data || [];
    },

    latestJob: (revisionId) => maybe(db.from('exercise_media_jobs').select('id,state,attempts,error_code,recipe_version')
      .eq('revision_id', revisionId).order('created_at', { ascending: false }).limit(1)),

    coachNames: async (ids) => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) return new Map();
      const data = await rows(db.from('coaches').select('id,name').in('id', unique));
      return new Map(data.map((row) => [row.id, row.name]));
    },

    // ----- Workout contexts (exercise membership derived server-side) -----
    workoutLog: (id) => maybe(db.from('workout_logs').select('id,client_id,archived,status,client:clients(id,coach_id,archived)').eq('id', id).eq('archived', false)),
    async logExerciseLibraryIds(logId) {
      const logged = await rows(db.from('workout_log_exercises').select('exercise_library_id,source_workout_exercise_id').eq('workout_log_id', logId).eq('archived', false));
      const ids = new Set(logged.map((row) => row.exercise_library_id).filter(Boolean));
      const legacy = [...new Set(logged.filter((row) => !row.exercise_library_id && row.source_workout_exercise_id).map((row) => row.source_workout_exercise_id))];
      if (legacy.length) {
        const sources = await rows(db.from('workout_exercises').select('id,exercise_library_id').in('id', legacy));
        for (const row of sources) if (row.exercise_library_id) ids.add(row.exercise_library_id);
      }
      return ids;
    },
    workoutAssignment: (id) => maybe(db.from('workout_assignments').select('id,client_id,workout_id,archived,client:clients(id,coach_id,archived)').eq('id', id).eq('archived', false)),
    programAssignment: (id) => maybe(db.from('program_assignments').select('id,client_id,program_id,archived,client:clients(id,coach_id,archived)').eq('id', id).eq('archived', false)),
    workout: (id) => maybe(db.from('workouts').select('*, client_owner:clients!client_id(coach_id)').eq('id', id).eq('archived', false)),
    async workoutExerciseLibraryIds(workoutIds) {
      if (!workoutIds.length) return new Set();
      const data = await rows(db.from('workout_exercises').select('exercise_library_id').in('workout_id', workoutIds).eq('archived', false));
      return new Set(data.map((row) => row.exercise_library_id).filter(Boolean));
    },
    async programWorkoutIds(programId) {
      const program = await maybe(db.from('programs').select('id,archived').eq('id', programId).eq('archived', false));
      if (!program) return null;
      const days = await rows(db.from('program_days').select('workout_id').eq('program_id', programId).eq('archived', false));
      return [...new Set(days.map((day) => day.workout_id).filter(Boolean))];
    },
    async liveWorkoutIds(ids) {
      if (!ids.length) return [];
      const data = await rows(db.from('workouts').select('id').in('id', ids).eq('archived', false));
      return data.map((row) => row.id);
    },
  };
}

module.exports = { createRepository };
