import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, StatTile, DashboardSkeleton, StatusBadge, SectionLabel, CheckInStats } from '@/components/common';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CalendarDays, Users, Inbox, MessageSquare, Check, Plus, ChevronRight, ClipboardCheck } from 'lucide-react';
import { fmtTime, fmtDay, fmtDateTime, fmtDate } from '@/lib/format';
import { toast } from 'sonner';

export default function CoachDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/dashboard/coach');
      setData(data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleBooking = async (id, action) => {
    try {
      await api.patch(`/bookings/${id}/${action}`);
      toast.success(action === 'approve' ? 'Request approved - session created' : 'Request declined');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (loading) return <DashboardSkeleton />;
  if (!data) return null;

  const firstName = (user.profile?.name || '').split(' ')[0];

  return (
    <div>
      <PageHeader
        title={`Hey, ${firstName}`}
        subtitle={user.role === 'admin' ? 'Admin view - all coaches' : 'Your day at CVF'}
        testId="coach-dashboard-header"
        action={
          <Button onClick={() => navigate('/coach/sessions?new=1')} className="rounded-xl hidden sm:flex" data-testid="dashboard-new-session-button">
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

      <Card className="mt-4" data-testid="pending-bookings-card">
        <CardHeader className="pb-3">
          <SectionLabel>Booking requests</SectionLabel>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {data.pending_bookings.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No pending requests.</p>
          )}
          {data.pending_bookings.map((b) => (
            <div key={b.id} className="rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="booking-request-row">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{b.client?.name}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(b.requested_time)} - {b.duration_minutes}m</p>
                  {b.note && <p className="text-xs text-muted-foreground mt-1 italic truncate">"{b.note}"</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" className="rounded-lg" onClick={() => handleBooking(b.id, 'approve')} data-testid="booking-approve-button">
                    <Check className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleBooking(b.id, 'decline')} data-testid="booking-decline-button">
                    Decline
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4" data-testid="recent-check-ins-card">
        <CardHeader className="pb-3">
          <SectionLabel>Check-ins to review</SectionLabel>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {data.recent_check_ins.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No check-ins waiting for review.</p>
          )}
          {data.recent_check_ins.map((checkIn) => (
            <Link key={checkIn.id} to={`/coach/clients/${checkIn.client_id}`} className="block rounded-xl border border-border bg-card/60 px-4 py-3 hover:bg-card transition-colors" data-testid="dashboard-check-in-row">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ClipboardCheck className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{checkIn.client?.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(checkIn.check_in_date)}</p>
                    <CheckInStats
                      className="mt-1"
                      stats={[
                        ['Energy', checkIn.energy || '-'],
                        ['Sleep', checkIn.sleep_quality || '-'],
                      ]}
                    />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4" data-testid="recent-messages-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <SectionLabel>Recent messages</SectionLabel>
          <Link to="/coach/messages" className="text-xs text-primary font-medium flex items-center">
            Inbox <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recent_messages.length === 0 && <p className="text-sm text-muted-foreground py-2">No messages yet.</p>}
          {data.recent_messages.map((m) => (
            <Link key={m.id} to={`/coach/messages/${m.client_id}`} className="block rounded-xl border border-border bg-card/60 px-4 py-2.5 hover:bg-card transition-colors" data-testid="recent-message-row">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{m.client?.name}</p>
                <p className="text-[10px] text-muted-foreground">{fmtDay(m.created_at)}</p>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {m.sender_role === 'coach' ? 'You: ' : ''}{m.content}
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
