const express = require('express');
const { supabaseAdmin, anonClient } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const {
  changePasswordLimiter, forgotPasswordLimiter, loginLimiter,
  refreshLimiter, resetPasswordLimiter, signupLimiter,
} = require('../middleware/rateLimits');
const { linkInvitedClient } = require('../services/clientClaims');
const { escapeLikePattern } = require('../utils/like');
const { configured } = require('../services/email');
const { sendPasswordResetEmail } = require('../services/accountRecovery');

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
    logError('login error', e);
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
      .ilike('email', escapeLikePattern(normalized))
      .eq('invited', true)
      .is('auth_user_id', null)
      .eq('archived', false)
      .order('created_at', { ascending: true })
      .limit(2);

    if (findErr) throw findErr;
    if ((matches || []).length > 1) {
      return res.status(409).json({ error: 'More than one invitation uses this email. Please contact your coach.' });
    }
    const clientRow = matches?.[0];
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

    const { data: linkedClient, error: linkErr } = await linkInvitedClient(supabaseAdmin, {
      clientId: clientRow.id,
      authUserId: created.user.id,
      updatedAt: new Date().toISOString(),
    });
    if (linkErr || !linkedClient) {
      // Roll back the orphaned auth user so signup can be retried cleanly.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (!linkErr) return res.status(409).json({ error: 'This invitation was already claimed. Try logging in instead.' });
      throw linkErr;
    }

    const sb = anonClient();
    const { data: signin, error: signinErr } = await sb.auth.signInWithPassword({ email: normalized, password });
    if (signinErr) throw signinErr;

    return res.status(201).json({
      access_token: signin.session.access_token,
      refresh_token: signin.session.refresh_token,
      expires_at: signin.session.expires_at,
      role: 'client',
      profile: linkedClient,
    });
  } catch (e) {
    logError('signup error', e);
    return res.status(500).json({ error: 'Signup failed. Please try again or contact your coach.' });
  }
});

// POST /api/auth/forgot-password { email }
// Known and unknown emails both answer 200 — the response never reveals
// whether an account exists. 503/502 reflect server config/provider state.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!configured()) {
      return res.status(503).json({ error: 'Email delivery is not set up yet. Please contact your coach directly.' });
    }
    const normalized = String(email).trim().toLowerCase();
    const pattern = escapeLikePattern(normalized);

    const { data: coach, error: coachErr } = await supabaseAdmin
      .from('coaches').select('id, name, email')
      .ilike('email', pattern).eq('archived', false).maybeSingle();
    if (coachErr) throw coachErr;
    let person = coach;
    if (!person) {
      const { data: client, error: clientErr } = await supabaseAdmin
        .from('clients').select('id, name, email, auth_user_id')
        .ilike('email', pattern).eq('archived', false)
        .not('auth_user_id', 'is', null).maybeSingle();
      if (clientErr) throw clientErr;
      person = client;
    }

    if (person) {
      try {
        await sendPasswordResetEmail({ email: normalized, name: person.name });
      } catch (sendErr) {
        logError('password reset send error', sendErr);
        return res.status(502).json({ error: 'Could not send the email right now. Please try again shortly.' });
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    logError('forgot password error', e);
    return res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
});

// POST /api/auth/reset-password { token, password }
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const sb = anonClient();
    const { data, error } = await sb.auth.verifyOtp({ type: 'recovery', token_hash: String(token) });
    if (error || !data?.user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password });
    if (updateErr) throw updateErr;
    return res.json({ ok: true });
  } catch (e) {
    logError('reset password error', e);
    return res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
});

// POST /api/auth/change-password { current_password, new_password }
router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const sb = anonClient();
    const { error: verifyErr } = await sb.auth.signInWithPassword({
      email: req.user.email,
      password: current_password,
    });
    if (verifyErr) return res.status(401).json({ error: 'Current password is incorrect' });

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(req.user.authUserId, { password: new_password });
    if (updateErr) throw updateErr;
    return res.json({ ok: true });
  } catch (e) {
    logError('change password error', e);
    return res.status(500).json({ error: 'Could not change the password. Please try again.' });
  }
});

// POST /api/auth/refresh { refresh_token }
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required' });
    const sb = anonClient();
    const { data, error } = await sb.auth.refreshSession({ refresh_token });
    if (error || !data?.session || !data?.user) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    const resolved = await resolveProfile(data.user.id);
    if (!resolved) {
      await sb.auth.signOut({ scope: 'local' });
      return res.status(403).json({ error: 'No active profile is linked to this account. Please contact your coach.' });
    }
    return res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  } catch (e) {
    logError('refresh error', e);
    return res.status(500).json({ error: 'Token refresh failed' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { role, coach, client, email, authUserId } = req.user;
  return res.json({ role, email, auth_user_id: authUserId, profile: coach || client });
});

module.exports = router;
