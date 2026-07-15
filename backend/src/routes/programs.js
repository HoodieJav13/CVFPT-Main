const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { supabaseAdmin } = require('../supabase');
const { logError } = require('../utils/logger');
const { requireAuth, requireCoach, requireClient, canAccessClient } = require('../middleware/auth');
const {
  canAccessProgram,
  canAccessWorkout,
  canAccessWorkoutAssignment,
  canManageWorkout,
  programDaysUseAccessibleWorkouts,
} = require('../security/access');
const {
  csvImportLimiter,
  libraryImportLimiter,
  pdfExportLimiter,
  pdfImportLimiter,
  programCommitLimiter,
} = require('../middleware/rateLimits');
const {
  PARSER_VERSION,
  csvTemplate,
  draftFromProgram,
  findSimilarExercise,
  normalizeDraft,
  normalizeName,
  parseCsvDraft,
  parsePasteDraft,
  validateDraft,
} = require('../lib/programDraft.cjs');
const { extractPdfText } = require('../lib/pdfText');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function programImportUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Import files must be 5 MB or smaller.' });
    }
    logError('program import upload error', err);
    return res.status(400).json({ error: 'Could not read the uploaded file.' });
  });
}

const CVF_LOCATION = 'Core Value Fitness - Albuquerque, NM';
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'cvf-logo.png');

function isCsvUpload(file) {
  return Boolean(file && (
    file.mimetype === 'text/csv'
    || file.mimetype === 'application/csv'
    || file.mimetype === 'application/vnd.ms-excel'
    || /\.csv$/i.test(file.originalname || '')
  ));
}

function isPdfUpload(file) {
  return Boolean(file && (
    file.mimetype === 'application/pdf'
    || /\.pdf$/i.test(file.originalname || '')
  ));
}

function sourceForImport(sourceType) {
  if (sourceType === 'pdf') return 'import_pdf_ai';
  if (sourceType === 'paste') return 'manual';
  return 'import_csv';
}

function isSupportedProgramFrequency(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function safeFilename(value) {
  const cleaned = String(value || 'Program')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `CVF-${cleaned || 'Program'}.pdf`;
}

function getExerciseText(exercise, includeCoachNotes = false) {
  const parts = [];
  if (exercise.sets || exercise.reps) parts.push(`${exercise.sets || '?'} x ${exercise.reps || '?'}`);
  if (exercise.rest) parts.push(`Rest: ${exercise.rest}`);
  if (exercise.tempo) parts.push(`Tempo: ${exercise.tempo}`);
  if (exercise.client_notes || exercise.notes) parts.push(exercise.client_notes || exercise.notes);
  if (includeCoachNotes && exercise.coach_notes) parts.push(`Coach: ${exercise.coach_notes}`);
  return parts.filter(Boolean).join(' - ');
}

function addWrappedText(doc, text, x, y, options = {}) {
  doc.text(String(text || ''), x, y, options);
  return doc.y;
}

function ensurePdfSpace(doc, needed = 80) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function generateProgramPdf(program, user, options = {}) {
  const includeVideos = options.includeVideos !== false;
  const includeCoachNotes = Boolean(options.includeCoachNotes);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 42, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Keep in sync with --primary in frontend/src/index.css — pdfkit can't read CSS vars.
    const teal = '#5EC4D4';
    // Keep in sync with --gold in frontend/src/index.css — pdfkit can't read CSS vars.
    const gold = '#FCF640';
    const dark = '#09111C';
    const muted = '#5F6B78';

    doc.rect(0, 0, doc.page.width, 116).fill(dark);
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, 42, 26, { width: 52, height: 52 });
    } else {
      doc.roundedRect(42, 30, 44, 44, 8).fill(teal).fillColor(dark).font('Helvetica-Bold').fontSize(13).text('CVF', 51, 45);
    }
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(program.name || 'Training Program', 110, 30, { width: 430 });
    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('CVF PT', 110, 58);
    doc.fillColor('#DCE6EF').font('Helvetica').fontSize(9).text(CVF_LOCATION, 110, 73);

    doc.y = 140;
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(14).text('Program Overview');
    doc.moveTo(42, doc.y + 6).lineTo(570, doc.y + 6).strokeColor(teal).lineWidth(1.5).stroke();
    doc.moveDown(1);
    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const coachName = user?.coach?.name || 'CVF Coach';
    const frequency = program.frequency_days || program.days?.length || 0;
    doc.text(`${frequency} ${frequency === 1 ? 'day' : 'days'}/week`, { continued: true });
    doc.fillColor(muted).text(`   Coach: ${coachName}   Generated: ${generated}`);
    if (program.description) {
      doc.moveDown(0.8);
      doc.fillColor('#1F2937').fontSize(10).text(program.description, { width: 510, lineGap: 2 });
    }
    doc.moveDown(1.2);

    (program.days || []).forEach((day) => {
      ensurePdfSpace(doc, 120);
      const workout = day.workout || {};
      doc.roundedRect(42, doc.y, 528, 32, 6).fill('#F3F8FA');
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(12).text(`Day ${day.day_number}: ${workout.name || 'Workout Day'}`, 54, doc.y + 9, { width: 390 });
      if (workout.goal) doc.fillColor(teal).fontSize(9).text(workout.goal, 440, doc.y - 14, { width: 116, align: 'right' });
      doc.y += 42;
      if (day.notes) {
        doc.fillColor(muted).font('Helvetica-Oblique').fontSize(9).text(day.notes, 54, doc.y, { width: 490 });
        doc.moveDown(0.6);
      }

      (workout.exercises || []).forEach((exercise, index) => {
        ensurePdfSpace(doc, 72);
        const exerciseName = exercise.library_exercise?.name || exercise.custom_name || exercise.name || 'Exercise';
        const top = doc.y;
        doc.circle(53, top + 8, 8).fill(teal);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text(String(index + 1), 49, top + 3, { width: 8, align: 'center' });
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(exerciseName, 70, top, { width: 470 });
        const detail = getExerciseText(exercise, includeCoachNotes);
        if (detail) doc.fillColor('#374151').font('Helvetica').fontSize(9).text(detail, 70, doc.y + 3, { width: 470, lineGap: 2 });
        if (includeVideos && (exercise.video_url || exercise.library_exercise?.video_url)) {
          const video = exercise.video_url || exercise.library_exercise.video_url;
          doc.fillColor(teal).fontSize(8).text(video, 70, doc.y + 4, { width: 470, underline: true });
        }
        doc.moveDown(0.8);
        doc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(70, doc.y).lineTo(570, doc.y).stroke();
        doc.moveDown(0.5);
      });
      doc.moveDown(0.6);
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`Core Value Fitness - ${i + 1} / ${range.count}`, 42, 752, { width: 528, align: 'center' });
    }

    doc.end();
  });
}

async function callOpenAiForDraft(pdfText, originalFilename) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.PROGRAM_IMPORT_MODEL;
  if (!apiKey || !model) {
    const error = new Error('PDF import is not configured. Add the AI import configuration, then try again.');
    error.status = 503;
    throw error;
  }

  const prompt = [
    'Extract this fitness program PDF into strict JSON only.',
    'Use this shape: { "program": { "name": "", "description": "", "frequency_days": 3, "source": "pdf" }, "days": [{ "day_number": 1, "name": "", "goal": "", "notes": "", "exercises": [{ "name": "", "sets": "", "reps": "", "rest": "", "tempo": "", "client_notes": "", "coach_notes": "", "video_url": "", "category": "", "equipment": "", "primary_muscle": "" }] }], "import_meta": { "source_type": "pdf", "original_filename": "", "parser_version": "", "confidence": 0.7, "warnings": [], "new_exercises_detected": [], "possible_duplicates": [] } }',
    'Return 3, 4, or 5 days only. If uncertain, add a warning instead of inventing details.',
    `Original filename: ${originalFilename}`,
    'PDF text:',
    pdfText.slice(0, 30000),
  ].join('\n\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: 'json_object' } },
    }),
  });
  if (!response.ok) {
    const error = new Error('PDF import could not parse this file. Review the file or try CSV import.');
    error.status = 502;
    throw error;
  }
  const data = await response.json();
  const text = data.output_text
    || data.output?.flatMap((item) => item.content || []).map((item) => item.text).filter(Boolean).join('\n')
    || '';
  return JSON.parse(text);
}

async function workoutWithDetails(workoutId) {
  const { data: workout } = await supabaseAdmin.from('workouts').select('*')
    .eq('id', workoutId).eq('archived', false).maybeSingle();
  if (!workout) return null;
  const { data: exercises, error } = await supabaseAdmin
    .from('workout_exercises')
    .select('*, library_exercise:exercise_library(*)')
    .eq('workout_id', workoutId)
    .eq('archived', false)
    .order('position');
  if (error) throw error;
  return { ...workout, exercises: exercises || [], exercise_count: (exercises || []).length };
}

async function programWithDetails(programId) {
  const { data: program } = await supabaseAdmin.from('programs').select('*')
    .eq('id', programId).eq('archived', false).maybeSingle();
  if (!program) return null;
  const { data: days, error } = await supabaseAdmin
    .from('program_days')
    .select('*, workout:workouts(*)')
    .eq('program_id', programId)
    .eq('archived', false)
    .order('day_number');
  if (error) throw error;
  const detailedDays = [];
  for (const day of days || []) {
    detailedDays.push({ ...day, workout: await workoutWithDetails(day.workout_id) });
  }
  const { data: assignments } = await supabaseAdmin
    .from('program_assignments')
    .select('*, client:clients(id, name)')
    .eq('program_id', programId)
    .eq('archived', false);
  return { ...program, days: detailedDays, assignments: assignments || [] };
}

async function listWorkouts(user) {
  let q = supabaseAdmin.from('workouts').select('*').eq('archived', false).order('created_at', { ascending: false });
  if (user.role !== 'admin') q = q.or(`coach_id.is.null,coach_id.eq.${user.coach.id}`);
  const { data, error } = await q;
  if (error) throw error;
  const result = [];
  for (const workout of data || []) result.push(await workoutWithDetails(workout.id));
  return result;
}

async function programDaysAreAccessible(user, days) {
  const workoutIds = [...new Set((days || []).map((day) => day.workout_id).filter(Boolean))];
  if (!workoutIds.length) return true;
  const { data, error } = await supabaseAdmin.from('workouts').select('*').in('id', workoutIds);
  if (error) throw error;
  return programDaysUseAccessibleWorkouts(user, days, data || []);
}

async function validateImportExerciseChoices(draft) {
  const { data: library, error } = await supabaseAdmin
    .from('exercise_library')
    .select('id,name')
    .eq('archived', false)
    .order('name');
  if (error) throw error;
  const activeExercises = library || [];
  const byId = new Map(activeExercises.map((exercise) => [exercise.id, exercise]));
  const byName = new Map(activeExercises.map((exercise) => [normalizeName(exercise.name), exercise]));
  const errors = [];
  (draft.days || []).forEach((day, dayIndex) => {
    (day.exercises || []).forEach((exercise, exerciseIndex) => {
      const path = `days.${dayIndex}.exercises.${exerciseIndex}.name`;
      if (exercise.exercise_library_id) {
        if (!byId.has(exercise.exercise_library_id)) {
          errors.push({ path, message: 'The selected existing exercise is no longer available' });
        }
        return;
      }
      if (byName.has(normalizeName(exercise.name)) || exercise.similarity_decision === 'create_new') return;
      const similar = findSimilarExercise(exercise.name, activeExercises);
      if (similar) {
        errors.push({
          path,
          message: `Choose whether to use existing exercise "${similar.name}" or create a new one`,
          suggested_exercise_id: similar.id,
          suggested_exercise_name: similar.name,
        });
      }
    });
  });
  return errors;
}

// ----- Exercise library -----
router.get('/exercise-library', requireCoach, async (req, res) => {
  try {
    let q = supabaseAdmin.from('exercise_library').select('*').eq('archived', false).order('name');
    if (req.query.q) q = q.ilike('name', `%${req.query.q}%`);
    const { data, error } = await q;
    if (error) throw error;
    return res.json(data || []);
  } catch (e) {
    logError('exercise library error', e);
    return res.status(500).json({ error: 'Failed to load exercise library' });
  }
});

router.post('/exercise-library', requireCoach, async (req, res) => {
  try {
    const { name, category, equipment, primary_muscle, secondary_muscles, video_url, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Exercise name is required' });
    const { data, error } = await supabaseAdmin.from('exercise_library').insert({
      name: String(name).trim(), category: category || null, equipment: equipment || null,
      primary_muscle: primary_muscle || null, secondary_muscles: secondary_muscles || null,
      video_url: video_url || null, notes: notes || null, source: 'manual', review_status: 'approved',
    }).select().single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('create library exercise error', e);
    return res.status(500).json({ error: 'Failed to save exercise' });
  }
});

router.post('/exercise-library/import', requireCoach, libraryImportLimiter, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length > 500) return res.status(413).json({ error: 'Exercise imports are limited to 500 rows' });
    const cleaned = rows
      .filter((row) => row.name && String(row.name).trim())
      .map((row) => ({
        name: String(row.name).trim(),
        category: row.category || null,
        equipment: row.equipment || null,
        primary_muscle: row.primary_muscle || null,
        secondary_muscles: row.secondary_muscles || null,
        video_url: row.video_url || null,
        notes: row.notes || null,
        source: 'import_csv',
        review_status: 'needs_review',
      }));
    if (!cleaned.length) return res.status(400).json({ error: 'No valid exercises found in import' });
    const { data, error } = await supabaseAdmin.from('exercise_library').insert(cleaned).select();
    if (error) throw error;
    return res.status(201).json({ imported: data.length, exercises: data });
  } catch (e) {
    logError('import library error', e);
    return res.status(500).json({ error: 'Failed to import exercises' });
  }
});

router.put('/exercise-library/:id', requireCoach, async (req, res) => {
  try {
    const allowed = ['name', 'category', 'equipment', 'primary_muscle', 'secondary_muscles', 'video_url', 'notes', 'source', 'review_status'];
    const updates = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in (req.body || {})) updates[k] = req.body[k] || null;
    if (updates.name !== undefined && !String(updates.name).trim()) return res.status(400).json({ error: 'Exercise name is required' });
    const { data, error } = await supabaseAdmin.from('exercise_library').update(updates)
      .eq('id', req.params.id).eq('archived', false).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Exercise not found' });
    return res.json(data);
  } catch (e) {
    logError('update library exercise error', e);
    return res.status(500).json({ error: 'Failed to update exercise' });
  }
});

router.patch('/exercise-library/:id/archive', requireCoach, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('exercise_library').update({ archived: req.body?.archived !== false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive library exercise error', e);
    return res.status(500).json({ error: 'Failed to archive exercise' });
  }
});

// ----- Workout templates -----
router.get('/workouts', requireCoach, async (req, res) => {
  try {
    return res.json(await listWorkouts(req.user));
  } catch (e) {
    logError('list workouts error', e);
    return res.status(500).json({ error: 'Failed to load workouts' });
  }
});

router.post('/workouts', requireCoach, async (req, res) => {
  try {
    const { name, description, goal, exercises } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Workout name is required' });
    const { data: workoutId, error } = await supabaseAdmin.rpc('save_workout', {
      p_workout_id: null,
      p_coach_id: req.user.role === 'admin' ? null : req.user.coach.id,
      p_name: String(name).trim(),
      p_description: description || null,
      p_goal: goal || null,
      p_exercises: Array.isArray(exercises) ? exercises : [],
    });
    if (error) throw error;
    return res.status(201).json(await workoutWithDetails(workoutId));
  } catch (e) {
    logError('create workout error', e);
    return res.status(500).json({ error: 'Failed to create workout' });
  }
});

router.get('/workouts/:id', requireCoach, async (req, res) => {
  try {
    const workout = await workoutWithDetails(req.params.id);
    if (!canAccessWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    return res.json(workout);
  } catch (e) {
    logError('get workout error', e);
    return res.status(500).json({ error: 'Failed to load workout' });
  }
});

router.put('/workouts/:id', requireCoach, async (req, res) => {
  try {
    const workout = await workoutWithDetails(req.params.id);
    if (!canManageWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    const body = req.body || {};
    const name = 'name' in body ? String(body.name || '').trim() : workout.name;
    if (!name) return res.status(400).json({ error: 'Workout name is required' });
    const { data: workoutId, error } = await supabaseAdmin.rpc('save_workout', {
      p_workout_id: workout.id,
      p_coach_id: workout.coach_id,
      p_name: name,
      p_description: 'description' in body ? body.description || null : workout.description,
      p_goal: 'goal' in body ? body.goal || null : workout.goal,
      p_exercises: Array.isArray(body.exercises) ? body.exercises : workout.exercises,
    });
    if (error) throw error;
    if (!workoutId) return res.status(404).json({ error: 'Workout not found' });
    return res.json(await workoutWithDetails(workoutId));
  } catch (e) {
    logError('update workout error', e);
    return res.status(500).json({ error: 'Failed to update workout' });
  }
});

router.patch('/workouts/:id/archive', requireCoach, async (req, res) => {
  try {
    const workout = await workoutWithDetails(req.params.id);
    if (!canManageWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    const { data, error } = await supabaseAdmin.from('workouts').update({ archived: true, updated_at: new Date().toISOString() }).eq('id', workout.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive workout error', e);
    return res.status(500).json({ error: 'Failed to archive workout' });
  }
});

// ----- Program import/export -----
router.get('/import/template.csv', requireCoach, async (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="CVF-program-import-template.csv"');
  return res.send(csvTemplate());
});

router.post('/import/parse-csv', requireCoach, csvImportLimiter, programImportUpload, async (req, res) => {
  try {
    if (!isCsvUpload(req.file)) return res.status(400).json({ error: 'Upload a CSV file using the program import template.' });
    const text = req.file.buffer.toString('utf8');
    const draft = parseCsvDraft(text, { originalFilename: req.file.originalname, sourceType: 'csv' });
    const validation = validateDraft(draft);
    if (!validation.valid) return res.status(422).json({ error: 'CSV parsed, but the draft needs fixes before saving.', draft: validation.draft, errors: validation.errors });
    return res.json({ message: 'CSV parsed. Review imported program before saving.', draft: validation.draft, errors: [] });
  } catch (e) {
    const status = e.validation ? 400 : 500;
    logError('parse csv program error', e);
    return res.status(status).json({ error: e.message || 'Could not parse CSV import' });
  }
});

router.post('/import/parse-paste', requireCoach, csvImportLimiter, async (req, res) => {
  try {
    const draft = parsePasteDraft(req.body?.text);
    const validation = validateDraft(draft);
    if (!validation.valid) {
      return res.status(422).json({
        error: 'Paste parsed, but the draft needs fixes before saving.',
        draft: validation.draft,
        errors: validation.errors,
      });
    }
    return res.json({ message: 'Paste parsed. Review imported program before saving.', draft: validation.draft, errors: [] });
  } catch (e) {
    if (e.code === 'NO_EXERCISES_FOUND' || e.validation?.no_exercises) {
      return res.status(400).json({ error: "Couldn't find any exercises in this text." });
    }
    logError('parse pasted program error', e);
    return res.status(500).json({ error: 'Could not parse pasted program' });
  }
});

router.post('/import/parse-pdf', requireCoach, pdfImportLimiter, programImportUpload, async (req, res) => {
  try {
    if (!isPdfUpload(req.file)) return res.status(400).json({ error: 'Upload a PDF file.' });
    const text = await extractPdfText(req.file.buffer);
    if (!text.trim()) return res.status(400).json({ error: 'Could not extract readable text from this PDF. Try the CSV template instead.' });
    const aiDraft = await callOpenAiForDraft(text, req.file.originalname);
    const draft = normalizeDraft({
      ...aiDraft,
      import_meta: {
        ...(aiDraft.import_meta || {}),
        source_type: 'pdf',
        original_filename: req.file.originalname,
        parser_version: PARSER_VERSION,
      },
    });
    const validation = validateDraft(draft);
    if (!validation.valid) return res.status(422).json({ error: 'PDF parsed, but the draft needs fixes before saving.', draft: validation.draft, errors: validation.errors });
    return res.json({ message: 'PDF parsed. Review extracted program before saving.', draft: validation.draft, errors: [] });
  } catch (e) {
    logError('parse pdf program error', e);
    return res.status(e.status || 500).json({ error: e.message || 'Could not parse PDF import' });
  }
});

router.post('/import/commit', requireCoach, programCommitLimiter, async (req, res) => {
  try {
    const validation = validateDraft(req.body?.draft || req.body);
    if (!validation.valid) return res.status(422).json({ error: 'Fix import draft errors before saving.', errors: validation.errors, draft: validation.draft });
    const choiceErrors = await validateImportExerciseChoices(validation.draft);
    if (choiceErrors.length) {
      return res.status(422).json({
        error: 'Review similar exercise names before saving.',
        errors: choiceErrors,
        draft: validation.draft,
      });
    }
    const source = sourceForImport(validation.draft.import_meta.source_type);
    const { data, error } = await supabaseAdmin.rpc('commit_program_import', {
      p_coach_id: req.user.coach.id,
      p_source: source,
      p_draft: validation.draft,
    });
    if (error) {
      logError('commit program import rpc error', error);
      return res.status(500).json({ error: 'Program import could not be saved. Confirm the latest database migration has been applied.' });
    }
    const program = data?.program_id ? await programWithDetails(data.program_id) : null;
    return res.status(201).json({ ...data, program });
  } catch (e) {
    logError('commit program import error', e);
    return res.status(500).json({ error: 'Failed to save imported program' });
  }
});

// ----- Structured programs -----
router.get('/', requireCoach, async (req, res) => {
  try {
    let q = supabaseAdmin.from('programs').select('*, assignments:program_assignments(id, archived, client:clients(id, name))')
      .eq('archived', false)
      .not('frequency_days', 'is', null)
      .order('created_at', { ascending: false });
    if (req.user.role !== 'admin') q = q.eq('coach_id', req.user.coach.id);
    const { data, error } = await q;
    if (error) throw error;
    const result = [];
    for (const program of data || []) {
      const detailed = await programWithDetails(program.id);
      result.push({
        ...program,
        days: detailed.days,
        day_count: detailed.days.length,
        exercise_count: detailed.days.reduce((sum, day) => sum + (day.workout?.exercise_count || 0), 0),
        active_assignments: (program.assignments || []).filter((a) => !a.archived),
      });
    }
    return res.json(result);
  } catch (e) {
    logError('list programs error', e);
    return res.status(500).json({ error: 'Failed to load programs' });
  }
});

router.post('/', requireCoach, async (req, res) => {
  try {
    const { name, description, frequency_days, days } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Program name is required' });
    const frequency = Number(frequency_days);
    if (!isSupportedProgramFrequency(frequency)) return res.status(400).json({ error: 'Choose 1 to 5 days per week' });
    const validDays = Array.isArray(days) ? days.filter((d) => d.workout_id) : [];
    if (validDays.length !== frequency) return res.status(400).json({ error: `Assign one workout to each of the ${frequency} days` });
    if (!await programDaysAreAccessible(req.user, validDays)) return res.status(404).json({ error: 'Workout not found' });
    const { data: programId, error } = await supabaseAdmin.rpc('save_program', {
      p_program_id: null,
      p_coach_id: req.user.coach.id,
      p_is_admin: req.user.role === 'admin',
      p_name: String(name).trim(),
      p_description: description || null,
      p_frequency_days: frequency,
      p_days: validDays,
    });
    if (error) throw error;
    return res.status(201).json(await programWithDetails(programId));
  } catch (e) {
    logError('create program error', e);
    return res.status(500).json({ error: e.message || 'Failed to create program' });
  }
});

router.get('/:id/export.pdf', requireCoach, pdfExportLimiter, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program) || program.archived) return res.status(404).json({ error: 'Program not found' });
    const pdf = await generateProgramPdf(program, req.user, {
      includeVideos: req.query.includeVideos !== 'false',
      includeCoachNotes: req.query.includeCoachNotes === 'true',
      format: req.query.format || 'client',
    });
    const filename = safeFilename(program.name);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdf);
  } catch (e) {
    logError('export program pdf error', e);
    return res.status(500).json({ error: 'Failed to export program PDF' });
  }
});

router.get('/:id', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program) || program.archived) return res.status(404).json({ error: 'Program not found' });
    return res.json(program);
  } catch (e) {
    logError('get program error', e);
    return res.status(500).json({ error: 'Failed to load program' });
  }
});

router.put('/:id', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const body = req.body || {};
    const name = 'name' in body ? String(body.name || '').trim() : program.name;
    if (!name) return res.status(400).json({ error: 'Program name is required' });
    const frequency = 'frequency_days' in body ? Number(body.frequency_days) : program.frequency_days;
    if (!isSupportedProgramFrequency(frequency)) return res.status(400).json({ error: 'Choose 1 to 5 days per week' });
    const validDays = Array.isArray(body.days)
      ? body.days.filter((day) => day.workout_id)
      : program.days.map((day) => ({ day_number: day.day_number, workout_id: day.workout_id, notes: day.notes }));
    if (validDays.length !== frequency) {
      return res.status(400).json({ error: `Assign one workout to each of the ${frequency} days` });
    }
    if (!await programDaysAreAccessible(req.user, validDays)) return res.status(404).json({ error: 'Workout not found' });
    const { data: programId, error } = await supabaseAdmin.rpc('save_program', {
      p_program_id: program.id,
      p_coach_id: program.coach_id,
      p_is_admin: req.user.role === 'admin',
      p_name: name,
      p_description: 'description' in body ? body.description || null : program.description,
      p_frequency_days: frequency,
      p_days: validDays,
    });
    if (error) throw error;
    if (!programId) return res.status(404).json({ error: 'Program not found' });
    return res.json(await programWithDetails(programId));
  } catch (e) {
    logError('update program error', e);
    return res.status(500).json({ error: 'Failed to update program' });
  }
});

router.patch('/:id/archive', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const { data, error } = await supabaseAdmin.from('programs').update({ archived: true }).eq('id', program.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive program error', e);
    return res.status(500).json({ error: 'Failed to archive program' });
  }
});

router.post('/:id/assign', requireCoach, async (req, res) => {
  try {
    const program = await programWithDetails(req.params.id);
    if (!program || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.body.client_id).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data: existing } = await supabaseAdmin.from('program_assignments').select('id')
      .eq('program_id', program.id).eq('client_id', clientRow.id).eq('archived', false).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Program is already assigned to this client' });
    const { data, error } = await supabaseAdmin.from('program_assignments').insert({
      program_id: program.id, client_id: clientRow.id, notes: req.body.notes || null,
    }).select('*, client:clients(id, name)').single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    logError('assign program error', e);
    return res.status(500).json({ error: 'Failed to assign program' });
  }
});

router.patch('/assignments/:assignmentId/archive', requireCoach, async (req, res) => {
  try {
    const { data: assignment } = await supabaseAdmin.from('program_assignments')
      .select('*, program:programs(*)').eq('id', req.params.assignmentId).eq('archived', false).maybeSingle();
    if (!assignment || assignment.program?.archived || !canAccessProgram(req.user, assignment.program)) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    const { data, error } = await supabaseAdmin.from('program_assignments').update({ archived: true }).eq('id', assignment.id).select().single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('unassign error', e);
    return res.status(500).json({ error: 'Failed to unassign program' });
  }
});

// ----- Standalone workout assignments -----
router.get('/workout-assignments/client/:clientId', requireCoach, async (req, res) => {
  try {
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', req.params.clientId).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const { data, error } = await supabaseAdmin.from('workout_assignments').select('*')
      .eq('client_id', clientRow.id).eq('archived', false).order('assigned_for', { ascending: true, nullsFirst: false });
    if (error) throw error;
    const result = [];
    for (const a of data || []) {
      const workout = await workoutWithDetails(a.workout_id);
      if (workout) result.push({ ...a, workout });
    }
    return res.json(result);
  } catch (e) {
    logError('workout assignments error', e);
    return res.status(500).json({ error: 'Failed to load workout assignments' });
  }
});

router.post('/workout-assignments', requireCoach, async (req, res) => {
  try {
    const { client_id, workout_id, assignment_mode, assigned_for, notes } = req.body || {};
    const { data: clientRow } = await supabaseAdmin.from('clients').select('*')
      .eq('id', client_id).eq('archived', false).maybeSingle();
    if (!clientRow || !canAccessClient(req.user, clientRow)) return res.status(404).json({ error: 'Client not found' });
    const workout = await workoutWithDetails(workout_id);
    if (!canAccessWorkout(req.user, workout)) return res.status(404).json({ error: 'Workout not found' });
    const mode = assignment_mode === 'dated' ? 'dated' : 'active';
    if (mode === 'dated' && !assigned_for) return res.status(400).json({ error: 'Choose a date for dated workouts' });
    const { data, error } = await supabaseAdmin.from('workout_assignments').insert({
      client_id: clientRow.id, workout_id: workout.id, assignment_mode: mode, assigned_for: mode === 'dated' ? assigned_for : null, notes: notes || null,
    }).select().single();
    if (error) throw error;
    return res.status(201).json({ ...data, workout });
  } catch (e) {
    logError('assign workout error', e);
    return res.status(500).json({ error: 'Failed to assign workout' });
  }
});

router.patch('/workout-assignments/:assignmentId/archive', requireCoach, async (req, res) => {
  try {
    const { data: assignment, error: loadError } = await supabaseAdmin.from('workout_assignments')
      .select('*, client:clients(*)')
      .eq('id', req.params.assignmentId)
      .eq('archived', false)
      .maybeSingle();
    if (loadError) throw loadError;
    if (assignment?.client?.archived || !canAccessWorkoutAssignment(req.user, assignment)) {
      return res.status(404).json({ error: 'Workout assignment not found' });
    }
    const { data, error } = await supabaseAdmin.from('workout_assignments')
      .update({ archived: true })
      .eq('id', assignment.id)
      .eq('archived', false)
      .select()
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    logError('archive workout assignment error', e);
    return res.status(500).json({ error: 'Failed to remove workout assignment' });
  }
});

router.get('/client/assigned', requireClient, async (req, res) => {
  try {
    const { data: programAssignments, error } = await supabaseAdmin.from('program_assignments')
      .select('*, program:programs(*)').eq('client_id', req.user.client.id).eq('archived', false);
    if (error) throw error;
    const programs = [];
    for (const assignment of programAssignments || []) {
      if (assignment.program && !assignment.program.archived) programs.push({ ...assignment, program: await programWithDetails(assignment.program_id) });
    }
    const { data: workoutAssignments, error: waErr } = await supabaseAdmin.from('workout_assignments').select('*')
      .eq('client_id', req.user.client.id).eq('archived', false).order('assigned_for', { ascending: true, nullsFirst: false });
    if (waErr) throw waErr;
    const workouts = [];
    for (const assignment of workoutAssignments || []) {
      const workout = await workoutWithDetails(assignment.workout_id);
      if (workout) workouts.push({ ...assignment, workout });
    }
    return res.json({ programs, workouts });
  } catch (e) {
    logError('client programs error', e);
    return res.status(500).json({ error: 'Failed to load your programs' });
  }
});

module.exports = router;
