// Fictional replay notes (preview demo layer). In Live mode notes are saved on
// the server (POST /group-sessions/:id/notes) and reach the client with their
// workout; these device-local notes only back the fictional replay and its
// phone views (cvf_cockpit_notes:v1:<scope>). Every write reports failure, so
// the screen never shows a save, resolve or removal that did not happen.

import { COCKPIT_NOTES_PREFIX } from './config.js';

export const NOTE_KINDS = Object.freeze(['cue', 'pain']);
export const NOTE_MAX_LENGTH = 200;
const STORAGE_FAILED = 'This device could not save that change. Nothing was changed; try again.';

export function notesKey(scope) {
  return `${COCKPIT_NOTES_PREFIX}${scope}`;
}

function validNote(note) {
  return note && typeof note.id === 'string' && NOTE_KINDS.includes(note.kind) && typeof note.clientId === 'string'
    && typeof note.text === 'string' && note.text.length > 0 && note.text.length <= NOTE_MAX_LENGTH
    && Number.isFinite(note.createdAtMs);
}

export function readNotes(storage, scope) {
  try {
    const parsed = JSON.parse(storage.getItem(notesKey(scope)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(validNote) : [];
  } catch {
    return [];
  }
}

function writeNotes(storage, scope, notes) {
  try {
    storage.setItem(notesKey(scope), JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

// Returns { notes, note } or { error } (and then nothing changed).
export function addNote(storage, scope, { id, clientId, kind, text, setRef, createdAtMs, author }) {
  const clean = String(text ?? '').trim().slice(0, NOTE_MAX_LENGTH);
  if (!clean) return { error: 'Write a short note first.' };
  if (!NOTE_KINDS.includes(kind)) return { error: 'Choose cue or pain flag.' };
  const note = { id, clientId, kind, text: clean, setRef: setRef || null, createdAtMs, author: author || null, resolved: false, savedTo: 'this_device' };
  const notes = [...readNotes(storage, scope).filter((row) => row.id !== id), note];
  if (!writeNotes(storage, scope, notes)) return { error: STORAGE_FAILED };
  return { notes, note };
}

// Returns { notes } or { error, notes } where notes is the unchanged list.
export function resolveNote(storage, scope, id) {
  const current = readNotes(storage, scope);
  const notes = current.map((row) => (row.id === id ? { ...row, resolved: true } : row));
  return writeNotes(storage, scope, notes) ? { notes } : { error: STORAGE_FAILED, notes: current };
}

export function removeNote(storage, scope, id) {
  const current = readNotes(storage, scope);
  const notes = current.filter((row) => row.id !== id);
  return writeNotes(storage, scope, notes) ? { notes } : { error: STORAGE_FAILED, notes: current };
}

export function clearScope(storage, scope) {
  try {
    storage.removeItem(notesKey(scope));
    return {};
  } catch {
    return { error: STORAGE_FAILED };
  }
}

// Server notes (GET /group-sessions/:id/notes) in the shape the model uses.
export function fromServerNote(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    kind: row.kind,
    text: row.text,
    setRef: row.workout_log_set_id ? { logId: row.workout_log_id, setId: row.workout_log_set_id } : null,
    createdAtMs: Date.parse(row.created_at),
    author: row.author_name || null,
    resolved: Boolean(row.resolved_at),
    savedTo: 'account',
  };
}
