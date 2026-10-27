import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { WEEKDAY_SHORT } from '@/lib/seriesPlan';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Controlled form for the repeat rule, program mapping, and notification choices.
// `config` shape: { weekdays, intervalWeeks, endMode, count, until, programId,
//                   startingDay, assignProgram, notify }
export function RecurrencePanel({ config, onChange, programs, selectedProgram, needsAssign, disabled }) {
  const toggleDay = (day) => {
    const next = config.weekdays.includes(day) ? config.weekdays.filter((d) => d !== day) : [...config.weekdays, day];
    onChange({ weekdays: next });
  };
  return (
    <div className="space-y-4" data-testid="series-recurrence-panel">
      <div className="space-y-1.5">
        <Label>Repeat on</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
          {DISPLAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              disabled={disabled}
              aria-pressed={config.weekdays.includes(day)}
              onClick={() => toggleDay(day)}
              data-testid={`series-weekday-${day}`}
              className={`min-h-11 min-w-11 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${config.weekdays.includes(day) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {WEEKDAY_SHORT[day]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Every</Label>
          <Select value={String(config.intervalWeeks)} onValueChange={(v) => onChange({ intervalWeeks: Number(v) })} disabled={disabled}>
            <SelectTrigger className="rounded-xl h-11" data-testid="series-interval-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">week</SelectItem>
              <SelectItem value="2">2 weeks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Ends</Label>
          <Select value={config.endMode} onValueChange={(v) => onChange({ endMode: v })} disabled={disabled}>
            <SelectTrigger className="rounded-xl h-11" data-testid="series-end-mode-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="count">After N sessions</SelectItem>
              <SelectItem value="until">On a date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {config.endMode === 'count' ? (
        <div className="space-y-1.5">
          <Label htmlFor="series-count">Number of sessions (max 52)</Label>
          <Input id="series-count" type="number" inputMode="numeric" min={1} max={52} value={config.count}
            onChange={(e) => onChange({ count: e.target.value })} disabled={disabled} className="rounded-xl h-11" data-testid="series-count-input" />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="series-until">Last day</Label>
          <Input id="series-until" type="date" value={config.until} onChange={(e) => onChange({ until: e.target.value })}
            disabled={disabled} className="rounded-xl h-11" data-testid="series-until-input" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Program (optional)</Label>
        <Select value={config.programId || 'none'} onValueChange={(v) => onChange({ programId: v === 'none' ? '' : v, startingDay: 1 })} disabled={disabled}>
          <SelectTrigger className="rounded-xl h-11" data-testid="series-program-select"><SelectValue placeholder="No program" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No program</SelectItem>
            {programs.map((program) => <SelectItem key={program.id} value={program.id}>{program.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedProgram && (
        <>
          <div className="space-y-1.5">
            <Label>Starting day</Label>
            <Select value={String(config.startingDay)} onValueChange={(v) => onChange({ startingDay: Number(v) })} disabled={disabled}>
              <SelectTrigger className="rounded-xl h-11" data-testid="series-starting-day-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(selectedProgram.days || []).map((day) => (
                  <SelectItem key={day.day_number} value={String(day.day_number)}>
                    Day {day.day_number}{day.workout?.name ? ` · ${day.workout.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Workouts attach to sessions in day order. You can change any of them below.</p>
          </div>
          {needsAssign && (
            <div className="flex items-center gap-2">
              <Checkbox id="series-assign" checked={config.assignProgram} disabled={disabled}
                onCheckedChange={(checked) => onChange({ assignProgram: checked === true })} data-testid="series-assign-checkbox" />
              <Label htmlFor="series-assign">Also assign this program to the client</Label>
            </div>
          )}
        </>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Checkbox id="series-notify" checked={config.notify} disabled={disabled}
            onCheckedChange={(checked) => onChange({ notify: checked === true })} data-testid="series-notify-checkbox" />
          <Label htmlFor="series-notify">Notify client when saved</Label>
        </div>
        <p className="pl-6 text-xs text-muted-foreground">One summary message. Unticked, nothing is sent now; normal reminders still apply.</p>
      </div>
      <p className="text-xs text-muted-foreground">All times are Mountain Time (Albuquerque).</p>
    </div>
  );
}
