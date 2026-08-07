// Loaded lazily via components/common.jsx so recharts stays out of the
// entry bundle — Login and every non-chart page skip the chart library.
import { useId } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { useVisualIntensity } from '@/lib/visualIntensity';
import { CHART_MOTION, MOTION_EASINGS, msToSeconds } from '@/lib/motion';

export default function MetricChart({ entries = [], unit, highlightLatest = false, markers = [], targetValue = null }) {
  const goal = targetValue === null || targetValue === undefined || targetValue === ''
    ? null
    : (Number.isFinite(Number(targetValue)) ? Number(targetValue) : null);
  const gradientId = `metric-fill-${useId().replace(/:/g, '')}`;
  const reducedMotion = useReducedMotion();
  const intensity = useVisualIntensity();
  const data = entries.map((e) => ({
    ts: (() => { try { return parseISO(e.recorded_on).getTime(); } catch { return null; } })(),
    value: Number(e.value),
  })).filter((point) => point.ts !== null).sort((a, b) => a.ts - b.ts);
  if (!data.length) return null;
  const lastIndex = data.length - 1;
  // Time-scaled axis (instead of one category per entry) so session markers
  // can sit at their true dates between entries. Padded so single-entry
  // charts and edge markers still render inside the plot.
  const minTs = data[0].ts;
  const maxTs = data[lastIndex].ts;
  const dayMs = 24 * 60 * 60 * 1000;
  const pad = Math.max(dayMs / 2, (maxTs - minTs) * 0.03);
  const domain = [minTs - pad, maxTs + pad];
  const markerTs = [...new Set(markers
    .map((iso) => { try { return parseISO(iso).getTime(); } catch { return null; } })
    .filter((ts) => ts !== null && ts >= domain[0] && ts <= domain[1]))];
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
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={domain}
            tickFormatter={(ts) => format(ts, 'MMM d')}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, color: 'hsl(var(--foreground))' }}
            labelFormatter={(ts) => format(ts, 'MMM d, yyyy')}
            formatter={(v) => [`${v}${unit ? ` ${unit}` : ''}`, 'Value']}
          />
          {markerTs.map((ts) => (
            <ReferenceLine key={ts} x={ts} stroke="hsl(var(--chart-2) / 0.22)" />
          ))}
          {goal !== null && (
            <ReferenceLine
              y={goal}
              ifOverflow="extendDomain"
              stroke="hsl(var(--achievement-gold) / 0.6)"
              strokeDasharray="6 5"
              label={{
                value: `Goal ${goal}${unit ? ` ${unit}` : ''}`,
                position: 'insideTopRight',
                fill: 'hsl(var(--achievement-gold))',
                fontSize: 10,
              }}
            />
          )}
          <Area
            key={entries.map((entry) => `${entry.id}:${entry.value}:${entry.recorded_on}`).join('|')}
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={!reducedMotion}
            animationDuration={CHART_MOTION.drawDurationMs[intensity]}
            animationEasing={MOTION_EASINGS.chartOut}
            dot={(props) => {
              const { key, index, cx, cy } = props;
              const latest = index === lastIndex;
              if (latest && highlightLatest && !reducedMotion) {
                return (
                  <g key={key}>
                    <m.circle
                      cx={cx}
                      cy={cy}
                      fill="hsl(var(--achievement-gold))"
                      initial={{ r: 5, opacity: 0.65 }}
                      animate={{ r: 18, opacity: 0 }}
                      transition={{
                        delay: msToSeconds(CHART_MOTION.drawDurationMs[intensity]),
                        duration: msToSeconds(CHART_MOTION.pulseDurationMs),
                        ease: MOTION_EASINGS.highlightOut,
                      }}
                    />
                    <m.circle
                      cx={cx}
                      cy={cy}
                      fill="hsl(var(--achievement-gold))"
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      initial={{ r: 2 }}
                      animate={{ r: 5.5 }}
                      transition={{
                        delay: msToSeconds(CHART_MOTION.drawDurationMs[intensity]),
                        duration: msToSeconds(CHART_MOTION.dotDurationMs),
                        ease: MOTION_EASINGS.highlightPop,
                      }}
                    />
                  </g>
                );
              }
              return (
                <circle key={key} cx={cx} cy={cy} r={latest ? 5.5 : 4} fill={latest ? 'hsl(var(--achievement-gold))' : 'hsl(var(--chart-1))'} stroke="hsl(var(--card))" strokeWidth={2} />
              );
            }}
            activeDot={{ r: 6, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      {markerTs.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="chart-marker-legend">
          Vertical lines mark workout days
        </p>
      )}
    </div>
  );
}
