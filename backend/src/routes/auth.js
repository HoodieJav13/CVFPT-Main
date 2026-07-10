const express = require('express');
const { supabaseAdmin, anonClient } = require('../supabase');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, refreshLimiter, signupLimiter } = require('../middleware/rateLimits');

const router = express.Router();

async function resolveProfile(authUserId) {
  const { data: coach } = await supabaseAdmin
    .from('coaches').select('*').eq('auth_user_id', authUserId).eq('archived', false).maybeSingle();
  if (coach) return { role: coach.is_admin ? 'admin' : 'coach', profile: coach };
  const { data: client } = await supabaseAdmin
    .from('clients').select('*').eq('auth_user_id', authUserId).eq('archived', false).maybeSingle();
  if (client) return { role: 'client', profile: client };
  return null;
}

// POST /api/auth/login { email, password }
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const sb = anonClient();
    const { data, error } = await sb.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password });
    if (error) return res.status(401).json({ error: 'Invalid email or password' });

    const resolved = await resolveProfile(data.user.id);
    if (!resolved) return res.status(403).json({ error: 'No profile linked to this account. Please contact your coach.' });

    return res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      role: resolved.role,
      profile: resolved.profile,
    });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/signup { email, password }
// Invitation-only claim flow: email must match an invited, unclaimed, non-archived client profile.
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const normalized = String(email).trim().toLowerCase();

    const { data: matches, error: findErr } = await supabaseAdmin
      .from('clients')
      .select('*')
      .ilike('email', normalized)
      .eq('invited', true)
      .is('auth_user_id', null)
      .eq('archived', false);

    if (findErr) throw findErr;
    const clientRow = (matches || [])[0];
    if (!clientRow) {
      return res.status(403).json({
        error: "We couldn't find an invitation for this email. Please contact your coach to get set up.",
      });
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: true,
    });
    if (createErr) {
      if (String(createErr.message || '').toLowerCase().includes('already')) {
        return res.status(409).json({ error: 'An account with this email already exists. Try logging in instead.' });
      }
      throw createErr;
    }

    const { error: linkErr } = await supabaseAdmin
      .from('clients')
      .update({ auth_user_id: created.user.id, updated_at: new Date().toISOString() })
      .eq('id', clientRow.id);
    if (linkErr) {
      // Roll back the orphaned auth user so signup can be retried cleanly.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw linkErr;
    }

    const sb = anonClient();
    const { data: signin, error: signinErr } = await sb.auth.signInWithPassword({ email: normalized, password });
    if (signinErr) throw signinErr;

    const { data: freshClient } = await supabaseAdmin.from('clients').select('*').eq('id', clientRow.id).single();

    return res.status(201).json({
      access_token: signin.session.access_token,
      refresh_token: signin.session.refresh_token,
      expires_at: signin.session.expires_at,
      role: 'client',
      profile: freshClient,
    });
  } catch (e) {
    console.error('signup error', e);
    return res.status(500).json({ error: 'Signup failed. Please try again or contact your coach.' });
  }
});

// POST /api/auth/refresh { refresh_token }
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });
    const sb = anonClient();
    const { data, error } = await sb.auth.refreshSession({ refresh_token });
    if (error || !data?.session) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    return res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  } catch (e) {
    console.error('refresh error', e);
    return res.status(500).json({ error: 'Token refresh failed' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { role, coach, client, email, authUserId } = req.user;
  return res.json({ role, email, auth_user_id: authUserId, profile: coach || client });
});

module.exports = router;
