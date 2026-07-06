import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { LoadingScreen, StatTile } from '@/components/common';
import CheckInForm from '@/components/CheckInForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  CalendarDays, CreditCard, Dumbbell, ChevronRight, MapPin,
  MessageSquare, AlertTriangle, ClipboardCheck, Activity,
} from 'lucide-react';
import { fmtDay, fmtTime, fmtDateTime, fmtDate } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientHome() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/dashboard/client');
      setData(data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCheckIn = async (payload) => {
    setSaving(true);
    try {
      await api.post('/check-ins/mine', payload);
      toast.success(data?.today_check_in ? 'Check-in updated' : 'Check-in saved');
      setCheckInOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not save check-in'));
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <LoadingScreen />;

  const firstName = (user.profile?.name || '').split(' ')[0];
  const todayCheckIn = data.today_check_in;

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Today, {firstName}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Check in, train well, stay connected.</p>
      </div>

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

      <Card className="border-primary/25" data-testid="daily-check-in-card">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily check-in</p>
              <h2 className="font-display text-xl font-semibold mt-1">
                {todayCheckIn ? 'You checked in today' : 'Ready for your check-in?'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {todayCheckIn
                  ? `Energy ${todayCheckIn.energy || '-'} / Sleep ${todayCheckIn.sleep_quality || '-'} / Stress ${todayCheckIn.stress || '-'}`
                  : 'Log readiness, soreness, sleep, stress, and notes for your coach.'}
              </p>
            </div>
            <Badge variant="outline" className={todayCheckIn ? 'bg-success/15 text-success-foreground border-success/25' : 'bg-gold/10 text-gold border-gold/25'}>
              {todayCheckIn ? (todayCheckIn.review_status === 'reviewed' ? 'Reviewed' : 'Sent') : 'Open'}
            </Badge>
          </div>
          {todayCheckIn?.coach_notes && (
            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
              <p className="text-xs font-semibold text-primary">Coach note</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{todayCheckIn.coach_notes}</p>
            </div>
          )}
          <Button className="mt-4 rounded-xl" onClick={() => setCheckInOpen(true)} data-testid="open-check-in-button">
            <ClipboardCheck className="h-4 w-4 mr-1.5" /> {todayCheckIn ? 'Edit check-in' : 'Start check-in'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <StatTile label="Programs" value={data.program_count} icon={Dumbbell} testId="program-count-tile" />
        <StatTile label="Unread" value={data.unread_messages} icon={MessageSquare} testId="unread-messages-tile" />
      </div>

      <Card className="mt-4" data-testid="client-home-next-session-card">
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Next session</CardTitle>
          <Link to="/client/sessions" className="text-xs text-primary font-medium flex items-center">
            Sessions <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {data.next_session ? (
            <div>
              <p className="font-display text-2xl font-semibold">
                {fmtDay(data.next_session.scheduled_at)} <span className="text-primary">{fmtTime(data.next_session.scheduled_at)}</span>
              </p>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                <span>{data.next_session.duration_minutes} min with {data.next_session.coach?.name}</span>
                {data.next_session.location && (
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {data.next_session.location}</span>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
              <Button asChild size="sm" className="mt-3 rounded-xl">
                <Link to="/client/sessions" data-testid="request-session-cta">Request a session</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Link to="/client/sessions" className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors" data-testid="quick-link-book">
          <CalendarDays className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Book</span>
        </Link>
        <Link to="/client/programs" className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors" data-testid="quick-link-programs">
          <Dumbbell className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Programs</span>
        </Link>
      </div>

      <Card className="mt-4" data-testid="recent-progress-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent progress</CardTitle>
          <Link to="/client/progress" className="text-xs text-primary font-medium flex items-center">
            Log/view <ChevronRight className="h-3.5 w-3.5" />
          </Link>
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
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Messages</CardTitle>
          <Link to="/client/messages" className="text-xs text-primary font-medium flex items-center">
            Open chat <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recent_messages.length === 0 && <p className="text-sm text-muted-foreground py-1">No messages yet. Say hi to your coach!</p>}
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

      <Link to="/client/packages" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors" data-testid="credits-summary-link">
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-gold" />
          <div>
            <p className="text-sm font-medium">Session credits</p>
            <p className="text-xs text-muted-foreground">Current balance: {data.credits}</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{todayCheckIn ? "Edit today's check-in" : "Today's check-in"}</DialogTitle></DialogHeader>
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
