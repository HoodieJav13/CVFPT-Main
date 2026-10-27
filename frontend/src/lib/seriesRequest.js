import { sortRows } from './seriesPlan.js';

export function createSeqGuard() {
  let latest = 0;
  return {
    next() { latest += 1; return latest; },
    isCurrent(seq) { return seq === latest; },
  };
}

// What a failed save means for the request id:
//  - unknown     : no response / timeout / 5xx. The server may have committed. Freeze the
//                  form and retry the SAME request until a definitive answer arrives.
//  - conflicts   : 409 with conflicts. Nothing was written; the coach edits and saves again.
//  - mismatch    : 409 request_mismatch. Surface it; never auto-retry under a new id.
//  - definitive  : any other 4xx. Nothing was written.
export function classifySaveOutcome(error) {
  const response = error?.response;
  if (!response) return { kind: 'unknown' };
  const { status, data } = response;
  if (status === 409 && data?.code === 'request_mismatch') return { kind: 'mismatch' };
  if (status === 409 && Array.isArray(data?.conflicts)) return { kind: 'conflicts', conflicts: data.conflicts };
  if (status >= 500) return { kind: 'unknown' };
  return { kind: 'definitive', message: data?.error || 'Could not save the series' };
}

const selectedSorted = (rows) => sortRows(rows).filter((row) => row.selected);

export function buildCheckBody({ clientId, durationMinutes, startDate, rows, seq }) {
  return {
    client_id: clientId,
    duration_minutes: durationMinutes,
    start_date: startDate,
    seq,
    slots: selectedSorted(rows).map(({ key, date, time }) => ({ key, date, time })),
  };
}

export function buildCreateBody({
  requestId, clientId, durationMinutes, location, rule, rows, mapping, programId, assignProgram, notify,
}) {
  return {
    request_id: requestId,
    client_id: clientId,
    duration_minutes: durationMinutes,
    location: location || null,
    rule,
    slots: selectedSorted(rows).map((row) => ({ key: row.key, date: row.date, time: row.time, workout_id: mapping?.[row.key] ?? null })),
    program_id: programId || null,
    assign_program: Boolean(programId) && Boolean(assignProgram),
    notify: Boolean(notify),
  };
}
