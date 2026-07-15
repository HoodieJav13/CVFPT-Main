const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { supabaseAdmin } = require('../supabase');
const {
  requireAuth,
  requireCoach,
  canAccessClient,
} = require('../middleware/auth');
const { resourceUploadLimiter } = require('../middleware/rateLimits');
const { logError } = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

const RESOURCE_BUCKET = 'resource-library';
const RESOURCE_SIGNED_URL_SECONDS = 60;
const RESOURCE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_FIELDS = [
  'id',
  'title',
  'description',
  'category_id',
  'file_name',
  'file_size_bytes',
  'is_public',
  'archived',
  'uploaded_by_coach_id',
  'created_at',
].join(',');
const COACH_RESOURCE_SELECT = `${RESOURCE_FIELDS},category:resource_categories(id,name),uploader:coaches!uploaded_by_coach_id(id,name),assignments:resource_assignments(id,client_id,active,assigned_at,client:clients(id,name,archived))`;
const CLIENT_RESOURCE_SELECT = `${RESOURCE_FIELDS},category:resource_categories(id,name)`;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RESOURCE_MAX_FILE_BYTES, files: 1 },
});

function resourceUpload(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Resource PDFs must be 10 MB or smaller.' });
    }
    logError('resource upload middleware error', error);
    return res.status(400).json({ error: 'Could not read the uploaded resource.' });
  });
}

function isPdfFile(file) {
  if (!file || file.mimetype !== 'application/pdf' || !Buffer.isBuffer(file.buffer)) return false;
  return file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));
}

function booleanValue(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

function safeOriginalFilename(value) {
  const base = String(value || 'resource.pdf').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-z0-9._ -]+/gi, '').trim().slice(0, 180);
  return cleaned || 'resource.pdf';
}

async function categoryExists(categoryId) {
  if (!categoryId) return true;
  if (!isUuid(categoryId)) return false;
  const { data, error } = await supabaseAdmin
    .from('resource_categories')
    .select('id')
    .eq('id', categoryId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function resourceRow(resourceId, { includeArchived = false, includeStoragePath = false } = {}) {
  if (!isUuid(resourceId)) return null;
  const fields = includeStoragePath ? `${RESOURCE_FIELDS},storage_path` : RESOURCE_FIELDS;
  let query = supabaseAdmin.from('resource_library').select(fields).eq('id', resourceId);
  if (!includeArchived) query = query.eq('archived', false);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function coachResource(resourceId, { includeArchived = false } = {}) {
  if (!isUuid(resourceId)) return null;
  let query = supabaseAdmin.from('resource_library').select(COACH_RESOURCE_SELECT).eq('id', resourceId);
  if (!includeArchived) query = query.eq('archived', false);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function clientCanAccessResource(resource, clientId) {
  if (!resource) return false;
  if (!resource.archived && resource.is_public) return true;
  const { data, error } = await supabaseAdmin
    .from('resource_assignments')
    .select('id')
    .eq('resource_id', resource.id)
    .eq('client_id', clientId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function manageableClient(user, clientId) {
  if (!isUuid(clientId)) return null;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('archived', false)
    .maybeSingle();
  if (error) throw error;
  return data && canAccessClient(user, data) ? data : null;
}

router.get('/', async (req, res) => {
  try {
    const categoryId = cleanText(req.query.category_id);
    if (categoryId && !isUuid(categoryId)) {
      return res.status(400).json({ error: 'Choose a valid resource category' });
    }

    if (req.user.role === 'client') {
      const { data: assignments, error: assignmentError } = await supabaseAdmin
        .from('resource_assignments')
        .select('resource_id')
        .eq('client_id', req.user.client.id)
        .eq('active', true);
      if (assignmentError) throw assignmentError;
      const assignedIds = [...new Set((assignments || []).map((row) => row.resource_id).filter(isUuid))];
      let query = supabaseAdmin
        .from('resource_library')
        .select(CLIENT_RESOURCE_SELECT)
        .order('created_at', { ascending: false });
      if (assignedIds.length) {
        query = query.or(`and(archived.eq.false,is_public.eq.true),id.in.(${assignedIds.join(',')})`);
      } else {
        query = query.eq('archived', false).eq('is_public', true);
      }
      if (categoryId) query = query.eq('category_id', categoryId);
      const { data, error } = await query;
      if (error) throw error;
      return res.json(data || []);
    }

    let query = supabaseAdmin
      .from('resource_library')
      .select(COACH_RESOURCE_SELECT)
      .eq('archived', false)
      .order('created_at', { ascending: false });
    if (categoryId) query = query.eq('category_id', categoryId);
    if (req.query.q) query = query.ilike('title', `%${String(req.query.q).slice(0, 120)}%`);
    const { data, error } = await query;
    if (error) throw error;
    return res.json((data || []).map((resource) => ({
      ...resource,
      assignments: (resource.assignments || []).filter(
        (assignment) => assignment.active && !assignment.client?.archived,
      ),
    })));
  } catch (error) {
    logError('list resources error', error);
    return res.status(500).json({ error: 'Failed to load resources' });
  }
});

router.post('/', requireCoach, resourceUploadLimiter, resourceUpload, async (req, res) => {
  let uploadedPath = null;
  try {
    const title = cleanText(req.body?.title);
    const categoryId = cleanText(req.body?.category_id);
    if (!title) return res.status(400).json({ error: 'Resource title is required' });
    if (!isPdfFile(req.file)) return res.status(400).json({ error: 'Upload a valid PDF file.' });
    if (!await categoryExists(categoryId)) {
      return res.status(400).json({ error: 'Choose a valid resource category' });
    }

    const resourceId = crypto.randomUUID();
    const fileName = safeOriginalFilename(req.file.originalname);
    uploadedPath = `${resourceId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(RESOURCE_BUCKET)
      .upload(uploadedPath, req.file.buffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('resource_library')
      .insert({
        id: resourceId,
        title,
        description: cleanText(req.body?.description),
        category_id: categoryId,
        storage_path: uploadedPath,
        file_name: fileName,
        file_size_bytes: req.file.size,
        is_public: booleanValue(req.body?.is_public),
        uploaded_by_coach_id: req.user.coach.id,
      })
      .select(RESOURCE_FIELDS)
      .single();
    if (insertError) throw insertError;
    uploadedPath = null;
    return res.status(201).json({ ...inserted, category: null, assignments: [] });
  } catch (error) {
    if (uploadedPath) {
      try {
        const { error: cleanupError } = await supabaseAdmin.storage
          .from(RESOURCE_BUCKET)
          .remove([uploadedPath]);
        if (cleanupError) logError('resource orphan cleanup error', cleanupError);
      } catch (cleanupError) {
        logError('resource orphan cleanup error', cleanupError);
      }
    }
    logError('upload resource error', error);
    return res.status(500).json({ error: 'Failed to upload resource' });
  }
});

router.get('/:id/download-link', async (req, res) => {
  try {
    const resource = await resourceRow(req.params.id, {
      includeArchived: req.user.role === 'client',
      includeStoragePath: true,
    });
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    if (req.user.role === 'client' && !await clientCanAccessResource(resource, req.user.client.id)) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    const { data, error } = await supabaseAdmin.storage
      .from(RESOURCE_BUCKET)
      .createSignedUrl(resource.storage_path, RESOURCE_SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) throw error || new Error('Signed URL missing');
    return res.json({
      signed_url: data.signedUrl,
      expires_in: RESOURCE_SIGNED_URL_SECONDS,
      file_name: resource.file_name,
    });
  } catch (error) {
    logError('resource download link error', error);
    return res.status(500).json({ error: 'Failed to prepare resource download' });
  }
});

router.patch('/:id', requireCoach, async (req, res) => {
  try {
    const existing = await resourceRow(req.params.id, { includeArchived: true });
    if (!existing) return res.status(404).json({ error: 'Resource not found' });
    const body = req.body || {};
    const updates = {};
    if ('title' in body) {
      const title = cleanText(body.title);
      if (!title) return res.status(400).json({ error: 'Resource title is required' });
      updates.title = title;
    }
    if ('description' in body) updates.description = cleanText(body.description);
    if ('category_id' in body) {
      const categoryId = cleanText(body.category_id);
      if (!await categoryExists(categoryId)) {
        return res.status(400).json({ error: 'Choose a valid resource category' });
      }
      updates.category_id = categoryId;
    }
    if ('is_public' in body) updates.is_public = booleanValue(body.is_public);
    if ('archived' in body) {
      return res.status(400).json({ error: 'Use the resource archive action to choose assigned client access' });
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No resource changes provided' });
    const { error } = await supabaseAdmin
      .from('resource_library')
      .update(updates)
      .eq('id', existing.id);
    if (error) throw error;
    return res.json(await coachResource(existing.id, { includeArchived: true }));
  } catch (error) {
    logError('update resource error', error);
    return res.status(500).json({ error: 'Failed to update resource' });
  }
});

router.post('/:id/archive', requireCoach, async (req, res) => {
  try {
    const resource = await resourceRow(req.params.id);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    const assignmentAccess = String(req.body?.assignment_access || '');
    if (!['keep', 'revoke'].includes(assignmentAccess)) {
      return res.status(400).json({ error: 'Choose whether to keep or revoke assigned client access' });
    }
    const { data, error } = await supabaseAdmin.rpc('archive_resource', {
      p_resource_id: resource.id,
      p_revoke_assigned_access: assignmentAccess === 'revoke',
    });
    if (error) throw error;
    const outcome = Array.isArray(data) ? data[0] : data;
    return res.json({
      resource: await coachResource(resource.id, { includeArchived: true }),
      active_assignments: outcome?.active_assignments || 0,
      revoked_assignments: outcome?.revoked_assignments || 0,
    });
  } catch (error) {
    logError('archive resource error', error);
    return res.status(500).json({ error: 'Failed to archive resource' });
  }
});

router.post('/:id/assign', requireCoach, async (req, res) => {
  try {
    const resource = await resourceRow(req.params.id);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    const client = await manageableClient(req.user, req.body?.client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin
      .from('resource_assignments')
      .upsert({
        resource_id: resource.id,
        client_id: client.id,
        active: true,
        assigned_at: new Date().toISOString(),
      }, { onConflict: 'resource_id,client_id' })
      .select()
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    logError('assign resource error', error);
    return res.status(500).json({ error: 'Failed to assign resource' });
  }
});

router.patch('/:id/assignments/:clientId', requireCoach, async (req, res) => {
  try {
    const resource = await resourceRow(req.params.id, { includeArchived: true });
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    const client = await manageableClient(req.user, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const { data: existing, error: loadError } = await supabaseAdmin
      .from('resource_assignments')
      .select('*')
      .eq('resource_id', resource.id)
      .eq('client_id', client.id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('resource_assignments')
        .update({ active: false })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return res.json(data);
    }
    const { data, error } = await supabaseAdmin
      .from('resource_assignments')
      .insert({ resource_id: resource.id, client_id: client.id, active: false })
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    logError('unassign resource error', error);
    return res.status(500).json({ error: 'Failed to unassign resource' });
  }
});

module.exports = router;
