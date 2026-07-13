import draftTools from '@/lib/programDraft.js';

const {
  csvTemplate,
  normalizeDraft,
  normalizeName,
  parseCsvDraft,
  parsePasteDraft,
  validateDraft,
} = draftTools;

const PREVIEW_ROLE_KEY = 'cvf_preview_role';
const PREVIEW_CLIENT_KEY = 'cvf_preview_client_id';
const CHANGE_EVENT = 'cvf-preview-change';

export const isPreviewMode = Boolean(import.meta.env.DEV && import.meta.env.REACT_APP_PREVIEW_MODE === 'true');

const now = new Date();
const iso = (days = 0, hours = 9) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
};
const dateOnly = (days = 0) => iso(days).slice(0, 10);
const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const state = {
  coaches: [
    { id: 'coach_marcus', auth_user_id: 'auth_marcus', name: 'Marcus Rivera', email: 'marcus@corevaluefitness.com', phone: '505-555-0101', is_admin: true, archived: false, created_at: iso(-300) },
    { id: 'coach_jordan', auth_user_id: 'auth_jordan', name: 'Jordan Banks', email: 'jordan@corevaluefitness.com', phone: '505-555-0102', is_admin: false, archived: false, created_at: iso(-240) },
    { id: 'coach_alex', auth_user_id: 'auth_alex', name: 'Alex Trujillo', email: 'alex@corevaluefitness.com', phone: '505-555-0103', is_admin: false, archived: false, created_at: iso(-180) },
  ],
  clients: [
    { id: 'client_sarah', coach_id: 'coach_marcus', name: 'Sarah Martinez', email: 'client.demo@corevaluefitness.com', phone: '505-555-0201', goals: 'Build strength and run a 10k in spring', health_notes: 'Mild left knee tendinitis', invited: true, auth_user_id: 'auth_sarah', archived: false, created_at: iso(-120), updated_at: iso(-1) },
    { id: 'client_david', coach_id: 'coach_marcus', name: 'David Chen', email: 'david.chen@example.com', phone: '505-555-0202', goals: 'Lose 20 lbs, improve energy', health_notes: 'Hypertension, cleared by physician', invited: true, auth_user_id: null, archived: false, created_at: iso(-90), updated_at: iso(-4) },
    { id: 'client_emily', coach_id: 'coach_jordan', name: 'Emily Romero', email: 'emily.romero@example.com', phone: '505-555-0203', goals: 'Postpartum strength rebuild', health_notes: 'Core progressions only', invited: false, auth_user_id: null, archived: false, created_at: iso(-60), updated_at: iso(-6) },
  ],
  resourceCategories: [
    { id: 'resource_category_general', name: 'General Info', created_at: iso(-90) },
    { id: 'resource_category_recovery', name: 'Injury & Recovery', created_at: iso(-90) },
    { id: 'resource_category_nutrition', name: 'Nutrition', created_at: iso(-90) },
  ],
  resources: [
    { id: 'resource_public_welcome', title: 'Welcome to CVF PT', description: 'What to expect from your coaching experience.', category_id: 'resource_category_general', storage_path: 'preview/welcome.pdf', file_name: 'CVF-Welcome.pdf', file_size_bytes: 82432, is_public: true, archived: false, uploaded_by_coach_id: 'coach_jordan', created_at: iso(-28) },
    { id: 'resource_sarah_recovery', title: 'Knee Recovery Basics', description: 'Simple recovery guidance for training days.', category_id: 'resource_category_recovery', storage_path: 'preview/knee-recovery.pdf', file_name: 'Knee-Recovery-Basics.pdf', file_size_bytes: 126640, is_public: false, archived: false, uploaded_by_coach_id: 'coach_jordan', created_at: iso(-14) },
  ],
  resourceAssignments: [
    { id: 'resource_assignment_sarah', resource_id: 'resource_sarah_recovery', client_id: 'client_sarah', active: true, assigned_at: iso(-12) },
  ],
  credits: { client_sarah: 8, client_david: 2, client_emily: 5 },
  sessions: [
    { id: 'session_today', client_id: 'client_sarah', coach_id: 'coach_marcus', scheduled_at: iso(0, 15), duration_minutes: 60, location: 'CVF Studio', status: 'scheduled', credit_deducted: false, archived: false, created_at: iso(-20), updated_at: iso(-1) },
    { id: 'session_next', client_id: 'client_sarah', coach_id: 'coach_marcus', scheduled_at: iso(3, 10), duration_minutes: 60, location: 'CVF Studio', status: 'scheduled', credit_deducted: false, archived: false, created_at: iso(-18), updated_at: iso(-1) },
    { id: 'session_done', client_id: 'client_sarah', coach_id: 'coach_marcus', scheduled_at: iso(-3, 9), duration_minutes: 60, location: 'CVF Studio', status: 'completed', credit_deducted: true, archived: false, created_at: iso(-30), updated_at: iso(-3) },
    { id: 'session_david', client_id: 'client_david', coach_id: 'coach_marcus', scheduled_at: iso(1, 13), duration_minutes: 45, location: 'CVF Studio', status: 'scheduled', credit_deducted: false, archived: false, created_at: iso(-12), updated_at: iso(-1) },
  ],
  sessionNotes: [
    { id: 'note_1', session_id: 'session_done', coach_id: 'coach_marcus', content: 'Great pacing today. Keep squats controlled and pain-free.', shared_with_client: true, archived: false, created_at: iso(-3, 11), updated_at: iso(-3, 11) },
  ],
  metrics: [
    { id: 'metric_weight', client_id: 'client_sarah', name: 'Body Weight', unit: 'lbs', archived: false, created_at: iso(-40) },
    { id: 'metric_waist', client_id: 'client_sarah', name: 'Waist', unit: 'in', archived: false, created_at: iso(-40) },
    { id: 'metric_mile', client_id: 'client_david', name: 'Mile Time', unit: 'min', archived: false, created_at: iso(-30) },
  ],
  metricEntries: [
    { id: 'entry_w1', metric_id: 'metric_weight', value: 168, notes: null, recorded_on: dateOnly(-28), archived: false, created_at: iso(-28) },
    { id: 'entry_w2', metric_id: 'metric_weight', value: 164.5, notes: 'Morning weigh-in', recorded_on: dateOnly(-14), archived: false, created_at: iso(-14) },
    { id: 'entry_w3', metric_id: 'metric_weight', value: 162, notes: null, recorded_on: dateOnly(-2), archived: false, created_at: iso(-2) },
    { id: 'entry_waist1', metric_id: 'metric_waist', value: 34.5, notes: null, recorded_on: dateOnly(-21), archived: false, created_at: iso(-21) },
    { id: 'entry_waist2', metric_id: 'metric_waist', value: 33.75, notes: null, recorded_on: dateOnly(-1), archived: false, created_at: iso(-1) },
  ],
  checkIns: [
    { id: 'check_sarah_today', client_id: 'client_sarah', coach_id: 'coach_marcus', check_in_date: dateOnly(0), energy: 4, soreness: 2, sleep_quality: 4, stress: 2, body_notes: 'Knee feels good today.', training_notes: 'Ready for lower body if we keep depth reasonable.', general_notes: 'Busy workday but on track.', coach_notes: 'Looks good. Warm up a little longer before squats.', review_status: 'reviewed', created_by_role: 'client', created_by_id: 'client_sarah', updated_by_role: 'coach', updated_by_id: 'coach_marcus', archived: false, created_at: iso(0, 8), updated_at: iso(0, 9) },
    { id: 'check_david', client_id: 'client_david', coach_id: 'coach_marcus', check_in_date: dateOnly(-1), energy: 2, soreness: 3, sleep_quality: 2, stress: 4, body_notes: 'Low energy.', training_notes: 'Cardio felt harder.', general_notes: 'Need an easier day.', coach_notes: null, review_status: 'needs_review', created_by_role: 'client', created_by_id: 'client_david', updated_by_role: 'client', updated_by_id: 'client_david', archived: false, created_at: iso(-1, 7), updated_at: iso(-1, 7) },
  ],
  exerciseLibrary: [
    { id: 'lib_goblet_squat', name: 'Goblet Squat', category: 'Strength', equipment: 'Dumbbell', primary_muscle: 'Quads', secondary_muscles: 'Glutes, Core', video_url: 'https://www.youtube.com/watch?v=MeIiIdhvXT4', notes: 'Use as the default squat pattern for new clients.', archived: false, created_at: iso(-55), updated_at: iso(-55) },
    { id: 'lib_db_bench', name: 'DB Bench Press', category: 'Strength', equipment: 'Dumbbells', primary_muscle: 'Chest', secondary_muscles: 'Shoulders, Triceps', video_url: 'https://www.youtube.com/watch?v=VmB1G1K7v94', notes: 'Neutral grip when shoulders are sensitive.', archived: false, created_at: iso(-55), updated_at: iso(-55) },
    { id: 'lib_cable_row', name: 'Cable Row', category: 'Strength', equipment: 'Cable', primary_muscle: 'Back', secondary_muscles: 'Biceps, Rear delts', video_url: 'https://www.youtube.com/watch?v=GZbfZ033f74', notes: 'Pause at the ribs.', archived: false, created_at: iso(-55), updated_at: iso(-55) },
    { id: 'lib_rdl', name: 'Romanian Deadlift', category: 'Strength', equipment: 'Dumbbells', primary_muscle: 'Hamstrings', secondary_muscles: 'Glutes, Back', video_url: 'https://www.youtube.com/watch?v=JCXUYuzwNrM', notes: 'Soft knees, hips back.', archived: false, created_at: iso(-50), updated_at: iso(-50) },
    { id: 'lib_world_stretch', name: 'World Greatest Stretch', category: 'Mobility', equipment: 'Bodyweight', primary_muscle: 'Hips', secondary_muscles: 'Thoracic spine, Hamstrings', video_url: 'https://www.youtube.com/watch?v=aiN-2yAIkec', notes: 'Move slowly and breathe.', archived: false, created_at: iso(-50), updated_at: iso(-50) },
  ],
  workouts: [
    { id: 'workout_lower_a', coach_id: 'coach_marcus', name: 'Lower Strength A', description: 'Squat pattern, hinge, and core support.', goal: 'Lower body strength', archived: false, created_at: iso(-45), updated_at: iso(-45) },
    { id: 'workout_upper_a', coach_id: 'coach_marcus', name: 'Upper Strength A', description: 'Horizontal push/pull with clean volume.', goal: 'Upper body strength', archived: false, created_at: iso(-44), updated_at: iso(-44) },
    { id: 'workout_mobility_run', coach_id: 'coach_marcus', name: 'Run Prep Mobility', description: 'Hips, ankles, and trunk prep for running days.', goal: 'Mobility', archived: false, created_at: iso(-40), updated_at: iso(-40) },
  ],
  workoutExercises: [
    { id: 'wex_1', workout_id: 'workout_lower_a', exercise_library_id: 'lib_goblet_squat', custom_name: null, sets: '3', reps: '8-10', rest: '90s', tempo: '3-1-1', notes: 'Slow lower, tall chest.', video_url: null, position: 0, archived: false, created_at: iso(-45) },
    { id: 'wex_2', workout_id: 'workout_lower_a', exercise_library_id: 'lib_rdl', custom_name: null, sets: '3', reps: '8', rest: '90s', tempo: '3-0-1', notes: 'Stop when hamstrings limit range.', video_url: null, position: 1, archived: false, created_at: iso(-45) },
    { id: 'wex_3', workout_id: 'workout_lower_a', exercise_library_id: null, custom_name: 'Half-kneeling Pallof Press', sets: '3', reps: '10/side', rest: '45s', tempo: '', notes: 'No torso rotation.', video_url: 'https://www.youtube.com/watch?v=ma2OjgP5XDc', position: 2, archived: false, created_at: iso(-45) },
    { id: 'wex_4', workout_id: 'workout_upper_a', exercise_library_id: 'lib_db_bench', custom_name: null, sets: '3', reps: '8', rest: '90s', tempo: '2-1-1', notes: 'Pause at bottom.', video_url: null, position: 0, archived: false, created_at: iso(-44) },
    { id: 'wex_5', workout_id: 'workout_upper_a', exercise_library_id: 'lib_cable_row', custom_name: null, sets: '3', reps: '10-12', rest: '75s', tempo: '', notes: 'Squeeze shoulder blades.', video_url: null, position: 1, archived: false, created_at: iso(-44) },
    { id: 'wex_6', workout_id: 'workout_mobility_run', exercise_library_id: 'lib_world_stretch', custom_name: null, sets: '2', reps: '5/side', rest: '', tempo: '', notes: 'Move slowly.', video_url: null, position: 0, archived: false, created_at: iso(-40) },
    { id: 'wex_7', workout_id: 'workout_mobility_run', exercise_library_id: null, custom_name: 'Ankle Rocker', sets: '2', reps: '8/side', rest: '', tempo: '', notes: 'Keep heel heavy.', video_url: '', position: 1, archived: false, created_at: iso(-40) },
  ],
  programs: [
    { id: 'program_foundation', coach_id: 'coach_marcus', name: 'Foundation Strength - Phase 1', description: 'Three days per week focused on clean mechanics and steady volume.', frequency_days: 3, archived: false, created_at: iso(-35), updated_at: iso(-35) },
    { id: 'program_hybrid', coach_id: 'coach_marcus', name: 'Hybrid Strength - Phase 2', description: 'Four weekly touchpoints for strength, mobility, and run prep.', frequency_days: 4, archived: false, created_at: iso(-20), updated_at: iso(-20) },
  ],
  programDays: [
    { id: 'day_foundation_1', program_id: 'program_foundation', day_number: 1, workout_id: 'workout_lower_a', notes: 'Keep RPE around 7.', archived: false, created_at: iso(-35) },
    { id: 'day_foundation_2', program_id: 'program_foundation', day_number: 2, workout_id: 'workout_upper_a', notes: '', archived: false, created_at: iso(-35) },
    { id: 'day_foundation_3', program_id: 'program_foundation', day_number: 3, workout_id: 'workout_mobility_run', notes: 'Best before an easy run.', archived: false, created_at: iso(-35) },
    { id: 'day_hybrid_1', program_id: 'program_hybrid', day_number: 1, workout_id: 'workout_lower_a', notes: '', archived: false, created_at: iso(-20) },
    { id: 'day_hybrid_2', program_id: 'program_hybrid', day_number: 2, workout_id: 'workout_upper_a', notes: '', archived: false, created_at: iso(-20) },
    { id: 'day_hybrid_3', program_id: 'program_hybrid', day_number: 3, workout_id: 'workout_mobility_run', notes: '', archived: false, created_at: iso(-20) },
    { id: 'day_hybrid_4', program_id: 'program_hybrid', day_number: 4, workout_id: 'workout_lower_a', notes: 'Lighter load than Day 1.', archived: false, created_at: iso(-20) },
  ],
  programAssignments: [
    { id: 'assign_sarah', program_id: 'program_foundation', client_id: 'client_sarah', notes: 'Complete twice before next session.', archived: false, created_at: iso(-18), client: { id: 'client_sarah', name: 'Sarah Martinez' } },
  ],
  workoutAssignments: [
    { id: 'work_assign_sarah_active', client_id: 'client_sarah', workout_id: 'workout_mobility_run', assignment_mode: 'active', assigned_for: null, notes: 'Use this on recovery days.', archived: false, created_at: iso(-8) },
    { id: 'work_assign_sarah_dated', client_id: 'client_sarah', workout_id: 'workout_upper_a', assignment_mode: 'dated', assigned_for: dateOnly(2), notes: 'Optional if shoulder feels good.', archived: false, created_at: iso(-2) },
  ],
  messages: [
    { id: 'msg_1', client_id: 'client_sarah', coach_id: 'coach_marcus', sender_role: 'coach', content: 'Nice work this week. Check in before tomorrow if anything feels off.', read_by_recipient: false, archived: false, created_at: iso(-1, 12) },
    { id: 'msg_2', client_id: 'client_sarah', coach_id: 'coach_marcus', sender_role: 'client', content: 'Will do. Knee has been feeling better.', read_by_recipient: true, archived: false, created_at: iso(-1, 13) },
    { id: 'msg_3', client_id: 'client_david', coach_id: 'coach_marcus', sender_role: 'client', content: 'Can we keep tomorrow a little lighter?', read_by_recipient: false, archived: false, created_at: iso(0, 8) },
  ],
  bookingRequests: [
    { id: 'booking_1', client_id: 'client_sarah', coach_id: 'coach_marcus', requested_time: iso(5, 11), duration_minutes: 60, location: 'CVF Studio', note: 'Late morning works best.', status: 'pending', archived: false, created_at: iso(-1), updated_at: iso(-1), client: { id: 'client_sarah', name: 'Sarah Martinez' } },
  ],
  waiverVersions: [
    { id: 'waiver_v1', version_number: 1, full_text: 'CVF PT liability waiver preview text. This is sample legal copy for local review only.', created_at: iso(-90) },
  ],
  waiverSignatures: [
    { id: 'sig_sarah', client_id: 'client_sarah', waiver_version_id: 'waiver_v1', signed_at: iso(-80), signed_name: 'Sarah Martinez', ip_address: '127.0.0.1', entered_by: 'client', entered_by_coach_id: null, version: { id: 'waiver_v1', version_number: 1 } },
  ],
  packages: [
    { id: 'pkg_4', name: '4 Session Pack', description: 'Starter pack for weekly training.', price: 320, session_credits: 4, is_recurring: false, archived: false, created_at: iso(-70) },
    { id: 'pkg_8', name: '8 Session Pack', description: 'Best for steady progress.', price: 600, session_credits: 8, is_recurring: false, archived: false, created_at: iso(-70) },
  ],
  purchases: [
    { id: 'purchase_1', client_id: 'client_sarah', package_id: 'pkg_8', amount: 600, credits_granted: 8, method: 'manual', status: 'completed', stripe_session_id: null, recorded_by_coach_id: 'coach_marcus', archived: false, created_at: iso(-22) },
  ],
};

function emitChange() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function onPreviewChange(cb) {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

export function getPreviewRole() {
  return localStorage.getItem(PREVIEW_ROLE_KEY) || 'client';
}

export function setPreviewRole(role) {
  localStorage.setItem(PREVIEW_ROLE_KEY, role);
  emitChange();
}

export function getPreviewClientId() {
  const stored = localStorage.getItem(PREVIEW_CLIENT_KEY);
  return state.clients.some((c) => c.id === stored && !c.archived) ? stored : 'client_sarah';
}

export function setPreviewClientId(clientId) {
  localStorage.setItem(PREVIEW_CLIENT_KEY, clientId);
  emitChange();
}

export function getPreviewClients() {
  return state.clients.filter((c) => !c.archived);
}

export function getPreviewUser() {
  const role = getPreviewRole();
  if (role === 'client') {
    const profile = clientById(getPreviewClientId());
    return { role: 'client', email: profile.email, profile };
  }
  const profile = state.coaches[0];
  return { role, email: profile.email, profile };
}

function currentCoach() {
  return state.coaches[0];
}

function currentClient() {
  return clientById(getPreviewClientId());
}

function clientById(clientId) {
  return state.clients.find((c) => c.id === clientId) || state.clients[0];
}

function coachById(coachId) {
  return state.coaches.find((c) => c.id === coachId) || state.coaches[0];
}

function resourceCategoryById(categoryId) {
  return state.resourceCategories.find((category) => category.id === categoryId) || null;
}

function previewResource(resource, includeAssignments = false) {
  const shaped = {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    category_id: resource.category_id,
    file_name: resource.file_name,
    file_size_bytes: resource.file_size_bytes,
    is_public: resource.is_public,
    archived: resource.archived,
    uploaded_by_coach_id: resource.uploaded_by_coach_id,
    created_at: resource.created_at,
    category: resourceCategoryById(resource.category_id),
  };
  if (includeAssignments) {
    shaped.uploader = coachById(resource.uploaded_by_coach_id);
    shaped.assignments = state.resourceAssignments
      .filter((assignment) => assignment.resource_id === resource.id && assignment.active)
      .map((assignment) => ({ ...assignment, client: clientById(assignment.client_id) }));
  }
  return shaped;
}

function previewClientCanAccessResource(resource, clientId) {
  return Boolean(resource && !resource.archived && (
    resource.is_public
    || state.resourceAssignments.some((assignment) => (
      assignment.resource_id === resource.id
      && assignment.client_id === clientId
      && assignment.active
    ))
  ));
}

function shapeClient(client) {
  return { ...client, coach: coachById(client.coach_id) };
}

function activeClientsForCoach() {
  const role = getPreviewRole();
  const coach = currentCoach();
  return state.clients
    .filter((c) => !c.archived && (role === 'admin' || c.coach_id === coach.id))
    .map(shapeClient);
}

function metricWithEntries(metric) {
  return {
    ...metric,
    entries: state.metricEntries
      .filter((e) => e.metric_id === metric.id && !e.archived)
      .sort((a, b) => String(a.recorded_on).localeCompare(String(b.recorded_on))),
  };
}

function libraryById(exerciseId) {
  return state.exerciseLibrary.find((e) => e.id === exerciseId) || null;
}

function workoutDetails(workoutId) {
  const workout = state.workouts.find((w) => w.id === workoutId);
  if (!workout) return null;
  const exercises = state.workoutExercises
    .filter((e) => e.workout_id === workout.id && !e.archived)
    .sort((a, b) => a.position - b.position)
    .map((exercise) => ({ ...exercise, library_exercise: exercise.exercise_library_id ? libraryById(exercise.exercise_library_id) : null }));
  return { ...workout, exercises, exercise_count: exercises.length };
}

function replaceWorkoutExercises(workoutId, exercises = []) {
  state.workoutExercises.filter((e) => e.workout_id === workoutId).forEach((e) => { e.archived = true; });
  exercises
    .filter((exercise) => exercise.exercise_library_id || String(exercise.custom_name || '').trim())
    .forEach((exercise, index) => {
      state.workoutExercises.push({
        id: id('wex'),
        workout_id: workoutId,
        exercise_library_id: exercise.exercise_library_id || null,
        custom_name: exercise.exercise_library_id ? null : (exercise.custom_name || null),
        sets: exercise.sets || null,
        reps: exercise.reps || null,
        rest: exercise.rest || null,
        tempo: exercise.tempo || null,
        notes: exercise.client_notes || exercise.notes || null,
        client_notes: exercise.client_notes || exercise.notes || null,
        coach_notes: exercise.coach_notes || null,
        video_url: exercise.video_url || null,
        position: index,
        archived: false,
        created_at: new Date().toISOString(),
      });
    });
}

function replaceProgramDays(programId, days = []) {
  state.programDays.filter((d) => d.program_id === programId).forEach((d) => { d.archived = true; });
  days.forEach((day) => {
    state.programDays.push({
      id: id('day'),
      program_id: programId,
      day_number: Number(day.day_number),
      workout_id: day.workout_id,
      notes: day.notes || null,
      archived: false,
      created_at: new Date().toISOString(),
    });
  });
}

function commitPreviewProgramDraft(inputDraft) {
  const { valid, errors, draft } = validateDraft(inputDraft);
  if (!valid) {
    const error = new Error('Fix import draft errors before saving.');
    error.validationErrors = errors;
    throw error;
  }
  const source = draft.import_meta.source_type === 'pdf'
    ? 'import_pdf_ai'
    : draft.import_meta.source_type === 'paste' ? 'manual' : 'import_csv';
  const createdExercises = [];
  const reusedExercises = [];
  const byName = new Map(state.exerciseLibrary.filter((e) => !e.archived).map((e) => [normalizeName(e.name), e]));
  const workoutIds = [];

  draft.days.forEach((day) => {
    const workout = {
      id: id('workout'),
      coach_id: currentCoach().id,
      name: day.name,
      description: day.notes || null,
      goal: day.goal || null,
      archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.workouts.push(workout);
    workoutIds.push({ day, workout });
    const rows = day.exercises.map((exercise) => {
      const key = normalizeName(exercise.name);
      let libraryExercise = byName.get(key);
      if (libraryExercise) {
        reusedExercises.push({ id: libraryExercise.id, name: libraryExercise.name });
      } else {
        libraryExercise = {
          id: id('lib'),
          name: exercise.name,
          category: exercise.category || null,
          equipment: exercise.equipment || null,
          primary_muscle: exercise.primary_muscle || null,
          secondary_muscles: null,
          video_url: exercise.video_url || null,
          notes: exercise.client_notes || null,
          source,
          review_status: 'needs_review',
          archived: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        state.exerciseLibrary.push(libraryExercise);
        byName.set(key, libraryExercise);
        createdExercises.push({ id: libraryExercise.id, name: libraryExercise.name });
      }
      return { ...exercise, exercise_library_id: libraryExercise.id, custom_name: exercise.name };
    });
    replaceWorkoutExercises(workout.id, rows);
  });

  const program = {
    id: id('program'),
    coach_id: currentCoach().id,
    name: draft.program.name,
    description: draft.program.description || null,
    frequency_days: Number(draft.program.frequency_days),
    archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.programs.push(program);
  replaceProgramDays(program.id, workoutIds.map(({ day, workout }) => ({ day_number: day.day_number, workout_id: workout.id, notes: day.notes })));
  return {
    program_id: program.id,
    program: programDetails(program.id),
    created_exercises: createdExercises,
    reused_exercises: reusedExercises,
    warnings: draft.import_meta.warnings || [],
  };
}

function programSummary(program) {
  const days = state.programDays
    .filter((d) => d.program_id === program.id && !d.archived)
    .sort((a, b) => a.day_number - b.day_number)
    .map((day) => ({ ...day, workout: workoutDetails(day.workout_id) }));
  const exerciseCount = days.reduce((count, day) => count + (day.workout?.exercise_count || 0), 0);
  const assignments = state.programAssignments
    .filter((a) => a.program_id === program.id)
    .map((a) => ({ ...a, client: { id: a.client_id, name: clientById(a.client_id)?.name } }));
  return {
    ...program,
    days,
    assignments,
    day_count: days.length,
    exercise_count: exerciseCount,
    active_assignments: assignments.filter((a) => !a.archived),
  };
}

function programDetails(programId) {
  const program = state.programs.find((p) => p.id === programId);
  if (!program) return null;
  return programSummary(program);
}

function workoutAssignmentDetails(assignment) {
  return { ...assignment, workout: workoutDetails(assignment.workout_id), client: { id: assignment.client_id, name: clientById(assignment.client_id)?.name } };
}

function waiverStatus(clientId) {
  const latest = state.waiverVersions.slice().sort((a, b) => b.version_number - a.version_number)[0] || null;
  const signatures = state.waiverSignatures
    .filter((s) => s.client_id === clientId)
    .map((s) => ({ ...s, version: state.waiverVersions.find((v) => v.id === s.waiver_version_id) }))
    .sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));
  return {
    latest_version: latest,
    signatures,
    signed_latest: Boolean(latest && signatures.some((s) => s.waiver_version_id === latest.id)),
  };
}

function paymentHistory(clientId) {
  return state.purchases
    .filter((p) => p.client_id === clientId && !p.archived)
    .map((p) => ({
      ...p,
      package: state.packages.find((pkg) => pkg.id === p.package_id),
      recorded_by: coachById(p.recorded_by_coach_id),
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function dashboardClient() {
  const client = currentClient();
  const clientSessions = state.sessions.filter((s) => s.client_id === client.id && !s.archived);
  const nextSessions = clientSessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at) >= now).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const messages = state.messages.filter((m) => m.client_id === client.id && !m.archived).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const metrics = state.metrics.filter((m) => m.client_id === client.id && !m.archived);
  const metricMap = Object.fromEntries(metrics.map((m) => [m.id, m]));
  const recentProgress = state.metricEntries
    .filter((e) => !e.archived && metricMap[e.metric_id])
    .sort((a, b) => String(b.recorded_on).localeCompare(String(a.recorded_on)))
    .slice(0, 5)
    .map((e) => ({ ...e, metric: metricMap[e.metric_id] }));
  const todayCheckIn = state.checkIns.find((c) => c.client_id === client.id && c.check_in_date === dateOnly(0) && !c.archived) || null;
  const latestCheckIn = state.checkIns.filter((c) => c.client_id === client.id && !c.archived).sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date)))[0] || null;
  return {
    next_session: nextSessions[0] ? { ...nextSessions[0], coach: coachById(nextSessions[0].coach_id) } : null,
    upcoming_sessions: nextSessions.map((s) => ({ ...s, coach: coachById(s.coach_id) })),
    recent_messages: messages.slice(0, 5),
    unread_messages: messages.filter((m) => m.sender_role === 'coach' && !m.read_by_recipient).length,
    today_check_in: todayCheckIn,
    latest_check_in: latestCheckIn,
    recent_progress: recentProgress,
    credits: state.credits[client.id] || 0,
    waiver: { has_version: Boolean(state.waiverVersions.length), signed_latest: waiverStatus(client.id).signed_latest },
    program_count: state.programAssignments.filter((a) => a.client_id === client.id && !a.archived).length
      + state.workoutAssignments.filter((a) => a.client_id === client.id && !a.archived).length,
    coach_name: coachById(client.coach_id).name,
  };
}

function dashboardCoach() {
  const clients = activeClientsForCoach();
  const clientIds = clients.map((c) => c.id);
  const today = dateOnly(0);
  const sessions = state.sessions.filter((s) => !s.archived && clientIds.includes(s.client_id));
  const bookings = state.bookingRequests.filter((b) => !b.archived && b.status === 'pending' && clientIds.includes(b.client_id)).map((b) => ({ ...b, client: { id: b.client_id, name: clientById(b.client_id).name } }));
  const messages = state.messages.filter((m) => !m.archived && clientIds.includes(m.client_id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const checkIns = state.checkIns.filter((c) => !c.archived && c.review_status === 'needs_review' && clientIds.includes(c.client_id)).map((c) => ({ ...c, client: { id: c.client_id, name: clientById(c.client_id).name } }));
  return {
    today_sessions: sessions.filter((s) => s.scheduled_at.slice(0, 10) === today).map((s) => ({ ...s, client: { id: s.client_id, name: clientById(s.client_id).name } })),
    upcoming_sessions: sessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at) > now).slice(0, 5).map((s) => ({ ...s, client: { id: s.client_id, name: clientById(s.client_id).name } })),
    pending_bookings: bookings,
    client_count: clients.length,
    unread_messages: messages.filter((m) => m.sender_role === 'client' && !m.read_by_recipient).length,
    recent_messages: messages.slice(0, 5).map((m) => ({ ...m, client: { id: m.client_id, name: clientById(m.client_id).name } })),
    recent_check_ins: checkIns.slice(0, 5),
  };
}

function ok(data, config, status = 200) {
  return Promise.resolve({ data, status, statusText: 'OK', headers: {}, config });
}

function fail(config, status, message) {
  return Promise.reject({ response: { data: { error: message }, status, statusText: 'Error', headers: {}, config }, config });
}

function body(config) {
  if (!config.data) return {};
  if (typeof config.data === 'string') {
    try { return JSON.parse(config.data); } catch { return {}; }
  }
  return config.data;
}

function pathFromConfig(config) {
  const raw = config.url || '/';
  const url = new URL(raw, 'http://preview.local/api');
  let path = url.pathname;
  if (path.startsWith('/api')) path = path.slice(4) || '/';
  return { path, search: url.searchParams };
}

function saveCheckIn(clientId, payload, actorRole) {
  const client = clientById(clientId);
  const checkDate = payload.check_in_date || dateOnly(0);
  let existing = state.checkIns.find((c) => c.client_id === clientId && c.check_in_date === checkDate && !c.archived);
  if (existing) {
    Object.assign(existing, payload, {
      check_in_date: checkDate,
      review_status: actorRole === 'client' ? 'needs_review' : (payload.review_status || existing.review_status),
      updated_by_role: actorRole,
      updated_by_id: actorRole === 'client' ? clientId : currentCoach().id,
      updated_at: new Date().toISOString(),
    });
    return existing;
  }
  existing = {
    id: id('check'),
    client_id: clientId,
    coach_id: client.coach_id,
    check_in_date: checkDate,
    energy: payload.energy || null,
    soreness: payload.soreness || null,
    sleep_quality: payload.sleep_quality || null,
    stress: payload.stress || null,
    body_notes: payload.body_notes || null,
    training_notes: payload.training_notes || null,
    general_notes: payload.general_notes || null,
    coach_notes: actorRole === 'client' ? null : (payload.coach_notes || null),
    review_status: actorRole === 'client' ? 'needs_review' : (payload.review_status || 'reviewed'),
    created_by_role: actorRole,
    created_by_id: actorRole === 'client' ? clientId : currentCoach().id,
    updated_by_role: actorRole,
    updated_by_id: actorRole === 'client' ? clientId : currentCoach().id,
    archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.checkIns.push(existing);
  return existing;
}

export function installPreviewApi(api) {
  if (!isPreviewMode) return;
  api.defaults.adapter = async (config) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const method = String(config.method || 'get').toLowerCase();
    const { path, search } = pathFromConfig(config);
    const payload = body(config);
    const role = getPreviewRole();
    const client = currentClient();

    if (path === '/auth/me' || path === '/auth/login' || path === '/auth/signup') return ok({ access_token: 'preview', refresh_token: 'preview', ...getPreviewUser() }, config);

    if (path === '/dashboard/client') return ok(dashboardClient(), config);
    if (path === '/dashboard/coach') return ok(dashboardCoach(), config);

    if (path === '/clients' && method === 'get') {
      const includeArchived = search.get('include_archived') === 'true';
      return ok(state.clients.filter((c) => includeArchived || !c.archived).filter((c) => role === 'admin' || c.coach_id === currentCoach().id).map(shapeClient), config);
    }
    if (path === '/clients' && method === 'post') {
      const row = { id: id('client'), coach_id: payload.coach_id || currentCoach().id, name: payload.name, email: payload.email || null, phone: payload.phone || null, goals: payload.goals || null, health_notes: payload.health_notes || null, invited: false, auth_user_id: null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.clients.push(row);
      return ok(row, config, 201);
    }

    if (path === '/resource-categories' && method === 'get') {
      if (role === 'client') return fail(config, 403, 'Coach access required');
      return ok(state.resourceCategories.slice().sort((a, b) => a.name.localeCompare(b.name)), config);
    }
    if (path === '/resource-categories' && method === 'post') {
      if (role === 'client') return fail(config, 403, 'Coach access required');
      const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
      if (!name) return fail(config, 400, 'Category name is required');
      const existing = state.resourceCategories.find((category) => category.name.toLowerCase() === name.toLowerCase());
      if (existing) return ok({ ...existing, reused: true }, config);
      const row = { id: id('resource_category'), name, created_at: new Date().toISOString(), reused: false };
      state.resourceCategories.push(row);
      return ok(row, config, 201);
    }

    if (path === '/resources' && method === 'get') {
      const categoryId = search.get('category_id');
      const query = String(search.get('q') || '').toLowerCase();
      let rows = state.resources.filter((resource) => !resource.archived);
      if (role === 'client') rows = rows.filter((resource) => previewClientCanAccessResource(resource, client.id));
      if (categoryId) rows = rows.filter((resource) => resource.category_id === categoryId);
      if (query) rows = rows.filter((resource) => resource.title.toLowerCase().includes(query));
      return ok(rows.map((resource) => previewResource(resource, role !== 'client')), config);
    }
    if (path === '/resources' && method === 'post') {
      if (role === 'client') return fail(config, 403, 'Coach access required');
      const file = payload?.get?.('file');
      const title = String(payload?.get?.('title') || '').trim();
      if (!title) return fail(config, 400, 'Resource title is required');
      if (!file || file.type !== 'application/pdf') return fail(config, 400, 'Upload a valid PDF file.');
      const header = await file.slice(0, 1024).text();
      if (!header.includes('%PDF-')) return fail(config, 400, 'Upload a valid PDF file.');
      const row = {
        id: id('resource'),
        title,
        description: String(payload.get('description') || '').trim() || null,
        category_id: String(payload.get('category_id') || '') || null,
        storage_path: `preview/${id('pdf')}.pdf`,
        file_name: file.name || 'resource.pdf',
        file_size_bytes: file.size,
        is_public: payload.get('is_public') === 'true',
        archived: false,
        uploaded_by_coach_id: currentCoach().id,
        created_at: new Date().toISOString(),
      };
      state.resources.unshift(row);
      return ok(previewResource(row, true), config, 201);
    }
    const resourceDownload = path.match(/^\/resources\/([^/]+)\/download-link$/);
    if (resourceDownload && method === 'get') {
      const resource = state.resources.find((row) => row.id === resourceDownload[1] && !row.archived);
      if (!resource || (role === 'client' && !previewClientCanAccessResource(resource, client.id))) {
        return fail(config, 404, 'Resource not found');
      }
      return ok({ signed_url: `https://example.invalid/cvf-preview-resource.pdf?token=${resource.id}`, expires_in: 60, file_name: resource.file_name }, config);
    }
    const resourceEdit = path.match(/^\/resources\/([^/]+)$/);
    if (resourceEdit && method === 'patch') {
      if (role === 'client') return fail(config, 403, 'Coach access required');
      const resource = state.resources.find((row) => row.id === resourceEdit[1]);
      if (!resource) return fail(config, 404, 'Resource not found');
      Object.assign(resource, payload);
      return ok(previewResource(resource, true), config);
    }
    const resourceAssign = path.match(/^\/resources\/([^/]+)\/assign$/);
    if (resourceAssign && method === 'post') {
      if (role === 'client') return fail(config, 403, 'Coach access required');
      let assignment = state.resourceAssignments.find((row) => row.resource_id === resourceAssign[1] && row.client_id === payload.client_id);
      if (assignment) Object.assign(assignment, { active: true, assigned_at: new Date().toISOString() });
      else {
        assignment = { id: id('resource_assignment'), resource_id: resourceAssign[1], client_id: payload.client_id, active: true, assigned_at: new Date().toISOString() };
        state.resourceAssignments.push(assignment);
      }
      return ok(assignment, config, 201);
    }
    const resourceUnassign = path.match(/^\/resources\/([^/]+)\/assignments\/([^/]+)$/);
    if (resourceUnassign && method === 'patch') {
      if (role === 'client') return fail(config, 403, 'Coach access required');
      let assignment = state.resourceAssignments.find((row) => row.resource_id === resourceUnassign[1] && row.client_id === resourceUnassign[2]);
      if (assignment) assignment.active = false;
      else {
        assignment = { id: id('resource_assignment'), resource_id: resourceUnassign[1], client_id: resourceUnassign[2], active: false, assigned_at: new Date().toISOString() };
        state.resourceAssignments.push(assignment);
      }
      return ok(assignment, config);
    }
    const clientMatch = path.match(/^\/clients\/([^/]+)$/);
    if (clientMatch) {
      const row = clientById(clientMatch[1]);
      if (method === 'get') return ok(row, config);
      if (method === 'put') {
        Object.assign(row, payload, { updated_at: new Date().toISOString() });
        return ok(row, config);
      }
    }
    const inviteMatch = path.match(/^\/clients\/([^/]+)\/invite$/);
    if (inviteMatch && method === 'patch') {
      const row = clientById(inviteMatch[1]);
      row.invited = Boolean(payload.invited);
      return ok(row, config);
    }
    const archiveClientMatch = path.match(/^\/clients\/([^/]+)\/archive$/);
    if (archiveClientMatch && method === 'patch') {
      const row = clientById(archiveClientMatch[1]);
      row.archived = Boolean(payload.archived);
      return ok(row, config);
    }

    if (path === '/admin/overview') return ok({ coaches: state.coaches.filter((c) => !c.archived).length, clients: state.clients.filter((c) => !c.archived).length, upcoming_sessions: state.sessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at) > now).length, pending_bookings: state.bookingRequests.filter((b) => b.status === 'pending').length }, config);
    if (path === '/admin/coaches' && method === 'get') return ok(state.coaches.filter((c) => !c.archived), config);
    if (path === '/admin/coaches' && method === 'post') {
      const row = { id: id('coach'), auth_user_id: id('auth'), name: payload.name, email: payload.email, phone: payload.phone || null, is_admin: Boolean(payload.is_admin), archived: false, created_at: new Date().toISOString() };
      state.coaches.push(row);
      return ok(row, config, 201);
    }
    const reassignMatch = path.match(/^\/admin\/clients\/([^/]+)\/reassign$/);
    if (reassignMatch && method === 'patch') {
      const row = clientById(reassignMatch[1]);
      row.coach_id = payload.coach_id;
      return ok(shapeClient(row), config);
    }

    if (path === '/sessions' && method === 'get') {
      let rows = state.sessions.filter((s) => !s.archived);
      if (search.get('client_id')) rows = rows.filter((s) => s.client_id === search.get('client_id'));
      if (search.get('status')) rows = rows.filter((s) => s.status === search.get('status'));
      rows = rows.map((s) => ({ ...s, client: { id: s.client_id, name: clientById(s.client_id).name }, coach: coachById(s.coach_id) })).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
      return ok(rows, config);
    }
    if (path === '/sessions' && method === 'post') {
      const target = clientById(payload.client_id);
      const row = { id: id('session'), client_id: target.id, coach_id: target.coach_id, scheduled_at: payload.scheduled_at, duration_minutes: payload.duration_minutes || 60, location: payload.location || null, status: 'scheduled', credit_deducted: false, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), client: { id: target.id, name: target.name } };
      state.sessions.push(row);
      return ok(row, config, 201);
    }
    if (path === '/sessions/client/mine') {
      const rows = state.sessions.filter((s) => s.client_id === client.id && !s.archived).map((s) => ({ ...s, coach: coachById(s.coach_id), shared_notes: state.sessionNotes.filter((n) => n.session_id === s.id && n.shared_with_client && !n.archived) })).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
      return ok(rows, config);
    }
    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'put') {
      const row = state.sessions.find((s) => s.id === sessionMatch[1]);
      Object.assign(row, payload, { updated_at: new Date().toISOString() });
      return ok({ ...row, client: { id: row.client_id, name: clientById(row.client_id).name } }, config);
    }
    const completeMatch = path.match(/^\/sessions\/([^/]+)\/complete$/);
    if (completeMatch && method === 'patch') {
      const row = state.sessions.find((s) => s.id === completeMatch[1]);
      row.status = 'completed';
      if ((state.credits[row.client_id] || 0) > 0) {
        state.credits[row.client_id] -= 1;
        row.credit_deducted = true;
      }
      return ok({ session: row, credit_deducted: row.credit_deducted, credits_remaining: state.credits[row.client_id] || 0 }, config);
    }
    const cancelMatch = path.match(/^\/sessions\/([^/]+)\/cancel$/);
    if (cancelMatch && method === 'patch') {
      const row = state.sessions.find((s) => s.id === cancelMatch[1]);
      row.status = 'cancelled';
      return ok(row, config);
    }
    const notesMatch = path.match(/^\/sessions\/([^/]+)\/notes$/);
    if (notesMatch && method === 'get') return ok(state.sessionNotes.filter((n) => n.session_id === notesMatch[1] && !n.archived), config);
    if (notesMatch && method === 'post') {
      const session = state.sessions.find((s) => s.id === notesMatch[1]);
      const row = { id: id('note'), session_id: session.id, coach_id: session.coach_id, content: payload.content, shared_with_client: Boolean(payload.shared_with_client), archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.sessionNotes.push(row);
      return ok(row, config, 201);
    }
    const noteMatch = path.match(/^\/sessions\/notes\/([^/]+)$/);
    if (noteMatch && method === 'put') {
      const row = state.sessionNotes.find((n) => n.id === noteMatch[1]);
      Object.assign(row, payload, { updated_at: new Date().toISOString() });
      return ok(row, config);
    }

    if (path === '/bookings/mine') return ok(state.bookingRequests.filter((b) => b.client_id === client.id && !b.archived).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), config);
    if (path === '/bookings' && method === 'get') {
      let rows = state.bookingRequests.filter((b) => !b.archived);
      if (search.get('status')) rows = rows.filter((b) => b.status === search.get('status'));
      return ok(rows.map((b) => ({ ...b, client: { id: b.client_id, name: clientById(b.client_id).name } })), config);
    }
    if (path === '/bookings' && method === 'post') {
      const row = { id: id('booking'), client_id: client.id, coach_id: client.coach_id, requested_time: payload.requested_time, duration_minutes: payload.duration_minutes || 60, location: payload.location || null, note: payload.note || null, status: 'pending', archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.bookingRequests.push(row);
      return ok(row, config, 201);
    }
    const bookingAction = path.match(/^\/bookings\/([^/]+)\/(approve|decline)$/);
    if (bookingAction && method === 'patch') {
      const booking = state.bookingRequests.find((b) => b.id === bookingAction[1]);
      booking.status = bookingAction[2] === 'approve' ? 'approved' : 'declined';
      if (bookingAction[2] === 'approve') state.sessions.push({ id: id('session'), client_id: booking.client_id, coach_id: booking.coach_id, scheduled_at: booking.requested_time, duration_minutes: booking.duration_minutes, location: booking.location, status: 'scheduled', credit_deducted: false, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return ok({ booking, session: null }, config);
    }

    if (path === '/progress/mine') return ok(state.metrics.filter((m) => m.client_id === client.id && !m.archived).map(metricWithEntries), config);
    const coachMetrics = path.match(/^\/progress\/clients\/([^/]+)\/metrics$/);
    if (coachMetrics && method === 'get') return ok(state.metrics.filter((m) => m.client_id === coachMetrics[1] && !m.archived).map(metricWithEntries), config);
    if (coachMetrics && method === 'post') {
      const row = { id: id('metric'), client_id: coachMetrics[1], name: payload.name, unit: payload.unit || null, archived: false, created_at: new Date().toISOString(), entries: [] };
      state.metrics.push(row);
      return ok(row, config, 201);
    }
    const metricEntry = path.match(/^\/progress\/metrics\/([^/]+)\/entries$/);
    if (metricEntry && method === 'post') {
      const row = { id: id('entry'), metric_id: metricEntry[1], value: Number(payload.value), notes: payload.notes || null, recorded_on: payload.recorded_on || dateOnly(0), archived: false, created_at: new Date().toISOString() };
      state.metricEntries.push(row);
      return ok(row, config, 201);
    }
    const entryPut = path.match(/^\/progress\/entries\/([^/]+)$/);
    if (entryPut && method === 'put') {
      const row = state.metricEntries.find((e) => e.id === entryPut[1]);
      Object.assign(row, { value: Number(payload.value), notes: payload.notes || null, recorded_on: payload.recorded_on || row.recorded_on });
      return ok(row, config);
    }
    const metricArchive = path.match(/^\/progress\/metrics\/([^/]+)\/archive$/);
    if (metricArchive && method === 'patch') {
      const row = state.metrics.find((m) => m.id === metricArchive[1]);
      row.archived = true;
      return ok(row, config);
    }

    if (path === '/check-ins/mine' && method === 'get') return ok(state.checkIns.filter((c) => c.client_id === client.id && !c.archived).sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date))), config);
    if (path === '/check-ins/mine' && method === 'post') return ok(saveCheckIn(client.id, payload, 'client'), config, 201);
    const checkClient = path.match(/^\/check-ins\/clients\/([^/]+)$/);
    if (checkClient && method === 'get') return ok(state.checkIns.filter((c) => c.client_id === checkClient[1] && !c.archived).sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date))), config);
    if (checkClient && method === 'post') return ok(saveCheckIn(checkClient[1], payload, role === 'admin' ? 'admin' : 'coach'), config, 201);
    const checkPut = path.match(/^\/check-ins\/([^/]+)$/);
    if (checkPut && method === 'put') {
      const row = state.checkIns.find((c) => c.id === checkPut[1]);
      Object.assign(row, payload, { review_status: role === 'client' ? 'needs_review' : (payload.review_status || row.review_status), updated_by_role: role, updated_by_id: role === 'client' ? client.id : currentCoach().id, updated_at: new Date().toISOString() });
      return ok(row, config);
    }

    if (path === '/programs/exercise-library' && method === 'get') {
      return ok(state.exerciseLibrary.filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name)), config);
    }
    if (path === '/programs/exercise-library' && method === 'post') {
      const row = { id: id('lib'), name: payload.name, category: payload.category || null, equipment: payload.equipment || null, primary_muscle: payload.primary_muscle || null, secondary_muscles: payload.secondary_muscles || null, video_url: payload.video_url || null, notes: payload.notes || null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.exerciseLibrary.push(row);
      return ok(row, config, 201);
    }
    if (path === '/programs/exercise-library/import' && method === 'post') {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      let imported = 0;
      rows.forEach((row) => {
        if (!String(row.name || '').trim()) return;
        state.exerciseLibrary.push({
          id: id('lib'),
          name: String(row.name).trim(),
          category: row.category || null,
          equipment: row.equipment || null,
          primary_muscle: row.primary_muscle || null,
          secondary_muscles: row.secondary_muscles || null,
          video_url: row.video_url || null,
          notes: row.notes || null,
          archived: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        imported += 1;
      });
      return ok({ imported }, config, 201);
    }
    const libraryEdit = path.match(/^\/programs\/exercise-library\/([^/]+)$/);
    if (libraryEdit && method === 'put') {
      const row = state.exerciseLibrary.find((e) => e.id === libraryEdit[1]);
      if (!row) return fail(config, 404, 'Exercise not found');
      Object.assign(row, payload, { updated_at: new Date().toISOString() });
      return ok(row, config);
    }
    const libraryArchive = path.match(/^\/programs\/exercise-library\/([^/]+)\/archive$/);
    if (libraryArchive && method === 'patch') {
      const row = state.exerciseLibrary.find((e) => e.id === libraryArchive[1]);
      if (!row) return fail(config, 404, 'Exercise not found');
      row.archived = true;
      row.updated_at = new Date().toISOString();
      return ok(row, config);
    }

    if (path === '/programs/workouts' && method === 'get') return ok(state.workouts.filter((w) => !w.archived).map((w) => workoutDetails(w.id)), config);
    if (path === '/programs/workouts' && method === 'post') {
      const workout = { id: id('workout'), coach_id: currentCoach().id, name: payload.name, description: payload.description || null, goal: payload.goal || null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.workouts.push(workout);
      replaceWorkoutExercises(workout.id, payload.exercises || []);
      return ok(workoutDetails(workout.id), config, 201);
    }
    const workoutId = path.match(/^\/programs\/workouts\/([^/]+)$/);
    if (workoutId && method === 'get') return ok(workoutDetails(workoutId[1]), config);
    if (workoutId && method === 'put') {
      const workout = state.workouts.find((w) => w.id === workoutId[1]);
      if (!workout) return fail(config, 404, 'Workout not found');
      Object.assign(workout, { name: payload.name, description: payload.description || null, goal: payload.goal || null, updated_at: new Date().toISOString() });
      replaceWorkoutExercises(workout.id, payload.exercises || []);
      return ok(workoutDetails(workout.id), config);
    }
    const workoutArchive = path.match(/^\/programs\/workouts\/([^/]+)\/archive$/);
    if (workoutArchive && method === 'patch') {
      const workout = state.workouts.find((w) => w.id === workoutArchive[1]);
      if (!workout) return fail(config, 404, 'Workout not found');
      workout.archived = true;
      workout.updated_at = new Date().toISOString();
      return ok(workout, config);
    }

    const workoutAssignmentsClient = path.match(/^\/programs\/workout-assignments\/client\/([^/]+)$/);
    if (workoutAssignmentsClient && method === 'get') {
      return ok(state.workoutAssignments.filter((a) => a.client_id === workoutAssignmentsClient[1] && !a.archived).map(workoutAssignmentDetails), config);
    }
    if (path === '/programs/workout-assignments' && method === 'post') {
      const row = { id: id('work_assign'), client_id: payload.client_id, workout_id: payload.workout_id, assignment_mode: payload.assignment_mode || 'active', assigned_for: payload.assignment_mode === 'dated' ? payload.assigned_for : null, notes: payload.notes || null, archived: false, created_at: new Date().toISOString() };
      state.workoutAssignments.push(row);
      return ok(workoutAssignmentDetails(row), config, 201);
    }
    const workoutUnassign = path.match(/^\/programs\/workout-assignments\/([^/]+)\/archive$/);
    if (workoutUnassign && method === 'patch') {
      const row = state.workoutAssignments.find((a) => a.id === workoutUnassign[1]);
      if (!row) return fail(config, 404, 'Assignment not found');
      row.archived = true;
      return ok(row, config);
    }

    if (path === '/programs/import/template.csv' && method === 'get') {
      return Promise.resolve({
        data: new Blob([csvTemplate()], { type: 'text/csv' }),
        status: 200,
        statusText: 'OK',
        headers: { 'content-disposition': 'attachment; filename="CVF-program-import-template.csv"' },
        config,
      });
    }
    if (path === '/programs/import/parse-csv' && method === 'post') {
      try {
        const file = payload?.get?.('file');
        if (!file) return fail(config, 400, 'Upload a CSV file using the program import template.');
        const draft = parseCsvDraft(await file.text(), { originalFilename: file.name, sourceType: 'csv' });
        const validation = validateDraft(draft);
        if (!validation.valid) {
          return Promise.reject({ response: { data: { error: 'CSV parsed, but the draft needs fixes before saving.', draft: validation.draft, errors: validation.errors }, status: 422, statusText: 'Error', headers: {}, config }, config });
        }
        return ok({ message: 'CSV parsed. Review imported program before saving.', draft: validation.draft, errors: [] }, config);
      } catch (e) {
        return fail(config, 400, e.message || 'Could not parse CSV import');
      }
    }
    if (path === '/programs/import/parse-paste' && method === 'post') {
      try {
        const draft = parsePasteDraft(payload?.text);
        const validation = validateDraft(draft);
        if (!validation.valid) {
          return Promise.reject({ response: { data: { error: 'Text parsed, but the draft needs fixes before saving.', draft: validation.draft, errors: validation.errors }, status: 422, statusText: 'Error', headers: {}, config }, config });
        }
        return ok({ message: 'Text parsed. Review imported program before saving.', draft: validation.draft, errors: [] }, config);
      } catch (e) {
        return fail(config, 400, e.message || "Couldn't find any exercises in this text.");
      }
    }
    if (path === '/programs/import/parse-pdf' && method === 'post') {
      return fail(config, 503, 'PDF import is not configured. Add the AI import configuration, then try again.');
    }
    if (path === '/programs/import/commit' && method === 'post') {
      try {
        return ok(commitPreviewProgramDraft(payload.draft || payload), config, 201);
      } catch (e) {
        return Promise.reject({ response: { data: { error: e.message || 'Fix import draft errors before saving.', errors: e.validationErrors || [] }, status: 422, statusText: 'Error', headers: {}, config }, config });
      }
    }

    if (path === '/programs' && method === 'get') return ok(state.programs.filter((p) => !p.archived && p.frequency_days).map(programSummary), config);
    if (path === '/programs' && method === 'post') {
      const program = { id: id('program'), coach_id: currentCoach().id, name: payload.name, description: payload.description || null, frequency_days: Number(payload.frequency_days), archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.programs.push(program);
      replaceProgramDays(program.id, payload.days || []);
      return ok(programDetails(program.id), config, 201);
    }
    if (path === '/programs/client/assigned') {
      return ok({
        programs: state.programAssignments.filter((a) => a.client_id === client.id && !a.archived).map((a) => ({ ...a, program: programDetails(a.program_id) })),
        workouts: state.workoutAssignments.filter((a) => a.client_id === client.id && !a.archived).map(workoutAssignmentDetails),
      }, config);
    }
    const programExport = path.match(/^\/programs\/([^/]+)\/export\.pdf$/);
    if (programExport && method === 'get') {
      const program = programDetails(programExport[1]);
      if (!program) return fail(config, 404, 'Program not found');
      const frequency = program.frequency_days || program.days?.length || 0;
      const text = `CVF PT\n${program.name}\n${frequency} ${frequency === 1 ? 'day' : 'days'}/week\n\nPreview mode PDF export placeholder. Real PDF export is generated by the backend.`;
      return Promise.resolve({
        data: new Blob([text], { type: 'application/pdf' }),
        status: 200,
        statusText: 'OK',
        headers: { 'content-disposition': `attachment; filename="CVF-${program.name.replace(/[^a-z0-9]+/gi, '-')}.pdf"` },
        config,
      });
    }
    const programId = path.match(/^\/programs\/([^/]+)$/);
    if (programId && method === 'get') return ok(programDetails(programId[1]), config);
    if (programId && method === 'put') {
      const program = state.programs.find((p) => p.id === programId[1]);
      if (!program) return fail(config, 404, 'Program not found');
      Object.assign(program, { name: payload.name, description: payload.description || null, frequency_days: Number(payload.frequency_days), updated_at: new Date().toISOString() });
      replaceProgramDays(program.id, payload.days || []);
      return ok(programDetails(program.id), config);
    }
    const programArchive = path.match(/^\/programs\/([^/]+)\/archive$/);
    if (programArchive && method === 'patch') {
      const program = state.programs.find((p) => p.id === programArchive[1]);
      if (!program) return fail(config, 404, 'Program not found');
      program.archived = true;
      return ok(program, config);
    }
    const programAssign = path.match(/^\/programs\/([^/]+)\/assign$/);
    if (programAssign && method === 'post') {
      const row = { id: id('assign'), program_id: programAssign[1], client_id: payload.client_id, notes: payload.notes || null, archived: false, created_at: new Date().toISOString(), client: { id: payload.client_id, name: clientById(payload.client_id).name } };
      state.programAssignments.push(row);
      return ok(row, config, 201);
    }
    const unassign = path.match(/^\/programs\/assignments\/([^/]+)\/archive$/);
    if (unassign && method === 'patch') {
      const row = state.programAssignments.find((a) => a.id === unassign[1]);
      row.archived = true;
      return ok(row, config);
    }

    if (path === '/messages/mine' && method === 'get') {
      state.messages.filter((m) => m.client_id === client.id && m.sender_role === 'coach').forEach((m) => { m.read_by_recipient = true; });
      return ok({ coach: coachById(client.coach_id), messages: state.messages.filter((m) => m.client_id === client.id && !m.archived).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }, config);
    }
    if (path === '/messages/mine' && method === 'post') {
      const row = { id: id('msg'), client_id: client.id, coach_id: client.coach_id, sender_role: 'client', content: payload.content, read_by_recipient: false, archived: false, created_at: new Date().toISOString() };
      state.messages.push(row);
      return ok(row, config, 201);
    }
    if (path === '/messages/threads') {
      const clients = activeClientsForCoach();
      return ok(clients.map((c) => {
        const msgs = state.messages.filter((m) => m.client_id === c.id && !m.archived).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return { client_id: c.id, client_name: c.name, coach: coachById(c.coach_id), last_message: msgs[0] || null, unread: msgs.filter((m) => m.sender_role === 'client' && !m.read_by_recipient).length };
      }), config);
    }
    const messageWith = path.match(/^\/messages\/with\/([^/]+)$/);
    if (messageWith && method === 'get') {
      state.messages.filter((m) => m.client_id === messageWith[1] && m.sender_role === 'client').forEach((m) => { m.read_by_recipient = true; });
      return ok({ client: { id: messageWith[1], name: clientById(messageWith[1]).name }, messages: state.messages.filter((m) => m.client_id === messageWith[1] && !m.archived).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }, config);
    }
    if (messageWith && method === 'post') {
      const target = clientById(messageWith[1]);
      const row = { id: id('msg'), client_id: target.id, coach_id: target.coach_id, sender_role: 'coach', content: payload.content, read_by_recipient: false, archived: false, created_at: new Date().toISOString() };
      state.messages.push(row);
      return ok(row, config, 201);
    }

    if (path === '/waivers/latest') return ok(state.waiverVersions[0], config);
    if (path === '/waivers/versions' && method === 'get') return ok(state.waiverVersions.slice().sort((a, b) => b.version_number - a.version_number), config);
    if (path === '/waivers/versions' && method === 'post') {
      const row = { id: id('waiver'), version_number: Math.max(...state.waiverVersions.map((v) => v.version_number)) + 1, full_text: payload.full_text, created_at: new Date().toISOString() };
      state.waiverVersions.unshift(row);
      return ok(row, config, 201);
    }
    if (path === '/waivers/my-status') return ok(waiverStatus(client.id), config);
    if (path === '/waivers/sign' && method === 'post') {
      const latest = state.waiverVersions[0];
      const row = { id: id('sig'), client_id: client.id, waiver_version_id: latest.id, signed_at: new Date().toISOString(), signed_name: payload.signed_name, ip_address: '127.0.0.1', entered_by: 'client', entered_by_coach_id: null, version: latest };
      state.waiverSignatures.push(row);
      return ok(row, config, 201);
    }
    const waiverClient = path.match(/^\/waivers\/client\/([^/]+)\/status$/);
    if (waiverClient) return ok(waiverStatus(waiverClient[1]), config);
    const waiverPaper = path.match(/^\/waivers\/client\/([^/]+)\/sign-paper$/);
    if (waiverPaper && method === 'post') {
      const latest = state.waiverVersions[0];
      const row = { id: id('sig'), client_id: waiverPaper[1], waiver_version_id: latest.id, signed_at: new Date().toISOString(), signed_name: payload.signed_name || clientById(waiverPaper[1]).name, ip_address: '127.0.0.1', entered_by: 'coach', entered_by_coach_id: currentCoach().id, version: latest };
      state.waiverSignatures.push(row);
      return ok(row, config, 201);
    }

    if (path === '/packages' && method === 'get') {
      const includeArchived = search.get('include_archived') === 'true';
      return ok(state.packages.filter((p) => includeArchived || !p.archived), config);
    }
    if (path === '/packages' && method === 'post') {
      const row = { id: id('pkg'), name: payload.name, description: payload.description || null, price: Number(payload.price), session_credits: Number(payload.session_credits) || 0, is_recurring: Boolean(payload.is_recurring), archived: false, created_at: new Date().toISOString() };
      state.packages.push(row);
      return ok(row, config, 201);
    }
    const pkgId = path.match(/^\/packages\/([^/]+)$/);
    if (pkgId && method === 'put') {
      const row = state.packages.find((p) => p.id === pkgId[1]);
      Object.assign(row, payload);
      return ok(row, config);
    }
    const pkgArchive = path.match(/^\/packages\/([^/]+)\/archive$/);
    if (pkgArchive && method === 'patch') {
      const row = state.packages.find((p) => p.id === pkgArchive[1]);
      row.archived = payload.archived !== false;
      return ok(row, config);
    }

    if (path === '/payments/config') return ok({ configured: false, publishable_key: null, message: 'Preview mode: online payments are disabled.' }, config);
    if (path === '/payments/credits') return ok({ balance: state.credits[client.id] || 0 }, config);
    const payCredits = path.match(/^\/payments\/credits\/([^/]+)$/);
    if (payCredits) return ok({ balance: state.credits[payCredits[1]] || 0 }, config);
    if (path === '/payments/history') return ok(paymentHistory(client.id), config);
    const payHistory = path.match(/^\/payments\/history\/([^/]+)$/);
    if (payHistory) return ok(paymentHistory(payHistory[1]), config);
    if (path === '/payments/manual' && method === 'post') {
      const pkg = state.packages.find((p) => p.id === payload.package_id);
      const row = { id: id('purchase'), client_id: payload.client_id, package_id: pkg.id, amount: payload.amount || pkg.price, credits_granted: pkg.session_credits, method: 'manual', status: 'completed', stripe_session_id: null, recorded_by_coach_id: currentCoach().id, archived: false, created_at: new Date().toISOString(), package: pkg };
      state.purchases.push(row);
      state.credits[payload.client_id] = (state.credits[payload.client_id] || 0) + pkg.session_credits;
      return ok({ purchase: row, credits: state.credits[payload.client_id] }, config, 201);
    }
    if (path === '/payments/checkout' && method === 'post') return fail(config, 503, 'Preview mode: checkout is disabled.');

    return fail(config, 404, `Preview route not mocked: ${method.toUpperCase()} ${path}`);
  };
}
