/**
 * CVF PT seed script - idempotent (safe to re-run).
 * Seeds: 3 coaches (1 admin), 6 clients, sessions, metrics, a program,
 * messages, 1 waiver version, 2 packages, credits, a pending booking request.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { supabaseAdmin } = require('../src/supabase');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required seed environment variable: ${name}`);
  return value;
}

function validateSeedTarget() {
  const environment = requiredEnv('CVF_SEED_ENV').toLowerCase();
  if (!['development', 'preview'].includes(environment)) {
    throw new Error('CVF_SEED_ENV must be development or preview');
  }
  if (process.env.CVF_SEED_CONFIRM_DEVELOPMENT !== 'true') {
    throw new Error('Refusing to seed without CVF_SEED_CONFIRM_DEVELOPMENT=true');
  }

  const target = new URL(requiredEnv('SUPABASE_URL'));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const allowedHosts = new Set(
    (process.env.CVF_SEED_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!localHosts.has(target.hostname) && !allowedHosts.has(target.hostname.toLowerCase())) {
    throw new Error('Refusing unapproved Supabase target; allow its exact hostname in CVF_SEED_ALLOWED_HOSTS');
  }
  console.log(`Seed target: ${environment} (${target.hostname})`);
}

const COACHES = [
  { name: 'Marcus Rivera', email: requiredEnv('CVF_SEED_ADMIN_EMAIL'), phone: '505-555-0101', is_admin: true, password: requiredEnv('CVF_SEED_ADMIN_PASSWORD') },
  { name: 'Jordan Banks', email: requiredEnv('CVF_SEED_COACH_A_EMAIL'), phone: '505-555-0102', is_admin: false, password: requiredEnv('CVF_SEED_COACH_A_PASSWORD') },
  { name: 'Alex Trujillo', email: requiredEnv('CVF_SEED_COACH_B_EMAIL'), phone: '505-555-0103', is_admin: false, password: requiredEnv('CVF_SEED_COACH_B_PASSWORD') },
];

async function ensureAuthUser(email, password) {
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return created.user.id;
  if (String(error.message || '').toLowerCase().includes('already')) {
    // look up existing
    let page = 1;
    while (page < 20) {
      const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
      const found = (data?.users || []).find((u) => u.email === email);
      if (found) return found.id;
      if (!data?.users?.length) break;
      page++;
    }
  }
  throw error;
}

function daysFromNow(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function main() {
  validateSeedTarget();
  console.log('Seeding CVF PT...');

  // ---- Coaches ----
  const coachRows = {};
  for (const c of COACHES) {
    let { data: existing } = await supabaseAdmin.from('coaches').select('*').eq('email', c.email).maybeSingle();
    if (!existing) {
      const authId = await ensureAuthUser(c.email, c.password);
      const { data, error } = await supabaseAdmin.from('coaches').insert({
        name: c.name, email: c.email, phone: c.phone, is_admin: c.is_admin, auth_user_id: authId,
      }).select().single();
      if (error) throw error;
      existing = data;
      console.log(`  coach created: ${c.name}`);
    } else {
      console.log(`  coach exists: ${c.name}`);
    }
    coachRows[c.email] = existing;
  }
  const marcus = coachRows[COACHES[0].email];
  const jordan = coachRows[COACHES[1].email];
  const alex = coachRows[COACHES[2].email];

  // ---- Clients ----
  const CLIENTS = [
    { name: 'Sarah Martinez', email: requiredEnv('CVF_SEED_CLIENT_EMAIL'), phone: '505-555-0201', coach: marcus, goals: 'Build strength and run a 10k in spring', health_notes: 'Mild left knee tendinitis - avoid deep lunges', invited: true, claim: true, password: requiredEnv('CVF_SEED_CLIENT_PASSWORD') },
    { name: 'David Chen', email: 'david.chen@example.com', phone: '505-555-0202', coach: marcus, goals: 'Lose 20 lbs, improve energy', health_notes: 'Hypertension, cleared by physician', invited: true, claim: false },
    { name: 'Emily Romero', email: 'emily.romero@example.com', phone: '505-555-0203', coach: jordan, goals: 'Postpartum strength rebuild', health_notes: 'Diastasis recti - core progressions only', invited: false },
    { name: 'Mike Thompson', email: 'mike.thompson@example.com', phone: '505-555-0204', coach: jordan, goals: 'Back squat 315, general athleticism', health_notes: null, invited: false },
    { name: 'Lisa Nguyen', email: 'lisa.nguyen@example.com', phone: '505-555-0205', coach: alex, goals: 'Marathon training support + injury prevention', health_notes: 'History of IT band syndrome', invited: false },
    { name: 'Robert Garcia', email: null, phone: '505-555-0206', coach: alex, goals: 'Stay active in retirement, balance work', health_notes: 'Hip replacement (2022) - follow PT guidelines', invited: false },
  ];

  const clientRows = {};
  for (const c of CLIENTS) {
    let existing = null;
    if (c.email) {
      const { data } = await supabaseAdmin.from('clients').select('*').eq('email', c.email).maybeSingle();
      existing = data;
    } else {
      const { data } = await supabaseAdmin.from('clients').select('*').eq('name', c.name).eq('coach_id', c.coach.id).maybeSingle();
      existing = data;
    }
    if (!existing) {
      const { data, error } = await supabaseAdmin.from('clients').insert({
        name: c.name, email: c.email, phone: c.phone, coach_id: c.coach.id,
        goals: c.goals, health_notes: c.health_notes, invited: Boolean(c.invited),
      }).select().single();
      if (error) throw error;
      existing = data;
      console.log(`  client created: ${c.name}`);
    } else {
      console.log(`  client exists: ${c.name}`);
    }
    if (c.claim && !existing.auth_user_id) {
      const authId = await ensureAuthUser(c.email, c.password);
      await supabaseAdmin.from('clients').update({ auth_user_id: authId, invited: true }).eq('id', existing.id);
      existing.auth_user_id = authId;
      console.log(`  client claimed account: ${c.name}`);
    }
    clientRows[c.name] = existing;
  }
  const sarah = clientRows['Sarah Martinez'];

  // ---- Waiver version ----
  let { data: waiverV } = await supabaseAdmin.from('waiver_versions').select('*').order('version_number', { ascending: false }).limit(1);
  if (!waiverV || !waiverV.length) {
    const { data, error } = await supabaseAdmin.from('waiver_versions').insert({
      version_number: 1,
      full_text: `CORE VALUE FITNESS - LIABILITY WAIVER AND RELEASE OF CLAIMS (Version 1)\n\nIn consideration of being permitted to participate in personal training services provided by Core Value Fitness (\"CVF\") in Albuquerque, New Mexico, I, the undersigned, acknowledge and agree to the following:\n\n1. ASSUMPTION OF RISK. I understand that physical exercise, including but not limited to strength training, cardiovascular conditioning, and functional movement, involves inherent risks including serious injury, disability, and death. I voluntarily assume all risks associated with my participation.\n\n2. PHYSICAL CONDITION. I represent that I am in adequate physical condition to participate in a personal training program and that I have disclosed all relevant health conditions, injuries, and limitations to my coach. I have been advised to consult a physician before beginning any exercise program.\n\n3. RELEASE OF LIABILITY. To the fullest extent permitted by law, I hereby release, waive, and discharge Core Value Fitness, its owners, coaches, employees, and agents from any and all claims, demands, or causes of action arising out of or related to any loss, damage, or injury sustained while participating in training services, whether arising from negligence or otherwise.\n\n4. MEDICAL AUTHORIZATION. In the event of an emergency, I authorize CVF staff to obtain medical assistance on my behalf, and I agree to be financially responsible for any costs incurred.\n\n5. MEDIA. I understand CVF will not use my image or likeness without separate written consent.\n\n6. ENTIRE AGREEMENT. This waiver constitutes the entire agreement between the parties regarding its subject matter and may only be superseded by a newer signed version.\n\nBy signing below, I acknowledge that I have read this waiver, understand its contents, and sign it voluntarily.`,
    }).select().single();
    if (error) throw error;
    waiverV = [data];
    console.log('  waiver version 1 created');
  } else {
    console.log('  waiver version exists');
  }
  const waiver = waiverV[0];

  // David Chen has a paper waiver recorded by his coach
  const david = clientRows['David Chen'];
  const { data: davidSig } = await supabaseAdmin.from('waiver_signatures').select('id').eq('client_id', david.id).limit(1);
  if (!davidSig || !davidSig.length) {
    await supabaseAdmin.from('waiver_signatures').insert({
      client_id: david.id, waiver_version_id: waiver.id, signed_name: 'David Chen',
      entered_by: 'coach', entered_by_coach_id: marcus.id, ip_address: null,
    });
    console.log('  paper waiver recorded for David Chen');
  }

  // ---- Packages ----
  const PACKAGES = [
    { name: 'Starter Pack', description: '4 one-on-one training sessions. Perfect for getting started.', price: 260, session_credits: 4, is_recurring: false },
    { name: 'Committed Pack', description: '12 one-on-one training sessions. Best value for consistent progress.', price: 660, session_credits: 12, is_recurring: false },
  ];
  for (const p of PACKAGES) {
    const { data: existing } = await supabaseAdmin.from('packages').select('id').eq('name', p.name).maybeSingle();
    if (!existing) {
      await supabaseAdmin.from('packages').insert(p);
      console.log(`  package created: ${p.name}`);
    }
  }

  // ---- Credits for Sarah (demo client) ----
  const { data: cc } = await supabaseAdmin.from('client_credits').select('*').eq('client_id', sarah.id).maybeSingle();
  if (!cc) {
    await supabaseAdmin.from('client_credits').insert({ client_id: sarah.id, balance: 6 });
    // matching manual purchase history
    const { data: pkg } = await supabaseAdmin.from('packages').select('*').eq('name', 'Starter Pack').maybeSingle();
    if (pkg) {
      await supabaseAdmin.from('purchases').insert({
        client_id: sarah.id, package_id: pkg.id, amount: pkg.price, credits_granted: pkg.session_credits,
        method: 'manual', status: 'completed', recorded_by_coach_id: marcus.id,
      });
    }
    console.log('  credits + purchase history seeded for Sarah');
  }

  // ---- Sessions ----
  const { data: existingSessions } = await supabaseAdmin.from('sessions').select('id').limit(1);
  if (!existingSessions || !existingSessions.length) {
    const sessions = [
      // today
      { client_id: sarah.id, coach_id: marcus.id, scheduled_at: daysFromNow(0, 9, 0), duration_minutes: 60, location: 'CVF Studio - Main Floor', status: 'scheduled', credit_deducted: false },
      { client_id: david.id, coach_id: marcus.id, scheduled_at: daysFromNow(0, 11, 0), duration_minutes: 45, location: 'CVF Studio - Main Floor', status: 'scheduled', credit_deducted: false },
      { client_id: clientRows['Emily Romero'].id, coach_id: jordan.id, scheduled_at: daysFromNow(0, 15, 0), duration_minutes: 60, location: 'CVF Studio - Room B', status: 'scheduled', credit_deducted: false },
      // upcoming
      { client_id: sarah.id, coach_id: marcus.id, scheduled_at: daysFromNow(2, 9, 0), duration_minutes: 60, location: 'CVF Studio - Main Floor', status: 'scheduled', credit_deducted: false },
      { client_id: clientRows['Mike Thompson'].id, coach_id: jordan.id, scheduled_at: daysFromNow(1, 17, 30), duration_minutes: 60, location: 'CVF Studio - Rack 2', status: 'scheduled', credit_deducted: false },
      { client_id: clientRows['Lisa Nguyen'].id, coach_id: alex.id, scheduled_at: daysFromNow(3, 7, 0), duration_minutes: 45, location: 'Bosque Trail (outdoor)', status: 'scheduled', credit_deducted: false },
      // past completed
      { client_id: sarah.id, coach_id: marcus.id, scheduled_at: daysFromNow(-3, 9, 0), duration_minutes: 60, location: 'CVF Studio - Main Floor', status: 'completed', credit_deducted: true },
      { client_id: sarah.id, coach_id: marcus.id, scheduled_at: daysFromNow(-7, 9, 0), duration_minutes: 60, location: 'CVF Studio - Main Floor', status: 'completed', credit_deducted: true },
      { client_id: clientRows['Robert Garcia'].id, coach_id: alex.id, scheduled_at: daysFromNow(-2, 10, 0), duration_minutes: 45, location: 'CVF Studio - Room B', status: 'completed', credit_deducted: false },
    ];
    const { data: inserted, error } = await supabaseAdmin.from('sessions').insert(sessions).select();
    if (error) throw error;
    console.log(`  ${inserted.length} sessions created`);

    // session notes on Sarah's completed sessions
    const past = inserted.filter((s) => s.status === 'completed' && s.client_id === sarah.id);
    if (past.length) {
      await supabaseAdmin.from('session_notes').insert([
        { session_id: past[0].id, coach_id: marcus.id, content: 'Great session - squat depth improving. Knee felt fine with box squats. Next time: add tempo work.', shared_with_client: true },
        { session_id: past[0].id, coach_id: marcus.id, content: 'Private: watch hip shift on heavier sets, may need single-leg accessory block.', shared_with_client: false },
      ]);
      console.log('  session notes created');
    }
  } else {
    console.log('  sessions exist');
  }

  // ---- Progress metrics for Sarah ----
  const { data: existingMetrics } = await supabaseAdmin.from('metrics').select('id').eq('client_id', sarah.id).limit(1);
  if (!existingMetrics || !existingMetrics.length) {
    const { data: weightMetric } = await supabaseAdmin.from('metrics').insert({ client_id: sarah.id, name: 'Body Weight', unit: 'lbs', improvement_direction: 'lower' }).select().single();
    const { data: squatMetric } = await supabaseAdmin.from('metrics').insert({ client_id: sarah.id, name: 'Back Squat 1RM', unit: 'lbs', improvement_direction: 'higher' }).select().single();
    const { data: mileMetric } = await supabaseAdmin.from('metrics').insert({ client_id: sarah.id, name: 'Mile Time', unit: 'min', improvement_direction: 'lower' }).select().single();
    const today = new Date();
    const dateStr = (weeksAgo) => {
      const d = new Date(today); d.setDate(d.getDate() - weeksAgo * 7);
      return d.toISOString().slice(0, 10);
    };
    await supabaseAdmin.from('metric_entries').insert([
      { metric_id: weightMetric.id, value: 168, recorded_on: dateStr(8) },
      { metric_id: weightMetric.id, value: 165.5, recorded_on: dateStr(6) },
      { metric_id: weightMetric.id, value: 163, recorded_on: dateStr(4) },
      { metric_id: weightMetric.id, value: 161.5, recorded_on: dateStr(2) },
      { metric_id: weightMetric.id, value: 160, recorded_on: dateStr(0) },
      { metric_id: squatMetric.id, value: 135, recorded_on: dateStr(8) },
      { metric_id: squatMetric.id, value: 155, recorded_on: dateStr(4) },
      { metric_id: squatMetric.id, value: 170, recorded_on: dateStr(0), notes: 'PR! Great depth.' },
      { metric_id: mileMetric.id, value: 10.5, recorded_on: dateStr(6) },
      { metric_id: mileMetric.id, value: 9.8, recorded_on: dateStr(2) },
    ]);
    console.log('  progress metrics seeded for Sarah');
  }

  // ---- Program ----
  const { data: existingProgram } = await supabaseAdmin.from('programs').select('id').eq('name', 'Foundation Strength - Phase 1').maybeSingle();
  if (!existingProgram) {
    const { data: program, error } = await supabaseAdmin.from('programs').insert({
      coach_id: marcus.id,
      name: 'Foundation Strength - Phase 1',
      description: '4-week foundational strength block. Focus on movement quality and progressive loading. Perform 3x per week.',
    }).select().single();
    if (error) throw error;
    await supabaseAdmin.from('program_exercises').insert([
      { program_id: program.id, name: 'Box Squat', sets: '4', reps: '8', notes: 'Control the descent, pause 1s on box', video_url: 'https://www.youtube.com/watch?v=rPLZk6mWWJY', position: 0 },
      { program_id: program.id, name: 'Romanian Deadlift', sets: '3', reps: '10', notes: 'Hinge at hips, soft knees, feel the hamstrings', video_url: 'https://www.youtube.com/watch?v=2SHsk9AzdjA', position: 1 },
      { program_id: program.id, name: 'Dumbbell Bench Press', sets: '3', reps: '10-12', notes: 'Full range, elbows ~45 degrees', video_url: 'https://www.youtube.com/watch?v=VmB1G1K7v94', position: 2 },
      { program_id: program.id, name: 'Single-Arm Row', sets: '3', reps: '12 each', notes: 'Squeeze shoulder blade at top', video_url: null, position: 3 },
      { program_id: program.id, name: 'Plank', sets: '3', reps: '45 sec', notes: 'Brace core, neutral spine', video_url: null, position: 4 },
    ]);
    await supabaseAdmin.from('program_assignments').insert({
      program_id: program.id, client_id: sarah.id, notes: 'Start week of Monday. Log how the knee feels after each squat day.',
    });
    console.log('  program created + assigned to Sarah');
  }

  // ---- Messages ----
  const { data: existingMsgs } = await supabaseAdmin.from('messages').select('id').eq('client_id', sarah.id).limit(1);
  if (!existingMsgs || !existingMsgs.length) {
    await supabaseAdmin.from('messages').insert([
      { client_id: sarah.id, coach_id: marcus.id, sender_role: 'coach', content: 'Hey Sarah! Great work this week. How is the knee feeling after the box squats?', read_by_recipient: true },
      { client_id: sarah.id, coach_id: marcus.id, sender_role: 'client', content: 'Feeling good! A little tight the next morning but no pain during the workout.', read_by_recipient: true },
      { client_id: sarah.id, coach_id: marcus.id, sender_role: 'coach', content: "Perfect, that's normal adaptation. Keep up the mobility work and I'll see you Thursday at 9!", read_by_recipient: false },
    ]);
    console.log('  messages seeded');
  }

  // ---- Pending booking request from Sarah ----
  const { data: existingBooking } = await supabaseAdmin.from('booking_requests').select('id').eq('client_id', sarah.id).limit(1);
  if (!existingBooking || !existingBooking.length) {
    await supabaseAdmin.from('booking_requests').insert({
      client_id: sarah.id, coach_id: marcus.id,
      requested_time: daysFromNow(5, 10, 0), duration_minutes: 60,
      location: 'CVF Studio - Main Floor', note: 'Could we do an extra session this week? Want to work on deadlift form.',
    });
    console.log('  pending booking request seeded');
  }

  console.log('\nSeed complete.');
  console.log('Dedicated fake-data account credentials were read from the environment and were not printed.');
  process.exit(0);
}

main().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
