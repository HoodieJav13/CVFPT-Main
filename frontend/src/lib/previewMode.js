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
    { id: 'metric_weight', client_id: 'client_sarah', name: 'Body Weight', unit: 'lbs', improvement_direction: 'lower', archived: false, created_at: iso(-40) },
    { id: 'metric_waist', client_id: 'client_sarah', name: 'Waist', unit: 'in', improvement_direction: 'lower', archived: false, created_at: iso(-40) },
    { id: 'metric_mile', client_id: 'client_david', name: 'Mile Time', unit: 'min', improvement_direction: 'lower', archived: false, created_at: iso(-30) },
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
    { id: 'wex_1', workout_id: 'workout_lower_a', exercise_library_id: 'lib_goblet_squat', custom_name: null, sets: '3', reps: '8-10', target_rpe: '7', rest: '90s', tempo: '3-1-1', default_load_value: 30, default_load_unit: 'lb', notes: 'Slow lower, tall chest.', video_url: null, position: 0, archived: false, created_at: iso(-45) },
    { id: 'wex_2', workout_id: 'workout_lower_a', exercise_library_id: 'lib_rdl', custom_name: null, sets: '3', reps: '8', target_rpe: '7-8', rest: '90s', tempo: '3-0-1', default_load_value: 40, default_load_unit: 'lb', notes: 'Stop when hamstrings limit range.', video_url: null, position: 1, archived: false, created_at: iso(-45) },
    { id: 'wex_3', workout_id: 'workout_lower_a', exercise_library_id: null, custom_name: 'Half-kneeling Pallof Press', sets: '3', reps: '10/side', target_rpe: '7', rest: '45s', tempo: '', default_load_value: 15, default_load_unit: 'lb', notes: 'No torso rotation.', video_url: 'https://www.youtube.com/watch?v=ma2OjgP5XDc', position: 2, archived: false, created_at: iso(-45) },
    { id: 'wex_4', workout_id: 'workout_upper_a', exercise_library_id: 'lib_db_bench', custom_name: null, sets: '3', reps: '8', target_rpe: '8', rest: '90s', tempo: '2-1-1', default_load_value: 20, default_load_unit: 'lb', notes: 'Pause at bottom.', video_url: null, position: 0, archived: false, created_at: iso(-44) },
    { id: 'wex_5', workout_id: 'workout_upper_a', exercise_library_id: 'lib_cable_row', custom_name: null, sets: '3', reps: '10-12', target_rpe: '8', rest: '75s', tempo: '', default_load_value: 35, default_load_unit: 'lb', notes: 'Squeeze shoulder blades.', video_url: null, position: 1, archived: false, created_at: iso(-44) },
    { id: 'wex_6', workout_id: 'workout_mobility_run', exercise_library_id: 'lib_world_stretch', custom_name: null, sets: '2', reps: '5/side', target_rpe: null, rest: '', tempo: '', default_load_value: null, default_load_unit: null, notes: 'Move slowly.', video_url: null, position: 0, archived: false, created_at: iso(-40) },
    { id: 'wex_7', workout_id: 'workout_mobility_run', exercise_library_id: null, custom_name: 'Ankle Rocker', sets: '2', reps: '8/side', target_rpe: null, rest: '', tempo: '', default_load_value: null, default_load_unit: null, notes: 'Keep heel heavy.', video_url: '', position: 1, archived: false, created_at: iso(-40) },
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
  programAssignmentExerciseLoads: [
    { id: 'paload_squat', program_assignment_id: 'assign_sarah', program_day_id: 'day_foundation_1', workout_exercise_id: 'wex_1', load_value: 35, load_unit: 'lb', archived: false, created_at: iso(-18), updated_at: iso(-18) },
    { id: 'paload_rdl', program_assignment_id: 'assign_sarah', program_day_id: 'day_foundation_1', workout_exercise_id: 'wex_2', load_value: 50, load_unit: 'lb', archived: false, created_at: iso(-18), updated_at: iso(-18) },
  ],
  workoutAssignmentExerciseLoads: [
    { id: 'waload_bench', workout_assignment_id: 'work_assign_sarah_dated', workout_exercise_id: 'wex_4', load_value: 25, load_unit: 'lb', archived: false, created_at: iso(-2), updated_at: iso(-2) },
  ],
  workoutLogs: [
    { id: 'log_preview_complete', client_id: 'client_sarah', program_assignment_id: 'assign_sarah', program_day_id: 'day_foundation_2', workout_assignment_id: null, dated_workout_assignment_id: null, workout_name: 'Upper Strength A', status: 'completed', notes: 'Shoulder felt strong today.', feedback: 'Good session. The last rows were challenging.', started_at: iso(-2, 17), completed_at: iso(-2, 18), archived: false, created_at: iso(-2, 17), updated_at: iso(-2, 18) },
  ],
  coachResponses: [
    { id: 'coach_response_marcus', workout_log_id: 'log_preview_complete', client_id: 'client_sarah', author_coach_id: 'coach_marcus', author_name_snapshot: 'Marcus Rivera', content: 'Strong pressing session. Keep the same shoulder position next time.', read_at: iso(-1, 10), archived: false, created_at: iso(-2, 19), edited_at: null, updated_at: iso(-2, 19) },
    { id: 'coach_response_jordan', workout_log_id: 'log_preview_complete', client_id: 'client_sarah', author_coach_id: 'coach_jordan', author_name_snapshot: 'Jordan Banks', content: 'Nice consistency across the working sets. Keep building from here.', read_at: null, archived: false, created_at: iso(-2, 20), edited_at: iso(-1, 11), updated_at: iso(-1, 11) },
  ],
  workoutLogExercises: [
    { id: 'logex_preview_bench', workout_log_id: 'log_preview_complete', source_workout_exercise_id: 'wex_4', exercise_name: 'DB Bench Press', prescribed_sets: '3', prescribed_reps: '8', prescribed_rpe: '8', prescribed_rest: '90s', prescribed_tempo: '2-1-1', prescribed_notes: 'Pause at bottom.', client_notes: 'Kept the pause consistent.', prescribed_load_value: 20, prescribed_load_unit: 'lb', position: 0, archived: false },
    { id: 'logex_preview_row', workout_log_id: 'log_preview_complete', source_workout_exercise_id: 'wex_5', exercise_name: 'Cable Row', prescribed_sets: '3', prescribed_reps: '10-12', prescribed_rpe: '8', prescribed_rest: '75s', prescribed_tempo: null, prescribed_notes: 'Squeeze shoulder blades.', client_notes: null, prescribed_load_value: 35, prescribed_load_unit: 'lb', position: 1, archived: false },
  ],
  workoutLogSets: [
    ...[1, 2, 3].map((setNumber) => ({ id: `logset_preview_bench_${setNumber}`, workout_log_id: 'log_preview_complete', workout_log_exercise_id: 'logex_preview_bench', set_number: setNumber, set_origin: 'prescribed', status: 'completed', actual_load_value: setNumber === 3 ? 22.5 : 20, actual_load_unit: 'lb', client_operation_id: null, archived: false })),
    ...[1, 2].map((setNumber) => ({ id: `logset_preview_row_${setNumber}`, workout_log_id: 'log_preview_complete', workout_log_exercise_id: 'logex_preview_row', set_number: setNumber, set_origin: 'prescribed', status: 'completed', actual_load_value: 35, actual_load_unit: 'lb', client_operation_id: null, archived: false })),
    { id: 'logset_preview_row_3', workout_log_id: 'log_preview_complete', workout_log_exercise_id: 'logex_preview_row', set_number: 3, set_origin: 'prescribed', status: 'skipped', actual_load_value: 35, actual_load_unit: 'lb', client_operation_id: null, archived: false },
  ],
  notifications: [
    { id: 'notification_preview_complete', recipient_coach_id: 'coach_marcus', event_type: 'workout_completed', workout_log_id: 'log_preview_complete', read_at: null, created_at: iso(-2, 18), updated_at: iso(-2, 18) },
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
  const direction = ['higher', 'lower'].includes(metric.improvement_direction)
    ? metric.improvement_direction
    : 'neutral';
  const entries = state.metricEntries
    .filter((e) => e.metric_id === metric.id && !e.archived)
    .sort((a, b) => String(a.recorded_on).localeCompare(String(b.recorded_on)));
  const best = direction === 'neutral' || !entries.length
    ? null
    : entries.reduce((current, entry) => {
      if (direction === 'higher') return Number(entry.value) > Number(current.value) ? entry : current;
      return Number(entry.value) < Number(current.value) ? entry : current;
    });
  const latest = entries[entries.length - 1] || null;
  const prior = latest ? entries.filter((entry) => entry.id !== latest.id) : [];
  const priorBest = direction === 'neutral' || !prior.length
    ? null
    : prior.reduce((current, entry) => {
      if (direction === 'higher') return Number(entry.value) > Number(current.value) ? entry : current;
      return Number(entry.value) < Number(current.value) ? entry : current;
    });
  const latestIsBest = Boolean(latest && priorBest && (
    direction === 'higher'
      ? Number(latest.value) > Number(priorBest.value)
      : Number(latest.value) < Number(priorBest.value)
  ));
  return {
    ...metric,
    improvement_direction: direction,
    entries,
    best_value: best ? Number(best.value) : null,
    latest_is_personal_best: latestIsBest,
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
  const existing = state.workoutExercises.filter((e) => e.workout_id === workoutId);
  const retained = new Set();
  exercises
    .filter((exercise) => exercise.exercise_library_id || String(exercise.custom_name || '').trim())
    .forEach((exercise, index) => {
      const row = existing.find((candidate) => candidate.id === exercise.id
        && candidate.exercise_library_id === (exercise.exercise_library_id || null)
        && candidate.custom_name === (exercise.exercise_library_id ? null : (exercise.custom_name || null)));
      const values = {
        workout_id: workoutId,
        exercise_library_id: exercise.exercise_library_id || null,
        custom_name: exercise.exercise_library_id ? null : (exercise.custom_name || null),
        sets: exercise.sets || null,
        reps: exercise.reps || null,
        target_rpe: exercise.target_rpe || null,
        rest: exercise.rest || null,
        tempo: exercise.tempo || null,
        default_load_value: exercise.default_load_value === '' || exercise.default_load_value == null ? null : Number(exercise.default_load_value),
        default_load_unit: exercise.default_load_value === '' || exercise.default_load_value == null ? null : (exercise.default_load_unit || 'lb'),
        notes: exercise.client_notes || exercise.notes || null,
        client_notes: exercise.client_notes || exercise.notes || null,
        coach_notes: exercise.coach_notes || null,
        video_url: exercise.video_url || null,
        position: index,
        archived: false,
      };
      if (row) {
        Object.assign(row, values);
        retained.add(row.id);
      } else {
        const created = { id: id('wex'), created_at: new Date().toISOString(), ...values };
        state.workoutExercises.push(created);
        retained.add(created.id);
      }
    });
  existing.filter((row) => !retained.has(row.id)).forEach((row) => {
    row.archived = true;
    state.programAssignmentExerciseLoads.filter((load) => load.workout_exercise_id === row.id).forEach((load) => { load.archived = true; });
    state.workoutAssignmentExerciseLoads.filter((load) => load.workout_exercise_id === row.id).forEach((load) => { load.archived = true; });
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
    .map((a) => ({
      ...a,
      client: { id: a.client_id, name: clientById(a.client_id)?.name },
      exercise_loads: state.programAssignmentExerciseLoads.filter((load) => load.program_assignment_id === a.id && !load.archived),
    }));
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
  return {
    ...assignment,
    workout: workoutDetails(assignment.workout_id),
    client: { id: assignment.client_id, name: clientById(assignment.client_id)?.name },
    exercise_loads: state.workoutAssignmentExerciseLoads.filter((load) => load.workout_assignment_id === assignment.id && !load.archived),
  };
}

function exerciseName(exercise) {
  return exercise.custom_name || libraryById(exercise.exercise_library_id)?.name || 'Exercise';
}

function prescribedSetCount(value) {
  const match = String(value || '').match(/\d+/);
  return Math.max(1, match ? Number(match[0]) : 1);
}

function workoutLogDetails(logId) {
  const log = state.workoutLogs.find((row) => row.id === logId && !row.archived);
  if (!log) return null;
  const exercises = state.workoutLogExercises
    .filter((row) => row.workout_log_id === log.id && !row.archived)
    .sort((a, b) => a.position - b.position)
    .map((exercise) => ({
      ...exercise,
      sets: state.workoutLogSets
        .filter((set) => set.workout_log_exercise_id === exercise.id && !set.archived)
        .sort((a, b) => a.set_number - b.set_number),
    }));
  const coachResponses = state.coachResponses
    .filter((row) => row.workout_log_id === log.id && !row.archived)
    .sort((a, b) => {
      const activity = new Date(b.edited_at || b.created_at) - new Date(a.edited_at || a.created_at);
      return activity || String(b.id).localeCompare(String(a.id));
    });
  return { ...log, client: clientById(log.client_id), coach_responses: coachResponses, exercises };
}

function previewLoadForExercise({ exercise, programAssignmentId, programDayId, workoutAssignmentId }) {
  const programLoad = state.programAssignmentExerciseLoads.find((load) => !load.archived
    && load.program_assignment_id === programAssignmentId
    && load.program_day_id === programDayId
    && load.workout_exercise_id === exercise.id);
  const workoutLoad = state.workoutAssignmentExerciseLoads.find((load) => !load.archived
    && load.workout_assignment_id === workoutAssignmentId
    && load.workout_exercise_id === exercise.id);
  return programLoad || workoutLoad || {
    load_value: exercise.default_load_value,
    load_unit: exercise.default_load_unit,
  };
}

function replacePreviewLoads(collection, ownerKey, ownerId, loads = []) {
  collection.filter((row) => row[ownerKey] === ownerId).forEach((row) => { row.archived = true; });
  loads.forEach((load) => {
    const row = {
      id: id('load'),
      [ownerKey]: ownerId,
      workout_exercise_id: load.workout_exercise_id,
      load_value: Number(load.load_value),
      load_unit: load.load_unit || 'lb',
      archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (load.program_day_id) row.program_day_id = load.program_day_id;
    collection.push(row);
  });
}

function startPreviewWorkout(clientId, payload) {
  const active = state.workoutLogs.find((row) => row.client_id === clientId && row.status === 'active' && !row.archived);
  const sameSource = active && (
    (payload.program_assignment_id && active.program_assignment_id === payload.program_assignment_id && active.program_day_id === payload.program_day_id)
    || (payload.workout_assignment_id && active.workout_assignment_id === payload.workout_assignment_id)
  );
  if (active) return { outcome: sameSource ? 'resumed' : 'conflict', workout_log: workoutLogDetails(active.id) };

  let workout = null;
  let programAssignment = null;
  let programDay = null;
  let workoutAssignment = null;
  if (payload.program_assignment_id) {
    programAssignment = state.programAssignments.find((row) => row.id === payload.program_assignment_id && row.client_id === clientId && !row.archived);
    programDay = state.programDays.find((row) => row.id === payload.program_day_id && row.program_id === programAssignment?.program_id && !row.archived);
    workout = programDay ? state.workouts.find((row) => row.id === programDay.workout_id && !row.archived) : null;
  } else {
    workoutAssignment = state.workoutAssignments.find((row) => row.id === payload.workout_assignment_id && row.client_id === clientId && !row.archived);
    workout = workoutAssignment ? state.workouts.find((row) => row.id === workoutAssignment.workout_id && !row.archived) : null;
    if (workoutAssignment?.assignment_mode === 'dated') {
      const completed = state.workoutLogs.find((row) => row.dated_workout_assignment_id === workoutAssignment.id
        && ['active', 'completed'].includes(row.status) && !row.archived);
      if (completed) return { outcome: 'already_completed', workout_log: workoutLogDetails(completed.id) };
    }
  }
  if (!workout) return null;

  const createdAt = new Date().toISOString();
  const log = {
    id: id('workout_log'),
    client_id: clientId,
    program_assignment_id: programAssignment?.id || null,
    program_day_id: programDay?.id || null,
    workout_assignment_id: workoutAssignment?.id || null,
    dated_workout_assignment_id: workoutAssignment?.assignment_mode === 'dated' ? workoutAssignment.id : null,
    workout_name: workout.name,
    status: 'active', notes: null, feedback: null, started_at: createdAt, completed_at: null,
    archived: false, created_at: createdAt, updated_at: createdAt,
  };
  state.workoutLogs.push(log);
  state.workoutExercises.filter((row) => row.workout_id === workout.id && !row.archived).sort((a, b) => a.position - b.position).forEach((exercise) => {
    const resolved = previewLoadForExercise({
      exercise,
      programAssignmentId: programAssignment?.id,
      programDayId: programDay?.id,
      workoutAssignmentId: workoutAssignment?.id,
    });
    const logExercise = {
      id: id('workout_log_exercise'), workout_log_id: log.id, source_workout_exercise_id: exercise.id,
      exercise_name: exerciseName(exercise), prescribed_sets: exercise.sets, prescribed_reps: exercise.reps,
      prescribed_rpe: exercise.target_rpe, prescribed_rest: exercise.rest, prescribed_tempo: exercise.tempo,
      prescribed_notes: exercise.notes, client_notes: null,
      prescribed_load_value: resolved?.load_value ?? null,
      prescribed_load_unit: resolved?.load_value == null ? null : (resolved.load_unit || 'lb'),
      position: exercise.position, archived: false, created_at: createdAt, updated_at: createdAt,
    };
    state.workoutLogExercises.push(logExercise);
    for (let setNumber = 1; setNumber <= prescribedSetCount(exercise.sets); setNumber += 1) {
      state.workoutLogSets.push({
        id: id('workout_log_set'), workout_log_id: log.id, workout_log_exercise_id: logExercise.id,
        set_number: setNumber, set_origin: 'prescribed', status: 'pending',
        actual_load_value: logExercise.prescribed_load_value, actual_load_unit: logExercise.prescribed_load_unit,
        client_operation_id: null, completed_at: null, archived: false, created_at: createdAt, updated_at: createdAt,
      });
    }
  });
  return { outcome: 'started', workout_log: workoutLogDetails(log.id) };
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

    if (path === '/workout-logs/start' && method === 'post') {
      if (role !== 'client') return fail(config, 403, 'Client access required');
      const result = startPreviewWorkout(client.id, payload);
      if (!result) return fail(config, 404, 'Assigned workout not found');
      if (result.outcome === 'conflict') return Promise.reject({ response: { data: { error: 'Finish or abandon your active workout first', active_workout: result.workout_log }, status: 409, statusText: 'Conflict', headers: {}, config }, config });
      if (result.outcome === 'already_completed') return Promise.reject({ response: { data: { error: 'This dated workout has already been completed', workout_log: result.workout_log }, status: 409, statusText: 'Conflict', headers: {}, config }, config });
      emitChange();
      return ok(result, config, result.outcome === 'started' ? 201 : 200);
    }
    if (path === '/workout-logs/active' && method === 'get') {
      const active = state.workoutLogs.find((row) => row.client_id === client.id && row.status === 'active' && !row.archived);
      return ok(active ? workoutLogDetails(active.id) : null, config);
    }
    if (path === '/workout-logs/mine' && method === 'get') {
      return ok(state.workoutLogs.filter((row) => row.client_id === client.id && row.status === 'completed' && !row.archived)
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)).map((row) => workoutLogDetails(row.id)), config);
    }
    if (path === '/workout-logs/coach-feedback/unread-count' && method === 'get') {
      if (role !== 'client') return fail(config, 403, 'Client access required');
      return ok({ unread: state.coachResponses.filter((row) => row.client_id === client.id && !row.archived && !row.read_at).length }, config);
    }
    const clientWorkoutHistory = path.match(/^\/workout-logs\/client\/([^/]+)$/);
    if (clientWorkoutHistory && method === 'get') {
      if (role === 'client') return fail(config, 404, 'Client not found');
      const target = clientById(clientWorkoutHistory[1]);
      if (!target || (role !== 'admin' && target.coach_id !== currentCoach().id)) return fail(config, 404, 'Client not found');
      return ok(state.workoutLogs.filter((row) => row.client_id === target.id && row.status === 'completed' && !row.archived)
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)).map((row) => workoutLogDetails(row.id)), config);
    }
    const workoutSetArchive = path.match(/^\/workout-logs\/([^/]+)\/sets\/([^/]+)\/archive$/);
    if (workoutSetArchive && method === 'patch') {
      const log = state.workoutLogs.find((row) => row.id === workoutSetArchive[1] && row.client_id === client.id && row.status === 'active' && !row.archived);
      const set = state.workoutLogSets.find((row) => row.id === workoutSetArchive[2] && row.workout_log_id === log?.id && row.set_origin === 'extra' && !row.archived);
      if (!set) return fail(config, 404, 'Extra set not found');
      set.archived = true;
      set.updated_at = new Date().toISOString();
      return ok(set, config);
    }
    const workoutSetUpdate = path.match(/^\/workout-logs\/([^/]+)\/sets\/([^/]+)$/);
    if (workoutSetUpdate && method === 'patch') {
      const log = state.workoutLogs.find((row) => row.id === workoutSetUpdate[1] && row.client_id === client.id && row.status === 'active' && !row.archived);
      const set = state.workoutLogSets.find((row) => row.id === workoutSetUpdate[2] && row.workout_log_id === log?.id && !row.archived);
      if (!set) return fail(config, 404, 'Workout set not found');
      Object.assign(set, {
        status: payload.status === 'completed' ? 'completed' : 'pending',
        actual_load_value: payload.actual_load_value === '' || payload.actual_load_value == null ? null : Number(payload.actual_load_value),
        actual_load_unit: payload.actual_load_value === '' || payload.actual_load_value == null ? null : (payload.actual_load_unit || 'lb'),
        completed_at: payload.status === 'completed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });
      return ok(set, config);
    }
    const workoutExtraSet = path.match(/^\/workout-logs\/([^/]+)\/exercises\/([^/]+)\/sets$/);
    if (workoutExtraSet && method === 'post') {
      const log = state.workoutLogs.find((row) => row.id === workoutExtraSet[1] && row.client_id === client.id && row.status === 'active' && !row.archived);
      const exercise = state.workoutLogExercises.find((row) => row.id === workoutExtraSet[2] && row.workout_log_id === log?.id && !row.archived);
      if (!exercise) return fail(config, 404, 'Workout exercise not found');
      const existing = state.workoutLogSets.find((row) => row.client_operation_id === payload.client_operation_id);
      if (existing) return ok(existing, config);
      const exerciseSets = state.workoutLogSets.filter((row) => row.workout_log_exercise_id === exercise.id && !row.archived);
      const row = {
        id: id('workout_log_set'), workout_log_id: log.id, workout_log_exercise_id: exercise.id,
        set_number: Math.max(0, ...exerciseSets.map((set) => set.set_number)) + 1,
        set_origin: 'extra', status: 'pending', actual_load_value: exercise.prescribed_load_value,
        actual_load_unit: exercise.prescribed_load_unit, client_operation_id: payload.client_operation_id,
        completed_at: null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.workoutLogSets.push(row);
      return ok(row, config, 201);
    }
    const workoutExerciseNotes = path.match(/^\/workout-logs\/([^/]+)\/exercises\/([^/]+)\/notes$/);
    if (workoutExerciseNotes && method === 'patch') {
      const log = state.workoutLogs.find((row) => row.id === workoutExerciseNotes[1] && row.client_id === client.id && row.status === 'active' && !row.archived);
      const exercise = state.workoutLogExercises.find((row) => row.id === workoutExerciseNotes[2] && row.workout_log_id === log?.id && !row.archived);
      if (!exercise) return fail(config, 404, 'Workout exercise not found');
      exercise.client_notes = String(payload.client_notes || '').slice(0, 2000) || null;
      exercise.updated_at = new Date().toISOString();
      return ok(exercise, config);
    }
    const completeAllWorkout = path.match(/^\/workout-logs\/([^/]+)\/complete-all$/);
    if (completeAllWorkout && method === 'post') {
      const log = state.workoutLogs.find((row) => row.id === completeAllWorkout[1] && row.client_id === client.id && row.status === 'active' && !row.archived);
      if (!log) return fail(config, 404, 'Workout log not found');
      state.workoutLogSets.filter((set) => set.workout_log_id === log.id && set.status === 'pending' && !set.archived).forEach((set) => {
        set.status = 'completed'; set.completed_at = new Date().toISOString(); set.updated_at = set.completed_at;
      });
      return ok(workoutLogDetails(log.id), config);
    }
    const abandonWorkout = path.match(/^\/workout-logs\/([^/]+)\/abandon$/);
    if (abandonWorkout && method === 'post') {
      const log = state.workoutLogs.find((row) => row.id === abandonWorkout[1] && row.client_id === client.id && row.status === 'active' && !row.archived);
      if (!log) return fail(config, 404, 'Workout log not found');
      log.status = 'abandoned'; log.updated_at = new Date().toISOString();
      return ok(log, config);
    }
    const markCoachFeedbackRead = path.match(/^\/workout-logs\/([^/]+)\/coach-feedback\/read$/);
    if (markCoachFeedbackRead && method === 'patch') {
      if (role !== 'client') return fail(config, 403, 'Client access required');
      const log = state.workoutLogs.find((row) => row.id === markCoachFeedbackRead[1] && row.client_id === client.id && !row.archived);
      if (!log) return fail(config, 404, 'Workout log not found');
      if (globalThis.__CVF_PREVIEW_FAIL_FEEDBACK_READ_ONCE__ === true) {
        globalThis.__CVF_PREVIEW_FAIL_FEEDBACK_READ_ONCE__ = false;
        return fail(config, 503, 'Preview mark-read failure');
      }
      const readAt = new Date().toISOString();
      let updated = 0;
      state.coachResponses.filter((row) => row.workout_log_id === log.id && row.client_id === client.id && !row.archived && !row.read_at).forEach((row) => {
        row.read_at = readAt;
        row.updated_at = readAt;
        updated += 1;
      });
      emitChange();
      return ok({ updated, read_at: updated ? readAt : null }, config);
    }
    const saveCoachResponse = path.match(/^\/workout-logs\/([^/]+)\/coach-response$/);
    if (saveCoachResponse && method === 'put') {
      if (!['coach', 'admin'].includes(role)) return fail(config, 403, 'Coach access required');
      if (!payload || Array.isArray(payload) || typeof payload.content !== 'string') return fail(config, 400, 'Coach response must be text');
      const content = payload.content.trim();
      if (!content) return fail(config, 400, 'Coach response is required');
      if (Array.from(content).length > 4000) return fail(config, 400, 'Coach response must be 4,000 characters or fewer');
      const log = state.workoutLogs.find((row) => row.id === saveCoachResponse[1] && !row.archived);
      const target = log ? clientById(log.client_id) : null;
      if (!log || target.archived || (role !== 'admin' && target.coach_id !== currentCoach().id)) return fail(config, 404, 'Workout log not found');
      if (log.status !== 'completed') return fail(config, 409, 'Only completed workouts accept coach responses');
      const existing = state.coachResponses.find((row) => row.workout_log_id === log.id && row.author_coach_id === currentCoach().id && !row.archived);
      const now = new Date().toISOString();
      if (existing) {
        if (existing.content !== content) {
          existing.content = content;
          existing.edited_at = now;
          existing.updated_at = now;
        }
        emitChange();
        return ok({ outcome: 'updated', response: existing }, config);
      }
      const response = { id: id('coach_response'), workout_log_id: log.id, client_id: log.client_id, author_coach_id: currentCoach().id, author_name_snapshot: currentCoach().name, content, read_at: null, archived: false, created_at: now, edited_at: null, updated_at: now };
      state.coachResponses.push(response);
      emitChange();
      return ok({ outcome: 'created', response }, config, 201);
    }
    const completeWorkout = path.match(/^\/workout-logs\/([^/]+)\/complete$/);
    if (completeWorkout && method === 'post') {
      const log = state.workoutLogs.find((row) => row.id === completeWorkout[1] && row.client_id === client.id && !row.archived);
      if (!log) return fail(config, 404, 'Workout log not found');
      if (log.status === 'completed') return ok(workoutLogDetails(log.id), config);
      const sets = state.workoutLogSets.filter((set) => set.workout_log_id === log.id && !set.archived);
      if (!sets.some((set) => set.status === 'completed')) return fail(config, 400, 'Complete at least one set');
      sets.filter((set) => set.status === 'pending').forEach((set) => { set.status = 'skipped'; set.updated_at = new Date().toISOString(); });
      Object.assign(log, { status: 'completed', notes: String(payload.notes || '') || null, feedback: String(payload.feedback || '') || null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      const recipients = new Set([clientById(log.client_id)?.coach_id, ...state.coaches.filter((coach) => coach.is_admin && !coach.archived).map((coach) => coach.id)]);
      recipients.forEach((recipientCoachId) => {
        if (!recipientCoachId || state.notifications.some((row) => row.recipient_coach_id === recipientCoachId && row.workout_log_id === log.id && row.event_type === 'workout_completed')) return;
        const createdAt = new Date().toISOString();
        state.notifications.unshift({ id: id('notification'), recipient_coach_id: recipientCoachId, event_type: 'workout_completed', workout_log_id: log.id, read_at: null, archived: false, created_at: createdAt, updated_at: createdAt });
      });
      emitChange();
      return ok(workoutLogDetails(log.id), config);
    }
    const workoutLog = path.match(/^\/workout-logs\/([^/]+)$/);
    if (workoutLog && method === 'get') {
      const detail = workoutLogDetails(workoutLog[1]);
      const canRead = detail && (role === 'client' ? detail.client_id === client.id : (role === 'admin' || detail.client.coach_id === currentCoach().id));
      return canRead ? ok(detail, config) : fail(config, 404, 'Workout log not found');
    }

    const visibleNotifications = () => state.notifications
      .filter((row) => row.recipient_coach_id === currentCoach().id && !row.archived)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((row) => ({ ...row, workout_log: workoutLogDetails(row.workout_log_id) }));
    if (path === '/notifications/unread-count' && method === 'get') return ok({ unread: visibleNotifications().filter((row) => !row.read_at).length }, config);
    if (path === '/notifications' && method === 'get') return ok(visibleNotifications(), config);
    if (path === '/notifications/read-all' && method === 'patch') {
      let updated = 0;
      state.notifications.filter((row) => row.recipient_coach_id === currentCoach().id && !row.archived && !row.read_at).forEach((row) => { row.read_at = new Date().toISOString(); updated += 1; });
      emitChange();
      return ok({ updated }, config);
    }
    const readNotification = path.match(/^\/notifications\/([^/]+)\/read$/);
    if (readNotification && method === 'patch') {
      const notification = state.notifications.find((row) => row.id === readNotification[1] && row.recipient_coach_id === currentCoach().id && !row.archived);
      if (!notification) return fail(config, 404, 'Notification not found');
      notification.read_at ||= new Date().toISOString();
      emitChange();
      return ok(notification, config);
    }

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
      row.credit_deducted = false;
      return ok({ session: row, credit_deducted: false, credits_remaining: null }, config);
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
      const row = { id: id('metric'), client_id: coachMetrics[1], name: payload.name, unit: payload.unit || null, improvement_direction: payload.improvement_direction || 'neutral', archived: false, created_at: new Date().toISOString(), entries: [] };
      state.metrics.push(row);
      return ok(row, config, 201);
    }
    const metricUpdate = path.match(/^\/progress\/metrics\/([^/]+)$/);
    if (metricUpdate && method === 'patch') {
      const row = state.metrics.find((m) => m.id === metricUpdate[1]);
      Object.assign(row, payload);
      return ok(row, config);
    }
    const metricEntry = path.match(/^\/progress\/metrics\/([^/]+)\/entries$/);
    if (metricEntry && method === 'post') {
      const metric = state.metrics.find((m) => m.id === metricEntry[1]);
      const previous = state.metricEntries.filter((entry) => entry.metric_id === metricEntry[1] && !entry.archived);
      const direction = metric?.improvement_direction || 'neutral';
      const previousValues = previous.map((entry) => Number(entry.value));
      const previousBest = direction === 'higher'
        ? Math.max(...previousValues)
        : direction === 'lower'
          ? Math.min(...previousValues)
          : null;
      const numericValue = Number(payload.value);
      const isPersonalBest = previous.length > 0 && (
        (direction === 'higher' && numericValue > previousBest)
        || (direction === 'lower' && numericValue < previousBest)
      );
      const row = { id: id('entry'), metric_id: metricEntry[1], value: Number(payload.value), notes: payload.notes || null, recorded_on: payload.recorded_on || dateOnly(0), archived: false, created_at: new Date().toISOString() };
      state.metricEntries.push(row);
      return ok({
        ...row,
        is_personal_best: isPersonalBest,
        previous_best_value: Number.isFinite(previousBest) ? previousBest : null,
        improvement_amount: isPersonalBest ? Math.abs(numericValue - previousBest) : null,
      }, config, 201);
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
      replacePreviewLoads(state.workoutAssignmentExerciseLoads, 'workout_assignment_id', row.id, payload.exercise_loads || []);
      return ok(workoutAssignmentDetails(row), config, 201);
    }
    const workoutAssignmentLoads = path.match(/^\/programs\/workout-assignments\/([^/]+)\/loads$/);
    if (workoutAssignmentLoads && method === 'put') {
      const row = state.workoutAssignments.find((assignment) => assignment.id === workoutAssignmentLoads[1] && !assignment.archived);
      if (!row) return fail(config, 404, 'Assignment not found');
      replacePreviewLoads(state.workoutAssignmentExerciseLoads, 'workout_assignment_id', row.id, payload.exercise_loads || []);
      return ok(workoutAssignmentDetails(row), config);
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
        programs: state.programAssignments.filter((a) => a.client_id === client.id && !a.archived).map((a) => ({
          ...a,
          exercise_loads: state.programAssignmentExerciseLoads.filter((load) => load.program_assignment_id === a.id && !load.archived),
          program: programDetails(a.program_id),
        })),
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
      replacePreviewLoads(state.programAssignmentExerciseLoads, 'program_assignment_id', row.id, payload.exercise_loads || []);
      return ok({ ...row, exercise_loads: state.programAssignmentExerciseLoads.filter((load) => load.program_assignment_id === row.id && !load.archived) }, config, 201);
    }
    const programAssignmentLoads = path.match(/^\/programs\/assignments\/([^/]+)\/loads$/);
    if (programAssignmentLoads && method === 'put') {
      const row = state.programAssignments.find((assignment) => assignment.id === programAssignmentLoads[1] && !assignment.archived);
      if (!row) return fail(config, 404, 'Assignment not found');
      replacePreviewLoads(state.programAssignmentExerciseLoads, 'program_assignment_id', row.id, payload.exercise_loads || []);
      return ok({ ...row, exercise_loads: state.programAssignmentExerciseLoads.filter((load) => load.program_assignment_id === row.id && !load.archived) }, config);
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

    return fail(config, 404, `Preview route not mocked: ${method.toUpperCase()} ${path}`);
  };
}
