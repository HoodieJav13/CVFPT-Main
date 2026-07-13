const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validatePackagePayload } = require('../validation/business');

const router = express.Router();
router.use(requireAuth);

// GET /api/packages (any authenticated user)
router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin.from('packages').select('*').order('price');
    if (req.query.include_archived === 'true' && req.user.role === 'admin') {
      // admin can see archived
    } else {
      q = q.eq('archived', false);
    }
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('list packages error', e);
    return res.status(500).json({ error: 'Failed to load packages' });
  }
});

// POST /api/packages (admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const validation = validatePackagePayload(req.body || {});
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const { data, error } = await supabaseAdmin.from('packages').insert(validation.value).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('create package error', e);
    return res.status(500).json({ error: 'Failed to create package' });
  }
});

// PUT /api/packages/:id (admin)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const validation = validatePackagePayload(req.body || {}, { partial: true });
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const { data, error } = await supabaseAdmin.from('packages').update(validation.value)
      .eq('id', req.params.id).eq('archived', false).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Package not found' });
    return res.json(data);
  } catch (e) {
    logError('update package error', e);
    return res.status(500).json({ error: 'Failed to update package' });
  }
});

// PATCH /api/packages/:id/archive (admin)
router.patch('/:id/archive', requireAdmin, async (req, res) => {
  try {
    const archived = req.body?.archived !== false;
    const { data, error } = await supabaseAdmin.from('packages').update({ archived })
      .eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Package not found' });
    return res.json(data);
  } catch (e) {
    logError('archive package error', e);
    return res.status(500).json({ error: 'Failed to archive package' });
  }
});

module.exports = router;
