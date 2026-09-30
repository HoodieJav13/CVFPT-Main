// Coach-picked goal measures (round-2 decision, 2026-09-29): up to three
// metrics per client, each shown as latest value, change since the first
// entry, and the coach's target when one is set. A change in the wrong
// direction reads neutral, never as an alert.
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

// Short date ("Sep 2"): the year only adds wrapping inside narrow cards.
const fmtShort = (iso) => { try { return format(parseISO(iso), 'MMM d'); } catch { return iso; } };
const fmtNumber = (value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
const withUnit = (value, unit) => `${fmtNumber(value)}${unit ? ` ${unit}` : ''}`;

export function goalChangeTone(direction, change) {
  if (change == null || change === 0 || !['higher', 'lower'].includes(direction)) return 'flat';
  return (direction === 'higher') === (change > 0) ? 'better' : 'other';
}

export function GoalMeasureRow({ measure, className }) {
  const { name, unit, latest, first, change, target_value: target } = measure;
  const tone = goalChangeTone(measure.improvement_direction, change);
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';
  return (
    <div className={cn('flex items-start justify-between gap-3', className)} data-testid="goal-measure-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {!latest && 'No entries yet'}
          {latest && change == null && `Started ${fmtShort(first.recorded_on)}`}
          {latest && change != null && (
            <>
              <span className={cn('font-semibold tabular-nums', tone === 'better' && 'text-success')} data-testid="goal-measure-change">
                {sign}{withUnit(Math.abs(change), unit)}
              </span>
              {' '}since {fmtShort(first.recorded_on)}
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">{latest ? withUnit(latest.value, unit) : '—'}</p>
        {target != null && <p className="text-[11px] tabular-nums text-gold">Goal {withUnit(target, unit)}</p>}
      </div>
    </div>
  );
}
