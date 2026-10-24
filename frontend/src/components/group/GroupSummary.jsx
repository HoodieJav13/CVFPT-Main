import { summarize } from '@/lib/groupSession';
import { StatTile } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { fmtTime } from '@/lib/format';

function formatVolume(volume) {
  const parts = Object.entries(volume).filter(([, value]) => value > 0).map(([unit, value]) => `${Math.round(value).toLocaleString()} ${unit}`);
  return parts.length ? parts.join(' + ') : '—';
}

function setText(set) {
  const reps = set.reps == null ? '' : `${set.reps}`;
  const load = set.load == null ? '' : `${set.load} ${set.unit}`;
  return [reps, load].filter(Boolean).join(' × ');
}

// Group and individual summary, built only from each trainee's own saved sets.
export default function GroupSummary({ session }) {
  const summary = summarize(session);
  return (
    <div className="space-y-6" data-testid="group-summary">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Rounds" value={`${summary.roundsDone}/${summary.roundCount}`} testId="group-summary-rounds" />
        <StatTile label="Sets saved" value={summary.totalSets} testId="group-summary-sets" />
        <StatTile label="Substitutions" value={summary.substitutions} testId="group-summary-substitutions" />
        <StatTile label="Equipment changes" value={summary.disruptions} testId="group-summary-disruptions" />
      </div>
      {summary.unsynced ? (
        <p className="text-sm text-destructive" role="alert" data-testid="group-summary-unsynced">
          {summary.unsynced} entered set(s) never reached the server and are not in anyone&apos;s history.
        </p>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Stations</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.stations.map((station) => (
            <div key={station.id} className="rounded-lg border border-border p-3 text-sm" data-testid={`group-summary-station-${station.id}`}>
              <p className="font-medium">{station.label} · {station.plan}</p>
              <p className="text-muted-foreground">{station.setsDone} sets saved across {station.visits} visit(s)</p>
              {station.amendments.map((row) => (
                <p key={row.id} className="text-xs text-muted-foreground">
                  {row.kind === 'restore' ? 'Equipment back' : `Changed to ${row.exercise.name}`} in round {row.round + 1}{row.reason ? ` (${row.reason})` : ''}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Each trainee</h2>
        {summary.people.map((person) => (
          <div key={person.traineeId} className="space-y-2 rounded-xl border border-border bg-card/60 p-4" data-testid={`group-summary-person-${person.traineeId}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{person.name}</p>
              <p className="text-sm text-muted-foreground" data-testid={`group-summary-person-${person.traineeId}-totals`}>
                {person.setsDone} of {person.setsPlanned} planned sets · volume {formatVolume(person.volume)}
              </p>
            </div>
            {person.replaces || person.leftRound !== null ? (
              <p className="text-xs text-muted-foreground">
                {person.replaces ? `Joined in round ${person.joinedRound + 1} as a substitute. ` : ''}
                {person.leftRound !== null ? `Left during round ${person.leftRound + 1}.` : ''}
              </p>
            ) : null}
            {person.stations.length ? person.stations.map((visit) => (
              <div key={`${visit.round}-${visit.stationLabel}`} className="text-sm" data-testid={`group-summary-visit-${person.traineeId}-${visit.round}`}>
                <span className="font-medium">Round {visit.round + 1} · {visit.stationLabel}: {visit.exercise}</span>
                {visit.amended ? <Badge variant="outline" className="ml-2">instead of {visit.replaces}</Badge> : null}
                <span className="ml-2 text-muted-foreground">{visit.sets.length ? visit.sets.map(setText).join(', ') : 'no sets saved'}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No sets recorded.</p>}
          </div>
        ))}
      </section>
      <section className="space-y-1">
        <h2 className="text-sm font-semibold">Timeline</h2>
        <ol className="space-y-1 text-sm text-muted-foreground" data-testid="group-summary-timeline">
          {summary.events.map((event, index) => <li key={index}>{fmtTime(event.at)} · {event.text}</li>)}
        </ol>
      </section>
    </div>
  );
}
