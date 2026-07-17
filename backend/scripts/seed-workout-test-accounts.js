/**
 * Idempotently provisions the four dedicated fake accounts used by hosted
 * workout verification. Run only with an ignored preview environment file.
 */
const { supabaseAdmin } = require('../src/supabase');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required account seed environment variable: ${name}`);
  return value;
}

function validateTarget() {
  if (required('CVF_TEST_ENV').toLowerCase() !== 'preview') {
    throw new Error('Workout account seeding is restricted to CVF_TEST_ENV=preview');
  }
  if (process.env.CVF_TEST_ALLOW_MUTATIONS !== 'true') {
    throw new Error('Refusing to seed without CVF_TEST_ALLOW_MUTATIONS=true');
  }
  const target = new URL(required('SUPABASE_URL'));
  if (target.protocol !== 'https:') throw new Error('Hosted account seeding requires an HTTPS Supabase URL');
  const allowed = new Set(
    required('CVF_TEST_SUPABASE_ALLOWED_HOSTS')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowed.has(target.hostname.toLowerCase())) {
    throw new Error('Refusing unapproved Supabase target');
  }
  console.log(`Account seed target: preview (${target.hostname})`);
}

function account(role, name, emailName, passwordName, isAdmin = false) {
  const email = required(emailName).toLowerCase();
  const password = required(passwordName);
  if (!email.startsWith('cvfpt.test.') || !email.endsWith('@example.com')) {
    throw new Error(`${emailName} must identify a dedicated cvfpt.test.*@example.com account`);
  }
  if (password.length < 12) throw new Error(`${passwordName} must be at least 12 characters`);
  return { role, name, email, password, isAdmin };
}

async function findAuthUser(email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = (data?.users || []).find((row) => row.email?.toLowerCase() === email);
    if (user) return user;
    if ((data?.users || []).length < 100) return null;
  }
  throw new Error(`Could not finish auth lookup for ${email}`);
}

async function ensureAuthUser({ email, password }) {
  let user = await findAuthUser(email);
  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  return user;
}

async function ensureCoach(profile, authUser) {
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('coaches')
    .select('*')
    .eq('email', profile.email)
    .maybeSingle();
  if (loadError) throw loadError;
  const values = {
    auth_user_id: authUser.id,
    name: profile.name,
    email: profile.email,
    is_admin: profile.isAdmin,
    archived: false,
  };
  const query = existing
    ? supabaseAdmin.from('coaches').update(values).eq('id', existing.id)
    : supabaseAdmin.from('coaches').insert(values);
  const { data, error } = await query.select().single();
  if (error) throw error;
  console.log(`${existing ? 'RESET' : 'CREATE'} ${profile.role}: ${profile.email} (${data.id})`);
  return data;
}

async function ensureClient(profile, authUser, coach) {
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('email', profile.email)
    .maybeSingle();
  if (loadError) throw loadError;
  const values = {
    auth_user_id: authUser.id,
    coach_id: coach.id,
    name: profile.name,
    email: profile.email,
    invited: true,
    archived: false,
  };
  const query = existing
    ? supabaseAdmin.from('clients').update(values).eq('id', existing.id)
    : supabaseAdmin.from('clients').insert(values);
  const { data, error } = await query.select().single();
  if (error) throw error;

  const { data: credits, error: creditLoadError } = await supabaseAdmin
    .from('client_credits')
    .select('id')
    .eq('client_id', data.id)
    .maybeSingle();
  if (creditLoadError) throw creditLoadError;
  if (!credits) {
    const { error: creditError } = await supabaseAdmin.from('client_credits').insert({ client_id: data.id, balance: 0 });
    if (creditError) throw creditError;
  }
  console.log(`${existing ? 'RESET' : 'CREATE'} ${profile.role}: ${profile.email} (${data.id}), coach ${coach.id}`);
  return data;
}

async function main() {
  validateTarget();
  const profiles = {
    admin: account('admin', 'CVF Test Admin', 'CVF_TEST_ADMIN_EMAIL', 'CVF_TEST_ADMIN_PASSWORD', true),
    coachA: account('coach A', 'CVF Test Coach A', 'CVF_TEST_COACH_A_EMAIL', 'CVF_TEST_COACH_A_PASSWORD'),
    coachB: account('coach B', 'CVF Test Coach B', 'CVF_TEST_COACH_B_EMAIL', 'CVF_TEST_COACH_B_PASSWORD'),
    client: account('client', 'CVF Test Client', 'CVF_TEST_CLIENT_EMAIL', 'CVF_TEST_CLIENT_PASSWORD'),
  };
  if (new Set(Object.values(profiles).map((profile) => profile.email)).size !== 4) {
    throw new Error('All four fake account emails must be distinct');
  }

  const authUsers = {};
  for (const [key, profile] of Object.entries(profiles)) authUsers[key] = await ensureAuthUser(profile);
  await ensureCoach(profiles.admin, authUsers.admin);
  const coachA = await ensureCoach(profiles.coachA, authUsers.coachA);
  await ensureCoach(profiles.coachB, authUsers.coachB);
  await ensureClient(profiles.client, authUsers.client, coachA);
  console.log('Hosted workout test accounts are ready.');
}

main().catch((error) => {
  console.error(`Account seed failed: ${error.message}`);
  process.exitCode = 1;
});
