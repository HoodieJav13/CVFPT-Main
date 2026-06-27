import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { LoadingScreen, StatTile } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CalendarDays, CreditCard, Dumbbell, FileSignature, ChevronRight, MapPin, MessageSquare, AlertTriangle,
} from 'lucide-react';
import { fmtDay, fmtTime, fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientHome() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard/client')
      .then(({ data }) => setData(data))
      .catch((e) => toast.error(errMsg(e, 'Failed to load')));
  }, []);

  if (!data) return <LoadingScreen />;

  const firstName = (user.profile?.name || '').split(' ')[0];

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Fitness Done Right</p>
      </div>

      {data.waiver.has_version && !data.waiver.signed_latest && (
        <Link to="/client/waiver" className="block mb-4" data-testid="waiver-alert-card">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#F2C94C]/35 bg-[#F2C94C]/8 bg-[#F2C94C]/10 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-[#F2C94C] shrink-0" />
              <div>
                <p className="text-sm font-semibold">Waiver needs your signature</p>
                <p className="text-xs text-muted-foreground">Please review and sign the liability waiver before your next session.</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </Link>
      )}

      <Card className="border-primary/25" data-testid="client-home-next-session-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Next session</CardTitle>
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
        <StatTile label="Session credits" value={data.credits} icon={CreditCard} testId="credits-balance-text" />
        <StatTile label="Active programs" value={data.program_count} icon={Dumbbell} testId="program-count-tile" />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Link to="/client/sessions" className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors" data-testid="quick-link-book">
          <CalendarDays className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Book a session</span>
        </Link>
        <Link to="/client/packages" className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5 hover:bg-card transition-colors" data-testid="quick-link-packages">
          <CreditCard className="h-5 w-5 text-[#F2C94C]" />
          <span className="text-sm font-medium">Buy credits</span>
        </Link>
      </div>

      <Card className="mt-4" data-testid="client-recent-messages-card">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent messages</CardTitle>
          <Link to="/client/messages" className="text-xs text-primary font-medium flex items-center">
            Open chat <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recent_messages.length === 0 && <p className="text-sm text-muted-foreground py-1">No messages yet. Say hi to your coach!</p>}
          {data.recent_messages.map((m) => (
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
    </div>
  );
}
