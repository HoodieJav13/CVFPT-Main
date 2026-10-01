const STEP_MINUTES = 15;
const WINDOW_MINUTES = 180;
const FIRST_START = 5 * 60;          // 05:00 — the DateTimePicker's first allowed start time
const LAST_START = 20 * 60 + 45;     // 20:45 — and its last (a start time, not a closing time: a 90-minute session started then ends later)
const MAX_ALTERNATIVES_PER_CALL = 600;
const MAX_SUGGESTIONS_PER_ROW = 3;

const pad = (n) => String(n).padStart(2, '0');
const toTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Same-day alternatives around the requested time, nearest first: +15, -15, +30, -30, ...
function candidateTimes({ date, time }) {
  const [hour, minute] = time.split(':').map(Number);
  const base = hour * 60 + minute;
  const out = [];
  for (let delta = STEP_MINUTES; delta <= WINDOW_MINUTES; delta += STEP_MINUTES) {
    for (const sign of [1, -1]) {
      const candidate = base + sign * delta;
      if (candidate < FIRST_START || candidate > LAST_START) continue;
      out.push({ date, time: toTime(candidate) });
    }
  }
  return out;
}

function chunk(items, size) {
  const parts = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

module.exports = { candidateTimes, chunk, MAX_ALTERNATIVES_PER_CALL, MAX_SUGGESTIONS_PER_ROW };
