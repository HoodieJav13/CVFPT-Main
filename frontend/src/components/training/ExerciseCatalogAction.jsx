import { useEffect, useRef, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { matchCatalogExercise } from '@/lib/trainingLibrary';
import { normalizeName } from '@/lib/programDraft';

// Coalesce same-account inline creates across rows/builders. This does not
// impose a new global uniqueness rule on the existing shared catalog.
const pendingCreates = new Map();
async function ensureCatalogExercise(key, name, videoUrl, isCurrent) {
  if (pendingCreates.has(key)) return pendingCreates.get(key);
  const request = (async () => {
    const { data: fresh } = await api.get('/programs/exercise-library?include_hidden=true');
    if (!isCurrent()) throw new Error('The editing session changed. Reopen the builder to try again.');
    const existing = matchCatalogExercise(fresh, name);
    if (existing?.hidden) throw new Error('This exercise is hidden. Make it available in the exercise catalog first.');
    return existing || (await api.post('/programs/exercise-library', { name, video_url: videoUrl || null })).data;
  })();
  pendingCreates.set(key, request);
  try { return await request; } finally { if (pendingCreates.get(key) === request) pendingCreates.delete(key); }
}

// Shared by the full, client-copy and quick builders. Newly created exercises
// are available to every row before the next parent list reload.
export function useBuilderCatalog(library) {
  const [created, setCreated] = useState([]);
  return [library.concat(created.filter((item) => !library.some((entry) => entry.id === item.id))),
    (item) => setCreated((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item])];
}

export function ExerciseCatalogAction({ exercise, library, onChange, onCreated, disabled = false, linkMatches = true }) {
  const { user, sessionEpoch } = useAuth();
  const actor = `${user?.profile?.id}:${sessionEpoch}`;
  const currentActor = useRef(actor); currentActor.current = actor;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handlers = useRef({ onChange, onCreated });
  handlers.current = { onChange, onCreated };
  const current = useRef(exercise);
  current.current = exercise;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pending = useRef(false);
  const name = String(exercise.custom_name || '').trim();
  const match = matchCatalogExercise(library, name);
  useEffect(() => {
    if (linkMatches && match && !exercise.exercise_library_id && !disabled) handlers.current.onChange({ exercise_library_id: match.id, custom_name: match.name });
  }, [match?.id, exercise.exercise_library_id, disabled, linkMatches]);
  const create = async () => {
    if (pending.current || disabled || !name) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await ensureCatalogExercise(`${actor}:${normalizeName(name)}`, name, exercise.video_url, () => mounted.current && currentActor.current === actor);
      if (!mounted.current || currentActor.current !== actor) return;
      handlers.current.onCreated(saved);
      // A slow response must never replace a different name typed in the meantime.
      if (normalizeName(current.current.custom_name) === normalizeName(name)) {
        handlers.current.onChange({ exercise_library_id: saved.id, custom_name: saved.name });
      }
    } catch (err) {
      if (mounted.current) setError(err.response ? errMsg(err, 'Could not create exercise. Your workout entries are still here.') : err.message || 'Could not create exercise. Your workout entries are still here.');
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  if (!name) return null;
  return (
    <div className="min-w-0 space-y-1">
      {exercise.exercise_library_id || match
        ? <p className="text-xs text-muted-foreground">In exercise catalog</p>
        : <><p className="text-xs text-muted-foreground">Custom exercise · only in this workout</p>
          <Button type="button" size="touch" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal rounded-xl text-left" disabled={disabled || saving} onClick={create}>
            {saving ? 'Adding to catalog…' : `Create “${name}” in catalog`}
          </Button></>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
