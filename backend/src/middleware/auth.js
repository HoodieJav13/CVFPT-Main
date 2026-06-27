const { supabaseAdmin } = require('../supabase');

/**
 * Verifies the Supabase access token and resolves the app role.
 * Attaches req.user = { authUserId, email, role: 'admin'|'coach'|'client', coach?, client? }
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing authorization token' });

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });

    const authUserId = data.user.id;

    const { data: coach } = await supabaseAdmin
      .from('coaches')
      .select('*')
      .eq('auth_user_id', authUserId)
      .eq('archived', false)
      .maybeSingle();

    if (coach) {
      req.user = { authUserId, email: data.user.email, role: coach.is_admin ? 'admin' : 'coach', coach };
      return next();
    }

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('auth_user_id', authUserId)
      .eq('archived', false)
      .maybeSingle();

    if (client) {
      req.user = { authUserId, email: data.user.email, role: 'client', client };
      return next();
    }

    return res.status(403).json({ error: 'No profile linked to this account. Please contact your coach.' });
  } catch (e) {
    console.error('auth middleware error', e);
    return res.status(500).json({ error: 'Authentication check failed' });
  }
}

function requireCoach(req, res, next) {
  if (req.user?.role === 'coach' || req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Coach access required' });
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

function requireClient(req, res, next) {
  if (req.user?.role === 'client') return next();
  return res.status(403).json({ error: 'Client access required' });
}

/** True if this coach/admin user may access the given client row. */
function canAccessClient(user, clientRow) {
  if (!clientRow) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'coach') return clientRow.coach_id === user.coach.id;
  return false;
}

module.exports = { requireAuth, requireCoach, requireAdmin, requireClient, canAccessClient };
