const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
    console.error('list packages error', e);
    return res.status(500).json({ error: 'Failed to load packages' });
  }
});

// POST /api/packages (admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, session_credits, is_recurring } = req.body || {};
    if (!name || price === undefined || isNaN(Number(price))) {
      return res.status(400).json({ error: 'Name and a numeric price are required' });
    }
    const { data, error } = await supabaseAdmin.from('packages').insert({
      name: String(name).trim(),
      description: description || null,
      price: Number(price),
      session_credits: Number(session_credits) || 0,
      is_recurring: Boolean(is_recurring),
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('create package error', e);
    return res.status(500).json({ error: 'Failed to create package' });
  }
});

// PUT /api/packages/:id (admin)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const allowed = ['name', 'description', 'price', 'session_credits', 'is_recurring'];
    const updates = {};
    for (const k of allowed) if (k in (req.body || {})) updates[k] = req.body[k];
    const { data, error } = await supabaseAdmin.from('packages').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('update package error', e);
    return res.status(500).json({ error: 'Failed to update package' });
  }
});

// PATCH /api/packages/:id/archive (admin)
router.patch('/:id/archive', requireAdmin, async (req, res) => {
  try {
    const archived = req.body?.archived !== false;
    const { data, error } = await supabaseAdmin.from('packages').update({ archived }).eq('id', req.params.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive package error', e);
    return res.status(500).json({ error: 'Failed to archive package' });
  }
});

module.exports = router;
