import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { parseYouTubeDemo } from '@/lib/exerciseDemo';
import { applyDemoChoice, applyDemoUrl, demoChoice, demoProblem } from '@/lib/trainingLibrary';

// Coach control for one workout exercise's demo reference
// (docs/exercise-guides/design.md). A library exercise either uses the library
// demo (followed live, nothing copied) or a custom link for this workout. A
// saved link from before library inheritance is labeled Legacy and stays as is
// until the coach deliberately chooses. Rendering never changes the row.
function describeLink(url) {
  if (!url) return null;
  return parseYouTubeDemo(url) ? 'YouTube demo, plays in the app on request' : 'External link, opens in a new tab';
}

export function DemoLinkField({ exercise, libraryExercise, onChange, testIdPrefix = 'workout-exercise' }) {
  const id = useId();
  const choice = demoChoice(exercise);
  const linked = Boolean(exercise.exercise_library_id);
  const problem = demoProblem(exercise);
  const libraryUrl = libraryExercise?.video_url || '';
  const showInput = !linked || choice === 'custom' || choice === 'legacy';
  const radio = (value, label, detail) => (
    <label className="flex min-h-11 items-start gap-2 text-sm">
      <input
        type="radio"
        name={`${id}-demo`}
        value={value}
        checked={choice === value}
        onChange={() => onChange(applyDemoChoice(exercise, value))}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        data-testid={`${testIdPrefix}-demo-${value}`}
      />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {detail && <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>}
      </span>
    </label>
  );
  return (
    <fieldset className="min-w-0 space-y-1 rounded-lg border border-border/60 px-3 pb-2 pt-1" data-testid={`${testIdPrefix}-demo`} data-demo-choice={choice}>
      <legend className="px-1 text-sm font-medium">Demo video</legend>
      {linked && (
        <div className="grid gap-x-3 sm:grid-cols-2">
          {radio('library', 'Use library demo', describeLink(libraryUrl) || 'No library demo yet. Workouts update when one is added.')}
          {radio('custom', 'Custom link for this workout', 'Library changes will not update this exercise.')}
        </div>
      )}
      {choice === 'legacy' && linked && (
        <p className="rounded-md bg-secondary/60 px-2 py-1.5 text-xs" data-testid={`${testIdPrefix}-demo-legacy`}>
          Legacy link saved before library demos. It stays as is until you choose an option above.
        </p>
      )}
      {showInput && (
        <div className="space-y-1">
          <label htmlFor={`${id}-url`} className="text-xs text-muted-foreground">{linked ? 'Link' : 'Demo link (optional)'}</label>
          <Input
            id={`${id}-url`}
            className="min-h-11"
            inputMode="url"
            value={exercise.video_url || ''}
            onChange={(event) => onChange(applyDemoUrl(exercise, event.target.value))}
            placeholder="https://youtu.be/…"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : `${id}-hint`}
            data-testid={`${testIdPrefix}-video-input`}
          />
          {problem
            ? <p id={`${id}-problem`} className="text-xs text-destructive" role="alert">{problem}</p>
            : <p id={`${id}-hint`} className="text-xs text-muted-foreground">{describeLink(exercise.video_url) || 'YouTube links play in the app; other links open in a new tab.'}</p>}
        </div>
      )}
    </fieldset>
  );
}
