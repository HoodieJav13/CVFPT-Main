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

test('auto-book runs creation + approval in one RPC with strict outcomes', () => {
  // One transaction: request_booking wraps insert + optional approve.
  assert.match(migration, /create or replace function public\.request_booking\(/);
  assert.match(migration, /v_approval := public\.approve_booking\(v_request\.id\);/);
  // SQL side only reports success on an explicit 'approved'.
  assert.match(migration, /v_approval is not null and v_approval->>'outcome' = 'approved'/);
  assert.match(migration, /revoke execute on function public\.request_booking\(uuid, uuid, timestamptz, integer, text, text, boolean\) from public, anon, authenticated;/);
  // Route side: single RPC call, strict outcome mapping, everything
  // unexpected throws instead of claiming a booking.
  assert.match(bookings, /\.rpc\('request_booking', \{/);
  assert.match(bookings, /p_auto_book: offeredSlot && Boolean\(coachRow\.data\?\.auto_book\)/);
  assert.match(bookings, /result\?\.outcome === 'auto_booked'/);
  assert.match(bookings, /result\?\.outcome === 'pending'/);
  assert.match(bookings, /throw new Error\(`unexpected request_booking outcome/);
  // The free-picker fallback (no published hours) never auto-books.
  assert.match(bookings, /let offeredSlot = false;/);
  assert.doesNotMatch(bookings, /from\('booking_requests'\)\.insert/);
});

test('D3 UI: enabling requires confirmation; client sees the booked outcome', () => {
  assert.match(editor, /auto-book-switch/);
  assert.match(editor, /auto-book-confirm/);
  assert.match(editor, /auto-book-cancel/);
  // Turning ON goes through the dialog; turning OFF is direct.
  assert.match(editor, /if \(checked\) setConfirmAutoBook\(true\); else setAutoBook\(false\);/);
  assert.match(editor, /instantly bookable/);
  // Copy reflects the setting on both sides: the coach drawer states
  // instant booking when on, and the client submit says Book session
  // only for offered slots under an opted-in coach.
  assert.match(editor, /Instant booking is on/);
  assert.match(clientSessions, /coachAutoBook && slots \? 'Book session' : 'Send request'/);
  assert.match(clientSessions, /Open times book instantly/);
  assert.match(clientSessions, /data\?\.auto_booked/);
});
