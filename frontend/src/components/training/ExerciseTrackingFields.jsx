import { WorkoutMetricInput } from './WorkoutMetricInput';
import { trackingType, tracks } from '@/lib/workoutMetrics';

const labels = { reps_weight: 'Reps / weight', duration: 'Duration', distance: 'Distance', duration_distance: 'Duration + distance' };
export function ExerciseTrackingFields({ exercise, onChange }) {
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Track this exercise
        <select aria-label="Exercise tracking type" className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={trackingType(exercise)} onChange={(event) => {
            const type = event.target.value;
            onChange({ tracking_type: type, ...(type !== 'reps_weight' ? { reps: '' } : {}),
              ...(!tracks({ tracking_type: type }, 'duration') ? { duration_value: '', duration_unit: null } : {}),
              ...(!tracks({ tracking_type: type }, 'distance') ? { distance_value: '', distance_unit: null } : {}) });
          }}>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {['duration', 'distance'].filter((metric) => tracks(exercise, metric)).map((metric) => (
          <WorkoutMetricInput key={metric} metric={metric} label={`Target ${metric}`} value={exercise[`${metric}_value`]}
            unit={exercise[`${metric}_unit`]} placeholder="Optional target"
            onValueChange={(value) => onChange({ [`${metric}_value`]: value, [`${metric}_unit`]: value === '' ? null : (exercise[`${metric}_unit`] || (metric === 'duration' ? 's' : 'm')) })}
            onUnitChange={(unit) => onChange({ [`${metric}_unit`]: unit })} />
        ))}
      </div>
      {trackingType(exercise) !== 'reps_weight' && <p className="text-xs text-muted-foreground">Targets are instructions. Performed values start blank. Enter values in the selected units; changing a unit keeps the number.</p>}
    </div>
  );
}
