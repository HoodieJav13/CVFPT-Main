import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import DateTimePicker from '@/components/DateTimePicker';
import { sortRows } from '@/lib/seriesPlan';

function conflictMessage(conflict) {
  if (conflict.scope === 'client') return 'This client is already booked then';
  if (conflict.scope === 'batch') return 'Overlaps another date in this series';
  return 'You already have a session then';
}

export function SeriesPreviewList({
  rows, workouts, mapping, summary, disabled, hasProgram,
  onToggle, onEditDateTime, onPickSuggestion, onPickWorkout, onAddDate,
}) {
  return (
    <div className="space-y-3" data-testid="series-preview">
      <p className="text-sm font-medium" data-testid="series-summary">
        {summary.selected} of {summary.total} selected{summary.lastDate ? ` · last on ${summary.lastDate}` : ''}
      </p>
      <ul className="space-y-2">
        {sortRows(rows).map((row) => {
          const conflict = row.selected ? row.conflict : null;
          return (
            <li
              key={row.key}
              data-testid={`series-row-${row.key}`}
              data-conflict={conflict ? conflict.scope : 'none'}
              className={`rounded-xl border px-3 py-2.5 ${conflict ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-card/60'} ${row.selected ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-2">
                <Checkbox checked={row.selected} disabled={disabled} onCheckedChange={() => onToggle(row.key)}
                  aria-label={`Include ${row.date} ${row.time}`} data-testid={`series-row-select-${row.key}`} />
                <div className="min-w-0 flex-1">
                  <DateTimePicker
                    value={`${row.date}T${row.time}`}
                    onChange={(value) => { if (value) onEditDateTime(row.key, { date: value.slice(0, 10), time: value.slice(11, 16) }); }}
                    disabled={disabled}
                    data-testid={`series-row-datetime-${row.key}`}
                  />
                </div>
              </div>
              {hasProgram || row.selected ? (
                <div className="mt-2 pl-6">
                  <Select
                    value={mapping[row.key] || 'none'}
                    onValueChange={(value) => onPickWorkout(row.key, value === 'none' ? null : value)}
                    disabled={disabled || !row.selected}
                  >
                    <SelectTrigger className="h-9 rounded-lg text-xs" data-testid={`series-row-workout-${row.key}`}><SelectValue placeholder="No workout" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No workout attached</SelectItem>
                      {workouts.map((workout) => <SelectItem key={workout.id} value={workout.id}>{workout.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {conflict && (
                <div className="mt-2 pl-6 text-sm" role="alert">
                  <p className="font-medium">{conflictMessage(conflict)}</p>
                  {conflict.display && conflict.scope !== 'batch' && <p className="text-xs text-muted-foreground">{conflict.display}</p>}
                  {(row.suggestions || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Suggested times">
                      {row.suggestions.map((suggestion) => (
                        <Button key={suggestion.time} type="button" size="sm" variant="outline" className="min-h-9 rounded-full text-xs" disabled={disabled}
                          onClick={() => onPickSuggestion(row.key, suggestion)} data-testid={`series-suggestion-${row.key}-${suggestion.time}`}>
                          {suggestion.display}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={disabled} onClick={onAddDate} data-testid="series-add-date">
        <Plus className="mr-1.5 h-4 w-4" /> Add a date
      </Button>
    </div>
  );
}
