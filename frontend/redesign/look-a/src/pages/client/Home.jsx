import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { DashboardSkeleton, LoadErrorState, StatTile, SectionLabel, CheckInStats, IconLink } from '@/components/common';
import CheckInForm from '@/components/CheckInForm';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Dumbbell, ChevronRight, MapPin,
  MessageSquare, AlertTriangle, ClipboardCheck, Activity, Play, Loader2, CheckCircle2, Pencil, Undo2,
} from 'lucide-react';
import { forgetHomeQuick, homeQuickEventId, homeQuickReply, homeUndoIdentity, readHomeUndo, swapHomeUndo } from '@/lib/lookA';

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
import { fmtDay, fmtTime, fmtDateTime, fmtDate, initials } from '@/lib/format';
import { toast } from 'sonner';
import { DashboardHero } from '@/components/BrandBackdrop';
import { DashboardChoreography } from '@/components/Choreography';
import { chooseClientTodayPlan } from '@/lib/clientTodayPlan';
import { QuickSessionBadge } from '@/components/training/QuickSessionBadge';
import { WeekStrip, StreakPill } from '@/components/WeekRhythm';
import { trackProductEvent } from '@/lib/telemetry';
import { useShowInstallCard } from '@/lib/pwa';
import { InstallCard } from '@/components/InstallGuide';

export default function ClientHome() {
  const { user } = useAuth();
  const showInstallCard = useShowInstallCard();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [training, setTraining] = useState({ assignments: null, activeLog: null, history: [], complete: false });
  const [startingWorkout, setStartingWorkout] = useState(false);
  // Look A: the one Undo for Home's Mark done. It stays (across reloads)
  // until the server says it is no longer the current change.
  const [homeUndo, setHomeUndoState] = useState(() => readHomeUndo());
  // One Mark done / Undo operation at a time (LOOK-A-HOME-UNDO-REVIEW 3):
  // `busy` names it for the buttons; the ref is the synchronous guard.
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(null);
  const quickCompleting = busy === 'mark';
  const undoing = busy === 'undo';
  // Every pointer change is a compare-and-set against the pointer the
  // operation started from, so an older reply never replaces a newer one.
  const swapPointer = useCallback((expected, next) => {
    const swapped = swapHomeUndo(homeUndoIdentity(expected), next);
    setHomeUndoState(readHomeUndo());
    return swapped;
  }, []);
  const exclusive = useCallback(async (kind, fn) => {
    if (busyRef.current) return undefined;
    busyRef.current = kind;
    setBusy(kind);
    try { return await fn(); } finally { busyRef.current = null; setBusy(null); }
  }, []);
  const [rhythm, setRhythm] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [acknowledging, setAcknowledging] = useState(false);

  const acknowledgeAnnouncement = async (announcement) => {
    setAcknowledging(true);
    try {
      await api.patch(`/announcements/${announcement.id}/read`);
      setAnnouncements((current) => current.map((row) => (row.id === announcement.id ? { ...row, read: true } : row)));
    } catch (e) {
      toast.error(errMsg(e, 'Could not mark as seen'));
    } finally {
      setAcknowledging(false);
    }
  };
  const [loadError, setLoadError] = useState(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dashboardResult, assignedResult, activeResult, historyResult, rhythmResult, announcementsResult] = await Promise.allSettled([
        api.get('/dashboard/client'),
        api.get('/programs/client/assigned'),
        api.get('/workout-logs/active'),
        api.get('/workout-logs/mine'),
        api.get('/workout-logs/week-rhythm'),
        api.get('/announcements/mine'),
      ]);
      if (dashboardResult.status === 'rejected') throw dashboardResult.reason;
      setData(dashboardResult.value.data);
      setRhythm(rhythmResult.status === 'fulfilled' ? rhythmResult.value.data : null);
      setAnnouncements(announcementsResult.status === 'fulfilled' ? announcementsResult.value.data : []);
      setTraining({
        assignments: assignedResult.status === 'fulfilled' ? assignedResult.value.data : null,
        activeLog: activeResult.status === 'fulfilled' ? activeResult.value.data : null,
        history: historyResult.status === 'fulfilled' ? historyResult.value.data : [],
        complete: assignedResult.status === 'fulfilled' && activeResult.status === 'fulfilled' && historyResult.status === 'fulfilled',
      });
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCheckIn = async (payload) => {
    setSaving(true);
    try {
      await api.post('/check-ins/mine', payload);
      trackProductEvent('check_in_submitted', { source: 'client_home' });
      toast.success(data?.today_check_in ? 'Check-in updated' : 'Check-in saved');
      setCheckInOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not save check-in'));
    } finally {
      setSaving(false);
    }
  };

  const startWorkout = async (source) => {
    setStartingWorkout(true);
    try {
      const { data: started } = await api.post('/workout-logs/start', source);
      trackProductEvent('workout_started', { source: 'client_home', assignment_kind: source.workout_assignment_id ? 'standalone' : 'program' });
      navigate(`/client/workouts/${started.workout_log.id}/track`);
    } catch (error) {
      const active = error.response?.data?.active_workout;
      if (error.response?.status === 409 && active?.id) {
        navigate(`/client/workouts/${active.id}/track`);
      } else {
        toast.error(errMsg(error, 'Could not start workout'));
      }
    } finally {
      setStartingWorkout(false);
    }
  };

  // One-tap "I did it" (design-plans/011 A): for clients who won't track sets.
  // Records the assigned workout done without set detail, then offers — never
  // forces — the daily check-in as the "how did it go?" handoff.
  //
  // The pending pointer is written before the request: a reload or a lost
  // reply keeps the same event id and the Undo offer. Only a reply whose log
  // is completed NOW is celebrated (a replay of a tap undone since is history).
  const sendMarkDone = useCallback(async (pending, { announce }) => {
    try {
      const { data: done } = await api.post('/workout-logs/quick-complete', { ...pending.source, event_id: pending.event_id });
      forgetHomeQuick();
      const reply = homeQuickReply(done);
      swapPointer(pending, reply.undo);
      if (reply.current) {
        trackProductEvent('workout_quick_completed', { source: 'client_home' });
        toast.success('Nice work — your coach has been notified');
        await load();
        if (announce) setCheckInOpen(true);
      } else {
        toast.message('That mark done was already undone. Nothing changed.');
        await load();
      }
      return { kind: 'answered', reply };
    } catch (error) {
      const active = error.response?.data?.active_workout;
      if (error.response?.status >= 400 && error.response?.status < 500) {
        // A refusal is final: nothing was marked done.
        forgetHomeQuick();
        swapPointer(pending, null);
        if (error.response.status === 409 && active?.id) {
          toast.error('You have a workout in progress — finish that one first.');
          if (announce) navigate(`/client/workouts/${active.id}/track`);
        } else {
          toast.error(errMsg(error, 'Could not mark the workout done'));
        }
        return { kind: 'refused' };
      }
      // No answer (offline or a lost reply): the server may have it. The
      // pointer and id stay, so a retry replays and Undo is still offered.
      if (announce) toast.error('Not confirmed yet. Tap Mark done again when you are online, or Undo it.');
      return { kind: 'unanswered' };
    }
  }, [load, navigate, swapPointer]);

  const quickComplete = (source, workoutName = null) => exclusive('mark', async () => {
    const current = readHomeUndo();
    const same = current?.state === 'pending' && JSON.stringify(current.source) === JSON.stringify(source);
    const pending = same ? current
      : { state: 'pending', source, event_id: homeQuickEventId(source, newId), workout_name: workoutName };
    if (!same && !swapPointer(current, pending)) return;
    await sendMarkDone(pending, { announce: true });
  });

  // A pending tap found on load (a reload mid-request or after a lost reply)
  // is replayed once with its own event id, when online.
  const resolvedRef = useRef(new Set());
  useEffect(() => {
    if (homeUndo?.state !== 'pending' || resolvedRef.current.has(homeUndo.event_id)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    resolvedRef.current.add(homeUndo.event_id);
    const pending = homeUndo;
    exclusive('mark', async () => {
      if (homeUndoIdentity(readHomeUndo()) !== homeUndoIdentity(pending)) return;
      await sendMarkDone(pending, { announce: false });
    });
  }, [homeUndo, exclusive, sendMarkDone]);

  // Is Home's Undo still the server's current one? (Another change, here or
  // on another device, ends it.) The reply only clears the pointer it asked about.
  useEffect(() => {
    if (homeUndo?.state !== 'saved') return undefined;
    let live = true;
    const asked = homeUndo;
    api.get(`/workout-logs/${asked.logId}/undo`).then(({ data: reply }) => {
      if (live && reply && Object.hasOwn(reply, 'undo') && reply.undo?.change_id !== asked.change_id && !busyRef.current) swapPointer(asked, null);
    }).catch((error) => {
      if (live && error.response?.status === 404 && !busyRef.current) swapPointer(asked, null);
    });
    return () => { live = false; };
  }, [homeUndo, swapPointer]);

  const undoSaved = useCallback(async (saved) => {
    const target = saved.undo_event_id ? saved : { ...saved, undo_event_id: newId() };
    if (target !== saved && !swapPointer(saved, target)) return;
    try {
      const { data: reply } = await api.post(`/workout-logs/${target.logId}/undo`, { event_id: target.undo_event_id, change_id: target.change_id });
      const result = reply?.result;
      const outcome = result?.outcome === 'replayed' ? result.original_outcome : result?.outcome;
      swapPointer(target, null);
      if (outcome === 'applied') toast.success('Marked not done. The workout is open again.');
      else toast.message(result?.reason || 'That could not be undone.');
      await load();
    } catch (error) {
      if (error.response?.status >= 400 && error.response?.status < 500) {
        swapPointer(target, null);
        toast.message(errMsg(error, 'That could not be undone.'));
        await load();
      } else {
        toast.error('Could not undo right now. Try again.');
      }
    }
  }, [load, swapPointer]);

  // Undo stays locked until its whole chain is answered: for a pending tap,
  // first learn what that tap did (the same id replays it), then undo exactly
  // that change, all inside one operation.
  const undoHome = () => exclusive('undo', async () => {
    const current = readHomeUndo();
    if (!current) { setHomeUndoState(null); return; }
    if (current.state === 'saved') { await undoSaved(current); return; }
    try {
      const { data: done } = await api.post('/workout-logs/quick-complete', { ...current.source, event_id: current.event_id });
      forgetHomeQuick();
      const reply = homeQuickReply(done);
      if (!reply.undo) {
        swapPointer(current, null);
        toast.message(reply.current ? 'That mark done can no longer be undone.' : 'That mark done was already undone. Nothing changed.');
        await load();
        return;
      }
      if (!swapPointer(current, reply.undo)) return;
      await undoSaved(reply.undo);
    } catch (error) {
      if (error.response?.status >= 400 && error.response?.status < 500) {
        forgetHomeQuick();
        swapPointer(current, null);
        toast.message('That mark done was not saved, so there is nothing to undo.');
        await load();
      } else {
        toast.error('Could not reach the server. Try Undo again when you are online.');
      }
    }
  });

  if (!data && loadError) return <LoadErrorState message={loadError} scope="client-home" onRetry={() => { setLoadError(null); load(); }} />;
  if (!data) return <DashboardSkeleton tiles={2} />;

  const firstName = (user.profile?.name || '').split(' ')[0];
  const todayCheckIn = data.today_check_in;
  const todayPlan = chooseClientTodayPlan({
    ...training,
    unreadMessages: data.unread_messages,
    todayCheckIn,
  });

  return (
    <div>
      <DashboardChoreography pageKey={`client-dashboard-${user.id || user.profile?.id || user.role}`}>
      <DashboardHero
        title={`Today, ${firstName}`}
        testId="client-dashboard-header"
      />

      {data.waiver.has_version && !data.waiver.signed_latest && (
        <Link to="/client/waiver" className="block mb-4" data-testid="waiver-alert-card">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-gold/35 bg-gold/10 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-gold shrink-0" />
              <div>
                <p className="text-sm font-semibold">Waiver needs your signature</p>
                <p className="text-xs text-muted-foreground">Please review and sign before your next session.</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}

      {/* Next-day catch-up (011 A): yesterday's unlogged workout gets one
          gentle, opportunity-framed chance to be rectified — same one-tap. */}
      {rhythm?.yesterday_missed?.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-achievement/35 bg-achievement/10 px-4 py-3.5" data-testid="catch-up-card">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{rhythm.yesterday_missed[0].workout_name || 'Assigned workout'}</p>
            <p className="text-xs text-muted-foreground">Yesterday · Still open · Counts this week</p>
          </div>
          <Button
            size="sm" variant="outline" className="min-h-11 shrink-0 rounded-xl border-achievement/40"
            disabled={Boolean(busy)}
            onClick={() => quickComplete({ workout_assignment_id: rhythm.yesterday_missed[0].id }, rhythm.yesterday_missed[0].workout_name || null)}
            aria-label={`Mark ${rhythm.yesterday_missed[0].workout_name || 'yesterday’s workout'} done without logging sets`}
            title="Mark done without logging sets"
            data-testid="catch-up-quick-complete"
          >
            {quickCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden />}
            Mark done
          </Button>
        </div>
      )}

      {homeUndo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3" data-testid="home-undo">
          <p className="min-w-0 break-words text-sm" aria-live="polite">
            <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-primary" aria-hidden />
            {homeUndo.state === 'pending'
              ? `${homeUndo.workout_name || 'Workout'}: Mark done is not confirmed yet.`
              : `${homeUndo.workout_name || 'Workout'} marked done. Sets were not logged.`}
          </p>
          <Button type="button" variant="outline" className="min-h-11 shrink-0 rounded-xl" disabled={Boolean(busy)} aria-busy={undoing} onClick={undoHome} data-testid="home-undo-button">
            {undoing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" aria-hidden />} Undo mark done
          </Button>
        </div>
      )}

      {showInstallCard && <InstallCard />}

      {/* The dominant-purpose card is the one raised, loud surface on this
          screen (design-plans/010: bold direction, owner pick 2026-08-07). */}
      <Card
        className="mb-4 overflow-hidden border-primary/40 bg-card shadow-[var(--app-elev)]"
        data-testid="client-today-plan"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{todayPlan.eyebrow}</p>
            <StreakPill count={rhythm?.week_streak} />
          </div>
          <div className="mt-1 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {todayPlan.quickSession && <QuickSessionBadge className="mb-1" testId="client-today-quick-session" />}
              <h2 className="font-display text-4xl font-semibold tracking-tight" data-testid="client-today-plan-title">{todayPlan.title}</h2>
              {todayPlan.description && <p className="mt-1 text-sm text-muted-foreground">{todayPlan.description}</p>}
            </div>
          </div>
          {todayPlan.source ? (
            <div className="mt-4 flex gap-2">
              <Button className="min-h-14 flex-1 rounded-xl text-base font-semibold" disabled={startingWorkout || Boolean(busy)} onClick={() => startWorkout(todayPlan.source)} data-testid="client-today-primary-action">
                {startingWorkout ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Starting workout</span></> : <><Play className="mr-1.5 h-4 w-4" />{todayPlan.action}</>}
              </Button>
              {/* One-tap for clients who won't track sets: open app, tap, close. */}
              <Button
                variant="outline"
                className="min-h-14 shrink-0 rounded-xl px-4"
                disabled={startingWorkout || Boolean(busy)}
                onClick={() => quickComplete(todayPlan.source, todayPlan.title || null)}
                aria-label="Mark done without logging sets"
                title="Mark done without logging sets"
                data-testid="client-today-quick-complete"
              >
                {quickCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden />}
                Mark done
              </Button>
            </div>
          ) : todayPlan.kind === 'check_in' ? (
            <Button className="mt-4 min-h-14 w-full rounded-xl text-base font-semibold" onClick={() => setCheckInOpen(true)} data-testid="client-today-primary-action">
              <ClipboardCheck className="mr-1.5 h-4 w-4" />{todayPlan.action}
            </Button>
          ) : (
            <Button asChild className="mt-4 min-h-14 w-full rounded-xl text-base font-semibold" data-testid="client-today-primary-action">
              <Link to={todayPlan.href}>{todayPlan.action}<ChevronRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          )}
          {/* The week lives inside the dominant card (011 A bold pick,
              owner 2026-08-10): today's work, the week, and the streak are
              one object. */}
          {rhythm && rhythm.week_total > 0 && (
            <WeekStrip rhythm={rhythm} className="mt-5 border-t border-primary/15 pt-4" />
          )}
        </CardContent>
      </Card>

      {/* One-way coach announcements (011 C): only unread ones surface, and
          "Got it" is the read receipt behind the coach's seen-count. */}
      {(() => {
        const unread = announcements.filter((row) => !row.read);
        if (!unread.length) return null;
        const latest = unread[0];
        return (
          <Card className="mb-4 border-primary/25" data-testid="client-announcement-card">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                    <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9px] text-primary">
                      {initials(latest.coach?.name || 'C')}
                    </span>
                    {latest.studio_wide ? 'Studio announcement' : `From ${latest.coach?.name?.split(' ')[0] || 'your coach'}`}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{latest.content}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {fmtDateTime(latest.created_at)}{unread.length > 1 ? ` · +${unread.length - 1} more` : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="min-h-11 shrink-0 rounded-lg" disabled={acknowledging}
                  onClick={() => acknowledgeAnnouncement(latest)} data-testid="announcement-got-it">
                  {acknowledging ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="sr-only">Acknowledging</span></> : 'Got it'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* A completed check-in demotes to a quiet strip so the dominant-
          purpose card stays the only loud thing on the screen. */}
      {todayCheckIn ? (
        <Card data-testid="daily-check-in-card">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                Checked in today
                <Badge variant="outline" className="bg-success/15 text-success-foreground border-success/25">
                  {todayCheckIn.review_status === 'reviewed' ? 'Reviewed' : 'Sent'}
                </Badge>
              </div>
              <CheckInStats
                className="mt-1.5"
                stats={[
                  ['Energy', todayCheckIn.energy || '-'],
                  ['Sleep', todayCheckIn.sleep_quality || '-'],
                  ['Stress', todayCheckIn.stress || '-'],
                ]}
              />
            </div>
            <Button variant="ghost" size="touchIcon" className="shrink-0 rounded-lg" onClick={() => setCheckInOpen(true)} aria-label="Edit check-in" title="Edit check-in" data-testid="open-check-in-button">
              <Pencil aria-hidden />
            </Button>
          </CardContent>
        </Card>
      ) : todayPlan.kind === 'check_in' ? null : (
      <Card className="border-primary/25" data-testid="daily-check-in-card">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <SectionLabel>Daily check-in</SectionLabel>
          <Button className="min-h-11 shrink-0 rounded-xl" onClick={() => setCheckInOpen(true)} data-testid="open-check-in-button">
            <ClipboardCheck className="h-4 w-4 mr-1.5" /> Start check-in
          </Button>
        </CardContent>
      </Card>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <StatTile label="Programs" value={data.program_count} icon={Dumbbell} testId="program-count-tile" />
        <StatTile label="Unread" value={data.unread_messages} icon={MessageSquare} testId="unread-messages-tile" />
      </div>

      <Card className="mt-4" data-testid="client-home-next-session-card">
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <SectionLabel>Next session</SectionLabel>
          <IconLink to="/client/sessions" label="All sessions" />
        </CardHeader>
        <CardContent>
          {data.next_session ? (
            <Link to={`/client/sessions/${data.next_session.id}`} className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="next-session-detail-link">
              <p className="font-display text-2xl font-semibold">
                {fmtDay(data.next_session.scheduled_at)} <span className="text-primary">{fmtTime(data.next_session.scheduled_at)}</span>
              </p>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                {data.next_session.coach?.name ? (
                  <span className="flex items-center gap-1.5" data-testid="next-session-coach-identity">
                    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                      {initials(data.next_session.coach.name)}
                    </span>
                    {data.next_session.duration_minutes} min with {data.next_session.coach.name.split(' ')[0]}
                  </span>
                ) : (
                  <span>{data.next_session.duration_minutes} min</span>
                )}
                {data.next_session.location && (
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {data.next_session.location}</span>
                )}
              </div>
            </Link>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
              <Button asChild size="sm" className="mt-3 min-h-11 rounded-xl">
                <Link to="/client/sessions" data-testid="request-session-cta">Request a session</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4" data-testid="recent-progress-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <SectionLabel>Recent progress</SectionLabel>
          <IconLink to="/client/progress" label="Open progress" />
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recent_progress.length === 0 && <p className="text-sm text-muted-foreground py-1">No progress entries yet.</p>}
          {data.recent_progress.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Activity className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{entry.metric?.name || 'Metric'}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(entry.recorded_on)}</p>
                </div>
              </div>
              <p className="font-semibold tabular-nums shrink-0">{entry.value}{entry.metric?.unit ? ` ${entry.metric.unit}` : ''}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4" data-testid="client-recent-messages-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <SectionLabel>Messages</SectionLabel>
          <IconLink to="/client/messages" label="Open chat" />
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recent_messages.length === 0 && <p className="text-sm text-muted-foreground py-1">No messages yet.</p>}
          {data.recent_messages.slice(0, 3).map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-card/60 px-4 py-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">{m.sender_role === 'coach' ? 'Coach' : 'You'}</p>
                <p className="text-[10px] text-muted-foreground">{fmtDateTime(m.created_at)}</p>
              </div>
              <p className="text-sm truncate mt-0.5">{m.content}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      </DashboardChoreography>

      <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{todayCheckIn ? "Edit today's check-in" : "Today's check-in"}</DialogTitle>
          </DialogHeader>
          <CheckInForm initial={todayCheckIn} saving={saving} onSubmit={saveCheckIn} submitLabel={todayCheckIn ? 'Update check-in' : 'Save check-in'} />
          {todayCheckIn?.coach_notes && (
            <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
              <p className="text-xs font-semibold text-primary">Coach note</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{todayCheckIn.coach_notes}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
