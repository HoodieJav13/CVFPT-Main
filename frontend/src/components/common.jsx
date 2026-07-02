import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';

export function LoadingScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-testid="loading-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export function PageHeader({ title, subtitle, action, testId }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5" data-testid={testId}>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatTile({ label, value, icon: Icon, accent = false, testId }) {
  return (
    <Card className={cn('relative overflow-hidden', accent && 'border-primary/30')} data-testid={testId}>
      <div className="absolute inset-x-0 top-0 h-[2px] bg-primary/70" />
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        </div>
        <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
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
  completed: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25',
  cancelled: 'bg-destructive/15 text-destructive border border-destructive/25',
  pending: 'bg-[#F2C94C]/15 text-[#F2C94C] border border-[#F2C94C]/25',
  needs_review: 'bg-[#F2C94C]/15 text-[#F2C94C] border border-[#F2C94C]/25',
  reviewed: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25',
  approved: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/25',
  declined: 'bg-destructive/15 text-destructive border border-destructive/25',
};

export function StatusBadge({ status, testId }) {
  return (
    <Badge variant="outline" className={cn('capitalize', SESSION_BADGES[status] || '')} data-testid={testId}>
      {status}
    </Badge>
  );
}

export function MetricChart({ entries = [], unit }) {
  const data = entries.map((e) => ({
    date: (() => { try { return format(parseISO(e.recorded_on), 'MMM d'); } catch { return e.recorded_on; } })(),
    value: Number(e.value),
  }));
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke="rgba(167,179,191,.18)" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: 'rgba(167,179,191,.75)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'rgba(167,179,191,.75)', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: 'hsl(214 28% 8%)', border: '1px solid hsl(214 22% 18%)', borderRadius: 12, color: '#F4F7FA' }}
          formatter={(v) => [`${v}${unit ? ` ${unit}` : ''}`, 'Value']}
        />
        <Line type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
