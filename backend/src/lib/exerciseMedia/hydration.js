// Attaches the CURRENT exercise guide (client-safe DTO) to workout rows that
// carry a canonical exercise id. One batched lookup per response, never per
// exercise. Disabled: rows are returned untouched with no query. A lookup
// failure must never block a workout read: media becomes null with
// media_status 'unavailable' and ordinary external links stay as they were.
const { logError } = require('../../utils/logger');
const { mediaConfig } = require('./config');

const BATCH = 500;

async function defaultLookup(ids) {
  const { defaultRuntime } = require('./runtime');
  const runtime = defaultRuntime();
  if (!runtime) return new Map();
  return runtime.service.mediaForExercises(ids);
}

async function attachExerciseMedia(rows, libraryIdOf, { enabled = mediaConfig().enabled, lookup = defaultLookup } = {}) {
  if (!enabled || !Array.isArray(rows) || !rows.length) return rows;
  const ids = [...new Set(rows.map(libraryIdOf).filter(Boolean))];
  let media = new Map();
  try {
    for (let i = 0; i < ids.length; i += BATCH) {
      for (const [key, value] of await lookup(ids.slice(i, i + BATCH))) media.set(key, value);
    }
  } catch (error) {
    logError('exercise media hydration error', error);
    return rows.map((row) => (libraryIdOf(row) ? { ...row, media: null, media_status: 'unavailable' } : { ...row, media: null }));
  }
  return rows.map((row) => ({ ...row, media: media.get(libraryIdOf(row)) || null }));
}

module.exports = { attachExerciseMedia };
