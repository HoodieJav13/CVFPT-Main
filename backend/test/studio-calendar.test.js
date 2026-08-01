const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sessions.js'), 'utf8');
const calendar = fs.readFileSync(path.join(root, 'frontend', 'src', 'pages', 'coach', 'Calendar.jsx'), 'utf8');

test('studio route: coach-only, registered before param routes, D1 masking server-side', () => {
  assert.match(routes, /router\.get\('\/studio', requireCoach/);
  // Express matches in registration order: /studio must precede /:id.
  assert.ok(
    routes.indexOf("router.get('/studio'") < routes.indexOf("router.put('/:id'"),
    'studio route must be registered before /:id routes',
  );
  // Masking keys on the CLIENT's coach (not the session's), with an
  // admin exemption; the name is stripped server-side, never client-side.
  assert.match(routes, /session\.client\?\.coach_id === viewerCoachId/);
  assert.match(routes, /const isAdmin = req\.user\.role === 'admin';/);
  assert.match(routes, /client: own && session\.client \? \{ id: session\.client\.id, name: session\.client\.name \} : null/);
  assert.match(routes, /masked: !own/);
  // The response is rebuilt field-by-field — the raw row (with the
  // client join carrying coach_id) is never spread through.
  const studioBlock = routes.slice(routes.indexOf("router.get('/studio'"), routes.indexOf('// POST /api/sessions'));
  assert.doesNotMatch(studioBlock, /\.\.\.session/);
});

test('calendar renders masked rows as Busy and keeps My week unchanged', () => {
  assert.match(calendar, /calendar-scope-\$\{key\}/);
  assert.match(calendar, /\[\['mine', 'My week'\], \['studio', 'Studio'\]\]/);
  assert.match(calendar, /scope === 'studio' \? '\/sessions\/studio' : '\/sessions'/);
  assert.match(calendar, /session\.masked \? 'Busy'/);
  assert.match(calendar, /data-masked=\{session\.masked \|\| undefined\}/);
});
