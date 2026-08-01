const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth } = require('../middleware/auth');
const { logError } = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

function ownTarget(user) {
  if (user.role === 'client') return { table: 'clients', id: user.client.id };
  return { table: 'coaches', id: user.coach.id };
}

router.get('/', async (req, res) => {
  try {
    const target = ownTarget(req.user);
    const { data, error } = await supabaseAdmin.from(target.table)
      .select('digest_opt_out').eq('id', target.id).eq('archived', false).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Account not found' });
    return res.json({ digest_opt_out: Boolean(data.digest_opt_out) });
  } catch (error) {
    logError('email preferences read error', error);
    return res.status(500).json({ error: 'Failed to load email preferences' });
  }
});

router.patch('/', async (req, res) => {
  if (typeof req.body?.digest_opt_out !== 'boolean') {
    return res.status(400).json({ error: 'digest_opt_out must be true or false' });
  }
  try {
    const target = ownTarget(req.user);
    const { data, error } = await supabaseAdmin.from(target.table)
      .update({ digest_opt_out: req.body.digest_opt_out })
      .eq('id', target.id).eq('archived', false).select('digest_opt_out').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Account not found' });
    return res.json({ digest_opt_out: Boolean(data.digest_opt_out) });
  } catch (error) {
    logError('email preferences update error', error);
    return res.status(500).json({ error: 'Failed to save email preferences' });
  }
});

module.exports = router;
