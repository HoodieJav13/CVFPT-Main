const { canAccessProgram } = require('../security/access');
const { logError } = require('../utils/logger');
// Only stored forward revisions establish history; never infer earlier changes.
function historyHandler(loadProgram, loadRevisions = async () => null) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!['coach', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Coach access required' });
    try {
      const program = await loadProgram(req.params.id);
      if (!program || program.archived || !canAccessProgram(req.user, program)) return res.status(404).json({ error: 'Program not found' });
      const stored = await loadRevisions(program.id);
      const rows = stored?.revisions || stored || [];
      const revisions = rows.map(row => ({ id: String(row.id), snapshot: row.snapshot, author: row.author || (row.author_coach_id ? { id: row.author_coach_id, name: row.author_name_snapshot } : null), recorded_at: row.recorded_at, source: row.source }));
      return res.json({ program_id: program.id, availability: revisions.length ? 'available' : 'unavailable', source: 'Stored program revisions', capture: stored === null ? 'disabled' : 'durable', revisions, has_earlier: Boolean(stored?.has_earlier) });
    } catch (error) {
      logError('program history read error', error);
      return res.status(500).json({ error: 'Could not load program history' });
    }
  };
}
module.exports = { historyHandler };
