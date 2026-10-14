// Quick-session read helpers (spec R3). Completion comes from an authoritative,
// non-paginated database EXISTS read; history provenance is a safe enum from each
// log's own assignment. Read failures always propagate: never "false" or "absent".

// `assignmentIds` must be quick assignments of `clientId` that the caller is
// already authorized to read. Returns Map<assignmentId, boolean>.
async function quickCompletionFlags(clientId, assignmentIds, { db }) {
  const ids = [...new Set((assignmentIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await db.rpc('get_quick_session_completion', {
    p_client_id: clientId,
    p_assignment_ids: ids,
  });
  if (error) throw error;
  const flags = new Map((data || []).map((row) => [row.assignment_id, row.completed === true]));
  const missing = ids.filter((id) => !flags.has(id));
  if (missing.length) throw new Error(`Quick session completion read is incomplete (${missing.length} missing)`);
  return flags;
}

// Adds `quick_session_completed` to quick rows only; other rows are unchanged.
async function annotateQuickCompletion(clientId, assignments, { db }) {
  const quickIds = (assignments || []).filter((row) => row.kind === 'quick').map((row) => row.id);
  const flags = await quickCompletionFlags(clientId, quickIds, { db });
  return (assignments || []).map((row) => (row.kind === 'quick'
    ? { ...row, quick_session_completed: flags.get(row.id) === true }
    : row));
}

// Map<logId, 'quick'|'assigned'|null> from each log's own workout_assignment_id,
// including archived sources (kind is immutable). Program logs are null. Only the
// enum leaves this function: no receipt, actor, pointer or other assignment data.
async function quickLogKinds(logs, { db }) {
  const kinds = new Map((logs || []).map((log) => [log.id, null]));
  const assignmentIds = [...new Set((logs || []).map((log) => log.workout_assignment_id).filter(Boolean))];
  if (!assignmentIds.length) return kinds;
  const { data, error } = await db.from('workout_assignments').select('id, kind').in('id', assignmentIds);
  if (error) throw error;
  const byAssignment = new Map((data || []).map((row) => [row.id, row.kind === 'quick' ? 'quick' : 'assigned']));
  for (const log of logs || []) {
    if (log.workout_assignment_id) kinds.set(log.id, byAssignment.get(log.workout_assignment_id) || null);
  }
  return kinds;
}

module.exports = { annotateQuickCompletion, quickCompletionFlags, quickLogKinds };
