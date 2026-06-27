import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState, MetricChart } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientProgress() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    api.get('/progress/mine')
      .then(({ data }) => setMetrics(data))
      .catch((e) => toast.error(errMsg(e, 'Failed to load progress')));
  }, []);

  if (!metrics) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Progress" subtitle="Your metrics, logged by your coach" />
      {metrics.length === 0 && (
        <EmptyState icon={TrendingUp} title="No metrics yet" subtitle="Your coach will log measurements and benchmarks here as you train." testId="client-progress-empty" />
      )}
      <div className="space-y-4">
        {metrics.map((m) => {
          const latest = m.entries[m.entries.length - 1];
          const first = m.entries[0];
          const delta = latest && first ? (Number(latest.value) - Number(first.value)).toFixed(1) : null;
          return (
            <Card key={m.id} data-testid="client-metric-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base font-display">{m.name}</CardTitle>
                    {latest && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Latest: <span className="text-primary font-semibold tabular-nums">{latest.value}{m.unit ? ` ${m.unit}` : ''}</span> on {fmtDate(latest.recorded_on)}
                      </p>
                    )}
                  </div>
                  {delta !== null && m.entries.length > 1 && (
                    <span className="text-xs font-semibold tabular-nums text-[#F2C94C]">
                      {delta > 0 ? '+' : ''}{delta}{m.unit ? ` ${m.unit}` : ''}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {m.entries.length > 0 ? (
                  <MetricChart entries={m.entries} unit={m.unit} />
                ) : (
                  <p className="text-sm text-muted-foreground py-3 text-center">No entries yet.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
