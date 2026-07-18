import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, LoadErrorState, StatTile, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, CalendarDays, Inbox, ShieldCheck, Plus, Loader2, FileText } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

export default function AdminPage() {
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/overview');
      setOverview(data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load admin overview');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!overview && loadError) return <LoadErrorState message={loadError} scope="admin-overview" onRetry={() => { setLoadError(null); load(); }} />;
  if (!overview) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Admin" subtitle="Business-wide management" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Coaches" value={overview.coaches} icon={ShieldCheck} testId="admin-stat-coaches" />
        <StatTile label="Clients" value={overview.clients} icon={Users} testId="admin-stat-clients" />
        <StatTile label="Upcoming" value={overview.upcoming_sessions} icon={CalendarDays} testId="admin-stat-upcoming" />
        <StatTile label="Requests" value={overview.pending_bookings} icon={Inbox} testId="admin-stat-requests" />
      </div>

      <Tabs defaultValue="coaches" className="mt-6">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl">
          <TabsTrigger value="coaches" data-testid="admin-tab-coaches">Coaches</TabsTrigger>
          <TabsTrigger value="waivers" data-testid="admin-tab-waivers">Waivers</TabsTrigger>
        </TabsList>
        <TabsContent value="coaches"><CoachesTab /></TabsContent>
        <TabsContent value="waivers"><WaiversTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function CoachesTab() {
  const [coaches, setCoaches] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', is_admin: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/coaches');
      setCoaches(data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e);
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/admin/coaches', form);
      toast.success('Coach account created');
      setOpen(false);
      setForm({ name: '', email: '', phone: '', password: '', is_admin: false });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  if (!coaches && loadError) return <LoadErrorState message={loadError} scope="admin-coaches" onRetry={() => { setLoadError(null); load(); }} />;
  if (!coaches) return <LoadingScreen />;

  return (
    <div className="space-y-3 mt-1">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl" data-testid="admin-add-coach-button">
              <Plus className="h-4 w-4 mr-1.5" /> Add coach
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm" data-testid="admin-coach-create-dialog">
            <DialogHeader>
              <DialogTitle>New coach account</DialogTitle>
              <DialogDescription>Create an invited coach account and assign its access role.</DialogDescription>
            </DialogHeader>
            <form onSubmit={create} className="space-y-3.5" data-testid="admin-coach-create-form">
              <div className="space-y-1.5"><Label>Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="coach-name-input" /></div>
              <div className="space-y-1.5"><Label>Email *</Label>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="coach-email-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="coach-phone-input" /></div>
                <div className="space-y-1.5"><Label>Password *</Label>
                  <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="coach-password-input" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.is_admin} onCheckedChange={(v) => setForm({ ...form, is_admin: v })} data-testid="coach-admin-switch" />
                Admin privileges
              </label>
              <DialogFooter>
                <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="coach-create-button">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create coach'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {coaches.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="admin-coach-row">
          <div>
            <p className="font-medium text-sm">{c.name}</p>
            <p className="text-xs text-muted-foreground">{c.email}{c.phone ? ` - ${c.phone}` : ''}</p>
          </div>
          {c.is_admin && <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25">Admin</Badge>}
        </div>
      ))}
    </div>
  );
}

function WaiversTab() {
  const [versions, setVersions] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/waivers/versions');
      setVersions(data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e);
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/waivers/versions', { full_text: text });
      toast.success('New waiver version published');
      setOpen(false);
      setText('');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  if (!versions && loadError) return <LoadErrorState message={loadError} scope="admin-waivers" onRetry={() => { setLoadError(null); load(); }} />;
  if (!versions) return <LoadingScreen />;

  return (
    <div className="space-y-3 mt-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Versions are append-only. New versions supersede old ones; existing signatures always reference the exact text signed.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-xl shrink-0" data-testid="waiver-version-create-button">
              <Plus className="h-4 w-4 mr-1.5" /> New version
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg" data-testid="admin-waiver-create-dialog">
            <DialogHeader>
              <DialogTitle>Publish new waiver version</DialogTitle>
              <DialogDescription>Publish append-only waiver text as the next available version.</DialogDescription>
            </DialogHeader>
            <form onSubmit={create} className="space-y-4">
              <Textarea required rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full waiver text..." data-testid="waiver-text-input" />
              <DialogFooter>
                <Button type="submit" disabled={saving || !text.trim()} className="rounded-xl w-full sm:w-auto" data-testid="waiver-publish-button">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Publish as v${(versions[0]?.version_number || 0) + 1}`}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {versions.map((v, i) => (
        <button key={v.id} onClick={() => setViewing(v)} className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:bg-card transition-colors text-left" data-testid="waiver-version-row">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-sm">Version {v.version_number} {i === 0 && <Badge variant="outline" className="ml-1 bg-primary/10 text-primary border-primary/25">Current</Badge>}</p>
              <p className="text-xs text-muted-foreground truncate">{v.full_text.slice(0, 80)}...</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground shrink-0">{fmtDateTime(v.created_at)}</p>
        </button>
      ))}

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Waiver version {viewing?.version_number}</DialogTitle>
            <DialogDescription>Review the full text of this published waiver version.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-80 rounded-lg border border-border bg-background/40 p-4">
            <pre className="whitespace-pre-wrap text-sm leading-6">{viewing?.full_text}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
