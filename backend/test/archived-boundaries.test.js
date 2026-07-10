const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function routeSource(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', name), 'utf8');
}

function assertQueryFiltersArchived(source, table, nearbyMarker) {
  const start = source.indexOf(nearbyMarker);
  assert.notEqual(start, -1, `missing route marker: ${nearbyMarker}`);
  const excerpt = source.slice(start, start + 1_500);
  assert.match(excerpt, new RegExp(`from\\('${table}'\\)[\\s\\S]*?eq\\('archived', false\\)`));
}

test('ordinary owned-resource routes exclude archived records', () => {
  const clients = routeSource('clients.js');
  assert.match(clients, /includeArchived = false/);
  assert.match(clients, /if \(!includeArchived\) query = query\.eq\('archived', false\)/);
  assert.match(clients, /loadClientOr404\(req, res, \{ includeArchived: true \}\)/);

  assertQueryFiltersArchived(routeSource('sessions.js'), 'sessions', 'async function loadSessionForCoach');
  assertQueryFiltersArchived(routeSource('progress.js'), 'clients', 'async function guardClient');
  assertQueryFiltersArchived(routeSource('checkins.js'), 'clients', 'async function loadClientForCoach');
  assertQueryFiltersArchived(routeSource('messages.js'), 'clients', "router.get('/with/:clientId'");
  assertQueryFiltersArchived(routeSource('bookings.js'), 'booking_requests', 'async function loadBookingForCoach');
  assertQueryFiltersArchived(routeSource('programs.js'), 'workouts', 'async function workoutWithDetails');
  assertQueryFiltersArchived(routeSource('programs.js'), 'programs', 'async function programWithDetails');
  assertQueryFiltersArchived(routeSource('payments.js'), 'purchases', "router.get('/verify'");
  assertQueryFiltersArchived(routeSource('waivers.js'), 'clients', "router.get('/client/:clientId/status'");
});
