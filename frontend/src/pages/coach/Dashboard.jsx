import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { StatTile, DashboardSkeleton, LoadErrorState, StatusBadge, SectionLabel, CheckInStats } from '@/components/common';
import { DashboardHero } from '@/components/BrandBackdrop';
import { DashboardChoreography } from '@/components/Choreography';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarDays, Users, Inbox, MessageSquare, Check, Plus, ChevronRight } from 'lucide-react';
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

  const load = useCallback(async () => {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [dashboardResult, analyticsResult] = await Promise.allSettled([
        api.get('/dashboard/coach'),
        api.get(`/analytics/coach?from=${from.toISOString()}&to=${to.toISOString()}`),
      ]);
      if (dashboardResult.status === 'rejected') throw dashboardResult.reason;
      setData(dashboardResult.value.data);
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Today" value={data.today_sessions.length} icon={CalendarDays} testId="stat-today-sessions" />
        <StatTile label="Clients" value={data.client_count} icon={Users} testId="stat-client-count" />
        <StatTile label="Requests" value={data.pending_bookings.length} icon={Inbox} testId="stat-pending-requests" />
        <StatTile label="Unread" value={data.unread_messages} icon={MessageSquare} testId="stat-unread-messages" />
      </div>

      <Card className="mt-5" data-testid="coach-dashboard-today-sessions-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <SectionLabel>Today's sessions</SectionLabel>
          <Link to="/coach/sessions" className="text-xs text-primary font-medium flex items-center" data-testid="view-all-sessions-link">
            View all <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {data.today_sessions.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No sessions scheduled today.</p>
          )}
          {data.today_sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="today-session-row">
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-center shrink-0">
                  <p className="font-display font-semibold text-primary tabular-nums">{fmtTime(s.scheduled_at)}</p>
                  <p className="text-[10px] text-muted-foreground">{s.duration_minutes}m</p>
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{s.client?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.location || 'No location'}</p>
                </div>
              </div>
              <StatusBadge status={s.status} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4" data-testid="coach-action-queue">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <div>
            <SectionLabel>Today&apos;s priorities</SectionLabel>
            <p className="mt-1 text-sm text-muted-foreground">Resolve the work that is waiting on you.</p>
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
    </DashboardChoreography>
  );
}
