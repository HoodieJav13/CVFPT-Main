// Look A prescription facts on authored workout exercises (local migration
// 20261114120000): prescribed_load_max (an upper load in the lower load's
// unit) and per_side. Checked before the save RPC so a coach gets a clear
// 400; the database re-checks every writer (look_a_load_range). A key that is
// absent is left absent so the database keeps the stored value; an explicit
// null or "" clears the upper load.
// General authored loads are finite and zero or more (the established
// bound); the 2000 cap applies only to substitution targets (sessionEvents).

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeLookAPrescription(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    if ('per_side' in row) {
      if (typeof row.per_side !== 'boolean') throw invalid('Per side must be on or off');
      out.per_side = row.per_side;
    }
    if ('prescribed_load_max' in row) {
      const raw = row.prescribed_load_max;
      if (raw === null || raw === '') {
        out.prescribed_load_max = null;
      } else {
        const value = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN);
        if (!Number.isFinite(value) || value < 0) throw invalid('Enter the upper load as a number');
        const lowerRaw = row.default_load_value;
        const lower = lowerRaw === null || lowerRaw === undefined || lowerRaw === '' ? null : Number(lowerRaw);
        if ('default_load_value' in row && (lower === null || !(value >= lower))) {
          throw invalid('The upper load must be higher than the load it starts from.');
        }
        out.prescribed_load_max = value;
      }
    }
    return out;
  });
}

function isLoadRangeError(error) {
  return error?.code === '22023' && /upper load/i.test(error?.message || '');
}

module.exports = { normalizeLookAPrescription, isLoadRangeError };
