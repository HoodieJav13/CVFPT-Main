import { Fragment } from 'react';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exerciseMarkers, groupKindLabel, supersetBlocks } from '@/lib/supersets';

/**
 * Renders an ordered exercise list with supersets/giant sets wrapped in a
 * labelled teal rail. Straight sets render exactly as the caller draws them.
 * children(exercise, { index, marker, grouped }) draws one exercise; marker
 * is program-sheet notation (1, 2, 3 — or A, B1, B2 once any group exists).
 */
export function SupersetGroups({ exercises, children: renderExercise, className, innerClassName = 'space-y-3' }) {
  const list = exercises || [];
  const markers = exerciseMarkers(list);
  return supersetBlocks(list).map((block) => {
    const rendered = block.items.map(({ exercise, index }) => (
      <Fragment key={exercise.id || `exercise-${index}`}>
        {renderExercise(exercise, { index, marker: markers[index], grouped: block.kind !== 'single' })}
      </Fragment>
    ));
    if (block.kind === 'single') return <Fragment key={`block-${block.start}`}>{rendered}</Fragment>;
    const label = groupKindLabel(block.kind);
    const range = `${markers[block.start]}–${markers[block.end]}`;
    return (
      <div
        key={`block-${block.start}`}
        role="group"
        aria-label={`${label} ${range}`}
        className={cn('border-l-2 border-primary/60 pl-3', className)}
        data-testid="superset-group"
      >
        <p className="mb-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-primary">
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            {label}
          </span>
          <span>· alternate {range}, then rest</span>
        </p>
        <div className={innerClassName}>{rendered}</div>
      </div>
    );
  });
}

export function ExerciseMarker({ marker, className }) {
  return (
    <span
      className={cn('inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 px-1.5 text-xs font-semibold tabular-nums text-primary', className)}
      data-testid="exercise-marker"
    >
      {marker}
    </span>
  );
}
