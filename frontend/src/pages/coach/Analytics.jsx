import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Trophy, ChevronRight, RotateCcw,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, ListSkeleton, LoadErrorState, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The toggle governs the tiles only. Attention thresholds, 30-day PRs and
// 7/30-day check-in consistency keep fixed windows server-side and are
// labelled with their own window below, so the page never implies the
// toggle moved them.
const RANGES = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
];

const REASON_TONE = {
  session_gap: 'text-destructive',
  low_adherence: 'text-destructive',
  no_check_in: 'text-gold',
  unanswered_message: 'text-primary',
  pending_request: 'text-primary',
};

// Coach-owned triggers: these are the studio's own service failures rather
// than client behaviour, and they are the ones fixable the same day.
const COACH_OWNED = new Set(['unanswered_message', 'pending_request']);

function pct(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

function Delta({ current, previous, invert = false, suffix = '' }) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return <span className="text-[11px] text-muted-foreground">no prior period</span>;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden /> no change
      </span>
    );
  }
  // "Good" depends on the metric: more sessions is good, more cancellations
  // is not, so the arrow direction and the colour are decided separately.
  const rising = diff > 0;
  const good = invert ? !rising : rising;
  const Icon = rising ? TrendingUp : TrendingDown;
  // Rate deltas are differences between percentages, so the honest unit is
  // percentage points — "5%" would misread as a relative change.
  const magnitude = suffix === '%'
    ? `${Math.abs(Math.round(diff * 100))} percentage points`
    : Math.abs(diff);
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', good ? 'text-success' : 'text-destructive')}>
      <Icon className="h-3 w-3" aria-hidden />
      {magnitude} vs previous
    </span>
  );
}

function Tile({ label, value, sub, children, testId }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-display text-3xl font-bold leading-none">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

export default function CoachAnalytics() {
  const [rangeKey, setRangeKey] = useState('30');
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  // Sequence guard: rapid range switching can let an older response arrive
  // last, leaving stale numbers under the newest label. Only the most
  // recently issued request may write state.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setData(null);
    setLoadError(null);
    const days = RANGES.find((r) => r.key === rangeKey)?.days || 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    try {
      const response = await api.get(
        `/analytics/coach?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      if (seq !== requestSeq.current) return; // superseded — drop it
      setData(response.data);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setLoadError(errMsg(error));
    }
  }, [rangeKey, attempt]);

  useEffect(() => { load(); }, [load]);

  const rangeLabel = useMemo(
    () => RANGES.find((r) => r.key === rangeKey)?.label || '30 days',
    [rangeKey]
  );

  const rangeToggle = (
    <div
      className="inline-flex rounded-lg border border-border bg-secondary/50 p-0.5"
      role="group"
      aria-label="Analytics range"
      data-testid="analytics-range-toggle"
    >
      {RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          data-testid={`analytics-range-${range.key}`}
          aria-pressed={rangeKey === range.key}
          onClick={() => setRangeKey(range.key)}
          className={cn(
            'min-h-11 rounded-md px-3 text-xs font-medium transition-colors motion-reduce:transition-none',
            rangeKey === range.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );

  if (loadError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Analytics" subtitle="How the practice is doing" testId="analytics-header" />
        <LoadErrorState message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeader title="Analytics" subtitle="How the practice is doing" action={rangeToggle} testId="analytics-header" />
        <ListSkeleton rows={4} />
      </div>
    );
  }

  // An incomplete read can hide a client who needs attention. A list that
  // looks authoritative while missing someone is worse than no list, so the
  // attention section is replaced outright rather than footnoted.
  const incomplete = data.coverage?.complete === false;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        subtitle="How the practice is doing"
        action={rangeToggle}
        testId="analytics-header"
      />

      {incomplete && (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
          data-testid="analytics-incomplete-banner"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">These numbers are incomplete</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Not all of your data could be read, so clients who need attention may be missing
                from this page. Don&apos;t rely on it until it loads fully.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 rounded-xl"
                onClick={() => setAttempt((n) => n + 1)}
                data-testid="analytics-incomplete-retry"
              >
                <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Try again
              </Button>
            </div>
          </div>
        </div>
      )}

      <section aria-label="Practice tiles" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={`Sessions · ${rangeLabel}`}
          value={data.sessions.completed}
          sub="completed"
          testId="analytics-tile-completed"
        >
          <Delta current={data.sessions.completed} previous={data.previous?.sessions?.completed} />
        </Tile>
        <Tile
          label={`Cancelled · ${rangeLabel}`}
          value={pct(data.sessions.cancellation_rate)}
          sub={`${data.sessions.cancelled} cancelled · ${data.sessions.no_show || 0} no-${(data.sessions.no_show || 0) === 1 ? 'show' : 'shows'} of ${data.sessions.completed + data.sessions.cancelled + (data.sessions.no_show || 0)} settled`}
          testId="analytics-tile-cancellation"
        >
          <Delta
            current={data.sessions.cancellation_rate}
            previous={data.previous?.sessions?.cancellation_rate}
            invert
            suffix="%"
          />
        </Tile>
        <Tile
          label={`Adherence · ${rangeLabel}`}
          value={pct(data.adherence.rate)}
          sub={data.adherence.assigned
            ? `${data.adherence.completed} of ${data.adherence.assigned} workouts`
            : 'no dated workouts due'}
          testId="analytics-tile-adherence"
        >
          <Delta current={data.adherence.rate} previous={data.previous?.adherence?.rate} suffix="%" />
        </Tile>
        {/* Fixed window regardless of the toggle — labelled so it reads as
            deliberate rather than a bug. */}
        <Tile
          label="Check-ins · last 7 days"
          value={pct(data.check_ins.average_rate_7)}
          sub={data.check_ins.clients_measured
            ? `${data.check_ins.clients_measured} clients · 30-day ${pct(data.check_ins.average_rate_30)}`
            : 'no check-ins yet'}
          testId="analytics-tile-checkins"
        />
      </section>

      <section aria-label="Clients needing attention" data-testid="analytics-attention">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">Needs attention</h2>
          <span className="text-[11px] text-muted-foreground">fixed windows, not the range above</span>
        </div>

        {incomplete ? (
          <div
            className="rounded-2xl border border-dashed border-border bg-secondary/20 px-6 py-10 text-center"
            data-testid="analytics-attention-unavailable"
          >
            <AlertTriangle className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
            <p className="mt-2 font-medium">Attention list unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This list is only useful if it is complete. It is hidden rather than shown partially.
            </p>
          </div>
        ) : data.attention.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="All quiet"
            subtitle="No clients currently meet an attention threshold."
            testId="analytics-attention-empty"
          />
        ) : (
          <ul className="space-y-2">
            {data.attention.map((row) => (
              <li key={row.client_id}>
                <Link
                  to={`/coach/clients/${row.client_id}`}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 transition-colors hover:bg-accent"
                  data-testid={`analytics-attention-row-${row.client_id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{row.client_name}</p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {row.reasons.map((reason) => (
                        <li
                          key={reason.code}
                          className={cn('text-xs', REASON_TONE[reason.code] || 'text-muted-foreground')}
                          data-testid={`analytics-reason-${reason.code}`}
                        >
                          {reason.label}
                          {COACH_OWNED.has(reason.code) && (
                            <span className="ml-1 text-muted-foreground">(on us)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.personal_records_30d > 0 && (
        <section
          aria-label="Recent personal records"
          className="flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/5 p-4"
          data-testid="analytics-pr-strip"
        >
          <Trophy className="h-5 w-5 shrink-0 text-gold" aria-hidden />
          <p className="text-sm">
            <span className="font-semibold">{data.personal_records_30d}</span>
            {' '}personal {data.personal_records_30d === 1 ? 'record' : 'records'} set in the last 30 days
            <span className="text-muted-foreground"> — worth a mention next session.</span>
          </p>
        </section>
      )}
    </div>
  );
}
