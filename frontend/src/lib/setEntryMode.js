// Focused set entry is opt-in while it is validated on phones (round-2
// design decision, 2026-09-29). `?entry=focused` on the tracker URL turns it
// on for this device and `?entry=list` turns it back off; nothing in the UI
// links to either yet, so clients stay on the set table by default.
const STORAGE_KEY = 'cvf_set_entry';

export function readSetEntryMode(search) {
  const requested = new URLSearchParams(search || '').get('entry');
  try {
    if (requested === 'focused' || requested === 'list') {
      localStorage.setItem(STORAGE_KEY, requested);
      return requested;
    }
    return localStorage.getItem(STORAGE_KEY) === 'focused' ? 'focused' : 'list';
  } catch {
    return requested === 'focused' ? 'focused' : 'list';
  }
}
