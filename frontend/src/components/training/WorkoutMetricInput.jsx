import { Input } from '@/components/ui/input';
import { METRIC_UNITS } from '@/lib/workoutMetrics';

// Preserve entered units. Unit changes deliberately reinterpret the value.
export function WorkoutMetricInput({ metric, label, value, unit, onValueChange, onUnitChange, onBlur, disabled, placeholder }) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="text-xs text-muted-foreground">{metric === 'duration' ? 'Duration' : 'Distance'}</span>
      <div className="flex min-w-0 gap-1">
        <Input type="number" min="0" step="any" inputMode="decimal" className="h-11 min-w-0 px-2 tabular-nums"
          aria-label={label} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)} onBlur={onBlur} disabled={disabled} placeholder={placeholder} />
        <select className="h-11 rounded-md border border-input bg-background px-2 text-sm" aria-label={`${label} unit`}
          title="Changing the unit keeps the number; enter the value in the selected unit."
          value={unit || (metric === 'duration' ? 's' : 'm')} onChange={(event) => onUnitChange(event.target.value)} disabled={disabled}>
          {Object.keys(METRIC_UNITS[metric]).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
    </div>
  );
}
