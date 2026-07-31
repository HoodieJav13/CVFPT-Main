import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Branded replacement for <input type="datetime-local"> (UI-3): a calendar
 * plus tappable time slots. Speaks the same value language as the native
 * input — an empty string or "YYYY-MM-DDTHH:mm" in local time — so form
 * state and submit paths stay unchanged.
 */

// Studio hours: 5:00 AM – 8:45 PM in 15-minute steps.
const SLOTS = [];
for (let hour = 5; hour <= 20; hour += 1) {
  for (let minute = 0; minute < 60; minute += 15) SLOTS.push({ hour, minute });
}

const SLOT_GROUPS = [
  { label: 'Morning', match: ({ hour }) => hour < 12 },
  { label: 'Afternoon', match: ({ hour }) => hour >= 12 && hour < 17 },
  { label: 'Evening', match: ({ hour }) => hour >= 17 },
];

const pad = (value) => String(value).padStart(2, '0');

function parseValue(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { date: null, time: null };
  return {
    date: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    time: { hour: Number(match[4]), minute: Number(match[5]) },
  };
}

function slotLabel({ hour, minute }) {
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function triggerLabel(date, time, placeholder) {
  if (!date) return placeholder;
  const day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? `${day} · ${slotLabel(time)}` : `${day} — choose a time`;
}

export default function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date & time',
  disabled = false,
  'data-testid': testId,
  triggerClassName,
}) {
  const [open, setOpen] = useState(false);
  const { date: valueDate, time: valueTime } = useMemo(() => parseValue(value), [value]);
  // A date picked before its time slot is held locally; onChange fires only
  // for complete selections, so required-field validation keeps working.
  const [pendingDate, setPendingDate] = useState(null);
  const date = pendingDate || valueDate;
  const time = pendingDate && valueDate && pendingDate.getTime() !== valueDate.getTime() ? null : valueTime;

  // A held partial selection survives closing and reopening the picker —
  // it only resets when the committed value changes (a slot was picked,
  // Clear was tapped, or the form repopulated externally).
  useEffect(() => {
    setPendingDate(null);
  }, [value]);

  const pickSlot = (slot) => {
    const target = date || new Date();
    onChange(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(slot.hour)}:${pad(slot.minute)}`);
    setPendingDate(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-testid={testId}
          data-value={value || ''}
          className={cn(
            'h-11 w-full justify-start rounded-xl px-3 text-left font-normal',
            !date && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          <CalendarDays className="mr-2 h-4 w-4 shrink-0 opacity-70" />
          <span className="truncate">{triggerLabel(date, time, placeholder)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[95vw] p-0" data-testid={testId ? `${testId}-panel` : undefined}>
        <Calendar
          mode="single"
          selected={date || undefined}
          defaultMonth={date || undefined}
          onSelect={(nextDate) => nextDate && setPendingDate(nextDate)}
          required
        />
        <div className="border-t border-border/70 p-3">
          {!date && <p className="pb-1 text-xs text-muted-foreground">Pick a day to choose a time.</p>}
          {date && (
            <div className="max-h-56 space-y-3 overflow-y-auto pr-1" data-testid="time-slot-list">
              {SLOT_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SLOTS.filter(group.match).map((slot) => {
                      const selected = Boolean(time && time.hour === slot.hour && time.minute === slot.minute);
                      return (
                        <Button
                          key={`${slot.hour}:${slot.minute}`}
                          type="button"
                          size="sm"
                          variant={selected ? 'default' : 'outline'}
                          className="h-11 px-1 text-xs tabular-nums"
                          onClick={() => pickSlot(slot)}
                          data-testid="time-slot"
                        >
                          {slotLabel(slot)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {value && (
            <div className="flex justify-end pt-2">
              <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { onChange(''); setPendingDate(null); }}>
                Clear
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
