const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');
const {
  IMPROVEMENT_DIRECTIONS,
  normalizeImprovementDirection,
  personalBestResult,
  metricProgressSummary,
} = require('../lib/progress');

const router = express.Router();
router.use(requireAuth);

async function metricsWithEntries(clientId) {
  const { data: metrics, error } = await supabaseAdmin.from('metrics').select('*')
    .eq('client_id', clientId).eq('archived', false).order('created_at');
  if (error) throw error;
  const ids = (metrics || []).map((m) => m.id);
  let entriesByMetric = {};
  if (ids.length) {
    const { data: entries } = await supabaseAdmin.from('metric_entries').select('*')
      .in('metric_id', ids).eq('archived', false)
      .order('recorded_on').order('created_at');
    for (const e of entries || []) {
      entriesByMetric[e.metric_id] = entriesByMetric[e.metric_id] || [];
      entriesByMetric[e.metric_id].push(e);
    }
  }
  return (metrics || []).map((m) => metricProgressSummary(m, entriesByMetric[m.id] || []));
}

async function guardClient(req, res) {
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
    .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
  if (!clientRow || !canAccessClient(req.user, clientRow)) {
    res.status(404).json({ error: 'Client not found' });
    return null;
  }
  return clientRow;
}

// GET /api/progress/clients/:clientId/metrics (coach)
router.get('/clients/:clientId/metrics', requireCoach, async (req, res) => {
  try {
    const clientRow = await guardClient(req, res);
    if (!clientRow) return;
    return res.json(await metricsWithEntries(clientRow.id));
  } catch (e) {
    logError('get metrics error', e);
    return res.status(500).json({ error: 'Failed to load progress' });
  }
});

// POST /api/progress/clients/:clientId/metrics { name, unit, improvement_direction }
router.post('/clients/:clientId/metrics', requireCoach, async (req, res) => {
  try {
    const clientRow = await guardClient(req, res);
    if (!clientRow) return;
    const { name, unit, improvement_direction = 'neutral' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Metric name is required' });
    if (!IMPROVEMENT_DIRECTIONS.has(improvement_direction)) {
      return res.status(400).json({ error: 'Choose whether higher, lower, or neither direction represents improvement' });
    }
    const { data, error } = await supabaseAdmin.from('metrics').insert({
      client_id: clientRow.id,
      name: String(name).trim(),
      unit: unit || null,
      improvement_direction,
    }).select().single();
    if (error) throw error;
    return res.status(201).json({ ...data, entries: [] });
  } catch (e) {
    logError('create metric error', e);
    return res.status(500).json({ error: 'Failed to create metric' });
  }
});

async function guardMetric(req, res) {
  const { data: metric } = await supabaseAdmin.from('metrics').select('*, client:clients(*)')
    .eq('id', req.params.metricId).eq('archived', false).maybeSingle();
  const clientOwnsMetric = req.user.role === 'client' && metric?.client_id === req.user.client.id;
  if (!metric || metric.client?.archived || (!clientOwnsMetric && !canAccessClient(req.user, metric.client))) {
    res.status(404).json({ error: 'Metric not found' });
    return null;
  }
  return metric;
}

// PATCH /api/progress/metrics/:metricId { name?, unit?, improvement_direction? }
router.patch('/metrics/:metricId', requireCoach, async (req, res) => {
  try {
    const metric = await guardMetric(req, res);
    if (!metric) return;

    const updates = {};
    if ('name' in (req.body || {})) {
      if (!String(req.body.name || '').trim()) return res.status(400).json({ error: 'Metric name is required' });
      updates.name = String(req.body.name).trim();
    }
    if ('unit' in (req.body || {})) updates.unit = req.body.unit || null;
    if ('improvement_direction' in (req.body || {})) {
      if (!IMPROVEMENT_DIRECTIONS.has(req.body.improvement_direction)) {
        return res.status(400).json({ error: 'Choose whether higher, lower, or neither direction represents improvement' });
      }
      updates.improvement_direction = req.body.improvement_direction;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No metric changes provided' });

    const { data, error } = await supabaseAdmin.from('metrics')
      .update(updates).eq('id', metric.id).select().single();
    if (error) throw error;
    return res.json({ ...data, improvement_direction: normalizeImprovementDirection(data.improvement_direction) });
  } catch (e) {
    logError('update metric error', e);
    return res.status(500).json({ error: 'Failed to update metric' });
  }
});

// POST /api/progress/metrics/:metricId/entries { value, notes, recorded_on }
router.post('/metrics/:metricId/entries', async (req, res) => {
  try {
    const metric = await guardMetric(req, res);
    if (!metric) return;
    const { value, notes, recorded_on } = req.body || {};
    if (value === undefined || value === null || value === '' || isNaN(Number(value))) {
      return res.status(400).json({ error: 'A numeric value is required' });
    }
    const { data, error } = await supabaseAdmin.from('metric_entries').insert({
      metric_id: metric.id,
      value: Number(value),
      notes: notes || null,
      recorded_on: recorded_on || new Date().toISOString().slice(0, 10),
    }).select().single();
    if (error) throw error;
    const { data: comparisonEntries, error: comparisonError } = await supabaseAdmin
      .from('metric_entries').select('*')
      .eq('metric_id', metric.id).eq('archived', false).neq('id', data.id);
    if (comparisonError) throw comparisonError;
    const result = personalBestResult(
      comparisonEntries || [],
      metric.improvement_direction,
      data.value,
    );
    return res.status(201).json({
      ...data,
      is_personal_best: result.isPersonalBest,
      previous_best_value: result.previousBestValue,
      improvement_amount: result.improvementAmount,
    });
  } catch (e) {
    logError('create entry error', e);
    return res.status(500).json({ error: 'Failed to log entry' });
  }
});

// PUT /api/progress/entries/:entryId { value, notes, recorded_on }
router.put('/entries/:entryId', async (req, res) => {
  try {
    const { data: entry } = await supabaseAdmin.from('metric_entries')
      .select('*, metric:metrics(*, client:clients(*))').eq('id', req.params.entryId).eq('archived', false).maybeSingle();
    const clientOwnsEntry = req.user.role === 'client' && entry?.metric?.client_id === req.user.client.id;
    if (!entry || entry.metric?.archived || (!clientOwnsEntry && !canAccessClient(req.user, entry.metric?.client))) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    const updates = {};
    if ('value' in (req.body || {})) {
      const { value } = req.body;
      if (value === undefined || value === null || value === '' || isNaN(Number(value))) {
        return res.status(400).json({ error: 'A numeric value is required' });
      }
      updates.value = Number(value);
    }
    if ('notes' in (req.body || {})) updates.notes = req.body.notes || null;
    if ('recorded_on' in (req.body || {})) updates.recorded_on = req.body.recorded_on || new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin.from('metric_entries').update(updates).eq('id', entry.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('update entry error', e);
    return res.status(500).json({ error: 'Failed to update entry' });
  }
});

// PATCH /api/progress/metrics/:metricId/archive
router.patch('/metrics/:metricId/archive', requireCoach, async (req, res) => {
  try {
    const metric = await guardMetric(req, res);
    if (!metric) return;
    const { data, error } = await supabaseAdmin.from('metrics').update({ archived: true }).eq('id', metric.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive metric error', e);
    return res.status(500).json({ error: 'Failed to archive metric' });
  }
});

// PATCH /api/progress/entries/:entryId/archive
router.patch('/entries/:entryId/archive', requireCoach, async (req, res) => {
  try {
    const { data: entry } = await supabaseAdmin.from('metric_entries')
      .select('*, metric:metrics(*, client:clients(*))')
      .eq('id', req.params.entryId).eq('archived', false).maybeSingle();
    if (!entry || entry.metric?.archived || entry.metric?.client?.archived || !canAccessClient(req.user, entry.metric?.client)) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    const { data, error } = await supabaseAdmin.from('metric_entries').update({ archived: true }).eq('id', entry.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive entry error', e);
    return res.status(500).json({ error: 'Failed to remove entry' });
  }
});

// GET /api/progress/mine (client)
router.get('/mine', requireClient, async (req, res) => {
  try {
    return res.json(await metricsWithEntries(req.user.client.id));
  } catch (e) {
    logError('client metrics error', e);
    return res.status(500).json({ error: 'Failed to load your progress' });
  }
});

module.exports = router;
