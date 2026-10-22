// Coach Notes stay on coach screens: only the coach client page renders the
// section, and only that component (plus the preview mock) calls the notes
// API. The server is still the real boundary; this keeps client screens from
// ever asking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const files = [];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) walk(full); else if (/\.(jsx?|mjs)$/.test(entry.name)) files.push(full);
});
walk(src);
const rel = (file) => path.relative(src, file).split(path.sep).join('/');
const matching = (pattern) => files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(rel).sort();

test('only the coach client page imports the Coach Notes section', () => {
  assert.deepEqual(matching(/from '@\/components\/CoachNotes'/), ['pages/coach/ClientDetail.jsx']);
});

test('only the section and the preview mock reference the coach-notes API', () => {
  // The API path segment, not unrelated test ids such as check-in-coach-notes.
  assert.deepEqual(matching(/\/coach-notes\b/), ['components/CoachNotes.jsx', 'lib/previewMode.js']);
});

test('no client-role screen references coach notes', () => {
  const clientScreens = files.filter((file) => rel(file).startsWith('pages/client/'));
  assert.ok(clientScreens.length > 0);
  for (const file of clientScreens) assert.doesNotMatch(readFileSync(file, 'utf8'), /\/coach-notes\b|CoachNotes|client_coach_notes/, rel(file));
});
