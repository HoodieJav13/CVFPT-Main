import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { convertTarget } from '@/lib/builderMetrics';
import { Input } from '@/components/ui/input';
import { METRIC_UNITS } from '@/lib/workoutMetrics';

// Preserve entered units. Unit changes deliberately reinterpret the value.
export function WorkoutMetricInput({ metric, label, value, unit, onValueChange, onUnitChange, onBlur, disabled, placeholder, errorId, allowConversion = false }) {
  const [conversion, setConversion] = useState(null);
  return (
    <div className="min-w-0 space-y-1">
      <span className="text-xs text-muted-foreground">{metric === 'duration' ? (allowConversion ? 'Time' : 'Duration') : 'Distance'}</span>
      <div className="flex min-w-0 gap-1">
        <Input type="number" min="0" step="any" inputMode="decimal" className="h-11 min-w-0 px-2 tabular-nums"
          aria-invalid={errorId ? true : undefined} aria-describedby={errorId} aria-label={label} value={value ?? ''} onChange={(event) => { setConversion(null); onValueChange(event.target.value); }} onBlur={onBlur} disabled={disabled} placeholder={placeholder} />
        <select className="h-11 rounded-md border border-input bg-background px-2 text-sm" aria-label={`${label} unit`}
          title="Changing the unit keeps the number; enter the value in the selected unit."
          value={unit || (metric === 'duration' ? 's' : 'm')} onChange={(event) => {
            const to = event.target.value;
            const from = unit || (metric === 'duration' ? 's' : 'm');
            const converted = convertTarget(value, from, to, metric);
            setConversion(allowConversion && from !== to && converted != null ? { from, to, value, converted } : null);
            onUnitChange(to);
          }} disabled={disabled}>
          {Object.keys(METRIC_UNITS[metric]).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      {conversion && unit === conversion.to && String(value) === String(conversion.value) && <div className="space-y-1">
        <p className="text-xs text-muted-foreground" role="status">Value is now {value} {unit}. Convert to keep the same {metric === 'duration' ? 'time' : 'distance'}.</p>
        <Button type="button" size="touch" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal rounded-lg text-xs" disabled={disabled}
          onClick={() => { onValueChange(String(conversion.converted)); setConversion(null); }}>
          {`Convert ${conversion.value} ${conversion.from} to ${conversion.converted} ${conversion.to}`}
        </Button>
      </div>}
    </div>
  );
}
