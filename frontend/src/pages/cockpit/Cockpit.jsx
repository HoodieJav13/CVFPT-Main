import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Gauge, Keyboard, Radio, Rewind, Settings2 } from 'lucide-react';
import { COCKPIT_CONTROLS_EVENT } from '@/lib/cockpitFlag';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  COCKPIT_SCOPE_STYLE, HEAT_LABELS, HEAT_STATES,
} from '@/lib/cockpit/config';
import {
  attentionItems, buildRoster, createTriageState, heatCounts, keyAction, latestPending,
  pruneCleared, stationEntries, stationQueues, triageReducer, visibleItems,
} from '@/lib/cockpit/model';
import { addNote, readNotes, resolveNote } from '@/lib/cockpit/notes';
import { REPLAY_COACH, REPLAY_SCENARIOS, REPLAY_STATIONS, replayAt } from '@/lib/cockpit/replay';
import {
  AttentionQueue, HEAT_STYLES, KeyGuide, Kbd, NextUpBar, RosterHeatMap, StationQueues, UndoBar,
} from '@/components/cockpit/CockpitBoard';
import ClientPanel from '@/components/cockpit/ClientPanel';
import TemplatePreviewPanel from '@/components/cockpit/TemplatePreviewPanel';

const denverTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' });
const timeText = (valueMs) => (valueMs == null || Number.isNaN(valueMs) ? '—' : denverTime.format(new Date(valueMs)));

function SourceTabs({ source, onSource }) {
  const tabs = [
    { id: 'replay', label: 'Replay', icon: Rewind },
    { id: 'live', label: 'Live', icon: Radio },
  ];
  return (
    <div role="tablist" aria-label="Session source" className="inline-flex rounded-lg border border-border bg-card p-1">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={source === tab.id} onClick={() => onSource(tab.id)} data-testid={`cockpit-source-${tab.id}`}
          className={cn('inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium', source === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          <tab.icon className="h-4 w-4" aria-hidden />{tab.label}
        </button>
      ))}
    </div>
  );
}

// Compact by default (one row); the story, steps, devices and phone links
// open on demand, so the next client and the roster stay in view.
function ReplayBar({ replay, onScenario, onStep, phoneBase }) {
  const { scenario, step } = replay;
  return (
    <section aria-label="Replay" className="rounded-xl border border-border bg-card px-3 py-2" data-testid="cockpit-replay">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Fictional replay</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Fictional session">
          {REPLAY_SCENARIOS.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={entry.id === scenario.id} onClick={() => onScenario(entry.id)} data-testid={`cockpit-scenario-${entry.id}`}
              className={cn('min-h-9 rounded-md px-2.5 text-sm font-medium', entry.id === scenario.id ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-muted/70')}>
              {entry.title}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onStep(step - 1)} disabled={step === 0} data-testid="cockpit-step-back" aria-label="Previous step"><ChevronLeft aria-hidden /></Button>
          <span className="min-w-36 text-center text-sm tabular-nums" data-testid="cockpit-step">Step {step + 1} of {scenario.stepCount}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onStep(step + 1)} disabled={step === scenario.stepCount - 1} data-testid="cockpit-step-forward" aria-label="Next step"><ChevronRight aria-hidden /></Button>
        </div>
      </div>
      <p className="mt-1 truncate text-sm text-muted-foreground" data-testid="cockpit-step-label">{timeText(replay.timeline.at(-1)?.serverMs)} · {replay.stepLabel}</p>
      <details className="mt-1 text-sm" data-testid="cockpit-replay-details">
        <summary className="cursor-pointer text-muted-foreground">Story, steps, devices ({replay.events.length} server events) and phone views</summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">{scenario.summary}</p>
          <ol className="flex flex-wrap gap-1 text-xs" aria-label="Replay steps">
            {replay.timeline.map((entry) => (
              <li key={entry.index}>
                <button type="button" onClick={() => onStep(entry.index)} aria-current={entry.index === step ? 'step' : undefined}
                  className={cn('rounded-md border px-2 py-1', entry.index === step ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
                  {timeText(entry.serverMs)} · {entry.label}
                </button>
              </li>
            ))}
          </ol>
          <div className="grid gap-3 lg:grid-cols-2">
            <ul className="space-y-1" data-testid="cockpit-devices">
              {replay.devices.filter((device) => device.history.length || device.outbox.length).map((device) => (
                <li key={device.id} className="rounded-lg bg-background/50 px-2 py-1">
                  <strong>{device.label}</strong>
                  {device.skewMs ? <span className="ml-2 text-muted-foreground">clock {device.skewMs > 0 ? '+' : '−'}{Math.abs(device.skewMs / 1000)} s</span> : null}
                  {!device.online ? <span className="ml-2 text-muted-foreground">offline</span> : null}
                  {device.outbox.length ? <span className="ml-2 text-muted-foreground">{device.outbox.length} waiting to send</span> : null}
                  {device.history.length ? <span className="block text-xs text-muted-foreground">Last: {device.history.at(-1).text} (device {timeText(device.history.at(-1).deviceMs)}, server {timeText(device.history.at(-1).serverMs)})</span> : null}
                </li>
              ))}
            </ul>
            <ol className="max-h-48 space-y-0.5 overflow-auto font-mono text-xs text-muted-foreground" aria-label="Server event order">
              {replay.events.slice(-14).map((event) => <li key={event.id}>{timeText(Date.parse(event.created_at))} · {event.id} → {event.outcome}{event.offline ? ' (offline)' : ''}</li>)}
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">
            Fictional data on this device; no account data. Phone views:{' '}
            {replay.overview.participants.map((row, index) => (
              <span key={row.client_id}>{index ? ', ' : ''}<Link className="text-primary underline-offset-2 hover:underline" to={`${phoneBase}/${row.client_id}?scenario=${scenario.id}&step=${step}`} target="_blank" rel="noreferrer">{row.name.split(' ')[0]}</Link></span>
            ))}
          </p>
        </div>
      </details>
    </section>
  );
}

export default function Cockpit() {
  const [params, setParams] = useSearchParams();
  const source = params.get('source') === 'live' ? 'live' : 'replay';
  const scenarioId = REPLAY_SCENARIOS.some((entry) => entry.id === params.get('scenario')) ? params.get('scenario') : REPLAY_SCENARIOS[0].id;
  const scenarioSteps = REPLAY_SCENARIOS.find((entry) => entry.id === scenarioId).steps.length;
  const stepParam = Number.parseInt(params.get('step') ?? '', 10);
  const step = Number.isInteger(stepParam) ? Math.max(0, Math.min(scenarioSteps - 1, stepParam)) : scenarioSteps - 1;
  const view = params.get('view') === 'template' ? 'template' : 'board';

  const setParam = useCallback((changes) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) { if (value == null) next.delete(key); else next.set(key, String(value)); }
      return next;
    }, { replace: true });
  }, [setParams]);

  const replay = useMemo(() => replayAt(scenarioId, step), [scenarioId, step]);
  const [replayRead, setReplayRead] = useState(() => new Set());
  const scope = `replay:${scenarioId}`;
  const [replayNotesState, setReplayNotesState] = useState(() => ({ scope, notes: readNotes(localStorage, scope) }));
  useEffect(() => {
    setReplayNotesState({ scope, notes: readNotes(localStorage, scope) });
    const onStorage = (event) => { if (event.key?.endsWith(scope)) setReplayNotesState({ scope, notes: readNotes(localStorage, scope) }); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scope]);
  const notes = replayNotesState.scope === scope ? replayNotesState.notes : [];
  const { session, overview } = replay;
  const notices = useMemo(() => replay.notices.notices.filter((row) => !replayRead.has(row.id)), [replay, replayRead]);
  const roster = useMemo(() => buildRoster({ session, overview, notes }), [session, overview, notes]);
  const items = useMemo(() => attentionItems({ rows: roster.rows, serverNowMs: roster.serverNowMs, notices }), [roster, notices]);
  const queues = useMemo(() => stationQueues(REPLAY_STATIONS, stationEntries(roster.rows, replay.logsByClient)), [replay, roster.rows]);

  // ---------- Triage state (pure reducer; effects run here) ----------
  const itemsRef = useRef(items);
  const triageRef = useRef(createTriageState());
  const [triage, setTriage] = useState(triageRef.current);
  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  const commitRef = useRef(() => {});
  commitRef.current = (item) => {
    if (item.noticeIds.length) setReplayRead((current) => new Set([...current, ...item.noticeIds]));
  };
  const dispatch = useCallback((action) => {
    const { state, effects } = triageReducer(triageRef.current, action, { items: itemsRef.current, nowMs: Date.now() });
    triageRef.current = state;
    setTriage(state);
    for (const effect of effects) if (effect.type === 'commit') commitRef.current(effect.item);
  }, []);
  useEffect(() => {
    itemsRef.current = items;
    const pruned = pruneCleared(triageRef.current, items);
    if (pruned !== triageRef.current) { triageRef.current = pruned; setTriage(pruned); }
  }, [items]);
  useEffect(() => {
    // A new scenario or session starts with a fresh queue; open clears commit.
    for (const entry of triageRef.current.pending) commitRef.current(entry.item);
    triageRef.current = createTriageState();
    setTriage(triageRef.current);
    setReplayRead(new Set());
  }, [scope]);
  const hasPending = triage.pending.length > 0;
  useEffect(() => {
    if (!hasPending) return undefined;
    const timer = window.setInterval(() => { setDeviceNow(Date.now()); dispatch({ type: 'tick' }); }, 250);
    return () => window.clearInterval(timer);
  }, [hasPending, dispatch]);
  const openClears = triage.pending.filter((entry) => deviceNow < entry.untilMs);

  const visible = visibleItems(items, triage);
  const selectedItem = visible.find((item) => item.key === triage.selectedKey) || null;
  const [selectedClientId, setSelectedClientId] = useState(null);
  const activeClientId = selectedItem?.clientId || selectedClientId || roster.rows[0]?.clientId || null;
  const selectedRow = roster.rows.find((row) => row.clientId === activeClientId) || null;
  const attentionByClient = useMemo(() => {
    const map = new Map();
    for (const item of visible) if (!map.has(item.clientId)) map.set(item.clientId, item);
    return map;
  }, [visible]);

  // ---------- Selected client's next set ----------
  const [noteKind, setNoteKind] = useState('cue');
  const noteRef = useRef(null);
  const selectedLog = replay.logsByClient[activeClientId] || null;
  const addClientNote = ({ kind, text, setRef }) => {
    if (!selectedRow) return { error: 'Select a client first.' };
    const result = addNote(localStorage, scope, { id: crypto.randomUUID(), clientId: selectedRow.clientId, kind, text, setRef, createdAtMs: roster.serverNowMs ?? Date.now(), author: REPLAY_COACH.name });
    if (result.notes) setReplayNotesState({ scope, notes: result.notes });
    return result;
  };
  const resolveClientNote = (id) => {
    const result = resolveNote(localStorage, scope, id);
    setReplayNotesState({ scope, notes: result.notes });
    return result;
  };

  const focusNote = useCallback((kind) => {
    setNoteKind(kind);
    // Focus in the same task as the N/P key. Waiting a frame let the first
    // typed letters reach the board shortcuts instead: the letter was lost and
    // "c" cleared an attention item, "u" undid one.
    const place = () => {
      const field = noteRef.current;
      if (!field) return false;
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: 'center' });
      return true;
    };
    if (!place()) window.requestAnimationFrame(place);
  }, []);

  // ---------- Keyboard ----------
  const [guideOpen, setGuideOpen] = useState(false);
  const moveRoster = useCallback((delta) => {
    const rows = roster.rows;
    if (!rows.length) return;
    const index = Math.max(0, rows.findIndex((row) => row.clientId === activeClientId));
    const next = rows[(index + delta + rows.length) % rows.length];
    dispatch({ type: 'select', key: null });
    setSelectedClientId(next.clientId);
  }, [roster.rows, activeClientId, dispatch]);
  useEffect(() => {
    if (source !== 'replay' || view !== 'board') return undefined;
    const onKey = (event) => {
      const action = keyAction(event);
      if (!action) return;
      if (action === 'escape') { if (document.activeElement === noteRef.current) noteRef.current.blur(); setGuideOpen(false); return; }
      event.preventDefault();
      if (action === 'left' || action === 'right') moveRoster(action === 'left' ? -1 : 1);
      else if (action === 'note') focusNote('cue');
      else if (action === 'pain') focusNote('pain');
      else if (action === 'help') setGuideOpen((open) => !open);
      else dispatch({ type: action });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, view, moveRoster, dispatch, focusNote]);

  const counts = heatCounts(roster.rows, roster.serverNowMs);
  const top = visible[0] || null;
  const phoneBase = '/coach/cockpit/phone';
  // Keep the latest open clear findable for the Undo bar.
  const undoTarget = latestPending(triage, deviceNow);

  return (
    <div className="space-y-4 pb-24" style={COCKPIT_SCOPE_STYLE} data-testid="cockpit">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-muted-foreground"><Gauge className="h-4 w-4" aria-hidden /> Coaching cockpit</p>
          <h1 className="font-display text-4xl font-semibold leading-tight" data-testid="cockpit-title">{overview?.session?.title || 'Live session'}</h1>
          <p className="text-sm text-muted-foreground" data-testid="cockpit-clock">
            Fictional replay · server time {timeText(roster.serverNowMs)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceTabs source={source} onSource={(id) => setParam({ source: id === 'live' ? 'live' : null })} />
          <div role="tablist" aria-label="Cockpit view" className="inline-flex rounded-lg border border-border bg-card p-1">
            {[['board', 'Session board'], ['template', 'Template changes']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setParam({ view: id === 'board' ? null : id })} data-testid={`cockpit-view-${id}`}
                className={cn('min-h-10 rounded-md px-3 text-sm font-medium', view === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setGuideOpen((open) => !open)} aria-expanded={guideOpen}><Keyboard aria-hidden /> Keys <Kbd>?</Kbd></Button>
          {(
            <Button type="button" variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => window.dispatchEvent(new Event(COCKPIT_CONTROLS_EVENT))} data-testid="cockpit-preview-controls">
              <Settings2 aria-hidden /> Preview controls
            </Button>
          )}
        </div>
      </header>

      <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground lg:hidden">The cockpit is laid out for a laptop or desktop. Clients use their own phone view.</p>

      {source === 'replay' && <ReplayBar replay={replay} onScenario={(id) => setParam({ scenario: id, step: null })} onStep={(value) => setParam({ step: value })} phoneBase={phoneBase} />}

      {source === 'live' ? (
        <section className="rounded-xl border border-border bg-card p-6" data-testid="cockpit-live-unsupported">
          <p className="font-display text-2xl font-semibold">Not available in preview</p>
          <p className="mt-1 text-muted-foreground">Use Replay to see the board built from fictional events. Live sessions are not connected.</p>
        </section>
      ) : view === 'template' ? (
        <TemplatePreviewPanel scope="replay" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" aria-label="Heat summary" data-testid="cockpit-heat-summary">
            {HEAT_STATES.map((heat) => (
              <span key={heat} className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold', HEAT_STYLES[heat].chip)}>
                <span className="font-display text-lg tabular-nums">{counts[heat]}</span>{HEAT_LABELS[heat]}
              </span>
            ))}
          </div>

          <NextUpBar item={top} total={visible.length} onClear={() => top && dispatch({ type: 'clear', key: top.key })} onNote={() => { if (top) dispatch({ type: 'select', key: top.key }); focusNote('cue'); }} />

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 space-y-4 lg:col-span-7">
              <RosterHeatMap rows={roster.rows} serverNowMs={roster.serverNowMs} selectedClientId={activeClientId} attentionByClient={attentionByClient}
                onSelect={(clientId) => { dispatch({ type: 'select', key: null }); setSelectedClientId(clientId); }} />
              <StationQueues queues={queues} note="Fictional floor · arrival order (server time)" />
            </div>
            <div className="min-w-0 space-y-4 lg:col-span-5">
              <AttentionQueue items={visible} selectedKey={triage.selectedKey} onSelect={(key) => dispatch({ type: 'select', key })} onClear={(key) => dispatch({ type: 'clear', key })} />
              <ClientPanel
                row={selectedRow}
                serverNowMs={roster.serverNowMs}
                log={selectedLog}
                notes={notes.filter((note) => note.clientId === activeClientId)}
                noteKind={noteKind}
                onNoteKind={setNoteKind}
                noteRef={noteRef}
                onAddNote={addClientNote}
                onResolveNote={resolveClientNote}
                persistenceLabel="Fictional replay: saved on this device and shown on their fictional phone view at that set."
                phoneHref={selectedRow ? `${phoneBase}/${selectedRow.clientId}?scenario=${scenarioId}&step=${step}` : null}
              />
              <KeyGuide open={guideOpen} />
            </div>
          </div>
        </>
      )}
      <UndoBar open={undoTarget ? openClears : []} nowMs={deviceNow} onUndo={() => dispatch({ type: 'undo' })} />
    </div>
  );
}
