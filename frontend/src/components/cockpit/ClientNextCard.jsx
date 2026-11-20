import { Check, HeartPulse, MessageSquareText, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ATTN } from './CockpitBoard';

function restText(remainingMs) {
  const total = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Phone-first client view: designed for 320–430 px and read at arm's length.
// One column, the rest timer as the largest element, the coach note pinned
// directly under the set it belongs to.
export default function ClientNextCard({ view, clockMs, coachName }) {
  if (!view) return <p className="text-lg text-muted-foreground">No workout today.</p>;
  if (view.done) {
    return (
      <section className="rounded-3xl border border-success/40 bg-success/10 p-6 text-center" data-testid="phone-done">
        <Check className="mx-auto h-10 w-10 text-success" aria-hidden />
        <p className="mt-2 font-display text-4xl font-semibold">All {view.setsTotal} sets recorded</p>
        <p className="mt-1 text-muted-foreground">{view.workoutName}</p>
      </section>
    );
  }
  const { next, rest } = view;
  const remaining = rest ? Math.max(0, rest.endsAtMs - clockMs) : 0;
  const resting = rest && remaining > 0;
  const progress = rest && rest.seconds ? Math.min(1, remaining / (rest.seconds * 1000)) : 0;
  return (
    <div className="space-y-4">
      <p className="flex items-baseline justify-between text-sm text-muted-foreground">
        <span>{view.workoutName}</span>
        <span className="tabular-nums" data-testid="phone-progress">{view.setsDone} / {view.setsTotal} sets</span>
      </p>

      <section aria-label="Rest timer" className={cn('rounded-3xl border p-5 text-center', resting ? 'border-primary/50 bg-primary/10' : 'border-border bg-card')} data-testid="phone-rest">
        <p className="flex items-center justify-center gap-2 text-base uppercase tracking-[0.2em] text-muted-foreground">
          <Timer className="h-5 w-5" aria-hidden /> {resting ? 'Rest' : 'Ready'}
        </p>
        <p className="font-display text-[clamp(5rem,28vw,8.5rem)] font-semibold leading-none tabular-nums" aria-live="off" data-testid="phone-rest-time">
          {resting ? restText(remaining) : 'Go'}
        </p>
        {resting ? (
          <span className="mx-auto mt-3 block h-2 w-full max-w-xs overflow-hidden rounded-full bg-background/70" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        ) : null}
      </section>

      <section aria-label="Next set" className="rounded-3xl border border-border bg-card p-5" data-testid="phone-next">
        <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">Next · set {next.setNumber} of {next.setCount}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold leading-tight" data-testid="phone-exercise">{next.exerciseName}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-background/60 p-3">
            <dt className="text-sm text-muted-foreground">Target</dt>
            <dd className="font-display text-4xl font-semibold tabular-nums">{next.reps || '—'}</dd>
          </div>
          <div className="rounded-2xl bg-background/60 p-3">
            <dt className="text-sm text-muted-foreground">Load</dt>
            <dd className="font-display text-4xl font-semibold tabular-nums" data-testid="phone-load">
              {next.loadValue != null ? <>{next.loadValue}<span className="ml-1 text-xl text-muted-foreground">{next.loadUnit}</span></> : 'Body'}
            </dd>
          </div>
        </dl>
        {next.upNext ? <p className="mt-3 text-sm text-muted-foreground">Then: {next.upNext}</p> : null}
      </section>

      {view.notes.length ? (
        <section aria-label="From your coach" className="space-y-2" data-testid="phone-notes">
          {view.notes.map((note) => {
            const Icon = note.kind === 'pain' ? HeartPulse : MessageSquareText;
            return (
              <article key={note.id} className={cn('rounded-2xl border-l-4 p-4', ATTN.border, ATTN.softBg)}>
                <p className={cn('flex items-center gap-2 text-sm font-semibold', ATTN.text)}><Icon className="h-4 w-4" aria-hidden />{note.kind === 'pain' ? 'Coach check-in' : 'Coach cue'} · this set</p>
                <p className="mt-1 text-2xl leading-snug" data-testid="phone-note-text">{note.text}</p>
                <p className="mt-1 text-xs text-muted-foreground">{note.author || coachName} · {note.savedTo === 'account' ? 'from your coach' : 'fictional replay note'}</p>
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
