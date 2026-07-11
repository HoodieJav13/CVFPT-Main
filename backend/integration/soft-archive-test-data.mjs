import { createClient } from '@supabase/supabase-js';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required cleanup environment variable: ${name}`);
  return value;
};

const environment = required('CVF_TEST_ENV').toLowerCase();
if (!['development', 'preview'].includes(environment)) throw new Error('CVF_TEST_ENV must be development or preview');
if (process.env.CVF_TEST_ALLOW_MUTATIONS !== 'true') throw new Error('Refusing cleanup without CVF_TEST_ALLOW_MUTATIONS=true');

const prefix = required('CVF_TEST_LABEL_PREFIX');
if (!/^CVF (?:LIVE|TEST)(?: |$)/.test(prefix)) throw new Error('CVF_TEST_LABEL_PREFIX must begin with CVF LIVE or CVF TEST');

const supabaseUrl = new URL(required('SUPABASE_URL'));
const allowedHosts = new Set(required('CVF_TEST_SUPABASE_ALLOWED_HOSTS').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
if (!allowedHosts.has(supabaseUrl.hostname.toLowerCase())) throw new Error('Refusing unapproved Supabase cleanup target');

const secret = required('SUPABASE_SERVICE_ROLE_KEY');
if (!secret.startsWith('sb_secret_')) throw new Error('Cleanup requires the current Supabase secret-key format');

const supabase = createClient(supabaseUrl.toString(), secret, { auth: { persistSession: false, autoRefreshToken: false } });
const pattern = `${prefix}%`;
const counts = {};

async function idsLike(table, column) {
  const { data, error } = await supabase.from(table).select('id').eq('archived', false).ilike(column, pattern);
  if (error) throw error;
  return (data || []).map((row) => row.id);
}

async function allIdsLike(table, column) {
  const { data, error } = await supabase.from(table).select('id').ilike(column, pattern);
  if (error) throw error;
  return (data || []).map((row) => row.id);
}

async function archiveIds(table, ids) {
  if (!ids.length) {
    counts[table] = counts[table] || 0;
    return;
  }
  const { data, error } = await supabase.from(table).update({ archived: true }).in('id', ids).select('id');
  if (error) throw error;
  counts[table] = (counts[table] || 0) + (data || []).length;
}

const clientIds = await idsLike('clients', 'name');
const activeSessionIds = await idsLike('sessions', 'location');
const activeProgramIds = await idsLike('programs', 'name');
const activeNamedWorkoutIds = await idsLike('workouts', 'name');
const activeExerciseIds = await idsLike('exercise_library', 'name');
const activeMetricIds = await idsLike('metrics', 'name');
const activePackageIds = await idsLike('packages', 'name');
const sessionIds = await allIdsLike('sessions', 'location');
const programIds = await allIdsLike('programs', 'name');
const namedWorkoutIds = await allIdsLike('workouts', 'name');
const metricIds = await allIdsLike('metrics', 'name');
const packageIds = await allIdsLike('packages', 'name');

let programWorkoutIds = [];
if (programIds.length) {
  const { data, error } = await supabase.from('program_days').select('workout_id').in('program_id', programIds);
  if (error) throw error;
  programWorkoutIds = (data || []).map((row) => row.workout_id).filter(Boolean);
}
const workoutIds = [...new Set([...namedWorkoutIds, ...programWorkoutIds])];
let activeProgramWorkoutIds = [];
if (programWorkoutIds.length) {
  const { data, error } = await supabase.from('workouts').select('id').eq('archived', false).in('id', programWorkoutIds);
  if (error) throw error;
  activeProgramWorkoutIds = (data || []).map((row) => row.id);
}
const activeWorkoutIds = [...new Set([...activeNamedWorkoutIds, ...activeProgramWorkoutIds])];

const linked = {};
for (const [table, column, parentIds] of [
  ['session_notes', 'session_id', sessionIds],
  ['program_days', 'program_id', programIds],
  ['program_assignments', 'program_id', programIds],
  ['workout_exercises', 'workout_id', workoutIds],
  ['workout_assignments', 'workout_id', workoutIds],
  ['metric_entries', 'metric_id', metricIds],
  ['purchases', 'package_id', packageIds],
]) {
  if (!parentIds.length) {
    linked[table] = [];
    continue;
  }
  const { data, error } = await supabase.from(table).select('id').eq('archived', false).in(column, parentIds);
  if (error) throw error;
  linked[table] = (data || []).map((row) => row.id);
}

for (const [table, column] of [
  ['session_notes', 'content'],
  ['metric_entries', 'notes'],
  ['program_assignments', 'notes'],
  ['workout_assignments', 'notes'],
]) {
  linked[table] = [...new Set([...(linked[table] || []), ...(await idsLike(table, column))])];
}

const messageIds = await idsLike('messages', 'content');
const bookingIds = await idsLike('booking_requests', 'note');
const checkInIds = [...new Set([
  ...(await idsLike('check_ins', 'general_notes')),
  ...(await idsLike('check_ins', 'coach_notes')),
])];
const ledgerSources = [...new Set([...(linked.purchases || []), ...sessionIds])];
let ledgerIds = [];
if (ledgerSources.length) {
  const { data, error } = await supabase.from('credit_transactions').select('id').eq('archived', false).in('source_id', ledgerSources);
  if (error) throw error;
  ledgerIds = (data || []).map((row) => row.id);
}

for (const [table, ids] of Object.entries(linked)) await archiveIds(table, ids);
await archiveIds('credit_transactions', ledgerIds);
await archiveIds('messages', messageIds);
await archiveIds('booking_requests', bookingIds);
await archiveIds('check_ins', checkInIds);
await archiveIds('metrics', activeMetricIds);
await archiveIds('programs', activeProgramIds);
await archiveIds('workouts', activeWorkoutIds);
await archiveIds('exercise_library', activeExerciseIds);
await archiveIds('packages', activePackageIds);
await archiveIds('sessions', activeSessionIds);
await archiveIds('clients', clientIds);

console.log(`Soft cleanup target: ${environment} (${supabaseUrl.hostname}); prefix: ${prefix}`);
for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count}`);
