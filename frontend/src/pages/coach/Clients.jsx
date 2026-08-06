import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, ListSkeleton, LoadErrorState, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Search, Users, ChevronRight, FileUp, Loader2 } from 'lucide-react';
import { initials } from '@/lib/format';
import { toast } from 'sonner';
import draftTools from '@/lib/programDraft.js';

const { parseCsv } = draftTools;

export default function Clients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', goals: '', health_notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/clients?include_archived=${showArchived}`);
      setClients(data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load clients');
      setLoadError(message);
      toast.error(message);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    return clients.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q));
  }, [clients, search]);

  const createClient = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post('/clients', form);
      toast.success(`${data.name} added`);
      setOpen(false);
      setForm({ name: '', email: '', phone: '', goals: '', health_notes: '' });
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to add client'));
    } finally {
      setSaving(false);
    }
  };

  if (!clients && loadError) return <LoadErrorState message={loadError} scope="coach-clients" onRetry={() => { setLoadError(null); load(); }} />;
  if (!clients) return <ListSkeleton rows={3} />;

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${clients.filter((c) => !c.archived).length} active`}
        action={
          <div className="flex gap-2">
          <ImportClientsDialog onImported={load} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl" data-testid="add-client-button">
                <Plus className="h-4 w-4 mr-1.5" /> Add client
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>New client</DialogTitle>
                <DialogDescription>Create an invited client record and assign its coach.</DialogDescription>
              </DialogHeader>
              <form onSubmit={createClient} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label>Full name *</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" data-testid="client-name-input" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@email.com" data-testid="client-email-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="505-555-0100" data-testid="client-phone-input" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Goals</Label>
                  <Textarea rows={2} value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} placeholder="What do they want to achieve?" data-testid="client-goals-input" />
                </div>
                <div className="space-y-1.5">
                  <Label>Injury / health notes</Label>
                  <Textarea rows={2} value={form.health_notes} onChange={(e) => setForm({ ...form, health_notes: e.target.value })} placeholder="Anything to train around?" data-testid="client-health-input" />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving} className="rounded-xl w-full sm:w-auto" data-testid="client-save-button">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add client'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." className="pl-9 h-11 rounded-xl" data-testid="client-list-search-input" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} data-testid="client-archive-toggle" />
          Archived
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No clients found" subtitle={search ? 'Try a different search.' : 'Add your first client to get started.'} testId="clients-empty-state" />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/coach/clients/${c.id}`)}
              className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:bg-card transition-colors text-left"
              data-testid="client-row"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">{initials(c.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.role === 'admin' && c.coach ? `Coach: ${c.coach.name}` : (c.email || 'No email')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.archived && <Badge variant="outline" className="text-muted-foreground">Archived</Badge>}
                {c.auth_user_id ? (
                  <Badge variant="outline" className="bg-success/15 text-success-foreground border-success/25">Active</Badge>
                ) : c.invited ? (
                  <Badge variant="outline" className="bg-primary/15 text-primary border-primary/25">Invited</Badge>
                ) : null}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// D5 (2026-08-06): roster-only CSV import to soften My PT Hub re-entry —
// parse client-side, preview, then commit; the server dedupes and reports
// per-row skip reasons. CSV columns: name, email, phone, goals.
function ImportClientsDialog({ onImported }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => { setRows(null); setResult(null); };

  const parseFile = async (file, inputElement) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, rows: parsed } = parseCsv(text);
      if (!headers.includes('name')) {
        toast.error('The CSV needs at least a "name" column');
        return;
      }
      const cleaned = parsed
        .map((row) => ({
          name: String(row.name || '').trim(),
          email: String(row.email || '').trim(),
          phone: String(row.phone || '').trim(),
          goals: String(row.goals || '').trim(),
        }))
        .filter((row) => row.name || row.email);
      if (!cleaned.length) {
        toast.error('No client rows found in this file');
        return;
      }
      setResult(null);
      setRows(cleaned);
    } catch (e) {
      toast.error(errMsg(e, 'Could not read that CSV'));
    } finally {
      if (inputElement) inputElement.value = '';
    }
  };

  const commit = async () => {
    setImporting(true);
    try {
      const { data } = await api.post('/clients/import', { rows });
      setResult(data);
      setRows(null);
      toast.success(`Imported ${data.imported} ${data.imported === 1 ? 'client' : 'clients'}`);
      onImported();
    } catch (e) {
      toast.error(errMsg(e, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl" data-testid="import-clients-button">
          <FileUp className="h-4 w-4 mr-1.5" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import clients</DialogTitle>
          <DialogDescription>
            CSV columns: name, email, phone, goals. Existing emails are skipped — nothing is overwritten.
          </DialogDescription>
        </DialogHeader>
        {!rows && !result && (
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-accent">
            <FileUp className="h-5 w-5" />
            Choose a CSV file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => parseFile(e.target.files?.[0], e.target)} data-testid="import-clients-file-input" />
          </label>
        )}
        {rows && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{rows.length} {rows.length === 1 ? 'client' : 'clients'} ready to import</p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-2" data-testid="import-clients-preview">
              {rows.map((row, index) => (
                <div key={`${row.email || row.name}-${index}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm odd:bg-secondary/40">
                  <span className="truncate font-medium">{row.name || <span className="text-destructive">Missing name</span>}</span>
                  <span className="truncate text-xs text-muted-foreground">{row.email || 'no email'}</span>
                </div>
              ))}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={reset} disabled={importing}>Choose another file</Button>
              <Button onClick={commit} disabled={importing} className="rounded-xl" data-testid="import-clients-commit-button">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Import ${rows.length}`}
              </Button>
            </DialogFooter>
          </div>
        )}
        {result && (
          <div className="space-y-3" data-testid="import-clients-result">
            <p className="text-sm font-medium">Imported {result.imported} {result.imported === 1 ? 'client' : 'clients'}.</p>
            {result.skipped?.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2 text-xs">
                <p className="font-medium text-muted-foreground">{result.skipped.length} skipped:</p>
                {result.skipped.map((skip, index) => (
                  <p key={index} className="text-muted-foreground">{skip.name || skip.email || `Row ${skip.row}`} — {skip.reason}</p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button className="rounded-xl" onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
