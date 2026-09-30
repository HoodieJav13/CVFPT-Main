import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { DashboardSkeleton, LoadErrorState, StatusBadge, SectionLabel, CheckInStats } from '@/components/common';
import { DashboardHero } from '@/components/BrandBackdrop';
import { DashboardChoreography } from '@/components/Choreography';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Plus, ChevronRight, Dumbbell } from 'lucide-react';
import { fmtTime, fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';
import { buildCoachActionQueue } from '@/lib/coachActionQueue';

export default function CoachDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [attention, setAttention] = useState([]);
  const [attentionUnavailable, setAttentionUnavailable] = useState(false);
  const [linkedLogs, setLinkedLogs] = useState({});

  const load = useCallback(async () => {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      // The agenda's live chips ("In the gym now", "Workout done") come from
      // the sessions list, which already carries each session's linked
      // workout. Best-effort: without it the agenda shows plain statuses.
      const dayFrom = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const dayTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);
      const [dashboardResult, analyticsResult, sessionsResult] = await Promise.allSettled([
        api.get('/dashboard/coach'),
        api.get(`/analytics/coach?from=${from.toISOString()}&to=${to.toISOString()}`),
        api.get('/sessions', { params: { from: dayFrom.toISOString(), to: dayTo.toISOString() } }),
      ]);
      if (dashboardResult.status === 'rejected') throw dashboardResult.reason;
      setData(dashboardResult.value.data);
      setLinkedLogs(sessionsResult.status === 'fulfilled'
        ? Object.fromEntries((sessionsResult.value.data || []).map((row) => [row.id, { log: row.linked_workout_log, workout: row.workout }]))
        : {});
      if (analyticsResult.status === 'fulfilled' && analyticsResult.value.data?.coverage?.complete !== false) {
        setAttention(analyticsResult.value.data?.attention || []);
        setAttentionUnavailable(false);
      } else {
        setAttention([]);
        setAttentionUnavailable(true);
      }
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load dashboard');
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [acting, setActing] = useState(null);

  const handleBooking = async (id, action) => {
    if (acting) return;
    setActing(`booking-${id}`);
    try {
      await api.patch(`/bookings/${id}/${action}`);
      toast.success(action === 'approve' ? 'Request approved - session created' : 'Request declined');
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  };

  const handleSessionComplete = async (id) => {
    if (acting) return;
    setActing(`session-${id}`);
    try {
      await api.patch(`/sessions/${id}/complete`);
      toast.success('Session completed');
      await load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not complete session'));
    } finally {
      setActing(null);
    }
  };

  if (loading) return <DashboardSkeleton />;
  if (!data && loadError) return <LoadErrorState message={loadError} scope="coach-dashboard" onRetry={() => { setLoading(true); load(); }} />;
  if (!data) return <DashboardSkeleton />;

  const firstName = (user.profile?.name || '').split(' ')[0];
  const actionQueue = buildCoachActionQueue(data, attention);
  const now = Date.now();
  const agenda = [...data.today_sessions]
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .map((session) => ({ ...session, linked: linkedLogs[session.id] || {} }));
  const firstUpcoming = agenda.findIndex((session) => new Date(session.scheduled_at).getTime() > now);
  const showNowLine = firstUpcoming > 0;
  const summary = [
    `${data.today_sessions.length} ${data.today_sessions.length === 1 ? 'session' : 'sessions'} today`,
    `${actionQueue.length} waiting on you`,
    `${data.client_count} ${data.client_count === 1 ? 'client' : 'clients'}`,
    data.unread_messages ? `${data.unread_messages} unread` : null,
  ].filter(Boolean).join(' · ');

  return (
    <DashboardChoreography pageKey={`coach-dashboard-${user.id || user.profile?.id || user.role}`}>
      <DashboardHero
        title={`Hey, ${firstName}`}
        subtitle={user.role === 'admin' ? 'Admin view - all coaches' : 'Your day at CVF'}
        testId="coach-dashboard-header"
        action={
          <Button onClick={() => navigate('/coach/sessions?new=1')} className="rounded-xl" data-testid="dashboard-new-session-button">
            <Plus className="h-4 w-4 mr-1.5" /> New session
          </Button>
        }
      />

      {/* One summary line replaces the four count tiles (round-2 decision,
          2026-09-29): the counts matter, the tiles only repeated the lists. */}
      <p className="-mt-1 mb-4 text-sm text-muted-foreground" data-testid="coach-day-summary">{summary}</p>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-5">
      <Card data-testid="coach-dashboard-today-sessions-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <SectionLabel>Today&apos;s agenda</SectionLabel>
          <Link to="/coach/sessions" className="flex min-h-11 items-center text-xs text-primary font-medium" data-testid="view-all-sessions-link">
            All sessions <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {agenda.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No sessions scheduled today.</p>
          )}
          {agenda.map((s, index) => {
            const past = new Date(s.scheduled_at).getTime() + (s.duration_minutes || 0) * 60 * 1000 < now;
            const live = s.status === 'scheduled' && s.linked.log?.status === 'active';
            const workoutDone = s.status === 'scheduled' && s.linked.log?.status === 'completed';
            return (
              <div key={s.id}>
                {showNowLine && index === firstUpcoming && (
                  <div className="flex items-center gap-2 py-1" aria-hidden="true" data-testid="agenda-now-line">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">Now</span>
                    <span className="h-px flex-1 bg-primary/60" />
                  </div>
                )}
                <div className={`flex flex-wrap items-center gap-3 border-t border-border/60 py-2.5 ${past && !workoutDone ? 'opacity-60' : ''}`} data-testid="today-session-row">
                  <Link to={`/coach/sessions/${s.id}`} className="flex min-w-[15rem] flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="w-16 shrink-0">
                      <p className="font-display font-semibold tabular-nums">{fmtTime(s.scheduled_at)}</p>
                      <p className="text-[11px] text-muted-foreground">{s.duration_minutes} min</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.client?.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[s.linked.workout?.name, s.location].filter(Boolean).join(' · ') || 'No location'}
                      </p>
                      {live && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="agenda-live-chip">
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" /> In the gym now
                        </p>
                      )}
                      {workoutDone && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-gold" data-testid="agenda-workout-done-chip">
                          <Dumbbell className="h-3 w-3" /> Workout done{s.linked.log.quick_completed ? ' (not tracked)' : ''}
                        </p>
                      )}
                    </div>
                  </Link>
                  {workoutDone ? (
                    <Button size="sm" className="ml-auto min-h-11 shrink-0 rounded-lg" disabled={acting === `session-${s.id}`} onClick={() => handleSessionComplete(s.id)} data-testid="agenda-confirm-complete-button">
                      <Check className="mr-1 h-3.5 w-3.5" /> Complete
                    </Button>
                  ) : (
                    <StatusBadge status={s.status} />
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-4 lg:mt-0" data-testid="coach-action-queue">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <div>
            <SectionLabel>Needs you</SectionLabel>
          </div>
          <Link to="/coach/analytics" className="flex min-h-11 shrink-0 items-center text-xs font-medium text-primary">
            Analytics <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {attentionUnavailable && (
            <p className="rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 text-xs" role="status" data-testid="coach-queue-partial-note">
              Longer-range client signals could not be loaded. Current requests, messages, check-ins, and open sessions are still shown.
            </p>
          )}
          {actionQueue.length === 0 && (
            <p className="text-sm text-muted-foreground py-2" data-testid="coach-action-queue-empty">Nothing needs your attention right now.</p>
          )}
          {actionQueue.map((item, index) => (
            <div
              key={item.key}
              // Surface roles (010 §6): the queue's first item — the thing to
              // do next — is the raised surface; the rest stay standard.
              className={index === 0
                ? 'rounded-xl border border-primary/35 bg-card px-4 py-3 shadow-[var(--app-elev-soft)]'
                : 'rounded-xl border border-border bg-card/60 px-4 py-3'}
              data-testid={`coach-action-${item.kind}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.kind === 'booking'
                      ? <><span data-testid="booking-client-name">{item.detail.client?.name || 'Client'}</span> is waiting for a booking decision</>
                      : item.title}
                  </p>
                  {item.kind === 'stale_session' && <p className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(item.detail.scheduled_at)} · {item.detail.duration_minutes}m</p>}
                  {item.kind === 'booking' && <>
                    <p className="mt-0.5 text-xs text-muted-foreground" data-testid="booking-request-time">{fmtDateTime(item.detail.requested_time)} · {item.detail.duration_minutes}m</p>
                    {item.detail.note && <p className="mt-1 truncate text-xs italic text-muted-foreground" data-testid="booking-request-note">&quot;{item.detail.note}&quot;</p>}
                  </>}
                  {item.kind === 'message' && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail.content}</p>}
                  {item.kind === 'check_in' && <CheckInStats className="mt-1" stats={[["Energy", item.detail.energy || '-'], ["Sleep", item.detail.sleep_quality || '-']]} />}
                  {item.kind === 'attention' && <p className="mt-0.5 text-xs text-muted-foreground">{item.reasons.map((reason) => reason.label).join(' · ')}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {item.kind === 'booking' ? (
                    <>
                      <Button size="sm" className="min-h-11 rounded-lg" disabled={acting === `booking-${item.detail.id}`} onClick={() => handleBooking(item.detail.id, 'approve')} data-testid="booking-approve-button"><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>
                      <Button size="sm" variant="outline" className="min-h-11 rounded-lg text-destructive" disabled={acting === `booking-${item.detail.id}`} onClick={() => handleBooking(item.detail.id, 'decline')} data-testid="booking-decline-button">Decline</Button>
                    </>
                  ) : item.kind === 'stale_session' ? (
                    <>
                      <Button size="sm" className="min-h-11 rounded-lg" disabled={acting === `session-${item.detail.id}`} onClick={() => handleSessionComplete(item.detail.id)}><Check className="mr-1 h-3.5 w-3.5" />Complete</Button>
                      <Button asChild size="sm" variant="outline" className="min-h-11 rounded-lg"><Link to="/coach/sessions?view=past">Review</Link></Button>
                    </>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="min-h-11 rounded-lg"><Link to={item.href}>{item.action}</Link></Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      </div>
    </DashboardChoreography>
  );
}
