// Minimal RFC 5545 event for "Add to calendar". UTC times only — calendar
// apps localize on import, so no timezone database is needed here.

function icsUtc(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Commas, semicolons, and backslashes are structural in ICS text values.
function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildSessionIcs(session, { otherName } = {}) {
  const start = new Date(session.scheduled_at);
  const end = new Date(start.getTime() + (session.duration_minutes * 60 * 1000));
  const summary = otherName ? `Training session with ${otherName}` : 'Training session';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CVF PT//Sessions//EN',
    'BEGIN:VEVENT',
    `UID:cvf-session-${session.id}@cvfpt`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsText(summary)}`,
    session.location ? `LOCATION:${icsText(session.location)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { buildSessionIcs, icsText, icsUtc };
