const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260801011500_auto_book.sql'), 'utf8');
const availability = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'availability.js'), 'utf8');
const bookings = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'bookings.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'AvailabilityEditor.jsx'), 'utf8');
const clientSessions = fs.readFileSync(path.join(root, 'frontend', 'src', 'pages', 'client', 'Sessions.jsx'), 'utf8');

test('auto-book schema: coach flag defaults off, nothing else changes', () => {
  assert.match(migration, /alter table public\.coaches\s*add column if not exists auto_book boolean not null default false;/);
  assert.doesNotMatch(migration, /create table|drop |update public\./);
});

test('toggle route: own coach only, boolean-validated', () => {
  assert.match(availability, /router\.patch\('\/auto-book', requireCoach/);
  assert.match(availability, /if \(typeof enabled !== 'boolean'\)/);
  assert.match(availability, /\.update\(\{ auto_book: enabled \}\)\.eq\('id', req\.user\.coach\.id\)/);
  // The Hours editor payload includes the flag.
  assert.match(availability, /auto_book: Boolean\(coachRow\.data\?\.auto_book\)/);
});

test('auto-book approves through the same transactional RPC, never bypassing checks', () => {
  // Only an offered slot from an opted-in coach auto-approves.
  assert.match(bookings, /if \(offeredSlot && Boolean\(coachRow\.data\?\.auto_book\)\)/);
  assert.match(bookings, /\.rpc\('approve_booking', \{ p_booking_id: data\.id \}\)/);
  // A race lost between slot check and approve leaves the request
  // pending for the coach — a 201, never an error for the client.
  assert.match(bookings, /return res\.status\(201\)\.json\(\{ \.\.\.data, auto_booked: false \}\);/);
  assert.match(bookings, /approval\.outcome !== 'coach_conflict' && approval\.outcome !== 'client_conflict'/);
  // The free-picker fallback (no published hours) never auto-books.
  assert.match(bookings, /let offeredSlot = false;/);
});

test('D3 UI: enabling requires confirmation; client sees the booked outcome', () => {
  assert.match(editor, /auto-book-switch/);
  assert.match(editor, /auto-book-confirm/);
  assert.match(editor, /auto-book-cancel/);
  // Turning ON goes through the dialog; turning OFF is direct.
  assert.match(editor, /if \(checked\) setConfirmAutoBook\(true\); else setAutoBook\(false\);/);
  assert.match(editor, /instantly bookable/);
  assert.match(clientSessions, /data\?\.auto_booked/);
});
