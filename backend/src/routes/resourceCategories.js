const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach } = require('../middleware/auth');
const { logError } = require('../utils/logger');

const router = express.Router();
router.use(requireAuth, requireCoach);

function normalizedCategoryName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function categories() {
  const { data, error } = await supabaseAdmin
    .from('resource_categories')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}

router.get('/', async (_req, res) => {
  try {
    return res.json(await categories());
  } catch (error) {
    logError('list resource categories error', error);
    return res.status(500).json({ error: 'Failed to load resource categories' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = normalizedCategoryName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Category name is required' });

    const existing = (await categories()).find(
      (category) => normalizedCategoryName(category.name).toLowerCase() === name.toLowerCase(),
    );
    if (existing) return res.json({ ...existing, reused: true });

    const { data, error } = await supabaseAdmin
      .from('resource_categories')
      .insert({ name })
      .select()
      .single();
    if (error) {
      // The migration's lower(trim(name)) unique index closes concurrent races.
      if (error.code === '23505') {
        const raced = (await categories()).find(
          (category) => normalizedCategoryName(category.name).toLowerCase() === name.toLowerCase(),
        );
        if (raced) return res.json({ ...raced, reused: true });
      }
      throw error;
    }
    return res.status(201).json({ ...data, reused: false });
  } catch (error) {
    logError('create resource category error', error);
    return res.status(500).json({ error: 'Failed to create resource category' });
  }
});

module.exports = router;
