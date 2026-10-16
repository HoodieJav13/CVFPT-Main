import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function useExerciseRemoval(setForm) {
  const [removed, setRemoved] = useState(null);
  const remove = (exercises, index) => {
    setRemoved({ row: exercises[index], index, next: exercises[index + 1]?._uid, previous: exercises[index - 1]?._uid });
    setForm((current) => ({ ...current, exercises: current.exercises.filter((row) => row._uid !== exercises[index]._uid) }));
  };
  const undo = () => {
    if (!removed) return;
    setForm((current) => {
      if (current.exercises.some((row) => row._uid === removed.row._uid)) return current;
      const exercises = [...current.exercises];
      const next = exercises.findIndex((row) => row._uid === removed.next);
      const previous = exercises.findIndex((row) => row._uid === removed.previous);
      const index = next >= 0 ? next : previous >= 0 ? previous + 1 : Math.min(removed.index, exercises.length);
      exercises.splice(index, 0, removed.row);
      return { ...current, exercises };
    });
    setRemoved(null);
  };
  return { remove, undo, removed };
}
export function ExerciseRemovalNotice({ removal, disabled = false }) {
  if (!removal.removed) return null;
  return <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2" role="status">
    <span className="min-w-0 break-words text-sm">Removed {removal.removed.row.custom_name || 'exercise'}.</span>
    <Button type="button" size="touch" variant="outline" className="rounded-lg" disabled={disabled} onClick={removal.undo} aria-label="Undo removal">Undo</Button>
  </div>;
}
