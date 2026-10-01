const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { exerciseMarkers, supersetBlocks } = require('./supersets');

const CVF_LOCATION = 'Core Value Fitness - Albuquerque, NM';
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'cvf-logo.png');

// Keep in sync with --primary in frontend/src/index.css — pdfkit can't read CSS vars.
const teal = '#5EC4D4';
// Keep in sync with --gold in frontend/src/index.css — pdfkit can't read CSS vars.
const gold = '#FCF640';
const dark = '#09111C';
const muted = '#5F6B78';

const DEFAULT_SET_BOXES = 4;
const MAX_SET_BOXES = 10;

function safeFilename(value) {
  const cleaned = String(value || 'Program')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `CVF-${cleaned || 'Program'}.pdf`;
}

function logSheetFilename(value) {
  const cleaned = String(value || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `CVF-${cleaned || 'Workout'}-Log.pdf`;
}

// One write-in box per prescribed set. Ranges ("3-4") and free text ("AMRAP")
// get a sensible default so the client always has room to log.
function setBoxCount(sets) {
  const match = String(sets ?? '').trim().match(/^\d+$/);
  const count = match ? Number(match[0]) : 0;
  if (count < 1) return DEFAULT_SET_BOXES;
  return Math.min(count, MAX_SET_BOXES);
}

function exerciseName(exercise) {
  return exercise.library_exercise?.name || exercise.custom_name || exercise.name || 'Exercise';
}

function exerciseVideo(exercise) {
  return exercise.video_url || exercise.library_exercise?.video_url || '';
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

function ensurePdfSpace(doc, needed = 80) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function createBrandedPdf(title, render) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 42, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 116).fill(dark);
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, 42, 26, { width: 52, height: 52 });
    } else {
      doc.roundedRect(42, 30, 44, 44, 8).fill(teal).fillColor(dark).font('Helvetica-Bold').fontSize(13).text('CVF', 51, 45);
    }
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(title, 110, 30, { width: 430 });
    doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('CVF PT', 110, 58);
    doc.fillColor('#DCE6EF').font('Helvetica').fontSize(9).text(CVF_LOCATION, 110, 73);
    doc.y = 140;

    render(doc);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; without this pdfkit treats it
      // as overflow and appends a blank page per footer.
      doc.page.margins.bottom = 0;
      doc.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`Core Value Fitness - ${i + 1} / ${range.count}`, 42, 752, { width: 528, align: 'center' });
    }

    doc.end();
  });
}

function drawSectionHeading(doc, heading) {
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(14).text(heading);
  doc.moveTo(42, doc.y + 6).lineTo(570, doc.y + 6).strokeColor(teal).lineWidth(1.5).stroke();
  doc.moveDown(1);
}

function drawDayBanner(doc, title, goal) {
  doc.roundedRect(42, doc.y, 528, 32, 6).fill('#F3F8FA');
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(12).text(title, 54, doc.y + 9, { width: 390 });
  if (goal) doc.fillColor(teal).fontSize(9).text(goal, 440, doc.y - 14, { width: 116, align: 'right' });
  doc.y += 42;
}

// A short caption above the first member of a superset/giant set, so a
// printed sheet says how to perform the lettered group.
function groupCaptions(exercises) {
  const captions = new Map();
  supersetBlocks(exercises).forEach((block) => {
    if (block.kind === 'single') return;
    const label = block.kind === 'superset' ? 'Superset' : 'Giant set';
    captions.set(block.items[0].index, `${label} - alternate these ${block.items.length}, then rest`);
  });
  return captions;
}

function drawGroupCaption(doc, caption) {
  if (!caption) return;
  doc.fillColor(teal).font('Helvetica-Bold').fontSize(7).text(caption.toUpperCase(), 70, doc.y, { width: 470, characterSpacing: 0.5 });
  doc.moveDown(0.3);
}

function drawExerciseTitle(doc, exercise, marker) {
  const top = doc.y;
  doc.circle(53, top + 8, 8).fill(teal);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(marker.length > 2 ? 6 : 8).text(marker, 45, top + 3, { width: 16, align: 'center', lineBreak: false });
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(exerciseName(exercise), 70, top, { width: 470 });
}

function generateProgramPdf(program, user, options = {}) {
  const includeVideos = options.includeVideos !== false;
  const includeCoachNotes = Boolean(options.includeCoachNotes);
  return createBrandedPdf(program.name || 'Training Program', (doc) => {
    drawSectionHeading(doc, 'Program Overview');
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
      drawDayBanner(doc, `Day ${day.day_number}: ${workout.name || 'Workout Day'}`, workout.goal);
      if (day.notes) {
        doc.fillColor(muted).font('Helvetica-Oblique').fontSize(9).text(day.notes, 54, doc.y, { width: 490 });
        doc.moveDown(0.6);
      }

      const markers = exerciseMarkers(workout.exercises);
      const captions = groupCaptions(workout.exercises);
      (workout.exercises || []).forEach((exercise, index) => {
        ensurePdfSpace(doc, 72 + (captions.has(index) ? 12 : 0));
        drawGroupCaption(doc, captions.get(index));
        drawExerciseTitle(doc, exercise, markers[index]);
        const detail = getExerciseText(exercise, includeCoachNotes);
        if (detail) doc.fillColor('#374151').font('Helvetica').fontSize(9).text(detail, 70, doc.y + 3, { width: 470, lineGap: 2 });
        const video = exerciseVideo(exercise);
        if (includeVideos && video) {
          doc.fillColor(teal).fontSize(8).text(video, 70, doc.y + 4, { width: 470, underline: true });
        }
        doc.moveDown(0.8);
        doc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(70, doc.y).lineTo(570, doc.y).stroke();
        doc.moveDown(0.5);
      });
      doc.moveDown(0.6);
    });
  });
}

// Mirrors the client Programs page: the coach's per-client load wins, then the
// exercise default.
function targetLoad(exercise, loadByExercise) {
  const assigned = loadByExercise.get(exercise.id);
  if (assigned) return `${assigned.load_value} ${assigned.load_unit}`;
  if (exercise.default_load_value !== null && exercise.default_load_value !== undefined && exercise.default_load_unit) {
    return `${exercise.default_load_value} ${exercise.default_load_unit}`;
  }
  return '';
}

function logSheetDetail(exercise, load) {
  return [
    (exercise.sets || exercise.reps) && `${exercise.sets || '?'} x ${exercise.reps || '?'}`,
    load && `Target: ${load}`,
    exercise.target_rpe && `RPE: ${exercise.target_rpe}`,
    exercise.rest && `Rest: ${exercise.rest}`,
    exercise.tempo && `Tempo: ${exercise.tempo}`,
    exercise.client_notes || exercise.notes,
  ].filter(Boolean).join(' - ');
}

const BOX_WIDTH = 74;
const BOX_HEIGHT = 40;
const BOX_GAP = 5;
const BOXES_PER_ROW = 6;

function drawSetBoxes(doc, count) {
  const rows = Math.ceil(count / BOXES_PER_ROW);
  let top = doc.y + 6;
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const inRow = Math.min(BOXES_PER_ROW, count - rowIndex * BOXES_PER_ROW);
    for (let col = 0; col < inRow; col += 1) {
      const setNumber = rowIndex * BOXES_PER_ROW + col + 1;
      const left = 70 + col * (BOX_WIDTH + BOX_GAP);
      doc.roundedRect(left, top, BOX_WIDTH, BOX_HEIGHT, 4).lineWidth(0.75).strokeColor('#CBD5E1').stroke();
      doc.fillColor(teal).font('Helvetica-Bold').fontSize(6.5).text(`SET ${setNumber}`, left + 5, top + 4, { lineBreak: false });
      doc.fillColor(muted).font('Helvetica').fontSize(7)
        .text('Wt', left + 5, top + 15, { lineBreak: false })
        .text('Reps', left + 5, top + 28, { lineBreak: false });
      doc.strokeColor('#E5E7EB').lineWidth(0.5)
        .moveTo(left + 24, top + 22).lineTo(left + BOX_WIDTH - 5, top + 22).stroke()
        .moveTo(left + 24, top + 35).lineTo(left + BOX_WIDTH - 5, top + 35).stroke();
    }
    top += BOX_HEIGHT + BOX_GAP;
  }
  doc.x = 42;
  doc.y = top;
}

function exerciseBlockHeight(boxes) {
  return 44 + Math.ceil(boxes / BOXES_PER_ROW) * (BOX_HEIGHT + BOX_GAP);
}

// Printable client sheet: prescriptions plus blank per-set boxes to log by
// hand. Coach-only notes are never rendered.
function generateLogSheetPdf({ title, clientName, note, sections }) {
  return createBrandedPdf(title || 'Workout', (doc) => {
    drawSectionHeading(doc, 'Workout Log');
    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    doc.fillColor(muted).font('Helvetica').fontSize(10)
      .text(`${clientName ? `Prepared for ${clientName}   ` : ''}Printed: ${generated}`);
    doc.fillColor(muted).fontSize(9).text('Write in the weight and reps you complete for each set.');
    if (note) {
      doc.moveDown(0.6);
      doc.fillColor('#1F2937').font('Helvetica-Oblique').fontSize(10).text(`Coach note: ${note}`, { width: 510, lineGap: 2 });
    }
    doc.moveDown(1.2);

    (sections || []).forEach((section) => {
      const exercises = section.exercises || [];
      ensurePdfSpace(doc, 70 + (exercises.length ? exerciseBlockHeight(setBoxCount(exercises[0].sets)) : 0));
      drawDayBanner(doc, section.title || 'Workout', section.goal);
      doc.fillColor(muted).font('Helvetica').fontSize(9).text('Date: ____________________', 54, doc.y, { width: 490 });
      doc.moveDown(0.4);
      if (section.notes) {
        doc.fillColor(muted).font('Helvetica-Oblique').fontSize(9).text(section.notes, 54, doc.y, { width: 490 });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);

      if (!exercises.length) {
        doc.fillColor(muted).font('Helvetica').fontSize(9).text('No exercises added yet.', 70, doc.y);
        doc.moveDown(1);
      }
      const loadByExercise = new Map((section.loads || []).map((load) => [load.workout_exercise_id, load]));
      const markers = exerciseMarkers(exercises);
      const captions = groupCaptions(exercises);
      exercises.forEach((exercise, index) => {
        const boxes = setBoxCount(exercise.sets);
        ensurePdfSpace(doc, exerciseBlockHeight(boxes) + (captions.has(index) ? 12 : 0));
        drawGroupCaption(doc, captions.get(index));
        drawExerciseTitle(doc, exercise, markers[index]);
        const detail = logSheetDetail(exercise, targetLoad(exercise, loadByExercise));
        if (detail) doc.fillColor('#374151').font('Helvetica').fontSize(9).text(detail, 70, doc.y + 3, { width: 470, lineGap: 2 });
        const video = exerciseVideo(exercise);
        if (video) doc.fillColor(teal).fontSize(8).text(video, 70, doc.y + 3, { width: 470, underline: true });
        drawSetBoxes(doc, boxes);
        doc.moveDown(0.6);
      });
      doc.moveDown(0.6);
    });
  });
}

module.exports = {
  generateLogSheetPdf,
  generateProgramPdf,
  logSheetFilename,
  safeFilename,
  setBoxCount,
};
