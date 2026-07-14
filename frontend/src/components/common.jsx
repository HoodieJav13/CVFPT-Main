import { useId } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useVisualIntensity } from '@/lib/visualIntensity';

export function LoadingScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-testid="loading-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export function LoadErrorState({ message = 'Please try again.', onRetry, scope = 'page' }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
      data-testid="load-error-state"
      data-load-error-scope={scope}
    >
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
      <h2 className="mt-3 font-display text-xl font-semibold">Unable to load this page</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground" data-testid="load-error-message">{message}</p>
      <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={onRetry} data-testid="load-error-retry-button">
        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Try again
      </Button>
    </div>
  );
}

export function PageHeader({ title, subtitle, action, testId }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5" data-testid={testId}>
      <div>
        <div className="h-[3px] w-7 rounded-full bg-primary mb-2" aria-hidden />
        <h1 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function IconButton({ label, children, ...props }) {
  return (
    <TooltipProvider delayDuration={300}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <Button type="button" {...props} aria-label={label}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

export function SectionLabel({ children, action, className, testId }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)} data-testid={testId}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-[2px] w-3.5 rounded-full bg-primary/70" aria-hidden />
        {children}
      </p>
      {action}
    </div>
  );
}

export function StatTile({ label, value, icon: Icon, accent = false, testId }) {
  return (
    <Card className={cn('relative overflow-hidden', accent && 'border-primary/30')} data-testid={testId}>
      <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary/70" aria-hidden />
      <CardContent className="p-4 pl-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        </div>
        <p className="mt-2 font-display text-4xl font-bold leading-none tabular-nums lg:text-5xl">{value}</p>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, subtitle, action, testId }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-10 text-center" data-testid={testId}>
      {Icon ? <Icon className="h-8 w-8 text-muted-foreground mb-3" /> : null}
      <p className="font-medium">{title}</p>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground max-w-xs">{subtitle}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const SESSION_BADGES = {
  scheduled: 'bg-primary/15 text-primary border border-primary/25',
  completed: 'bg-success/15 text-success-foreground border border-success/25',
  cancelled: 'bg-destructive/15 text-destructive border border-destructive/25',
  pending: 'bg-gold/15 text-gold border border-gold/25',
  needs_review: 'bg-gold/15 text-gold border border-gold/25',
  reviewed: 'bg-success/15 text-success-foreground border border-success/25',
  approved: 'bg-success/15 text-success-foreground border border-success/25',
  declined: 'bg-destructive/15 text-destructive border border-destructive/25',
};

export function StatusBadge({ status, testId }) {
  return (
    <Badge variant="outline" className={cn('capitalize', SESSION_BADGES[status] || '')} data-testid={testId}>
      {status}
    </Badge>
  );
}

/** Labeled mini-chips for check-in metrics ("Energy 2" etc.). Pure formatting of already-present values. */
export function CheckInStats({ stats, className }) {
  const present = stats.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!present.length) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {present.map(([label, value]) => (
        <span key={label} className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[11px]">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{value}</span>
        </span>
      ))}
    </span>
  );
}

/* ---------- Skeleton layouts (loading placeholders, presentational only) ---------- */

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-5 w-16 rounded-full shrink-0" />
    </div>
  );
}

export function ListSkeleton({ rows = 3, header = true }) {
  return (
    <div data-testid="loading-skeleton">
      {header && (
        <div className="mb-5">
          <Skeleton className="h-[3px] w-7 mb-2" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3.5 w-56 mt-2" />
        </div>
      )}
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  );
}

export function DashboardSkeleton({ tiles = 4 }) {
  return (
    <div data-testid="loading-skeleton">
      <div className="mb-5">
        <Skeleton className="h-[3px] w-7 mb-2" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-3.5 w-36 mt-2" />
      </div>
      <div className={cn('grid grid-cols-2 gap-3', tiles === 4 && 'lg:grid-cols-4')}>
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card/40 p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-12 mt-3" />
          </div>
        ))}
      </div>
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: 3 }, (_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  );
}

export function SessionsSkeleton() {
  return (
    <div data-testid="loading-skeleton">
      <div className="mb-5">
        <Skeleton className="h-[3px] w-7 mb-2" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-3.5 w-52 mt-2" />
      </div>
      {Array.from({ length: 2 }, (_, g) => (
        <div key={g} className="mb-5">
          <Skeleton className="h-3 w-24 mb-2.5" />
          <div className="space-y-2">
            {Array.from({ length: 2 }, (_, i) => <SkeletonRow key={i} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div data-testid="loading-skeleton">
      <div className="mb-5">
        <Skeleton className="h-[3px] w-7 mb-2" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-3.5 w-56 mt-2" />
      </div>
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[200px] w-full mt-4 rounded-lg" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/* ---------- Metric chart ---------- */

const CHART_DURATIONS = {
  restrained: 650,
  cinematic: 820,
  spectacle: 1000,
};

export function MetricChart({ entries = [], unit, highlightLatest = false }) {
  const gradientId = `metric-fill-${useId().replace(/:/g, '')}`;
  const reducedMotion = useReducedMotion();
  const intensity = useVisualIntensity();
  const data = entries.map((e) => ({
    date: (() => { try { return format(parseISO(e.recorded_on), 'MMM d'); } catch { return e.recorded_on; } })(),
    value: Number(e.value),
  }));
  if (!data.length) return null;
  const lastIndex = data.length - 1;
  return (
    <div className="min-h-[220px]">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.55)" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} padding={{ left: 12, right: 12 }} />
          <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, color: 'hsl(var(--foreground))' }}
            formatter={(v) => [`${v}${unit ? ` ${unit}` : ''}`, 'Value']}
          />
          <Area
            key={entries.map((entry) => `${entry.id}:${entry.value}:${entry.recorded_on}`).join('|')}
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={!reducedMotion}
            animationDuration={CHART_DURATIONS[intensity]}
            animationEasing="ease-out"
            dot={(props) => {
              const { key, index, cx, cy } = props;
              const latest = index === lastIndex;
              if (latest && highlightLatest && !reducedMotion) {
                return (
                  <g key={key}>
                    <m.circle
                      cx={cx}
                      cy={cy}
                      fill="hsl(var(--gold))"
                      initial={{ r: 5, opacity: 0.65 }}
                      animate={{ r: 18, opacity: 0 }}
                      transition={{ delay: CHART_DURATIONS[intensity] / 1000, duration: 0.7, ease: 'easeOut' }}
                    />
                    <m.circle
                      cx={cx}
                      cy={cy}
                      fill="hsl(var(--gold))"
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      initial={{ r: 2 }}
                      animate={{ r: 5.5 }}
                      transition={{ delay: CHART_DURATIONS[intensity] / 1000, duration: 0.32, ease: 'backOut' }}
                    />
                  </g>
                );
              }
              return (
                <circle key={key} cx={cx} cy={cy} r={latest ? 5.5 : 4} fill={latest ? 'hsl(var(--gold))' : 'hsl(var(--chart-1))'} stroke="hsl(var(--card))" strokeWidth={2} />
              );
            }}
            activeDot={{ r: 6, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
