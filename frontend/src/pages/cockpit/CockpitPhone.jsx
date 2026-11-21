import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import ClientNextCard from '@/components/cockpit/ClientNextCard';
import { clientNextView } from '@/lib/cockpit/model';
import { COCKPIT_SCOPE_STYLE } from '@/lib/cockpit/config';
import { readNotes } from '@/lib/cockpit/notes';
import { REPLAY_CLIENTS, REPLAY_COACH, REPLAY_SCENARIOS, replayAt } from '@/lib/cockpit/replay';

const denverTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' });

// Fictional client phone view for a cockpit replay (preview builds only). It
// is rebuilt from the same deterministic replay step the coach is looking at,
// and shows the coach's device-local note pinned to this client's next set.
// The rest timer runs on the replay's server time plus time since this page
// opened (a simulated clock, labeled).
export default function CockpitPhone({ view }) {
  const params = useParams();
  const [search] = useSearchParams();
  const clientId = view === 'coach' ? params.clientId : (search.get('as') || REPLAY_CLIENTS[0].id);
  const scenarioId = REPLAY_SCENARIOS.some((entry) => entry.id === search.get('scenario')) ? search.get('scenario') : REPLAY_SCENARIOS[0].id;
  const stepParam = Number.parseInt(search.get('step') ?? '', 10);
  const replay = useMemo(() => replayAt(scenarioId, Number.isInteger(stepParam) ? stepParam : undefined), [scenarioId, stepParam]);
  const scope = `replay:${scenarioId}`;
  const [notes, setNotes] = useState(() => readNotes(localStorage, scope));
  const [openedAt] = useState(() => Date.now());
  const [deviceNow, setDeviceNow] = useState(() => Date.now());

  useEffect(() => {
    setNotes(readNotes(localStorage, scope));
    const onStorage = (event) => { if (event.key?.endsWith(scope)) setNotes(readNotes(localStorage, scope)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope]);
  useEffect(() => {
    const timer = window.setInterval(() => setDeviceNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const serverNowMs = Date.parse(replay.overview.server_time);
  const clockMs = serverNowMs + (deviceNow - openedAt);
  const client = REPLAY_CLIENTS.find((row) => row.id === clientId) || null;
  const log = replay.logsByClient[clientId] || null;
  const participant = replay.overview.participants.some((row) => row.client_id === clientId);
  const nextView = useMemo(() => clientNextView(log, notes.filter((note) => note.clientId === clientId), serverNowMs), [log, notes, clientId, serverNowMs]);

  return (
    <div className="min-h-dvh bg-background app-noise" style={COCKPIT_SCOPE_STYLE} data-testid="cockpit-phone">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold leading-tight" data-testid="phone-client-name">{client?.name || 'Unknown participant'}</p>
            <p className="truncate text-xs text-muted-foreground">Fictional replay · {replay.scenario.title} · {denverTime.format(new Date(clockMs))} (simulated)</p>
          </div>
          {view === 'coach' ? <Link to={`/coach/cockpit?scenario=${scenarioId}&step=${replay.step}`} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm text-primary">Cockpit</Link> : null}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pb-12 pt-4">
        {!client || !participant ? (
          <p className="rounded-2xl border border-border bg-card p-5 text-lg" data-testid="phone-not-here">
            {client ? `${client.name} has not joined this session yet at this point in the replay.` : 'This participant is not in the replay.'}
          </p>
        ) : (
          <ClientNextCard view={nextView} clockMs={clockMs} coachName={REPLAY_COACH.name} />
        )}
      </main>
    </div>
  );
}
