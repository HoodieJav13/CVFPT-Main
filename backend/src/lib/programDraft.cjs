// Duplicated in frontend/src/lib/programDraft.js — keep both in sync manually. See CLAUDE.md.
const PARSER_VERSION = 'program-draft-v1';
const EXERCISE_LINE_PATTERN = /^(.+?)\s+(\d+)[xX](\d+(?:-\d+)?)(.*)$/;
const REST_DETAIL_PATTERN = /^rest\b/i;
const DETAIL_SEPARATOR_PATTERN = /\s+(?:-|\u2013|\u2014|\u2212)\s+/;

const REQUIRED_CSV_COLUMNS = ['day_number', 'workout_name', 'exercise_name'];
const KNOWN_CSV_COLUMNS = [
  'program_name',
  'program_description',
  'frequency_days',
  'day_number',
  'workout_name',
  'day_goal',
  'day_notes',
  'exercise_name',
  'sets',
  'reps',
  'rest',
  'tempo',
  'client_notes',
  'coach_notes',
  'notes',
  'video_url',
  'category',
  'equipment',
  'primary_muscle',
];

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanString(value) {
  return String(value || '').trim();
}

function nullableString(value) {
  const cleaned = cleanString(value);
  return cleaned || '';
}

function parseCsv(text) {
  const rows = [];
  const parsed = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (current || row.length) {
        row.push(current);
        parsed.push(row);
      }
      current = '';
      row = [];
      if (char === '\r' && next === '\n') i += 1;
    } else {
      current += char;
    }
  }
  if (current || row.length) {
    row.push(current);
    parsed.push(row);
  }

  const headers = (parsed.shift() || []).map((h) => normalizeName(h).replace(/\s+/g, '_'));
  for (const values of parsed) {
    const obj = {};
    headers.forEach((header, i) => { obj[header] = cleanString(values[i]); });
    if (Object.values(obj).some(Boolean)) rows.push(obj);
  }
  return { headers, rows };
}

function csvEscape(value) {
  const text = String(value || '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvTemplate() {
  const header = KNOWN_CSV_COLUMNS.join(',');
  const examples = [
    {
      program_name: 'Foundation Strength - Phase 1',
      program_description: 'Three day strength program for general fitness.',
      frequency_days: '3',
      day_number: '1',
      workout_name: 'Lower Strength A',
      day_goal: 'Lower body strength',
      day_notes: 'Keep RPE around 7.',
      exercise_name: 'Goblet Squat',
      sets: '3',
      reps: '8-10',
      rest: '90s',
      tempo: '3-1-1',
      client_notes: 'Slow lower, tall chest.',
      coach_notes: 'Watch knee depth.',
      notes: '',
      video_url: '',
      category: 'Strength',
      equipment: 'Dumbbell',
      primary_muscle: 'Quads',
    },
    {
      program_name: 'Foundation Strength - Phase 1',
      program_description: 'Three day strength program for general fitness.',
      frequency_days: '3',
      day_number: '1',
      workout_name: 'Lower Strength A',
      day_goal: 'Lower body strength',
      day_notes: 'Keep RPE around 7.',
      exercise_name: 'Romanian Deadlift',
      sets: '3',
      reps: '8',
      rest: '90s',
      tempo: '3-0-1',
      client_notes: 'Stop when hamstrings limit range.',
      coach_notes: '',
      notes: '',
      video_url: '',
      category: 'Strength',
      equipment: 'Dumbbell',
      primary_muscle: 'Hamstrings',
    },
    {
      program_name: 'Foundation Strength - Phase 1',
      program_description: 'Three day strength program for general fitness.',
      frequency_days: '3',
      day_number: '2',
      workout_name: 'Upper Strength A',
      day_goal: 'Upper body push and pull',
      day_notes: 'Leave one or two reps in reserve.',
      exercise_name: 'Incline Dumbbell Press',
      sets: '3',
      reps: '8-10',
      rest: '90s',
      tempo: '2-0-1',
      client_notes: 'Control the lower and keep shoulder blades set.',
      coach_notes: '',
      notes: '',
      video_url: '',
      category: 'Strength',
      equipment: 'Dumbbell',
      primary_muscle: 'Chest',
    },
    {
      program_name: 'Foundation Strength - Phase 1',
      program_description: 'Three day strength program for general fitness.',
      frequency_days: '3',
      day_number: '3',
      workout_name: 'Full Body A',
      day_goal: 'Full body strength practice',
      day_notes: 'Move crisply and stop before form breaks.',
      exercise_name: 'Cable Row',
      sets: '3',
      reps: '10-12',
      rest: '75s',
      tempo: '2-1-1',
      client_notes: 'Pull elbows toward ribs.',
      coach_notes: '',
      notes: '',
      video_url: '',
      category: 'Strength',
      equipment: 'Cable',
      primary_muscle: 'Back',
    },
  ];
  return [header, ...examples.map((row) => KNOWN_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(','))].join('\n');
}

function draftFromCsvRows(rows, options = {}) {
  const warnings = [];
  const daysByNumber = new Map();
  const first = rows.find((row) => Object.values(row).some(Boolean)) || {};
  const frequencyFromRows = Number(first.frequency_days || new Set(rows.map((row) => row.day_number).filter(Boolean)).size || 3);
  const frequency = [3, 4, 5].includes(frequencyFromRows) ? frequencyFromRows : Math.min(5, Math.max(3, frequencyFromRows || 3));
  if (frequency !== frequencyFromRows) warnings.push('Frequency was normalized to a supported 3, 4, or 5 day value.');

  rows.forEach((row, index) => {
    const dayNumber = Number(row.day_number);
    if (!dayNumber || dayNumber < 1 || dayNumber > 5) {
      warnings.push(`Row ${index + 2}: skipped because day_number must be between 1 and 5.`);
      return;
    }
    if (!cleanString(row.exercise_name)) {
      warnings.push(`Row ${index + 2}: skipped because exercise_name is required.`);
      return;
    }
    if (!daysByNumber.has(dayNumber)) {
      daysByNumber.set(dayNumber, {
        day_number: dayNumber,
        name: nullableString(row.workout_name) || `Day ${dayNumber}`,
        goal: nullableString(row.day_goal),
        notes: nullableString(row.day_notes),
        exercises: [],
      });
    }
    const day = daysByNumber.get(dayNumber);
    day.exercises.push({
      name: cleanString(row.exercise_name),
      sets: nullableString(row.sets),
      reps: nullableString(row.reps),
      rest: nullableString(row.rest),
      tempo: nullableString(row.tempo),
      client_notes: nullableString(row.client_notes || row.notes),
      coach_notes: nullableString(row.coach_notes),
      video_url: nullableString(row.video_url),
      category: nullableString(row.category),
      equipment: nullableString(row.equipment),
      primary_muscle: nullableString(row.primary_muscle),
    });
  });

  return normalizeDraft({
    program: {
      name: nullableString(first.program_name) || nullableString(options.originalFilename).replace(/\.[^.]+$/, '') || 'Imported Program',
      description: nullableString(first.program_description),
      frequency_days: frequency,
      source: options.sourceType || 'csv',
    },
    days: Array.from(daysByNumber.values()).sort((a, b) => a.day_number - b.day_number),
    import_meta: {
      source_type: options.sourceType || 'csv',
      original_filename: options.originalFilename || '',
      parser_version: PARSER_VERSION,
      confidence: null,
      warnings,
      new_exercises_detected: [],
      possible_duplicates: [],
    },
  });
}

function parseCsvDraft(text, options = {}) {
  const { headers, rows } = parseCsv(text);
  const warnings = [];
  const missing = REQUIRED_CSV_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) {
    const error = new Error(`Missing required CSV columns: ${missing.join(', ')}`);
    error.validation = { missing_columns: missing };
    throw error;
  }
  const unknown = headers.filter((header) => !KNOWN_CSV_COLUMNS.includes(header));
  if (unknown.length) warnings.push(`Ignored unknown CSV columns: ${unknown.join(', ')}`);
  const draft = draftFromCsvRows(rows, options);
  draft.import_meta.warnings = [...warnings, ...(draft.import_meta.warnings || [])];
  return draft;
}

function matchExerciseLine(line) {
  const match = cleanString(line).match(EXERCISE_LINE_PATTERN);
  if (!match) return null;
  return {
    name: cleanString(match[1]),
    sets: match[2],
    reps: match[3],
    client_notes: cleanString(match[4]),
  };
}

function parseRestDetail(line) {
  const segments = cleanString(line).split(DETAIL_SEPARATOR_PATTERN);
  const rest = cleanString((segments.shift() || '').replace(/^rest\b\s*:?\s*/i, ''));
  let tempo = '';
  const cueSegments = [];

  for (const segment of segments) {
    const tempoMatch = segment.match(/^tempo\b\s*:?\s*(.*)$/i);
    if (tempoMatch && !tempo) tempo = cleanString(tempoMatch[1]);
    else if (cleanString(segment)) cueSegments.push(cleanString(segment));
  }

  return { rest, tempo, cue: cueSegments.join(' ') };
}

function parsePasteDraft(text) {
  const normalizedText = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalizedText) {
    const error = new Error("Couldn't find any exercises in this text.");
    error.code = 'NO_EXERCISES_FOUND';
    error.validation = { no_exercises: true };
    throw error;
  }

  const warnings = [];
  let exerciseCount = 0;
  const blocks = normalizedText.split(/\n(?:[ \t]*\n)+/);
  const days = blocks.map((block, blockIndex) => {
    const lines = block.split('\n').map(cleanString).filter(Boolean);
    const dayNumber = blockIndex + 1;
    const firstLineIsExercise = Boolean(matchExerciseLine(lines[0]));
    const notes = [];
    const exercises = [];
    let lineIndex = firstLineIsExercise ? 0 : 1;

    while (lineIndex < lines.length) {
      const exerciseMatch = matchExerciseLine(lines[lineIndex]);
      if (!exerciseMatch) {
        notes.push(lines[lineIndex]);
        warnings.push(`Day ${dayNumber}, line ${lineIndex + 1}: kept unmatched text as a day note: "${lines[lineIndex]}"`);
        lineIndex += 1;
        continue;
      }

      const exercise = {
        name: exerciseMatch.name,
        sets: exerciseMatch.sets,
        reps: exerciseMatch.reps,
        rest: '',
        tempo: '',
        client_notes: exerciseMatch.client_notes,
        coach_notes: '',
        video_url: '',
        category: '',
        equipment: '',
        primary_muscle: '',
      };
      const detailLine = lines[lineIndex + 1];
      if (detailLine && REST_DETAIL_PATTERN.test(detailLine) && !matchExerciseLine(detailLine)) {
        const detail = parseRestDetail(detailLine);
        exercise.rest = detail.rest;
        exercise.tempo = detail.tempo;
        exercise.client_notes = [exercise.client_notes, detail.cue].filter(Boolean).join(' ');
        lineIndex += 1;
      }
      exercises.push(exercise);
      exerciseCount += 1;
      lineIndex += 1;
    }

    return {
      day_number: dayNumber,
      name: firstLineIsExercise ? `Day ${dayNumber}` : lines[0],
      goal: '',
      notes: notes.join('; '),
      exercises,
    };
  });

  if (!exerciseCount) {
    const error = new Error("Couldn't find any exercises in this text.");
    error.code = 'NO_EXERCISES_FOUND';
    error.validation = { no_exercises: true };
    throw error;
  }

  return normalizeDraft({
    program: {
      name: '',
      description: '',
      frequency_days: blocks.length,
      source: 'paste',
    },
    days,
    import_meta: {
      source_type: 'paste',
      original_filename: '',
      parser_version: PARSER_VERSION,
      confidence: null,
      warnings,
      new_exercises_detected: [],
      possible_duplicates: [],
    },
  });
}

function normalizeDraft(input = {}) {
  const draft = {
    program: {
      name: cleanString(input.program?.name),
      description: nullableString(input.program?.description),
      frequency_days: Number(input.program?.frequency_days),
      source: nullableString(input.program?.source),
    },
    days: Array.isArray(input.days) ? input.days.map((day, dayIndex) => ({
      day_number: Number(day.day_number || dayIndex + 1),
      name: nullableString(day.name) || `Day ${Number(day.day_number || dayIndex + 1)}`,
      goal: nullableString(day.goal),
      notes: nullableString(day.notes),
      exercises: Array.isArray(day.exercises) ? day.exercises.map((exercise) => ({
        name: cleanString(exercise.name || exercise.custom_name || exercise.library_exercise?.name),
        sets: nullableString(exercise.sets),
        reps: nullableString(exercise.reps),
        rest: nullableString(exercise.rest),
        tempo: nullableString(exercise.tempo),
        client_notes: nullableString(exercise.client_notes || exercise.notes),
        coach_notes: nullableString(exercise.coach_notes),
        video_url: nullableString(exercise.video_url || exercise.library_exercise?.video_url),
        category: nullableString(exercise.category || exercise.library_exercise?.category),
        equipment: nullableString(exercise.equipment || exercise.library_exercise?.equipment),
        primary_muscle: nullableString(exercise.primary_muscle || exercise.library_exercise?.primary_muscle),
      })) : [],
    })) : [],
    import_meta: {
      source_type: input.import_meta?.source_type || 'csv',
      original_filename: nullableString(input.import_meta?.original_filename),
      parser_version: input.import_meta?.parser_version || PARSER_VERSION,
      confidence: input.import_meta?.confidence ?? null,
      warnings: Array.isArray(input.import_meta?.warnings) ? input.import_meta.warnings.filter(Boolean).map(String) : [],
      new_exercises_detected: Array.isArray(input.import_meta?.new_exercises_detected) ? input.import_meta.new_exercises_detected : [],
      possible_duplicates: Array.isArray(input.import_meta?.possible_duplicates) ? input.import_meta.possible_duplicates : [],
    },
  };
  return draft;
}

function validateDraft(input) {
  const draft = normalizeDraft(input);
  const errors = [];
  const isPasteDraft = draft.import_meta.source_type === 'paste';
  const supportedFrequencies = isPasteDraft ? [1, 2, 3, 4, 5] : [3, 4, 5];
  if (!draft.program.name) errors.push({ path: 'program.name', message: 'Program name is required' });
  if (!supportedFrequencies.includes(draft.program.frequency_days)) {
    errors.push({
      path: 'program.frequency_days',
      message: isPasteDraft ? 'Choose 1 to 5 days per week' : 'Choose 3, 4, or 5 days per week',
    });
  }
  if (draft.days.length !== draft.program.frequency_days) errors.push({ path: 'days', message: `Add exactly ${draft.program.frequency_days || 0} workout days` });
  const dayNumbers = new Set();
  draft.days.forEach((day, dayIndex) => {
    if (!day.day_number || day.day_number < 1 || day.day_number > 5) errors.push({ path: `days.${dayIndex}.day_number`, message: 'Day number must be between 1 and 5' });
    if (dayNumbers.has(day.day_number)) errors.push({ path: `days.${dayIndex}.day_number`, message: `Day ${day.day_number} is duplicated` });
    dayNumbers.add(day.day_number);
    if (!day.name) errors.push({ path: `days.${dayIndex}.name`, message: 'Workout day name is required' });
    if (!day.exercises.length) errors.push({ path: `days.${dayIndex}.exercises`, message: 'Add at least one exercise' });
    day.exercises.forEach((exercise, exerciseIndex) => {
      if (!exercise.name) errors.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.name`, message: 'Exercise name is required' });
    });
  });
  return { valid: errors.length === 0, errors, draft };
}

function draftFromProgram(program) {
  return normalizeDraft({
    program: {
      name: program.name,
      description: program.description,
      frequency_days: program.frequency_days,
      source: program.source || 'manual',
    },
    days: (program.days || []).map((day) => ({
      day_number: day.day_number,
      name: day.workout?.name || `Day ${day.day_number}`,
      goal: day.workout?.goal || '',
      notes: day.notes || '',
      exercises: (day.workout?.exercises || []).map((exercise) => ({
        name: exercise.library_exercise?.name || exercise.custom_name || exercise.name,
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.rest,
        tempo: exercise.tempo,
        client_notes: exercise.client_notes || exercise.notes || '',
        coach_notes: exercise.coach_notes || '',
        video_url: exercise.video_url || exercise.library_exercise?.video_url || '',
        category: exercise.library_exercise?.category || '',
        equipment: exercise.library_exercise?.equipment || '',
        primary_muscle: exercise.library_exercise?.primary_muscle || '',
      })),
    })),
    import_meta: {
      source_type: 'manual',
      original_filename: '',
      parser_version: PARSER_VERSION,
      confidence: null,
      warnings: [],
      new_exercises_detected: [],
      possible_duplicates: [],
    },
  });
}

module.exports = {
  PARSER_VERSION,
  REQUIRED_CSV_COLUMNS,
  KNOWN_CSV_COLUMNS,
  normalizeName,
  parseCsv,
  parseCsvDraft,
  parsePasteDraft,
  csvTemplate,
  normalizeDraft,
  validateDraft,
  draftFromProgram,
};
