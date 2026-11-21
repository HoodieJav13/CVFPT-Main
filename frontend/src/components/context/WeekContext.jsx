import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ClipboardCheck, RotateCcw, Target } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SectionLabel, CheckInStats } from '@/components/common';
import { formatDay } from '@/lib/outsideActivities';

// Read-only context from the EXISTING check-in and progress APIs. No second
// check-in/goal system and no score: missing answers are listed as missing,
// and no check-in never means rested, ready or fine.
const CHECK_IN_FIELDS = [['energy', 'Energy'], ['sleep_quality', 'Sleep'], ['soreness', 'Soreness'], ['stress', 'Stress']];
const CHECK_IN_LIMIT = 100;

function useContextRead(url) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const load = useCallback(async () => {
    setState({ status: 'loading', data: null, error: null });
    try {
      const { data } = await api.get(url);
      setState({ status: 'available', data, error: null });
    } catch (error) {
      setState({ status: 'unavailable', data: null, error: errMsg(error, 'Could not load') });
    }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

function Unavailable({ what, onRetry, testId }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5" data-testid={testId}>
      <p className="text-sm">{what} couldn’t load. This is not the same as nothing logged.</p>
      <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 rounded-lg" onClick={onRetry}>
        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />Retry
      </Button>
    </div>
  );
}

export default function WeekContext({ clientId, viewerRole, days, today, checkInPrompt, onCheckIn }) {
  const isClient = viewerRole === 'client';
  const [checkIns, reloadCheckIns] = useContextRead(isClient ? `/check-ins/mine?limit=${CHECK_IN_LIMIT}` : `/check-ins/clients/${clientId}?limit=${CHECK_IN_LIMIT}`);
  const [goals, reloadGoals] = useContextRead(isClient ? '/progress/mine' : `/progress/clients/${clientId}/metrics`);
  const weekStart = days[0];
  const weekEnd = days[6];

  const weekCheckIns = (checkIns.data || [])
    .filter((row) => !row.archived && row.check_in_date >= weekStart && row.check_in_date <= weekEnd)
    .sort((a, b) => String(b.check_in_date).localeCompare(String(a.check_in_date)));
  const oldest = (checkIns.data || []).reduce((min, row) => (!min || row.check_in_date < min ? row.check_in_date : min), null);
  const windowIncomplete = checkIns.status === 'available' && (checkIns.data || []).length >= CHECK_IN_LIMIT && oldest > weekStart;
  const latest = weekCheckIns[0] || null;
  const missing = latest ? CHECK_IN_FIELDS.filter(([key]) => latest[key] == null).map(([, label]) => label) : [];
  const checkedInToday = (checkIns.data || []).some((row) => !row.archived && row.check_in_date === today);
  const showPrompt = isClient && checkInPrompt === 'on' && days.includes(today) && checkIns.status === 'available' && !checkedInToday;

  const metrics = (goals.data || []).filter((metric) => !metric.archived).slice(0, 4);

  return (
    <Card data-testid="week-context">
      <CardHeader className="pb-2">
        <SectionLabel>Check-ins & goals</SectionLabel>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-label="Check-ins this week" className="space-y-2" data-testid="week-context-check-ins">
          {checkIns.status === 'loading' && <p className="text-sm text-muted-foreground">Loading check-ins…</p>}
          {checkIns.status === 'unavailable' && <Unavailable what="Check-ins" onRetry={reloadCheckIns} testId="week-check-ins-unavailable" />}
          {checkIns.status === 'available' && (
            <>
              {windowIncomplete ? (
                <p className="text-sm text-muted-foreground" data-testid="week-check-ins-incomplete">Only the latest {CHECK_IN_LIMIT} check-ins load here, and this week is older. Open Check-ins for the full history.</p>
              ) : weekCheckIns.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="week-check-ins-empty">No check-ins logged this week. That doesn’t tell us how the week went.</p>
              ) : (
                <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5" data-testid="week-check-ins-summary">
                  <p className="text-sm font-medium">{weekCheckIns.length} of 7 days checked in</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Latest {formatDay(latest.check_in_date)}</p>
                  <CheckInStats className="mt-1.5" stats={CHECK_IN_FIELDS.map(([key, label]) => [label, latest[key]])} />
                  {missing.length > 0 && <p className="mt-1 text-xs text-muted-foreground" data-testid="week-check-ins-missing">Not answered: {missing.join(', ')}</p>}
                </div>
              )}
              {showPrompt && (
                <Button type="button" className="min-h-11 w-full rounded-xl" onClick={onCheckIn} data-testid="week-check-in-prompt">
                  <ClipboardCheck className="mr-1.5 h-4 w-4" aria-hidden />Check in for today
                </Button>
              )}
              {isClient && checkInPrompt !== 'on' && (
                <p className="text-xs text-muted-foreground" data-testid="week-check-in-prompt-hidden">
                  Check-in reminders are off here. You can still check in any time from <Link to="/client" className="font-medium text-primary underline-offset-2 hover:underline">Today</Link>.
                </p>
              )}
            </>
          )}
        </section>

        <section aria-label="Goals" className="space-y-2" data-testid="week-context-goals">
          {goals.status === 'loading' && <p className="text-sm text-muted-foreground">Loading goals…</p>}
          {goals.status === 'unavailable' && <Unavailable what="Goals" onRetry={reloadGoals} testId="week-goals-unavailable" />}
          {goals.status === 'available' && metrics.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="week-goals-empty">No progress metrics set up yet.</p>
          )}
          {goals.status === 'available' && metrics.map((metric) => {
            const entries = (metric.entries || []).filter((entry) => !entry.archived);
            const last = entries[entries.length - 1] || null;
            const thisWeek = entries.filter((entry) => entry.recorded_on >= weekStart && entry.recorded_on <= weekEnd).length;
            const unit = metric.unit ? ` ${metric.unit}` : '';
            return (
              <div key={metric.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5" data-testid="week-goal-row">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{metric.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {last ? `Latest ${last.value}${unit} · ${formatDay(last.recorded_on)}` : 'No entries yet'}
                    {` · ${thisWeek ? `${thisWeek} this week` : 'none this week'}`}
                  </p>
                </div>
                {metric.target_value != null && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[11px]">
                    <Target className="h-3 w-3" aria-hidden />Goal {metric.target_value}{unit}
                  </span>
                )}
              </div>
            );
          })}
        </section>
      </CardContent>
    </Card>
  );
}
