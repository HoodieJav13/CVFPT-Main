const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');

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
      .in('metric_id', ids).eq('archived', false).order('recorded_on');
    for (const e of entries || []) {
      entriesByMetric[e.metric_id] = entriesByMetric[e.metric_id] || [];
      entriesByMetric[e.metric_id].push(e);
    }
  }
  return (metrics || []).map((m) => ({ ...m, entries: entriesByMetric[m.id] || [] }));
}

async function guardClient(req, res) {
  const { data: clientRow } = await supabaseAdmin.from('clients').select('*').eq('id', req.params.clientId).maybeSingle();
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
    console.error('get metrics error', e);
    return res.status(500).json({ error: 'Failed to load progress' });
  }
});

// POST /api/progress/clients/:clientId/metrics { name, unit }
router.post('/clients/:clientId/metrics', requireCoach, async (req, res) => {
  try {
    const clientRow = await guardClient(req, res);
    if (!clientRow) return;
    const { name, unit } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Metric name is required' });
    const { data, error } = await supabaseAdmin.from('metrics').insert({
      client_id: clientRow.id, name: String(name).trim(), unit: unit || null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json({ ...data, entries: [] });
  } catch (e) {
    console.error('create metric error', e);
    return res.status(500).json({ error: 'Failed to create metric' });
  }
});

async function guardMetric(req, res) {
  const { data: metric } = await supabaseAdmin.from('metrics').select('*, client:clients(*)').eq('id', req.params.metricId).maybeSingle();
  if (!metric || !canAccessClient(req.user, metric.client)) {
    res.status(404).json({ error: 'Metric not found' });
    return null;
  }
  return metric;
}

// POST /api/progress/metrics/:metricId/entries { value, notes, recorded_on }
router.post('/metrics/:metricId/entries', requireCoach, async (req, res) => {
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
    return res.status(201).json(data);
  } catch (e) {
    console.error('create entry error', e);
    return res.status(500).json({ error: 'Failed to log entry' });
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
    console.error('archive metric error', e);
    return res.status(500).json({ error: 'Failed to archive metric' });
  }
});

// PATCH /api/progress/entries/:entryId/archive
router.patch('/entries/:entryId/archive', requireCoach, async (req, res) => {
  try {
    const { data: entry } = await supabaseAdmin.from('metric_entries')
      .select('*, metric:metrics(*, client:clients(*))').eq('id', req.params.entryId).maybeSingle();
    if (!entry || !canAccessClient(req.user, entry.metric?.client)) return res.status(404).json({ error: 'Entry not found' });
    const { data, error } = await supabaseAdmin.from('metric_entries').update({ archived: true }).eq('id', entry.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('archive entry error', e);
    return res.status(500).json({ error: 'Failed to remove entry' });
  }
});

// GET /api/progress/mine (client)
router.get('/mine', requireClient, async (req, res) => {
  try {
    return res.json(await metricsWithEntries(req.user.client.id));
  } catch (e) {
    console.error('client metrics error', e);
    return res.status(500).json({ error: 'Failed to load your progress' });
  }
});

module.exports = router;
