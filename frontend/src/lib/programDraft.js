import { normalizeTracking } from './workoutMetrics.js';
// ESM browser copy of backend/src/lib/programDraft.cjs — keep logic in sync manually. See CLAUDE.md.
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
  'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit',
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

// Demo reference for an imported or copied row (docs/exercise-guides/design.md).
// An explicit mode is kept as given (null = an unclassified legacy copy) and
// checked by validateDraft; otherwise a per-row link is an explicit override and
// no link inherits the library demo live. A library exercise's own link is never
// copied into the row.
function draftDemoReference(exercise) {
  const videoUrl = nullableString(exercise.video_url);
  if (Object.prototype.hasOwnProperty.call(exercise, 'video_link_mode')) {
    return { video_url: videoUrl, video_link_mode: exercise.video_link_mode ?? null };
  }
  return { video_url: videoUrl, video_link_mode: videoUrl ? 'override' : 'inherit' };
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
      tracking_type: row.tracking_type || 'reps_weight', duration_value: row.duration_value, duration_unit: row.duration_unit, distance_value: row.distance_value, distance_unit: row.distance_unit,
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

function noExercisesError(validation = { no_exercises: true }) {
  const error = new Error("Couldn't find any exercises in this text.");
  error.code = 'NO_EXERCISES_FOUND';
  error.validation = validation;
  return error;
}

// Shared by paste import and workout authoring: blank lines split days, a first
// line that is not an exercise names the day, other unmatched lines become day
// notes, and a following "Rest ..." line adds rest/tempo/cue to its exercise.
// matchLine alone decides what an exercise line is.
function walkPasteBlocks(normalizedText, matchLine) {
  const warnings = [];
  const annotations = [];
  const unmatched = [];
  const headers = [];
  let exerciseCount = 0;
  const blocks = normalizedText.split(/\n(?:[ \t]*\n)+/);
  const days = blocks.map((block, blockIndex) => {
    const lines = block.split('\n').map(cleanString).filter(Boolean);
    const dayNumber = blockIndex + 1;
    const firstLineIsExercise = Boolean(matchLine(lines[0]));
    const notes = [];
    const exercises = [];
    const dayAnnotations = [];
    const dayUnmatched = [];
    let lineIndex = firstLineIsExercise ? 0 : 1;

    while (lineIndex < lines.length) {
      const exerciseMatch = matchLine(lines[lineIndex]);
      if (!exerciseMatch) {
        notes.push(lines[lineIndex]);
        dayUnmatched.push(lines[lineIndex]);
        warnings.push(`Day ${dayNumber}, line ${lineIndex + 1}: kept unmatched text as a day note: "${lines[lineIndex]}"`);
        lineIndex += 1;
        continue;
      }

      const exercise = {
        name: exerciseMatch.name,
        sets: exerciseMatch.sets,
        reps: exerciseMatch.reps,
        ...exerciseMatch.tracking,
        rest: exerciseMatch.rest || '',
        tempo: exerciseMatch.tempo || '',
        client_notes: exerciseMatch.client_notes,
        coach_notes: '',
        video_url: '',
        category: '',
        equipment: '',
        primary_muscle: '',
      };
      const detailLine = lines[lineIndex + 1];
      if (detailLine && REST_DETAIL_PATTERN.test(detailLine) && !matchLine(detailLine)) {
        const detail = parseRestDetail(detailLine);
        exercise.rest = detail.rest || exercise.rest;
        exercise.tempo = detail.tempo || exercise.tempo;
        exercise.client_notes = [exercise.client_notes, detail.cue].filter(Boolean).join(' ');
        lineIndex += 1;
      }
      exercises.push(exercise);
      dayAnnotations.push(exerciseMatch.annotation || null);
      exerciseCount += 1;
      lineIndex += 1;
    }

    annotations.push(dayAnnotations);
    unmatched.push(dayUnmatched);
    headers.push(firstLineIsExercise ? null : lines[0]);
    return {
      day_number: dayNumber,
      name: firstLineIsExercise ? `Day ${dayNumber}` : lines[0],
      goal: '',
      notes: notes.join('; '),
      exercises,
    };
  });
  return { blocks, days, warnings, exerciseCount, annotations, unmatched, headers };
}

function parsePasteDraft(text) {
  const normalizedText = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalizedText) throw noExercisesError();

  const { blocks, days, warnings, exerciseCount } = walkPasteBlocks(normalizedText, matchExerciseLine);
  if (!exerciseCount) throw noExercisesError();

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

// ----- Workout authoring (docs/workout-authoring/first-slice.md) -----
// Typed, pasted or keyboard-dictated workout text. Uses the paste walker with a
// line reader that also understands spoken set phrasing and duration/distance
// units, keeping values and units as written. A prescription it cannot hold
// (unknown unit, a range for a time/distance target, decimal reps) is returned
// as an explicit issue with its raw text, never as reps. parsePasteDraft is
// unchanged.
const AUTHORING_PARSER_VERSION = 'workout-authoring-v1';
const AUTHORING_UNIT_WORDS = {
  reps: ['rep', 'reps', 'repetition', 'repetitions'],
  sets: ['set', 'sets'],
  s: ['s', 'sec', 'secs', 'second', 'seconds'],
  min: ['min', 'mins', 'minute', 'minutes'],
  m: ['m', 'meter', 'meters', 'metre', 'metres'],
  km: ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'],
  mi: ['mi', 'mile', 'miles'],
  yd: ['yd', 'yds', 'yard', 'yards'],
};
// Units the workout builder cannot store. They are never converted or read as reps.
const AUTHORING_UNSUPPORTED_UNITS = [
  'h', 'hr', 'hrs', 'hour', 'hours', 'ms', 'cal', 'cals', 'calorie', 'calories', 'kcal', 'ft', 'feet', 'foot',
  'inch', 'inches', 'step', 'steps', 'breath', 'breaths', 'lap', 'laps', 'round', 'rounds', 'floor', 'floors',
  'lb', 'lbs', 'kg', 'kgs',
];
const AUTHORING_NUMBER = '(\\d+(?:\\.\\d+)?)';
const AUTHORING_RANGE = `(?:\\s*(?:-|\\u2013|\\u2014|\\u2212|to)\\s*${AUTHORING_NUMBER})?`;
// "Name 3x10", "Name 3 x 30 sec", "Name 3 by 10", "Name 3 sets of 8 to 10 reps".
const AUTHORING_SETS_PATTERN = new RegExp(`^(.+?)\\s+(\\d+)\\s*(?:[xX\\u00d7*]|by\\b|sets?(?:\\s+(?:of|x|\\u00d7))?)\\s*${AUTHORING_NUMBER}${AUTHORING_RANGE}(.*)$`, 'i');
// "Name 30 sec", "Name 1.5 mi", "Name 10 reps", "Name 3 sets": the first number followed by a unit word.
const AUTHORING_METRIC_SCAN = new RegExp(`\\s${AUTHORING_NUMBER}${AUTHORING_RANGE}\\s*([a-zA-Z]+)\\b`, 'g');
const AUTHORING_SECOND_METRIC = /^\s*(?:,|\/|\+|&|and\b|in\b|for\b|@|at\b)?\s*(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|−|to)\s*(\d+(?:\.\d+)?))?\s*([a-zA-Z]+)\b(.*)$/i;
const AUTHORING_SECOND_TARGET_START = /^\s*(?:,|\/|\+|&|and\b|in\b|for\b|@|at\b)?\s*\d/;
const AUTHORING_DAY_HEADER = /^(?:day\s*(?:\d+|one|two|three|four|five|six|seven)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
// Text that looks like it carries a prescription, so it is not quietly kept as a note or a day name.
const AUTHORING_SIGNAL = /\d|\b(?:sets?|reps?|seconds?|secs?|minutes?|mins?|rounds?|miles?|meters?|metres?|yards?|laps?)\b/i;
const AUTHORING_REPS_TRACKING = { tracking_type: 'reps_weight', duration_value: null, duration_unit: null, distance_value: null, distance_unit: null };

function authoringUnit(word) {
  const key = String(word || '').toLowerCase();
  if (!key) return null;
  for (const [unit, words] of Object.entries(AUTHORING_UNIT_WORDS)) {
    if (!words.includes(key)) continue;
    if (unit === 'reps' || unit === 'sets') return { kind: unit };
    return { kind: unit === 's' || unit === 'min' ? 'duration' : 'distance', unit };
  }
  return AUTHORING_UNSUPPORTED_UNITS.includes(key) ? { kind: 'unsupported', word: key } : null;
}

// Rest, tempo and cues written after the prescription: ", rest 90s, tempo 3-1-1, chest up".
function authoringDetails(remainder) {
  const text = cleanString(remainder).replace(/^(?:[,;:]|-|–|—)+\s*/, '');
  let rest = '';
  let tempo = '';
  const cues = [];
  text.split(/\s*[,;]\s*|\s+(?:-|–|—|−)\s+/).map(cleanString).filter(Boolean).forEach((segment) => {
    const restMatch = segment.match(/^rest\b\s*:?\s*(.*)$/i);
    const tempoMatch = segment.match(/^tempo\b\s*:?\s*(.*)$/i);
    if (restMatch && !rest) rest = cleanString(restMatch[1]);
    else if (tempoMatch && !tempo) tempo = cleanString(tempoMatch[1]);
    else cues.push(segment);
  });
  return { rest, tempo, cue: cues.join(', ') };
}

function authoringPrescription(sourceLine, text, name, { sets, value, upper, unitWord, tail }) {
  let remainder = tail;
  let unit = null;
  let unknownSuffix = '';
  if (unitWord !== undefined) {
    unit = authoringUnit(unitWord);
  } else {
    const word = tail.match(/^\s*([a-zA-Z]+)\b(.*)$/);
    unit = word ? authoringUnit(word[1]) : null;
    if (unit) remainder = word[2];
    // A bare word immediately after a number could be a unit. Cue/detail
    // introductions have explicit grammar; other suffixes need the coach's
    // note/edit choice rather than an ever-growing list of rejected units.
    else if (word && !/^(?:to|at|rest|tempo)\b/i.test(word[1])) {
      unknownSuffix = cleanString(tail);
      remainder = '';
    }
  }
  const kind = unit ? unit.kind : 'reps';
  const tracking = { ...AUTHORING_REPS_TRACKING };
  let setsValue = sets;
  let reps = '';
  let reason = '';

  if (unknownSuffix) {
    reason = `The suffix "${unknownSuffix}" could not be classified as a unit or cue.`;
  } else if (kind === 'unsupported') {
    reason = `"${unit.word}" is not a unit the workout builder can hold.`;
  } else if (kind === 'reps') {
    if (!/^\d+$/.test(value) || (upper && !/^\d+$/.test(upper))) {
      reason = 'Reps must be whole numbers.';
    } else {
      reps = upper ? `${value}-${upper}` : value;
      const perSide = remainder.match(/^\/([a-zA-Z]+)\b(.*)$/);
      if (perSide) {
        reps += `/${perSide[1]}`;
        remainder = perSide[2];
      }
    }
  } else if (kind === 'sets') {
    if (sets || upper || !/^\d+$/.test(value)) reason = 'The number of sets is unclear.';
    else setsValue = value;
  } else if (upper) {
    reason = `A range (${value}-${upper} ${unit.unit}) cannot be a single ${kind} target.`;
  } else {
    tracking.tracking_type = kind;
    tracking[`${kind}_value`] = Number(value);
    tracking[`${kind}_unit`] = unit.unit;
    const second = remainder.match(AUTHORING_SECOND_METRIC);
    const other = second ? authoringUnit(second[3]) : null;
    if (second) {
      remainder = second[4];
      if (!other || !['duration', 'distance'].includes(other.kind)) {
        reason = `The additional target unit "${second[3]}" is not supported here.`;
      } else if (second[2]) {
        reason = `A range (${second[1]}-${second[2]} ${other.unit}) cannot be a single ${other.kind} target.`;
      } else if (other.kind === kind) {
        reason = `Two ${kind} targets were given.`;
      } else {
        tracking.tracking_type = 'duration_distance';
        tracking[`${other.kind}_value`] = Number(second[1]);
        tracking[`${other.kind}_unit`] = other.unit;
      }
    } else if (AUTHORING_SECOND_TARGET_START.test(remainder)) {
      reason = 'The additional target could not be read.';
      remainder = '';
    }
    if (!reason) {
      try { normalizeTracking(tracking); } catch (error) { reason = `${error.message}.`; }
    }
  }

  const raw = cleanString(text.slice(name.length, text.length - remainder.length));
  const details = authoringDetails(remainder);
  return {
    name,
    sets: reason ? sets : setsValue,
    reps: reason ? '' : reps,
    tracking: reason ? { ...AUTHORING_REPS_TRACKING } : tracking,
    rest: details.rest,
    tempo: details.tempo,
    client_notes: details.cue,
    annotation: { source_line: cleanString(sourceLine), prescription_issue: reason ? { raw, reason } : null },
  };
}

function matchAuthoringLine(line) {
  const text = cleanString(line).replace(/^(?:[-*•]|\d+[.)])\s+/, '');
  if (!text || /^(?:rest|tempo)\b/i.test(text) || AUTHORING_DAY_HEADER.test(text)) return null;
  const setsMatch = text.match(AUTHORING_SETS_PATTERN);
  if (setsMatch) {
    return {
      ...authoringPrescription(line, text, setsMatch[1], { sets: setsMatch[2], value: setsMatch[3], upper: setsMatch[4], tail: setsMatch[5] }),
      name: cleanString(setsMatch[1]),
    };
  }
  for (const found of text.matchAll(AUTHORING_METRIC_SCAN)) {
    const name = cleanString(text.slice(0, found.index));
    if (!name || !authoringUnit(found[3])) continue;
    return {
      ...authoringPrescription(line, text, text.slice(0, found.index), {
        sets: '', value: found[1], upper: found[2], unitWord: found[3], tail: text.slice(found.index + found[0].length),
      }),
      name,
    };
  }
  return null;
}

// Dictated text rarely has blank lines, so a "Day 2" / "Tuesday" header line also starts a new day.
function splitAuthoringDays(text) {
  const lines = [];
  text.split('\n').forEach((line) => {
    const clean = cleanString(line);
    if (lines.length && cleanString(lines[lines.length - 1]) && AUTHORING_DAY_HEADER.test(clean)) lines.push('');
    lines.push(line);
  });
  return lines.join('\n');
}

function parseAuthoringText(text) {
  const normalizedText = splitAuthoringDays(String(text || '').replace(/\r\n?/g, '\n')).trim();
  if (!normalizedText) throw noExercisesError({ no_exercises: true, unrecognized_lines: [] });
  const walked = walkPasteBlocks(normalizedText, matchAuthoringLine);
  if (!walked.exerciseCount) {
    throw noExercisesError({ no_exercises: true, unrecognized_lines: normalizedText.split('\n').map(cleanString).filter(Boolean) });
  }

  const warnings = [...walked.warnings];
  const review = { days: [] };
  const days = walked.days.map((day, index) => {
    const header = walked.headers[index];
    // A first line that reads like a prescription is not quietly used as the day name.
    const demoted = Boolean(header) && AUTHORING_SIGNAL.test(header) && !AUTHORING_DAY_HEADER.test(header);
    const extraLines = demoted ? [header, ...walked.unmatched[index]] : walked.unmatched[index];
    if (demoted) warnings.push(`Day ${day.day_number}: "${header}" was not used as the day name because it reads like a prescription.`);
    review.days.push({
      exercises: walked.annotations[index],
      extra_lines: extraLines.map((line) => ({ line, signal: AUTHORING_SIGNAL.test(line) })),
    });
    return demoted ? { ...day, name: `Day ${day.day_number}`, notes: extraLines.join('; ') } : day;
  });

  return {
    draft: normalizeDraft({
      program: { name: '', description: '', frequency_days: walked.blocks.length, source: 'authoring' },
      days,
      import_meta: {
        source_type: 'authoring',
        original_filename: '',
        parser_version: AUTHORING_PARSER_VERSION,
        confidence: null,
        warnings,
        new_exercises_detected: [],
        possible_duplicates: [],
      },
    }),
    review,
  };
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
        tracking_type: exercise.tracking_type ?? 'reps_weight',
        duration_value: exercise.duration_value ?? null, duration_unit: exercise.duration_unit || null,
        distance_value: exercise.distance_value ?? null, distance_unit: exercise.distance_unit || null,
        rest: nullableString(exercise.rest),
        tempo: nullableString(exercise.tempo),
        client_notes: nullableString(exercise.client_notes || exercise.notes),
        coach_notes: nullableString(exercise.coach_notes),
        ...draftDemoReference(exercise),
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
      try { normalizeTracking(exercise); } catch (error) { errors.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.tracking_type`, message: error.message }); }
      if (!exercise.name) errors.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}.name`, message: 'Exercise name is required' });
      const demoPath = `days.${dayIndex}.exercises.${exerciseIndex}.video_link_mode`;
      if (![null, 'inherit', 'override'].includes(exercise.video_link_mode)) errors.push({ path: demoPath, message: 'Choose the library demo or a custom link' });
      else if (exercise.video_link_mode === 'inherit' && exercise.video_url) errors.push({ path: demoPath, message: 'Use the library demo or a custom link, not both' });
      else if (exercise.video_link_mode === 'override' && !exercise.video_url) errors.push({ path: demoPath, message: 'Add a link, or choose the library demo' });
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
        tracking_type: exercise.tracking_type, duration_value: exercise.duration_value, duration_unit: exercise.duration_unit, distance_value: exercise.distance_value, distance_unit: exercise.distance_unit,
        rest: exercise.rest,
        tempo: exercise.tempo,
        client_notes: exercise.client_notes || exercise.notes || '',
        coach_notes: exercise.coach_notes || '',
        video_url: exercise.video_url || '',
        video_link_mode: exercise.video_link_mode ?? null,
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

const draftTools = {
  PARSER_VERSION,
  AUTHORING_PARSER_VERSION,
  REQUIRED_CSV_COLUMNS,
  KNOWN_CSV_COLUMNS,
  normalizeName,
  parseCsv,
  parseCsvDraft,
  parsePasteDraft,
  parseAuthoringText,
  csvTemplate,
  normalizeDraft,
  validateDraft,
  draftFromProgram,
};

export {
  PARSER_VERSION,
  AUTHORING_PARSER_VERSION,
  REQUIRED_CSV_COLUMNS,
  KNOWN_CSV_COLUMNS,
  normalizeName,
  parseCsv,
  parseCsvDraft,
  parsePasteDraft,
  parseAuthoringText,
  csvTemplate,
  normalizeDraft,
  validateDraft,
  draftFromProgram,
};

export default draftTools;
