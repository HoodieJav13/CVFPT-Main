const express = require('express');
const { supabaseAdmin } = require('../supabase');
const { requireAuth, requireCoach, requireAdmin, requireClient, canAccessClient } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

async function latestVersion() {
  const { data } = await supabaseAdmin.from('waiver_versions').select('*')
    .order('version_number', { ascending: false }).limit(1);
  return data?.[0] || null;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || null;
}

// GET /api/waivers/latest
router.get('/latest', async (_req, res) => {
  try {
    const v = await latestVersion();
    if (!v) return res.status(404).json({ error: 'No waiver version exists yet' });
    return res.json(v);
  } catch (e) {
    console.error('latest waiver error', e);
    return res.status(500).json({ error: 'Failed to load waiver' });
  }
});

// GET /api/waivers/versions (admin)
router.get('/versions', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('waiver_versions').select('*')
      .order('version_number', { ascending: false });
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    console.error('versions error', e);
    return res.status(500).json({ error: 'Failed to load waiver versions' });
  }
});

// POST /api/waivers/versions (admin) { full_text } - APPEND ONLY
router.post('/versions', requireAdmin, async (req, res) => {
  try {
    const fullText = (req.body?.full_text || '').trim();
    if (!fullText) return res.status(400).json({ error: 'Waiver text is required' });
    const current = await latestVersion();
    const { data, error } = await supabaseAdmin.from('waiver_versions').insert({
      version_number: (current?.version_number || 0) + 1,
      full_text: fullText,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('create version error', e);
    return res.status(500).json({ error: 'Failed to create waiver version' });
  }
});

async function signatureStatus(clientId) {
  const latest = await latestVersion();
  const { data: signatures } = await supabaseAdmin.from('waiver_signatures')
    .select('*, version:waiver_versions(id, version_number)')
    .eq('client_id', clientId).order('signed_at', { ascending: false });
  const signedLatest = Boolean(latest && (signatures || []).some((s) => s.waiver_version_id === latest.id));
  return { latest_version: latest, signatures: signatures || [], signed_latest: signedLatest };
}

// GET /api/waivers/client/:clientId/status (coach)
router.get('/client/:clientId/status', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    return res.json(await signatureStatus(clientRow.id));
  } catch (e) {
    console.error('waiver status error', e);
    return res.status(500).json({ error: 'Failed to load waiver status' });
  }
});

// POST /api/waivers/client/:clientId/sign-paper (coach records a paper waiver)
router.post('/client/:clientId/sign-paper', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const latest = await latestVersion();
    if (!latest) return res.status(400).json({ error: 'No waiver version exists yet' });
    const signedName = (req.body?.signed_name || clientRow.name).trim();
    const { data, error } = await supabaseAdmin.from('waiver_signatures').insert({
      client_id: clientRow.id,
      waiver_version_id: latest.id,
      signed_name: signedName,
      ip_address: clientIp(req),
      entered_by: 'coach',
      entered_by_coach_id: req.user.coach.id,
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('sign paper error', e);
    if (e.code === '23505') return res.status(409).json({ error: 'The current waiver is already signed for this client' });
    return res.status(500).json({ error: 'Failed to record signature' });
  }
});

// GET /api/waivers/my-status (client)
router.get('/my-status', requireClient, async (req, res) => {
  try {
    return res.json(await signatureStatus(req.user.client.id));
  } catch (e) {
    console.error('my waiver status error', e);
    return res.status(500).json({ error: 'Failed to load your waiver status' });
  }
});

// POST /api/waivers/sign (client) { signed_name }
router.post('/sign', requireClient, async (req, res) => {
  try {
    const latest = await latestVersion();
    if (!latest) return res.status(400).json({ error: 'No waiver available to sign yet' });
    const signedName = (req.body?.signed_name || '').trim();
    if (!signedName) return res.status(400).json({ error: 'Please type your full legal name to sign' });
    const { signatures } = await signatureStatus(req.user.client.id);
    if (signatures.some((s) => s.waiver_version_id === latest.id)) {
      return res.status(409).json({ error: 'You have already signed the current waiver' });
    }
    const { data, error } = await supabaseAdmin.from('waiver_signatures').insert({
      client_id: req.user.client.id,
      waiver_version_id: latest.id,
      signed_name: signedName,
      ip_address: clientIp(req),
      entered_by: 'client',
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error('sign waiver error', e);
    if (e.code === '23505') return res.status(409).json({ error: 'You have already signed the current waiver' });
    return res.status(500).json({ error: 'Failed to sign waiver' });
  }
});

module.exports = router;
