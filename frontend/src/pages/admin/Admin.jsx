import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, LoadErrorState, StatTile, EmptyState, IconButton } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, CalendarDays, Inbox, ShieldCheck, Plus, Loader2, FileText, Archive, ArchiveRestore, Pencil } from 'lucide-react';
import { fmtDateTime, fmtMoney } from '@/lib/format';
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
          <TabsTrigger value="packages" data-testid="admin-tab-packages">Packages</TabsTrigger>
        </TabsList>
        <TabsContent value="coaches"><CoachesTab /></TabsContent>
        <TabsContent value="waivers"><WaiversTab /></TabsContent>
        <TabsContent value="packages"><PackagesTab /></TabsContent>
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
            <DialogHeader><DialogTitle>New coach account</DialogTitle></DialogHeader>
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
            <DialogHeader><DialogTitle>Publish new waiver version</DialogTitle></DialogHeader>
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
          <DialogHeader><DialogTitle>Waiver version {viewing?.version_number}</DialogTitle></DialogHeader>
          <ScrollArea className="h-80 rounded-lg border border-border bg-background/40 p-4">
            <pre className="whitespace-pre-wrap text-sm leading-6">{viewing?.full_text}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PackagesTab() {
  const [packages, setPackages] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', price: '', session_credits: '', is_recurring: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/packages?include_archived=true');
      setPackages(data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e);
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', price: '', session_credits: '', is_recurring: false });
    setOpen(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description || '', price: String(p.price), session_credits: String(p.session_credits), is_recurring: p.is_recurring });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, price: Number(form.price), session_credits: Number(form.session_credits) };
      if (editing) {
        await api.put(`/packages/${editing.id}`, payload);
        toast.success('Package updated');
      } else {
        await api.post('/packages', payload);
        toast.success('Package created');
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (p) => {
    try {
      await api.patch(`/packages/${p.id}/archive`, { archived: !p.archived });
      toast.success(p.archived ? 'Package restored' : 'Package archived');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (!packages && loadError) return <LoadErrorState message={loadError} scope="admin-packages" onRetry={() => { setLoadError(null); load(); }} />;
  if (!packages) return <LoadingScreen />;

  return (
    <div className="space-y-3 mt-1">
      <div className="flex justify-end">
        <Button size="sm" className="rounded-xl" onClick={openCreate} data-testid="package-create-button">
          <Plus className="h-4 w-4 mr-1.5" /> New package
        </Button>
      </div>
      {packages.map((p) => (
        <Card key={p.id} className={p.archived ? 'opacity-60' : ''} data-testid="admin-package-row">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">
                {p.name}
                {p.is_recurring && <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/25">Recurring</Badge>}
                {p.archived && <Badge variant="outline" className="ml-2 text-muted-foreground">Archived</Badge>}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{fmtMoney(p.price)} - {p.session_credits} credits</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <IconButton label={`Edit ${p.name}`} size="touchIcon" variant="ghost" className="rounded-lg" onClick={() => openEdit(p)} data-testid="package-edit-button">
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label={`${p.archived ? 'Restore' : 'Archive'} ${p.name}`} size="touchIcon" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => toggleArchive(p)} data-testid="package-archive-button">
                {p.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </IconButton>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editing ? 'Edit package' : 'New package'}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3.5">
            <div className="space-y-1.5"><Label>Name *</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="package-name-input" /></div>
            <div className="space-y-1.5"><Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="package-description-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Price (USD) *</Label>
                <Input required type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="package-price-input" /></div>
              <div className="space-y-1.5"><Label>Session credits *</Label>
                <Input required type="number" min="0" value={form.session_credits} onChange={(e) => setForm({ ...form, session_credits: e.target.value })} data-testid="package-credits-input" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.is_recurring} onCheckedChange={(v) => setForm({ ...form, is_recurring: v })} data-testid="package-recurring-switch" />
              Recurring package
            </label>
            <DialogFooter>
              <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="package-save-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save changes' : 'Create package'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
