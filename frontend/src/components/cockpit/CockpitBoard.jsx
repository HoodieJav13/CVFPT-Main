import { AlertTriangle, Check, CircleDot, Clock, Footprints, HeartPulse, Hourglass, MessageSquareWarning, Repeat2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HEAT_LABELS } from '@/lib/cockpit/config';
import { classifyHeat, paceOf } from '@/lib/cockpit/model';

// Cockpit-scoped attention colour (config COCKPIT_SCOPE_STYLE sets
// --attention on the cockpit roots). Literal class strings so Tailwind keeps
// them. Never colour alone: every state also carries a label and an icon.
export const ATTN = {
  text: 'text-[hsl(var(--attention))]',
  softBg: 'bg-[hsl(var(--attention)/0.1)]',
  border: 'border-[hsl(var(--attention)/0.7)]',
  softBorder: 'border-[hsl(var(--attention)/0.4)]',
  solid: 'bg-[hsl(var(--attention))] text-[hsl(var(--attention-foreground))]',
  bar: 'bg-[hsl(var(--attention))]',
};

export const HEAT_STYLES = {
  needs_cue: { tile: cn('border-2', ATTN.border, ATTN.softBg), chip: ATTN.solid, icon: MessageSquareWarning },
  behind: { tile: cn('border-dashed bg-card', ATTN.softBorder), chip: cn('border', ATTN.softBorder, ATTN.text), icon: Hourglass },
  on_pace: { tile: 'border-primary/35 bg-primary/[0.07]', chip: 'bg-primary/15 text-primary', icon: CircleDot },
  done: { tile: 'border-success/35 bg-success/[0.07]', chip: 'bg-success/15 text-success', icon: Check },
  not_started: { tile: 'border-border bg-muted/30', chip: 'bg-muted text-muted-foreground', icon: Footprints },
};

const KIND_ICONS = {
  conflict: AlertTriangle, swap_waiting: Repeat2, pain: HeartPulse, idle: Clock, swap_review: Repeat2, notice: MessageSquareWarning, behind: Hourglass, arrived: Footprints,
};

export const KIND_LABELS = {
  conflict: 'Two values', swap_waiting: 'Swap waiting', pain: 'Pain flag', idle: 'Quiet', swap_review: 'Swap to review', notice: 'Notice', behind: 'Behind', arrived: 'Just arrived',
};

export function Kbd({ children, className }) {
  return <kbd className={cn('inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground', className)}>{children}</kbd>;
}

export function NextUpBar({ item, total, onClear, onNote }) {
  if (!item) {
    return (
      <section aria-label="Next up" className="rounded-2xl border border-success/40 bg-success/[0.08] px-6 py-4" data-testid="cockpit-next-up">
        <p className="text-sm uppercase tracking-[0.18em] text-success">Next up</p>
        <p className="font-display text-4xl font-semibold leading-tight">Nobody needs you right now</p>
        <p className="mt-1 text-muted-foreground">Everyone is on pace, done, or not started yet.</p>
      </section>
    );
  }
  const Icon = KIND_ICONS[item.kind] || AlertTriangle;
  return (
    <section aria-label="Next up" aria-live="polite" className={cn('flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 bg-card px-6 py-4', ATTN.border)} data-testid="cockpit-next-up">
      <div className="min-w-0">
        <p className={cn('flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em]', ATTN.text)}>
          <Icon className="h-4 w-4" aria-hidden /> Next up · {KIND_LABELS[item.kind]} · 1 of {total}
        </p>
        <p className="font-display text-5xl font-semibold leading-none tracking-tight" data-testid="cockpit-next-name">{item.name}</p>
        <p className="mt-2 max-w-3xl text-xl leading-snug text-foreground/90" data-testid="cockpit-next-reason">{item.reason}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onClear} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="cockpit-next-clear">
          <Kbd>C</Kbd> Clear
        </button>
        <button type="button" onClick={onNote} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Kbd>N</Kbd> Note
        </button>
      </div>
    </section>
  );
}

export function RosterHeatMap({ rows, serverNowMs, selectedClientId, onSelect, attentionByClient }) {
  return (
    <section aria-labelledby="cockpit-roster-title" data-testid="cockpit-roster">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="cockpit-roster-title" className="font-display text-xl font-semibold">Roster</h2>
        <p className="text-xs text-muted-foreground"><Kbd>←</Kbd> <Kbd>→</Kbd> move across the roster</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
        {rows.map((row) => {
          const heat = classifyHeat(row, serverNowMs);
          const style = HEAT_STYLES[heat];
          const Icon = style.icon;
          const pace = paceOf(row, serverNowMs);
          const selected = row.clientId === selectedClientId;
          const top = attentionByClient.get(row.clientId);
          return (
            <li key={row.clientId} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(row.clientId)}
                aria-pressed={selected}
                data-testid={`cockpit-tile-${row.clientId}`}
                data-heat={heat}
                className={cn('flex h-full min-h-24 w-full flex-col justify-between rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', style.tile, selected && 'outline outline-2 outline-offset-2 outline-foreground')}
              >
                {/* The full name gets its own line and may wrap: identifying a
                    client from across the floor beats a tidy grid. */}
                <span className="block break-words font-display text-[1.35rem] font-semibold leading-tight" data-testid={`cockpit-tile-name-${row.clientId}`}>{row.name}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', style.chip)}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />{HEAT_LABELS[heat]}
                  </span>
                  {top ? <span className="text-xs text-foreground/80">{KIND_LABELS[top.kind]}</span> : null}
                </span>
                <span className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
                  {row.log ? <span><span className="font-display text-xl text-foreground tabular-nums">{row.log.done}</span>/{row.log.total} sets</span> : <span>No workout yet</span>}
                  {pace && heat !== 'done' ? <span className="text-xs">{Math.round(pace.expected * 100)}% of time</span> : null}
                </span>
                {row.log ? (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-background/60" aria-hidden>
                    <span className={cn('block h-full rounded-full', heat === 'done' ? 'bg-success' : heat === 'needs_cue' || heat === 'behind' ? ATTN.bar : 'bg-primary')} style={{ width: `${row.log.total ? Math.round((row.log.done / row.log.total) * 100) : 0}%` }} />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AttentionQueue({ items, selectedKey, onSelect, onClear }) {
  return (
    <section aria-labelledby="cockpit-attention-title" data-testid="cockpit-attention">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="cockpit-attention-title" className="font-display text-xl font-semibold">Who needs you <span className="text-muted-foreground">({items.length})</span></h2>
        <p className="text-xs text-muted-foreground"><Kbd>↑</Kbd> <Kbd>↓</Kbd> · <Kbd>C</Kbd> clear</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">Nothing waiting. A cleared item comes back only if something new happens.</p>
      ) : (
        <ol className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1" aria-label="Ranked by urgency">
          {items.map((item, index) => {
            const Icon = KIND_ICONS[item.kind] || AlertTriangle;
            const selected = item.key === selectedKey;
            return (
              <li key={item.key} className={cn('flex items-stretch gap-1 rounded-xl border bg-card', selected ? 'border-foreground ring-1 ring-foreground' : 'border-border')}>
                <button
                  type="button"
                  onClick={() => onSelect(item.key)}
                  aria-current={selected ? 'true' : undefined}
                  data-testid={`cockpit-item-${index}`}
                  className="flex min-h-14 min-w-0 flex-1 items-start gap-3 rounded-l-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold', index === 0 ? ATTN.solid : 'bg-muted text-foreground')}>{index + 1}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold"><Icon className={cn('h-4 w-4 shrink-0', ATTN.text)} aria-hidden />{item.name}<span className="text-xs font-normal text-muted-foreground">· {KIND_LABELS[item.kind]}</span></span>
                    <span className="block text-sm text-muted-foreground">{item.reason}</span>
                  </span>
                </button>
                <button type="button" onClick={() => onClear(item.key)} aria-label={`Clear ${KIND_LABELS[item.kind]} for ${item.name}`} className="min-h-14 rounded-r-xl px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Clear
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function StationQueues({ queues, note }) {
  return (
    <section aria-labelledby="cockpit-stations-title" data-testid="cockpit-stations">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="cockpit-stations-title" className="font-display text-xl font-semibold">Equipment queues</h2>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      {queues.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No station information for this session. Station queues appear for station-mode sessions and in replay.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {queues.map((queue) => (
            <li key={queue.id} className="min-w-0 rounded-xl border border-border bg-card p-3" data-testid={`cockpit-station-${queue.id}`}>
              <p className="break-words font-display text-lg font-semibold leading-tight">{queue.label}</p>
              <p className="text-xs text-muted-foreground">{queue.capacity ? `${queue.working.length}/${queue.capacity} in use` : `${queue.working.length} here`}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {queue.working.map((entry) => <li key={entry.clientId} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" aria-hidden />{entry.name}</li>)}
                {queue.working.length === 0 ? <li className="text-muted-foreground">Free</li> : null}
              </ul>
              {queue.waiting.length ? (
                <div className="mt-2 border-t border-border pt-2">
                  <p className={cn('text-xs uppercase tracking-wide', ATTN.text)}>{queue.capacity ? `Waiting (${queue.waiting.length})` : 'Next round'}</p>
                  <ol className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {queue.waiting.map((entry, index) => <li key={entry.clientId}>{index + 1}. {entry.name}</li>)}
                  </ol>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Shows the most recent clear still inside its window, and how many others
// are still undoable, so no window silently disappears.
export function UndoBar({ open, nowMs, onUndo }) {
  if (!open.length) return null;
  const latest = open[open.length - 1];
  const seconds = Math.max(0, Math.ceil((latest.untilMs - nowMs) / 1000));
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg" data-testid="cockpit-undo">
      <span>
        Cleared <strong>{latest.item.name}</strong> · {KIND_LABELS[latest.item.kind]}
        {open.length > 1 ? <span className="ml-1 text-muted-foreground" data-testid="cockpit-undo-more">(+{open.length - 1} more still undoable)</span> : null}
      </span>
      <button type="button" onClick={onUndo} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="cockpit-undo-button">
        <Undo2 className="h-4 w-4" aria-hidden /> Undo <Kbd className="border-primary-foreground/40 bg-transparent text-primary-foreground">U</Kbd> {seconds} s
      </button>
    </div>
  );
}

export function KeyGuide({ open }) {
  if (!open) return null;
  const rows = [['↑ ↓  or  K J', 'Move through who needs you'], ['← →', 'Move across the roster'], ['C', 'Clear the selected item (one key)'], ['U', 'Undo the latest clear (each has 10 s)'], ['N', 'Cue for the selected client'], ['P', 'Pain flag for the selected client'], ['Space / Enter', 'Jump to the next item'], ['?', 'Show or hide these keys'], ['Esc', 'Leave the note']];
  return (
    <aside aria-label="Keyboard shortcuts" className="rounded-xl border border-border bg-card p-4" data-testid="cockpit-key-guide">
      <h2 className="font-display text-lg font-semibold">Keys</h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([key, text]) => <div key={key} className="contents"><dt><Kbd>{key}</Kbd></dt><dd className="text-muted-foreground">{text}</dd></div>)}
      </dl>
    </aside>
  );
}
