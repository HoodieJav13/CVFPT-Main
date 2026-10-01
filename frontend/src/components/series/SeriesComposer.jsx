import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { RecurrencePanel } from '@/components/series/RecurrencePanel';
import { SeriesPreviewList } from '@/components/series/SeriesPreviewList';
import { createDraftStore, newRequestId } from '@/lib/seriesDraftStore';
import { classifySaveOutcome, buildCheckBody, buildCreateBody, createSeqGuard } from '@/lib/seriesRequest';
import {
  assignDefault, configFromBody, mapWorkouts, pinsFromBody, programGate, rowsFromBody, shiftDate, sortRows, summarizeSelection, weekdayOfDate,
} from '@/lib/seriesPlan';

const signatureOf = (rows, durationMinutes) => JSON.stringify([
  durationMinutes,
  sortRows(rows).filter((row) => row.selected).map((row) => [row.key, row.date, row.time]),
]);

// Stages: configure -> review -> saving -> done, with two special stages:
//   unknown  : the save outcome is not known (timeout / 5xx / restored after a reload).
//              The body and request id are FROZEN; the only actions are Retry and Check,
//              both of which resend the identical request until a definitive answer arrives.
//   mismatch : the server says this request id was used with different content.
//
// Identity: the parent keys this component by CLIENT only, so ordinary edits to duration or
// location (props) never reset the draft. Duration is part of the check signature, so changing
// it re-checks the whole selection. Changing the first session's date/time sends the coach back
// to the repeat settings (the rows came from a rule that no longer matches) without discarding them.
export function SeriesComposer({
  clientId, startAt, durationMinutes, location, resumeRecord = null, onBusyChange, onDone,
}) {
  const { user } = useAuth();
  const userId = user?.profile?.id || user?.email || 'anonymous';
  const store = useMemo(() => createDraftStore({ userId }), [userId]);
  const startDate = startAt.slice(0, 10);
  const startTime = startAt.slice(11, 16);

  const [config, setConfig] = useState({
    weekdays: [weekdayOfDate(startDate)], intervalWeeks: 1, endMode: 'count', count: 12, until: '',
    programId: '', startingDay: 1, assignProgram: true, notify: true,
  });
  const [stage, setStage] = useState(resumeRecord ? 'unknown' : 'configure');
  const [rows, setRows] = useState([]);
  const [pins, setPins] = useState({});
  const [ruleUsed, setRuleUsed] = useState(null); // the rule the current rows were generated from (display copy)
  const [programs, setPrograms] = useState([]);
  // 'loading' | 'ready' | 'failed' — an unloaded or failed list must never be mistaken for "no program".
  const [programsStatus, setProgramsStatus] = useState('loading');
  const [workouts, setWorkouts] = useState([]);
  const [checking, setChecking] = useState(false);
  const [checkedSignature, setCheckedSignature] = useState(null); // the selection the server last checked
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [startChanged, setStartChanged] = useState(false);
  const [error, setError] = useState('');
  const [storageOk, setStorageOk] = useState(true);

  // One request id per draft; never regenerated automatically.
  const requestIdRef = useRef(resumeRecord?.request_id || newRequestId());
  const frozenBodyRef = useRef(resumeRecord?.body || null);
  const draftRef = useRef(resumeRecord?.draft || null); // editor snapshot taken at the moment of saving
  const guard = useRef(createSeqGuard()).current;
  const lastChecked = useRef(null);
  const prevStartAt = useRef(startAt);
  const addedCounter = useRef(0);

  const markChecked = (signature) => { lastChecked.current = signature; setCheckedSignature(signature); };

  const loadPrograms = useCallback(() => {
    setProgramsStatus('loading');
    api.get('/programs')
      .then(({ data }) => { setPrograms(data || []); setProgramsStatus('ready'); })
      .catch(() => setProgramsStatus('failed'));
  }, []);

  useEffect(() => {
    loadPrograms();
    api.get('/programs/workouts').then(({ data }) => setWorkouts(data || [])).catch(() => setWorkouts([]));
  }, [loadPrograms]);

  // A pending save for this client (reload, or the drawer was closed mid-save) is restored, not replaced.
  useEffect(() => {
    if (resumeRecord) return;
    const pending = store.load(clientId);
    if (pending) {
      requestIdRef.current = pending.request_id;
      frozenBodyRef.current = pending.body;
      draftRef.current = pending.draft || null;
      setStage('unknown');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { onBusyChange?.(stage === 'saving' || stage === 'unknown'); }, [stage, onBusyChange]);

  // The first session moved: the rows were generated from a rule that no longer matches.
  useEffect(() => {
    if (prevStartAt.current === startAt) return;
    prevStartAt.current = startAt;
    if (rows.length && (stage === 'review' || stage === 'configure')) { setStage('configure'); setStartChanged(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt]);

  const selectedProgram = programs.find((program) => program.id === config.programId) || null;
  // `needsAssign` only decides whether the checkbox is offered and sent. The checkbox's VALUE is the
  // coach's choice: its default is applied when a program is explicitly chosen (chooseConfig below),
  // never as a reaction to program metadata loading or to a restored draft.
  const needsAssign = Boolean(selectedProgram) && !(selectedProgram.active_assignments || []).some((a) => a.client?.id === clientId);
  // Automatic workouts and the requested assignment both come from the program. A draft that references a
  // program (always true for a restored one) cannot be saved until that program has really loaded.
  const gate = programGate({ programId: config.programId, status: programsStatus, program: selectedProgram });

  const programDays = useMemo(
    () => (selectedProgram?.days || []).map((day) => ({ day_number: day.day_number, workout_id: day.workout?.id || day.workout_id || null })),
    [selectedProgram],
  );
  const mapping = useMemo(
    () => mapWorkouts({ rows, programDays, startingDay: config.startingDay, pins }),
    [rows, programDays, config.startingDay, pins],
  );
  const summary = useMemo(() => summarizeSelection(rows), [rows]);
  const signature = useMemo(() => signatureOf(rows, durationMinutes), [rows, durationMinutes]);
  const anyConflict = rows.some((row) => row.selected && row.conflict);
  const frozen = stage === 'saving' || stage === 'unknown' || stage === 'done';

  const patchConfig = (patch) => setConfig((current) => ({ ...current, ...patch }));
  // Choosing a program is the one moment the "assign" default is applied.
  const chooseConfig = (patch) => {
    if (Object.hasOwn(patch, 'programId')) {
      const chosen = programs.find((program) => program.id === patch.programId) || null;
      patchConfig({ ...patch, assignProgram: assignDefault(chosen, clientId) });
    } else {
      patchConfig(patch);
    }
  };
  const updateRow = (key, patch) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const slotToRow = (slot) => ({
    key: slot.key, date: slot.date, time: slot.time, selected: true, conflict: slot.conflict, suggestions: slot.suggestions || [], display: slot.display,
  });

  const currentRule = () => ({
    start_date: startDate, time: startTime, weekdays: config.weekdays, interval_weeks: config.intervalWeeks,
    end: config.endMode === 'count' ? { count: Number(config.count) } : { until: config.until },
  });

  // Previewing REGENERATES the dates; the existing draft is replaced only when the new preview succeeds.
  const preview = async () => {
    setError('');
    setChecking(true);
    try {
      const rule = currentRule();
      const { data } = await api.post('/sessions/series/preview', {
        client_id: clientId, start_date: rule.start_date, time: rule.time, duration_minutes: durationMinutes,
        weekdays: rule.weekdays, interval_weeks: rule.interval_weeks, end: rule.end, location: location || null,
      });
      const next = data.slots.map(slotToRow);
      setRuleUsed(rule);
      setRows(next);
      setPins({});
      setStartChanged(false);
      markChecked(signatureOf(next, durationMinutes));
      setStage('review');
    } catch (e) {
      setError(errMsg(e, 'Could not preview the dates'));
    } finally {
      setChecking(false);
    }
  };

  // Re-check the WHOLE selection whenever a date, time, duration, or selection changes.
  // Every change bumps the sequence (even when the fetch is skipped) so a delayed response can
  // never overwrite newer state, and Create stays disabled until the CURRENT selection has been
  // checked (checkedSignature === signature) — including the debounce gap before the request starts.
  useEffect(() => {
    if (stage !== 'review' || !rows.length) return undefined;
    const seq = guard.next();
    if (lastChecked.current === signature) { setChecking(false); return undefined; }
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const { data } = await api.post('/sessions/series/check', buildCheckBody({
          clientId, durationMinutes, startDate: ruleUsed?.start_date || startDate, rows, seq,
        }));
        if (!guard.isCurrent(data.seq)) return;
        setCheckFailed(false);
        setRows((current) => current.map((row) => {
          const result = data.slots.find((slot) => slot.key === row.key);
          return result ? { ...row, conflict: result.conflict, suggestions: result.suggestions || [], display: result.display } : row;
        }));
        markChecked(signature);
        setChecking(false);
      } catch {
        if (guard.isCurrent(seq)) { setCheckFailed(true); setChecking(false); }
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, stage, retryTick]);

  const applyConflicts = (conflicts) => {
    markChecked(null); // force a fresh check (and suggestions) once the editor is back in review
    setRows((current) => current.map((row) => {
      const conflict = conflicts.find((item) => item.key === row.key);
      return conflict
        ? { ...row, conflict: { scope: conflict.scope, session: conflict.session, with_key: conflict.with_key, display: conflict.display }, suggestions: [] }
        : row;
    }));
  };

  // After a reload the composer only has the frozen request (and, for newer records, an editor
  // snapshot). When the retry ends in a DEFINITIVE answer the editor must be usable again:
  // restore the snapshot (configuration, every row incl. deselected ones, pins); for older
  // records fall back to rebuilding rows/pins/config from the submitted body.
  const restoreEditor = () => {
    if (rows.length) return; // the editor state is still live in this session
    const snapshot = draftRef.current;
    const body = frozenBodyRef.current;
    if (snapshot?.v === 1) {
      setConfig(snapshot.config);
      setRows(snapshot.rows);
      setPins(snapshot.pins || {});
      setRuleUsed(snapshot.ruleUsed || body?.rule || null);
    } else if (body) {
      setConfig(configFromBody(body));
      setRows(rowsFromBody(body));
      setPins(pinsFromBody(body));
      setRuleUsed(body.rule || null);
    }
    markChecked(null);
  };

  const send = async (body) => {
    setStage('saving');
    setError('');
    try {
      const { data } = await api.post('/sessions/series', body);
      store.clear(clientId);
      frozenBodyRef.current = null;
      draftRef.current = null;
      toast.success(data.replayed ? 'Recovered your saved series' : `${data.receipt.slots.length} sessions scheduled`);
      setStage('done');
      onDone?.(data);
    } catch (err) {
      const outcome = classifySaveOutcome(err);
      if (outcome.kind === 'unknown') { setStage('unknown'); return; } // keep the record; stay frozen
      store.clear(clientId);
      restoreEditor();
      frozenBodyRef.current = null;
      draftRef.current = null;
      if (outcome.kind === 'conflicts') {
        applyConflicts(outcome.conflicts);
        setStage('review');
        toast.error('Some dates are no longer available — pick new times or untick them');
      } else if (outcome.kind === 'mismatch') {
        setError('This save was already used with different content. Nothing was changed.');
        setStage('mismatch');
      } else {
        setError(outcome.message);
        setStage('review');
      }
    }
  };

  const create = () => {
    if (gate) return; // defense in depth: the button is disabled too
    const body = buildCreateBody({
      requestId: requestIdRef.current, clientId, durationMinutes, location, rule: ruleUsed || currentRule(), rows, mapping,
      programId: config.programId, assignProgram: needsAssign && config.assignProgram, notify: config.notify,
    });
    frozenBodyRef.current = body;
    draftRef.current = { v: 1, config, rows, pins, ruleUsed: ruleUsed || currentRule() };
    // Persist BEFORE the first POST so a reload after a timeout can still recover it.
    setStorageOk(store.save(clientId, { request_id: requestIdRef.current, body, draft: draftRef.current, state: 'pending' }));
    send(body);
  };

  const retryFrozen = () => send(frozenBodyRef.current);

  const addDate = () => {
    const last = sortRows(rows).at(-1);
    addedCounter.current += 1;
    setRows((current) => [...current, {
      key: `a${addedCounter.current}-${Date.now().toString(36)}`, date: shiftDate(last?.date || startDate, 1), time: startTime,
      selected: true, conflict: null, suggestions: [],
    }]);
  };

  // ---- render ----
  const storageWarning = !storageOk && (
    <p className="text-xs text-muted-foreground" data-testid="series-storage-warning">
      This browser cannot remember an unfinished save, so closing or reloading before it finishes cannot be recovered automatically.
    </p>
  );

  if (stage === 'unknown' || (stage === 'saving' && frozenBodyRef.current)) {
    const body = frozenBodyRef.current;
    const first = body?.slots?.[0];
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4" data-testid="series-composer" data-request-id={requestIdRef.current}>
        <div role="status" data-testid="series-unknown">
          <p className="font-medium">{stage === 'saving' ? 'Saving…' : 'Save status unknown'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {body ? `${body.slots.length} session${body.slots.length === 1 ? '' : 's'}${first ? ` starting ${first.date} ${first.time}` : ''}.` : ''}
            {' '}We could not confirm whether this was saved. Retrying is safe — it will not create duplicates.
          </p>
        </div>
        {storageWarning}
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11 rounded-xl" disabled={stage === 'saving'} onClick={retryFrozen} data-testid="series-retry-button">
            {stage === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retry'}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={stage === 'saving'} onClick={retryFrozen} data-testid="series-check-button">
            Check whether it saved
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="series-composer" data-request-id={requestIdRef.current}>
      <RecurrencePanel
        config={config} onChange={chooseConfig} programs={programs.filter((p) => p.frequency_days)} selectedProgram={selectedProgram}
        needsAssign={needsAssign} disabled={frozen || stage === 'review' || stage === 'mismatch'}
      />
      {stage === 'configure' && (
        <>
          {startChanged && (
            <p className="rounded-xl border border-border px-3 py-2.5 text-sm" role="status" data-testid="series-start-changed">
              The first session changed. Preview again to regenerate the dates, or go back to keep your current dates.
            </p>
          )}
          {rows.length > 0 && !startChanged && (
            <p className="text-xs text-muted-foreground" data-testid="series-regenerate-note">
              Previewing again regenerates the dates: your edits, unticked dates and workout choices will be replaced.
            </p>
          )}
          {error && <p className="text-sm text-destructive" role="alert" data-testid="series-error">{error}</p>}
          <Button type="button" className="min-h-11 w-full rounded-xl font-semibold" disabled={checking || !config.weekdays.length || !clientId}
            onClick={preview} data-testid="series-preview-button">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : rows.length ? 'Regenerate dates' : 'Preview dates'}
          </Button>
          {rows.length > 0 && (
            <Button type="button" variant="ghost" className="min-h-11 w-full rounded-xl text-muted-foreground" disabled={checking}
              onClick={() => { setStartChanged(false); setStage('review'); }} data-testid="series-back-to-dates">
              Back to dates (keep edits)
            </Button>
          )}
        </>
      )}
      {stage === 'mismatch' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm" role="alert" data-testid="series-error">{error}</div>
      )}
      {(stage === 'review' || stage === 'mismatch') && (
        <>
          {stage === 'review' && (
            <Button type="button" variant="ghost" className="min-h-11 rounded-xl text-muted-foreground" disabled={frozen} onClick={() => setStage('configure')} data-testid="series-edit-rule">
              Change repeat settings
            </Button>
          )}
          <SeriesPreviewList
            rows={rows} workouts={workouts} mapping={mapping} summary={summary} hasProgram={Boolean(selectedProgram)} disabled={frozen || stage === 'mismatch'}
            onToggle={(key) => setRows((current) => current.map((row) => (row.key === key ? { ...row, selected: !row.selected } : row)))}
            onEditDateTime={(key, { date, time }) => updateRow(key, { date, time, conflict: null, suggestions: [] })}
            onPickSuggestion={(key, suggestion) => updateRow(key, { date: suggestion.date, time: suggestion.time, conflict: null, suggestions: [] })}
            onPickWorkout={(key, workoutId) => setPins((current) => ({ ...current, [key]: workoutId }))}
            onAddDate={addDate}
          />
          {checkFailed && (
            <p className="text-sm text-destructive" role="alert" data-testid="series-check-failed">
              Could not check these dates.{' '}
              <button type="button" className="underline" onClick={() => { markChecked(null); setCheckFailed(false); setRetryTick((tick) => tick + 1); }} data-testid="series-check-retry">Retry</button>
            </p>
          )}
          {error && stage === 'review' && <p className="text-sm text-destructive" role="alert" data-testid="series-error">{error}</p>}
          {storageWarning}
          {gate === 'loading' && (
            <p className="text-sm text-muted-foreground" role="status" data-testid="series-program-loading">Loading program details…</p>
          )}
          {gate === 'failed' && (
            <p className="text-sm text-destructive" role="alert" data-testid="series-program-failed">
              Could not load the program details, so the workouts and program assignment cannot be saved yet.{' '}
              <button type="button" className="underline" onClick={loadPrograms} data-testid="series-program-retry">Retry</button>
            </p>
          )}
          {gate === 'missing' && (
            <p className="text-sm text-destructive" role="alert" data-testid="series-program-missing">
              That program is no longer available. Use “Change repeat settings” to choose another program or “No program”.
            </p>
          )}
          <Button type="button" className="min-h-11 w-full rounded-xl font-semibold"
            disabled={Boolean(gate) || checkedSignature !== signature || checking || checkFailed || anyConflict || summary.selected === 0 || stage === 'mismatch'}
            onClick={create} data-testid="series-create-button">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : `Create ${summary.selected} session${summary.selected === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </div>
  );
}
