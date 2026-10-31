import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle, Archive, ChevronLeft, ChevronRight, Dumbbell, Eye, Loader2, Pencil, Plus, RotateCcw, Settings2,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { isPreviewMode } from '@/lib/previewFlag';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionLabel } from '@/components/common';
import CheckInForm from '@/components/CheckInForm';
import OutsideActivityForm from '@/components/context/OutsideActivityForm';
import WeekContext from '@/components/context/WeekContext';
import {
  ACTIVITY_LABELS, activityToForm, addDays, collectionText, denverToday, emptyActivityForm, formatDay, formatDuration,
  formatWeekRange, summaryText, visibilityText,
} from '@/lib/outsideActivities';
import {
  classifyFailure, createPendingStore, freezeRequest, mergeActivity, newRequestId, probeCapability, replayNotice, submitFrozen, validPreferenceCommit,
} from '@/lib/contextEntry';
import { cn } from '@/lib/utils';

const NOTICE_TONES = {
  success: 'border-success/25 bg-success/10',
  warning: 'border-gold/35 bg-gold/10',
  error: 'border-destructive/30 bg-destructive/5',
};

export default function WholeWeekView({ clientId = null, viewerRole, userId, weekStart, onWeekChange }) {
  const isClient = viewerRole === 'client';
  const base = isClient ? '/whole-week/mine' : `/whole-week/clients/${clientId}`;
  const createUrl = isClient ? '/outside-activities/mine' : `/outside-activities/clients/${clientId}`;
  const preferenceUrl = isClient ? '/context-preferences/mine' : `/context-preferences/clients/${clientId}`;
  const scope = `${base}|${weekStart}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const pageRequest = useRef(null);
  const [paging, setPaging] = useState(false);
  const store = useMemo(() => createPendingStore({ scope: `${isPreviewMode ? 'preview' : 'live'}:${userId || 'unknown'}:${clientId || 'self'}` }), [userId, clientId]);

  const [week, setWeek] = useState({ status: 'loading', data: null, error: null, httpStatus: null, scope: null });
  const [pending, setPending] = useState(() => store.load());
  const [dialog, setDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [interrupted, setInterrupted] = useState(() => store.interrupted());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefSaving, setPrefSaving] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [contextKey, setContextKey] = useState(0);
  const sequence = useRef(0);
  const accessEpoch = useRef(0);
  const accessScope = useRef(null);
  accessScope.current = `${scope}|${userId || 'unknown'}`;
  const accessTicket = () => ({ epoch: accessEpoch.current, scope: accessScope.current });
  const isCurrentAccess = (ticket) => ticket.epoch === accessEpoch.current && ticket.scope === accessScope.current;


  useEffect(() => {
    setPending(store.load()); setInterrupted(store.interrupted());
    setSaving(false); setPrefSaving(false); setCheckInSaving(false);
    setDialog(null); setConfirmArchive(null); setCheckInOpen(false); setNotice(null);
  }, [store, scope]);
  useEffect(() => () => { accessEpoch.current += 1; }, []);

  // Definitive access loss invalidates in-flight pages and removes every
  // private view/form, even when the last successful read is still cached.
  const clearAccess = useCallback((httpStatus = 403, message = 'This week is no longer available to you.') => {
    accessEpoch.current += 1;
    sequence.current += 1;
    pageRequest.current = null;
    setPaging(false);
    setSaving(false);
    setPrefSaving(false);
    setCheckInSaving(false);
    store.clear();
    setPending(null);
    setInterrupted(false);
    setDialog(null);
    setConfirmArchive(null);
    setCheckInOpen(false);
    setSettingsOpen(false);
    setNotice(null);
    setWeek({ status: 'unavailable', data: null, error: message, httpStatus, scope });
  }, [scope, store]);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    pageRequest.current = null;
    setPaging(false);
    setWeek((state) => state.scope === scope ? { ...state, status: state.data ? 'refreshing' : 'loading' } : { status: 'loading', data: null, error: null, httpStatus: null, scope });
    try {
      const { data } = await api.get(base, { params: { week_start: weekStart } });
      if (current !== sequence.current) return null;
      setWeek({ status: 'available', data, error: null, httpStatus: null, scope });
      return data;
    } catch (error) {
      if (current !== sequence.current) return null;
      // A failed read is an error state, never an empty successful week.
      if ([401, 403, 404].includes(error.response?.status)) clearAccess(error.response.status);
      else setWeek({ status: 'unavailable', data: null, error: errMsg(error, 'Could not load this week.'), httpStatus: error.response?.status ?? null, scope });
      return null;
    }
  }, [base, weekStart, scope, clearAccess]);

  useEffect(() => { load(); return () => { sequence.current += 1; }; }, [load]);

  const loadMore = async () => {
    const cursor = week.data?.next_cursor;
    if (!cursor || paging || pageRequest.current || week.status !== 'available' || week.scope !== scope) return;
    const generation = sequence.current;
    const client = week.data.client_id;
    const request = { scope, generation };
    pageRequest.current = request; setPaging(true);
    try {
      const response = await api.get(base, { params: { week_start: weekStart, cursor: JSON.stringify(cursor) } });
      if (activeScope.current !== request.scope || sequence.current !== generation) return;
      const next = response.data;
      if (next?.client_id !== client || next.week_start !== weekStart || !Array.isArray(next.activities)) throw new Error('Invalid activity page');
      setWeek((state) => state.scope !== request.scope ? state : { ...state, data: { ...next, activities: next.activities.reduce((rows, row) => mergeActivity(rows, row), state.data.activities) } });
    } catch (error) {
      if (activeScope.current !== request.scope || sequence.current !== generation) return;
      if ([401, 403, 404].includes(error.response?.status)) {
        clearAccess(error.response.status);
      } else setNotice({ tone: 'error', text: 'Could not load more entries. The entries already shown stay available; try again or refresh.' });
    } finally {
      if (pageRequest.current === request) { pageRequest.current = null; setPaging(false); }
    }
  };

  const data = week.scope === scope ? week.data : null;
  const today = data?.today || denverToday();
  const checkInInitial = useMemo(() => ({ check_in_date: today }), [today]);
  const collectionOn = data?.preferences?.activity_collection === 'on';
  const locked = Boolean(pending) || saving || interrupted;

  const handleResult = async (result, frozen) => {
    if (result.state === 'confirmed') {
      setPending(null);
      setInterrupted(false);
      setDialog(null);
      setNotice({ tone: 'success', text: replayNotice(result.data)
        || (frozen.kind === 'archive' ? 'Activity removed from this week. The record is kept, not deleted.' : frozen.kind === 'update' ? 'Correction saved.' : 'Activity saved.') });
      setWeek((state) => (state.data ? { ...state, data: { ...state.data, activities: mergeActivity(state.data.activities, result.data.resource) } } : state));
      await load();
      return;
    }
    if (result.state === 'unknown') {
      setPending(store.load() || frozen);
      setDialog(null);
      setNotice(null);
      return;
    }
    if (result.state === 'denied') {
      clearAccess(403, result.message);
      return;
    }
    setPending(store.load());
    if (result.state === 'conflict' && result.code === 'revision_conflict' && dialog?.mode === 'edit') {
      setDialog((state) => (state ? { ...state, error: result.message, conflict: true } : state));
      return;
    }
    if (result.state === 'conflict') {
      setDialog(null);
      setNotice({ tone: result.state === 'denied' ? 'error' : 'warning', text: result.message, reload: true });
      if (result.state === 'conflict') await load();
      return;
    }
    // rejected / not_sent / unsupported: nothing was saved; keep the form editable.
    if (dialog) setDialog((state) => (state ? { ...state, error: result.message } : state));
    else setNotice({ tone: 'error', text: result.message });
  };

  const send = async (frozen, retry = false) => {
    const ticket = accessTicket();
    setSaving(true);
    setNotice(null);
    try {
      const result = await submitFrozen({ api, frozen, store, retry, isCurrent: () => isCurrentAccess(ticket) });
      if (!isCurrentAccess(ticket)) return;
      await handleResult(result, frozen);
    } finally {
      if (isCurrentAccess(ticket)) setSaving(false);
    }
  };

  const submitForm = (fields) => {
    if (pending) return;
    if (dialog.mode === 'edit') {
      const activity = dialog.activity;
      send(freezeRequest({
        kind: 'update', method: 'patch', url: `/outside-activities/${activity.id}`, activityId: activity.id,
        body: { request_id: newRequestId(), revision: activity.revision, ...fields },
        summary: `Correction to ${ACTIVITY_LABELS[fields.activity_type]} on ${formatDay(fields.occurred_on)}`,
      }));
    } else {
      send(freezeRequest({
        kind: 'create', method: 'post', url: createUrl,
        body: { request_id: newRequestId(), revision: 0, ...fields },
        summary: `${ACTIVITY_LABELS[fields.activity_type]} on ${formatDay(fields.occurred_on)}`,
      }));
    }
  };

  const archive = (activity) => {
    setConfirmArchive(null);
    send(freezeRequest({
      kind: 'archive', method: 'patch', url: `/outside-activities/${activity.id}/archive`, activityId: activity.id,
      body: { request_id: newRequestId(), revision: activity.revision },
      summary: `Removing ${ACTIVITY_LABELS[activity.activity_type]} on ${formatDay(activity.occurred_on)}`,
    }));
  };

  // Explicit conflict reload: fetch the authoritative row and let the person
  // re-apply deliberately under a new request. Nothing is retried for them.
  const reloadConflict = async () => {
    const fresh = await load();
    const latest = fresh?.activities?.find((row) => row.id === dialog?.activity?.id);
    if (!latest) {
      setDialog(null);
      setNotice({ tone: 'warning', text: 'That activity is no longer in this week. Nothing was overwritten.' });
      return;
    }
    setDialog({ mode: 'edit', activity: latest, initial: activityToForm(latest), error: null, conflict: false });
  };

  const savePreference = async (patch) => {
    if (!data?.preferences) return;
    const ticket = accessTicket();
    let accessDenied = false;
    setPrefSaving(true);
    setNotice(null);
    try {
      const capable = await probeCapability(api);
      if (!isCurrentAccess(ticket)) return;
      if (capable !== true) {
        setNotice({ tone: 'error', text: capable === 'offline' ? 'You appear to be offline. The setting was not changed.' : 'This server cannot save these settings yet. Nothing was sent.' });
        return;
      }
      const response = await api.patch(preferenceUrl, { revision: data.preferences.revision, ...patch });
      if (!isCurrentAccess(ticket)) return;
      if (!validPreferenceCommit(response.data, data.preferences.revision, patch)) {
        setNotice({ tone: 'warning', text: 'Couldn’t confirm that change. Showing the settings as currently saved.' });
      } else {
        setNotice({ tone: 'success', text: 'Sharing setting saved.' });
      }
    } catch (error) {
      if (!isCurrentAccess(ticket)) return;
      const outcome = classifyFailure(error);
      if (outcome.state === 'denied') { accessDenied = true; clearAccess(error.response.status, outcome.message); return; }
      setNotice({
        tone: outcome.state === 'unknown' ? 'warning' : 'error',
        text: outcome.state === 'unknown' ? 'Couldn’t confirm that change. Showing the settings as currently saved.'
          : outcome.state === 'conflict' ? 'Settings changed elsewhere. Showing the current settings; nothing was overwritten.' : outcome.message,
      });
    } finally {
      if (isCurrentAccess(ticket)) {
        setPrefSaving(false);
        if (!accessDenied) await load();
      }
    }
  };

  const saveCheckIn = async (payload) => {
    const ticket = accessTicket();
    setCheckInSaving(true);
    try {
      // The existing manual check-in route, unchanged.
      await api.post('/check-ins/mine', payload);
      if (!isCurrentAccess(ticket)) return;
      setCheckInOpen(false);
      setNotice({ tone: 'success', text: 'Check-in saved.' });
      setContextKey((key) => key + 1);
    } catch (error) {
      if (!isCurrentAccess(ticket)) return;
      if ([401, 403, 404].includes(error.response?.status)) clearAccess(error.response.status);
      else setNotice({ tone: 'error', text: errMsg(error, 'Could not save check-in') });
    } finally {
      if (isCurrentAccess(ticket)) setCheckInSaving(false);
    }
  };

  const days = data?.days || Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const isCurrentWeek = data ? weekStart === data.current_week_start : false;

  return (
    <div className="space-y-4" data-testid="whole-week">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="touchIcon" className="rounded-xl" onClick={() => onWeekChange(addDays(weekStart, -7))} aria-label="Previous week" title="Previous week" data-testid="whole-week-previous">
          <ChevronLeft aria-hidden />
        </Button>
        <div className="min-w-0 text-center">
          <p className="font-display text-xl font-semibold tabular-nums" data-testid="whole-week-range">{formatWeekRange(weekStart)}</p>
          <p className="text-xs text-muted-foreground">{isCurrentWeek ? 'This week' : 'Earlier week'} · Mon–Sun, Denver dates</p>
        </div>
        <Button type="button" variant="outline" size="touchIcon" className="rounded-xl" disabled={!data || weekStart >= data.current_week_start} onClick={() => onWeekChange(addDays(weekStart, 7))} aria-label="Next week" title="Next week" data-testid="whole-week-next">
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {notice && (
        <div role="status" className={cn('flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm', NOTICE_TONES[notice.tone])} data-testid="whole-week-notice">
          <p>{notice.text}</p>
          {notice.reload && <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 rounded-lg" onClick={() => { setNotice(null); load(); }}>Reload</Button>}
        </div>
      )}

      {interrupted && !pending && (
        <div role="status" className="rounded-2xl border border-gold/35 bg-gold/10 px-4 py-3.5" data-testid="outside-activity-interrupted">
          <p className="text-sm font-semibold">An interrupted save could not be recovered</p>
          <p className="mt-1 text-sm text-muted-foreground">The private draft stayed in memory and was lost when this page reloaded. It may already be saved. Check the entries loaded below before logging a replacement. Nothing is resent automatically.</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11 rounded-xl" disabled={week.status !== 'available'} onClick={() => { store.clear(); setInterrupted(false); }} data-testid="outside-activity-interrupted-checked">I checked the saved entries</Button>
        </div>
      )}

      {pending && (
        <div role="status" className="rounded-2xl border border-gold/35 bg-gold/10 px-4 py-3.5" data-testid="outside-activity-pending">
          <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-gold" aria-hidden />Saved status unknown</p>
          <p className="mt-1 text-sm text-muted-foreground">{pending.summary || 'An activity save'} may or may not have finished. Retry sends the same save; it will not be added twice. New entries wait until this is resolved.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" className="min-h-11 rounded-xl" disabled={saving} onClick={() => send(pending, true)} data-testid="outside-activity-retry">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />}Retry same save
            </Button>
          </div>
        </div>
      )}

      {week.status === 'loading' && !data && (
        <p className="rounded-2xl border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="whole-week-loading">Loading the week…</p>
      )}

      {week.status === 'unavailable' && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-5" data-testid="whole-week-unavailable">
          <p className="font-semibold">{[401, 403, 404].includes(week.httpStatus) ? 'This week isn’t available to you.' : 'This week couldn’t load.'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {[401, 403, 404].includes(week.httpStatus) ? 'Your access may have changed.' : `${week.error} Nothing is shown rather than an empty week that might be wrong.`}
          </p>
          {week.httpStatus !== 404 && (
            <Button type="button" variant="outline" className="mt-3 min-h-11 rounded-xl" onClick={load} data-testid="whole-week-retry"><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />Try again</Button>
          )}
        </div>
      )}

      {data && (
        <>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="whole-week-visibility"><Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />{visibilityText(data)}</p>

          <Card data-testid="whole-week-summary">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <SectionLabel>Outside activity</SectionLabel>
              {collectionOn && (
                <Button type="button" size="sm" className="min-h-11 rounded-xl" disabled={locked}
                  onClick={() => setDialog({ mode: 'create', initial: emptyActivityForm(days.includes(today) ? today : days[6]), error: null })}
                  data-testid="outside-activity-add">
                  <Plus className="mr-1 h-4 w-4" aria-hidden />Log activity
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm" data-testid="outside-activity-total">{summaryText(data.summary)}</p>
              {data.summary?.activity_count > 0 && data.summary.unknown_effort_count > 0 && (
                <p className="text-xs text-muted-foreground">Effort not given for {data.summary.unknown_effort_count}.</p>
              )}
              <p className="text-xs text-muted-foreground" data-testid="outside-activity-page-coverage">Showing {data.activities.length} of {data.summary.activity_count} logged activities. Totals cover the whole week.</p>
              {!collectionOn && <p className="text-sm text-muted-foreground" data-testid="outside-activity-collection">{collectionText(data.preferences, viewerRole)}</p>}
              <p className="text-xs text-muted-foreground">Outside activity is counted separately from PT workouts and is not turned into a score.</p>
            </CardContent>
          </Card>

          <Card data-testid="whole-week-pt">
            <CardContent className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-2">
                <Dumbbell className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <p className="text-sm" data-testid="whole-week-pt-count">
                  {data.pt_workouts?.status === 'available'
                    ? `${data.pt_workouts.completed_count} PT ${data.pt_workouts.completed_count === 1 ? 'workout' : 'workouts'} completed`
                    : 'PT workouts couldn’t load. This is not the same as none.'}
                </p>
              </div>
              {isClient && <Link to="/client" className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline" data-testid="whole-week-today-link">Start or resume on Today</Link>}
            </CardContent>
          </Card>

          <ol className="space-y-2" aria-label="Days this week" data-testid="whole-week-days">
            {days.map((day) => {
              const rows = (data.activities || []).filter((row) => row.occurred_on === day);
              const pt = data.pt_workouts?.status === 'available' ? data.pt_workouts.by_day?.[day] || 0 : null;
              return (
                <li key={day} className={cn('rounded-2xl border border-border bg-card/40 px-4 py-3', day === today && 'border-primary/40')} data-testid="whole-week-day" data-date={day}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{formatDay(day)}{day === today && <span className="ml-1.5 text-xs font-medium text-primary">Today</span>}</p>
                    {pt > 0 && <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">{pt} PT {pt === 1 ? 'workout' : 'workouts'}</span>}
                  </div>
                  {rows.length === 0 && !pt && <p className="mt-1 text-xs text-muted-foreground">{pt === null ? 'No outside activity logged; PT history unavailable.' : 'Nothing logged'}</p>}
                  {rows.map((row) => (
                    <div key={row.id} className="mt-2 rounded-xl border border-border bg-card/60 px-3 py-2.5" data-testid="outside-activity-row">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{ACTIVITY_LABELS[row.activity_type]}{row.label ? ` · ${row.label}` : ''}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDuration(row.duration_seconds)} · {Number.isInteger(row.effort_rpe) ? `Effort ${row.effort_rpe}/10` : 'Effort not given'}
                          </p>
                          {row.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{row.note}</p>}
                          <p className="mt-1 text-[11px] text-muted-foreground" data-testid="outside-activity-attribution">
                            {row.created_by_role === 'client' ? (isClient ? 'Logged by you' : 'Logged by the client') : `Logged by ${row.created_by_name || 'a coach'} (${row.created_by_role === 'admin' ? 'admin' : 'coach'})`}
                            {row.revision > 1 ? ' · corrected' : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button type="button" variant="ghost" size="touchIcon" className="rounded-lg" disabled={locked} aria-label="Correct activity" title="Correct activity"
                            onClick={() => setDialog({ mode: 'edit', activity: row, initial: activityToForm(row), error: null })} data-testid="outside-activity-edit">
                            <Pencil aria-hidden />
                          </Button>
                          <Button type="button" variant="ghost" size="touchIcon" className="rounded-lg" disabled={locked} aria-label="Remove activity" title="Remove activity"
                            onClick={() => setConfirmArchive(row)} data-testid="outside-activity-archive">
                            <Archive aria-hidden />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            {data.next_cursor && <Button type="button" variant="outline" className="min-h-11 rounded-xl" disabled={paging || week.status !== 'available'} onClick={loadMore} data-testid="outside-activity-load-more">{paging ? 'Loading more…' : 'Load more activities'}</Button>}
            <Button type="button" variant="ghost" className="min-h-11 rounded-xl" disabled={paging || saving} onClick={load} data-testid="outside-activity-refresh">Refresh entries</Button>
            <p className="text-xs text-muted-foreground">Entries may change while you browse. Refresh to update the full list.</p>
          </div>

          <WeekContext key={`${clientId || 'self'}:${contextKey}`} clientId={clientId} viewerRole={viewerRole} days={days} today={today}
            checkInPrompt={data.preferences?.checkin_prompt} onCheckIn={() => setCheckInOpen(true)} />

          <Card data-testid="whole-week-settings">
            <CardContent className="p-4">
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-medium" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} data-testid="whole-week-settings-toggle">
                <span className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" aria-hidden />Sharing settings</span>
                <ChevronRight className={cn('h-4 w-4 transition-transform', settingsOpen && 'rotate-90')} aria-hidden />
              </button>
              {settingsOpen && (
                <div className="mt-3 space-y-3 border-t border-border pt-3">
                  {isClient ? (
                    <>
                      <PreferenceSwitch
                        id="pref-activity-share" testId="pref-activity-share" disabled={prefSaving}
                        label="Share outside activity with my coach"
                        help={data.preferences.activity_coach_enabled ? 'Your coach turned this on. Turning it off stops new entries; earlier ones stay visible.' : 'Your coach hasn’t turned this on. You can still keep it off ahead of time.'}
                        checked={!data.preferences.activity_client_off}
                        onChange={(checked) => savePreference({ activity_client_off: !checked })}
                      />
                      <PreferenceSwitch
                        id="pref-checkin-reminder" testId="pref-checkin-reminder" disabled={prefSaving}
                        label="Show a check-in reminder here"
                        help="Manual check-ins on Today always stay available."
                        checked={!data.preferences.checkin_prompt_client_off}
                        onChange={(checked) => savePreference({ checkin_prompt_client_off: !checked })}
                      />
                    </>
                  ) : (
                    <>
                      <PreferenceSwitch
                        id="pref-activity-enable" testId="pref-activity-enable" disabled={prefSaving}
                        label="Let this client log outside activity"
                        help={data.preferences.activity_client_off ? 'The client turned this off. Only they can turn it back on; you cannot log on their behalf meanwhile.' : 'Off by default. You can log on their behalf while it is on.'}
                        checked={data.preferences.activity_coach_enabled}
                        onChange={(checked) => savePreference({ activity_coach_enabled: checked })}
                      />
                      <PreferenceSwitch
                        id="pref-checkin-enable" testId="pref-checkin-enable" disabled={prefSaving}
                        label="Show the client a check-in reminder here"
                        help={data.preferences.checkin_prompt_client_off ? 'The client hid this reminder.' : 'Manual check-ins stay available either way.'}
                        checked={data.preferences.checkin_prompt_coach_enabled}
                        onChange={(checked) => savePreference({ checkin_prompt_coach_enabled: checked })}
                      />
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !saving) setDialog(null); }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" aria-describedby="outside-activity-dialog-description">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'edit' ? 'Correct activity' : 'Log outside activity'}</DialogTitle>
            <DialogDescription id="outside-activity-dialog-description">{data ? visibilityText(data) : ''}</DialogDescription>
          </DialogHeader>
          {dialog?.conflict ? (
            <div role="alert" className="space-y-3" data-testid="outside-activity-conflict">
              <p className="text-sm">{dialog.error}</p>
              <p className="text-sm text-muted-foreground">Your correction was not saved and nothing was overwritten. Reload to see the latest version, then re-apply your change.</p>
              <Button type="button" className="min-h-11 w-full rounded-xl" onClick={reloadConflict} data-testid="outside-activity-conflict-reload">Reload latest version</Button>
            </div>
          ) : dialog && (
            <OutsideActivityForm initial={dialog.initial} today={today} mode={dialog.mode} saving={saving} error={dialog.error}
              onSubmit={submitForm} onCancel={() => setDialog(null)} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmArchive)} onOpenChange={(open) => { if (!open) setConfirmArchive(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this activity?</DialogTitle>
            <DialogDescription>It stops counting in this week. The record is kept for history, not deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => setConfirmArchive(null)}>Keep it</Button>
            <Button type="button" variant="destructive" className="min-h-11 rounded-xl" onClick={() => archive(confirmArchive)} data-testid="outside-activity-archive-confirm">Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isClient && (
        <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
          <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader><DialogTitle>Today’s check-in</DialogTitle></DialogHeader>
            <CheckInForm initial={checkInInitial} saving={checkInSaving} onSubmit={saveCheckIn} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PreferenceSwitch({ id, label, help, checked, onChange, disabled, testId }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}
