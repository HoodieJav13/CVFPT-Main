import { useId } from 'react';
import { Check, ChevronDown, ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Compact, ever-present workout outline (P1). Collapsed it is one row: the
// next exercise's name (no set numbers) plus an expand control. Expanded it lists exercise names in
// coach order under their superset/giant-set labels — never sets, reps or
// loads. Choosing a name only reveals that exercise; it changes nothing.
export function WorkoutOutline({ blocks, next, expanded, onToggle, onJump, sealed }) {
  const listId = useId();
  const summary = sealed ? 'Finished on this phone'
    : next ? `Next: ${next.marker ? `${next.marker} · ` : ''}${next.exerciseName}` : 'All sets done';
  return (
    <div className="rounded-xl border border-border bg-card px-2 py-1" data-testid="workout-outline" data-expanded={expanded ? 'true' : 'false'}>
      <div className="flex min-h-11 items-center gap-2">
        <ListOrdered className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="workout-outline-summary">{summary}</p>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 px-2" onClick={onToggle}
          aria-expanded={expanded} aria-controls={listId} data-testid="workout-outline-toggle">
          {expanded ? 'Hide outline' : 'Outline'}
          <ChevronDown className={cn('ml-1 h-4 w-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden />
        </Button>
      </div>
      {expanded && (
        <nav id={listId} aria-label="Workout outline" className="max-h-[45vh] overflow-y-auto pb-1" data-testid="workout-outline-list">
          {blocks.map((block) => (
            <div key={block.key} className={cn('py-0.5', block.label && 'mt-1 rounded-lg border border-border/70 px-1')}>
              {block.label && <p className="px-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{block.label}</p>}
              <ul>
                {block.items.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onJump(item.id)} data-testid="workout-outline-item" data-status={item.status}
                      className={cn('flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        item.status === 'next' && 'font-semibold text-primary', item.status === 'done' && 'text-muted-foreground')}
                      aria-current={item.status === 'next' ? 'step' : undefined}>
                      <span className="w-7 shrink-0 tabular-nums text-xs text-muted-foreground">{item.marker}</span>
                      <span className="min-w-0 flex-1 break-words">{item.name}</span>
                      {item.status === 'done' && <><Check className="h-4 w-4 shrink-0 text-success" aria-hidden /><span className="sr-only">done</span></>}
                      {item.status === 'next' && <span className="sr-only">next</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
