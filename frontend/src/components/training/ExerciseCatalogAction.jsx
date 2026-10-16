import { useEffect, useRef, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { matchCatalogExercise } from '@/lib/trainingLibrary';

// Shared by the full, client-copy and quick builders. Newly created exercises
// are available to every row before the next parent list reload.
export function useBuilderCatalog(library) {
  const [created, setCreated] = useState([]);
  return [library.concat(created.filter((item) => !library.some((entry) => entry.id === item.id))),
    (item) => setCreated((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item])];
}

export function ExerciseCatalogAction({ exercise, library, onChange, onCreated, disabled = false }) {
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
  const create = async () => {
    if (pending.current || disabled || !name) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      // Refresh first: another coach may have added this since the builder opened.
      const { data: fresh } = await api.get('/programs/exercise-library');
      const existing = matchCatalogExercise(fresh, name);
      const saved = existing || (await api.post('/programs/exercise-library', { name, video_url: exercise.video_url || null })).data;
      if (!mounted.current) return;
      handlers.current.onCreated(saved);
      // A slow response must never replace a different name typed in the meantime.
      if (String(current.current.custom_name || '').trim().toLowerCase() === name.toLowerCase()) {
        handlers.current.onChange({ exercise_library_id: saved.id, custom_name: saved.name });
      }
    } catch (err) {
      if (mounted.current) setError(errMsg(err, 'Could not create exercise. Your workout entries are still here.'));
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
