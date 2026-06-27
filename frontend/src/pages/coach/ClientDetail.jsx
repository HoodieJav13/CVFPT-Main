import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { LoadingScreen, StatusBadge, MetricChart, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, Pencil, Archive, ArchiveRestore, Loader2, Plus, FileSignature,
  CreditCard, TrendingUp, Dumbbell, CalendarDays, MessageSquare, Trash2,
} from 'lucide-react';
import { initials, fmtDate, fmtDateTime, fmtMoney, fmtTime, fmtDay } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [credits, setCredits] = useState(0);
  const [waiver, setWaiver] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, cr, w] = await Promise.all([
        api.get(`/clients/${id}`),
        api.get(`/payments/credits/${id}`),
        api.get(`/waivers/client/${id}/status`),
      ]);
      setClient(c.data);
      setCredits(cr.data.balance);
      setWaiver(w.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load client'));
      navigate('/coach/clients');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  if (loading || !client) return <LoadingScreen />;

  return (
    <div>
      <button onClick={() => navigate('/coach/clients')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4" data-testid="back-to-clients-button">
        <ArrowLeft className="h-4 w-4" /> Clients
      </button>

      <div className="flex items-center gap-4 mb-5">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-primary/15 text-primary font-display font-semibold text-lg">{initials(client.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight truncate" data-testid="client-detail-name">{client.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {client.archived && <Badge variant="outline" className="text-muted-foreground">Archived</Badge>}
            {client.auth_user_id ? (
              <Badge variant="outline" className="bg-emerald-500/15 text-emerald-200 border-emerald-500/25">Account active</Badge>
            ) : client.invited ? (
              <Badge variant="outline" className="bg-primary/15 text-primary border-primary/25">Invited - awaiting signup</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">Not invited</Badge>
            )}
            <Badge variant="outline" className="bg-[#F2C94C]/10 text-[#F2C94C] border-[#F2C94C]/25" data-testid="client-credits-badge">{credits} credits</Badge>
          </div>
        </div>
        <Button variant="secondary" size="icon" className="rounded-xl shrink-0" onClick={() => navigate(`/coach/messages/${client.id}`)} data-testid="client-message-button">
          <MessageSquare className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="progress" data-testid="tab-progress">Progress</TabsTrigger>
          <TabsTrigger value="sessions" data-testid="tab-sessions">Sessions</TabsTrigger>
          <TabsTrigger value="programs" data-testid="tab-programs">Programs</TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab client={client} credits={credits} waiver={waiver} reload={load} user={user} />
        </TabsContent>
        <TabsContent value="progress">
          <ProgressTab clientId={client.id} />
        </TabsContent>
        <TabsContent value="sessions">
          <SessionsTab clientId={client.id} />
        </TabsContent>
        <TabsContent value="programs">
          <ProgramsTab clientId={client.id} />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTab clientId={client.id} reloadParent={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ client, credits, waiver, reload, user }) {
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    name: client.name, email: client.email || '', phone: client.phone || '',
    goals: client.goals || '', health_notes: client.health_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [coaches, setCoaches] = useState([]);

  useEffect(() => {
    if (user.role === 'admin') {
      api.get('/admin/coaches').then(({ data }) => setCoaches(data)).catch(() => {});
    }
  }, [user.role]);

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/clients/${client.id}`, form);
      toast.success('Client updated');
      setEditOpen(false);
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleInvite = async (invited) => {
    try {
      await api.patch(`/clients/${client.id}/invite`, { invited });
      toast.success(invited ? 'Client invited - they can now sign up with their email' : 'Invitation removed');
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const toggleArchive = async () => {
    try {
      await api.patch(`/clients/${client.id}/archive`, { archived: !client.archived });
      toast.success(client.archived ? 'Client restored' : 'Client archived');
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const reassign = async (coachId) => {
    try {
      await api.patch(`/admin/clients/${client.id}/reassign`, { coach_id: coachId });
      toast.success('Client reassigned');
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const markPaperSigned = async () => {
    try {
      await api.post(`/waivers/client/${client.id}/sign-paper`, { signed_name: client.name });
      toast.success('Paper waiver recorded');
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-4 mt-1">
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Profile</CardTitle>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="rounded-lg" data-testid="edit-client-button">
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
              <form onSubmit={saveEdit} className="space-y-3.5">
                <div className="space-y-1.5"><Label>Name</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="edit-name-input" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="edit-email-input" /></div>
                  <div className="space-y-1.5"><Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="edit-phone-input" /></div>
                </div>
                <div className="space-y-1.5"><Label>Goals</Label>
                  <Textarea rows={2} value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} data-testid="edit-goals-input" /></div>
                <div className="space-y-1.5"><Label>Injury / health notes</Label>
                  <Textarea rows={2} value={form.health_notes} onChange={(e) => setForm({ ...form, health_notes: e.target.value })} data-testid="edit-health-input" /></div>
                <DialogFooter>
                  <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="edit-save-button">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Email" value={client.email || '-'} />
          <Row label="Phone" value={client.phone || '-'} />
          <Row label="Goals" value={client.goals || '-'} />
          <Row label="Health notes" value={client.health_notes || '-'} />
          <Row label="Client since" value={fmtDate(client.created_at)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-sm">Client portal invitation</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {client.auth_user_id
                ? 'This client has claimed their account.'
                : client.invited
                  ? `Invited - tell them to sign up at this site with ${client.email || 'their email'}.`
                  : 'Toggle on, then tell the client to sign up using their email.'}
            </p>
          </div>
          <Switch
            checked={client.invited || Boolean(client.auth_user_id)}
            disabled={Boolean(client.auth_user_id)}
            onCheckedChange={toggleInvite}
            data-testid="client-invite-switch"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileSignature className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Waiver</p>
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="waiver-status-text">
                  {!waiver?.latest_version
                    ? 'No waiver version exists yet'
                    : waiver.signed_latest
                      ? `Signed v${waiver.latest_version.version_number}`
                      : `Not signed (current: v${waiver.latest_version.version_number})`}
                </p>
              </div>
            </div>
            {waiver?.latest_version && !waiver.signed_latest && (
              <Button size="sm" variant="secondary" className="rounded-lg" onClick={markPaperSigned} data-testid="mark-paper-signed-button">
                Record paper waiver
              </Button>
            )}
          </div>
          {waiver?.signatures?.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              {waiver.signatures.map((s) => (
                <p key={s.id} className="text-xs text-muted-foreground" data-testid="waiver-signature-row">
                  v{s.version?.version_number} signed by "{s.signed_name}" on {fmtDateTime(s.signed_at)}
                  {s.entered_by === 'coach' ? ' (coach-entered, paper)' : ''}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {user.role === 'admin' && (
        <Card>
          <CardContent className="p-4">
            <p className="font-medium text-sm mb-2">Assigned coach (admin)</p>
            <Select value={client.coach_id} onValueChange={reassign}>
              <SelectTrigger className="rounded-xl" data-testid="admin-reassign-client-button">
                <SelectValue placeholder="Select coach" />
              </SelectTrigger>
              <SelectContent>
                {coaches.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}{c.is_admin ? ' (admin)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Button variant="outline" onClick={toggleArchive} className="rounded-xl w-full" data-testid="archive-client-button">
        {client.archived ? <><ArchiveRestore className="h-4 w-4 mr-2" /> Restore client</> : <><Archive className="h-4 w-4 mr-2" /> Archive client</>}
      </Button>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex gap-3">
      <p className="w-28 shrink-0 text-muted-foreground">{label}</p>
      <p className="flex-1 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function ProgressTab({ clientId }) {
  const [metrics, setMetrics] = useState(null);
  const [metricOpen, setMetricOpen] = useState(false);
  const [metricForm, setMetricForm] = useState({ name: '', unit: '' });
  const [entryFor, setEntryFor] = useState(null);
  const [entryForm, setEntryForm] = useState({ value: '', recorded_on: new Date().toISOString().slice(0, 10), notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/progress/clients/${clientId}/metrics`);
      setMetrics(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const addMetric = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/progress/clients/${clientId}/metrics`, metricForm);
      toast.success('Metric added');
      setMetricOpen(false);
      setMetricForm({ name: '', unit: '' });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/progress/metrics/${entryFor.id}/entries`, entryForm);
      toast.success('Entry logged');
      setEntryFor(null);
      setEntryForm({ value: '', recorded_on: new Date().toISOString().slice(0, 10), notes: '' });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const archiveMetric = async (m) => {
    try {
      await api.patch(`/progress/metrics/${m.id}/archive`);
      toast.success(`"${m.name}" archived`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (!metrics) return <LoadingScreen />;

  return (
    <div className="space-y-4 mt-1">
      <div className="flex justify-end">
        <Dialog open={metricOpen} onOpenChange={setMetricOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl" data-testid="add-metric-button">
              <Plus className="h-4 w-4 mr-1.5" /> New metric
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>New metric</DialogTitle></DialogHeader>
            <form onSubmit={addMetric} className="space-y-3.5">
              <div className="space-y-1.5"><Label>Name *</Label>
                <Input required value={metricForm.name} onChange={(e) => setMetricForm({ ...metricForm, name: e.target.value })} placeholder='e.g. "Back Squat 1RM", "Waist"' data-testid="metric-name-input" /></div>
              <div className="space-y-1.5"><Label>Unit</Label>
                <Input value={metricForm.unit} onChange={(e) => setMetricForm({ ...metricForm, unit: e.target.value })} placeholder="lbs, in, min..." data-testid="metric-unit-input" /></div>
              <DialogFooter>
                <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="metric-save-button">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {metrics.length === 0 && (
        <EmptyState icon={TrendingUp} title="No metrics yet" subtitle='Create a metric like "Body Weight" or "Mile Time" and start logging.' testId="metrics-empty-state" />
      )}

      {metrics.map((m) => {
        const latest = m.entries[m.entries.length - 1];
        return (
          <Card key={m.id} data-testid="metric-card">
            <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base font-display">{m.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {latest ? <>Latest: <span className="text-primary font-semibold tabular-nums">{latest.value}{m.unit ? ` ${m.unit}` : ''}</span> on {fmtDate(latest.recorded_on)}</> : 'No entries yet'}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => setEntryFor(m)} data-testid="log-entry-button">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Log
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-muted-foreground" onClick={() => archiveMetric(m)} data-testid="archive-metric-button">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {m.entries.length > 0 ? (
                <MetricChart entries={m.entries} unit={m.unit} />
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">Log the first entry to see the chart.</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={Boolean(entryFor)} onOpenChange={(o) => !o && setEntryFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Log {entryFor?.name}</DialogTitle></DialogHeader>
          <form onSubmit={addEntry} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Value{entryFor?.unit ? ` (${entryFor.unit})` : ''} *</Label>
                <Input required type="number" step="any" value={entryForm.value} onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })} data-testid="entry-value-input" /></div>
              <div className="space-y-1.5"><Label>Date</Label>
                <Input type="date" value={entryForm.recorded_on} onChange={(e) => setEntryForm({ ...entryForm, recorded_on: e.target.value })} data-testid="entry-date-input" /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label>
              <Input value={entryForm.notes} onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })} placeholder="PR! Great depth." data-testid="entry-notes-input" /></div>
            <DialogFooter>
              <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="entry-save-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log entry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionsTab({ clientId }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    api.get(`/sessions?client_id=${clientId}`).then(({ data }) => setSessions(data.reverse())).catch((e) => toast.error(errMsg(e)));
  }, [clientId]);

  if (!sessions) return <LoadingScreen />;

  return (
    <div className="space-y-3 mt-1">
      <div className="flex justify-end">
        <Button size="sm" className="rounded-xl" onClick={() => navigate(`/coach/sessions?new=1&client=${clientId}`)} data-testid="schedule-for-client-button">
          <Plus className="h-4 w-4 mr-1.5" /> Schedule session
        </Button>
      </div>
      {sessions.length === 0 && <EmptyState icon={CalendarDays} title="No sessions yet" subtitle="Schedule the first session for this client." />}
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="client-session-row">
          <div>
            <p className="font-medium text-sm">{fmtDay(s.scheduled_at)} - {fmtTime(s.scheduled_at)}</p>
            <p className="text-xs text-muted-foreground">{s.duration_minutes}m - {s.location || 'No location'}</p>
          </div>
          <StatusBadge status={s.status} />
        </div>
      ))}
    </div>
  );
}

function ProgramsTab({ clientId }) {
  const [programs, setPrograms] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/programs');
      setPrograms(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!programs) return <LoadingScreen />;

  const assigned = programs.filter((p) => p.active_assignments.some((a) => a.client?.id === clientId));
  const available = programs.filter((p) => !p.active_assignments.some((a) => a.client?.id === clientId));

  const assign = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await api.post(`/programs/${selected}/assign`, { client_id: clientId });
      toast.success('Program assigned');
      setAssignOpen(false);
      setSelected('');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const unassign = async (program) => {
    const a = program.active_assignments.find((x) => x.client?.id === clientId);
    if (!a) return;
    try {
      await api.patch(`/programs/assignments/${a.id}/archive`);
      toast.success('Program unassigned');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-3 mt-1">
      <div className="flex justify-end">
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl" data-testid="assign-program-button">
              <Plus className="h-4 w-4 mr-1.5" /> Assign program
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Assign a program</DialogTitle></DialogHeader>
            <form onSubmit={assign} className="space-y-4">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="rounded-xl" data-testid="assign-program-select">
                  <SelectValue placeholder="Choose program..." />
                </SelectTrigger>
                <SelectContent>
                  {available.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {available.length === 0 && <p className="text-xs text-muted-foreground">All your programs are already assigned to this client. Create more from the Programs tab.</p>}
              <DialogFooter>
                <Button type="submit" disabled={saving || !selected} className="rounded-xl w-full sm:w-auto" data-testid="assign-confirm-button">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {assigned.length === 0 && <EmptyState icon={Dumbbell} title="No programs assigned" subtitle="Assign one of your workout programs to this client." />}
      {assigned.map((p) => (
        <Card key={p.id} data-testid="assigned-program-card">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{p.exercise_count} exercises</p>
            </div>
            <Button size="sm" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => unassign(p)} data-testid="unassign-program-button">
              Unassign
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PaymentsTab({ clientId, reloadParent }) {
  const [history, setHistory] = useState(null);
  const [packages, setPackages] = useState([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, p] = await Promise.all([
        api.get(`/payments/history/${clientId}`),
        api.get('/packages'),
      ]);
      setHistory(h.data);
      setPackages(p.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const record = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const { data } = await api.post('/payments/manual', { client_id: clientId, package_id: selected });
      toast.success(`Purchase recorded - balance now ${data.credits} credits`);
      setOpen(false);
      setSelected('');
      load();
      reloadParent();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  if (!history) return <LoadingScreen />;

  return (
    <div className="space-y-3 mt-1">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl" data-testid="record-purchase-button">
              <Plus className="h-4 w-4 mr-1.5" /> Record purchase
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Record manual purchase</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground -mt-2">For cash / in-person payments. Credits are added immediately.</p>
            <form onSubmit={record} className="space-y-4">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger className="rounded-xl" data-testid="purchase-package-select">
                  <SelectValue placeholder="Choose package..." />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} - {fmtMoney(p.price)} ({p.session_credits} credits)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button type="submit" disabled={saving || !selected} className="rounded-xl w-full sm:w-auto" data-testid="purchase-confirm-button">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record purchase'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {history.length === 0 && <EmptyState icon={CreditCard} title="No payments yet" subtitle="Record a manual purchase or have the client buy a package." />}
      {history.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="payment-history-row">
          <div>
            <p className="font-medium text-sm">{p.package?.name || 'Package'}</p>
            <p className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)} - {p.method === 'manual' ? 'Cash/manual' : 'Card (Stripe)'}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{fmtMoney(p.amount)}</p>
            <p className="text-xs text-muted-foreground">{p.credits_granted} credits - {p.status}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
