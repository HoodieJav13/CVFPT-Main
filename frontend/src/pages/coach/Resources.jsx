import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Download, FileText, Library, Loader2, Pencil, Plus, Search, Users } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { formatFileSize, openResourceDownload } from '@/lib/resources';
import { PageHeader, ListSkeleton, LoadErrorState, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const EMPTY_UPLOAD = { title: '', description: '', category_id: '', is_public: false };

export default function CoachResources() {
  const [resources, setResources] = useState(null);
  const [categories, setCategories] = useState([]);
  const [clients, setClients] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editResource, setEditResource] = useState(null);
  const [assignResource, setAssignResource] = useState(null);
  const [downloadingId, setDownloadingId] = useState('');

  const load = useCallback(async () => {
    try {
      const [resourceResponse, categoryResponse, clientResponse] = await Promise.all([
        api.get('/resources'),
        api.get('/resource-categories'),
        api.get('/clients'),
      ]);
      setResources(resourceResponse.data || []);
      setCategories(categoryResponse.data || []);
      setClients(clientResponse.data || []);
      setLoadError(null);
    } catch (error) {
      const message = errMsg(error, 'Failed to load resources');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (resources || []).filter((resource) => (
      (categoryId === 'all' || resource.category_id === categoryId)
      && (!query || resource.title.toLowerCase().includes(query))
    ));
  }, [resources, search, categoryId]);

  const download = async (resource) => {
    setDownloadingId(resource.id);
    try {
      await openResourceDownload(resource.id);
    } catch (error) {
      toast.error(errMsg(error, 'Could not download resource'));
    } finally {
      setDownloadingId('');
    }
  };

  const archive = async (resource) => {
    try {
      await api.patch(`/resources/${resource.id}`, { archived: true });
      toast.success('Resource archived');
      load();
    } catch (error) {
      toast.error(errMsg(error, 'Could not archive resource'));
    }
  };

  if (!resources && loadError) return <LoadErrorState message={loadError} scope="coach-resources" onRetry={() => { setLoadError(null); load(); }} />;
  if (!resources) return <ListSkeleton rows={3} />;

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Upload PDF handouts and control client access"
        action={<UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} categories={categories} setCategories={setCategories} onSaved={load} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resources..." className="h-11 rounded-xl pl-9" data-testid="coach-resource-search" />
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-11 rounded-xl" data-testid="coach-resource-category-filter"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Library} title="No resources found" subtitle={search || categoryId !== 'all' ? 'Try a different search or category.' : 'Upload your first PDF handout.'} testId="coach-resources-empty" />
      ) : (
        <div className="space-y-3">
          {filtered.map((resource) => {
            const activeAssignments = (resource.assignments || []).filter((assignment) => assignment.active);
            return (
              <Card key={resource.id} data-testid="coach-resource-card">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><FileText className="h-5 w-5" /></div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-display font-semibold" data-testid="coach-resource-title">{resource.title}</p>
                          {resource.is_public ? (
                            <Badge variant="outline" className="border-success/25 bg-success/10 text-success-foreground">Public — visible to all clients</Badge>
                          ) : (
                            <Badge variant="outline">{activeAssignments.length} assigned</Badge>
                          )}
                        </div>
                        {resource.description && <p className="mt-1 text-sm text-muted-foreground">{resource.description}</p>}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {resource.category?.name || 'Uncategorized'} · {resource.file_name}
                          {formatFileSize(resource.file_size_bytes) ? ` · ${formatFileSize(resource.file_size_bytes)}` : ''}
                        </p>
                        {!resource.is_public && activeAssignments.length > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">Assigned to {activeAssignments.map((assignment) => assignment.client?.name).filter(Boolean).join(', ')}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={downloadingId === resource.id} onClick={() => download(resource)} data-testid="coach-resource-download"><Download className="mr-1.5 h-4 w-4" /> PDF</Button>
                      {!resource.is_public && <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => setAssignResource(resource)} data-testid="coach-resource-assign"><Users className="mr-1.5 h-4 w-4" /> Assign</Button>}
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-xl" onClick={() => setEditResource(resource)} aria-label={`Edit ${resource.title}`} data-testid="coach-resource-edit"><Pencil className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-xl text-muted-foreground" onClick={() => archive(resource)} aria-label={`Archive ${resource.title}`} data-testid="coach-resource-archive"><Archive className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editResource && <EditDialog resource={editResource} categories={categories} onClose={() => setEditResource(null)} onSaved={() => { setEditResource(null); load(); }} />}
      {assignResource && <AssignDialog resource={assignResource} clients={clients} onClose={() => setAssignResource(null)} onSaved={() => { setAssignResource(null); load(); }} />}
    </div>
  );
}

function CategorySelect({ value, onValueChange, categories, testId }) {
  return (
    <Select value={value || 'uncategorized'} onValueChange={(next) => onValueChange(next === 'uncategorized' ? '' : next)}>
      <SelectTrigger className="h-11 rounded-xl" data-testid={testId}><SelectValue placeholder="Uncategorized" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="uncategorized">Uncategorized</SelectItem>
        {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function UploadDialog({ open, onOpenChange, categories, setCategories, onSaved }) {
  const [form, setForm] = useState(EMPTY_UPLOAD);
  const [file, setFile] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [saving, setSaving] = useState(false);

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    setAddingCategory(true);
    try {
      const { data } = await api.post('/resource-categories', { name: newCategory });
      setCategories((current) => [...current.filter((category) => category.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((current) => ({ ...current, category_id: data.id }));
      setNewCategory('');
      toast.success(data.reused ? 'Existing category selected' : 'Category added');
    } catch (error) {
      toast.error(errMsg(error, 'Could not add category'));
    } finally {
      setAddingCategory(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file) return toast.error('Choose a PDF file');
    setSaving(true);
    try {
      const payload = new FormData();
      payload.append('title', form.title);
      payload.append('description', form.description);
      if (form.category_id) payload.append('category_id', form.category_id);
      payload.append('is_public', String(form.is_public));
      payload.append('file', file);
      await api.post('/resources', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Resource uploaded');
      setForm(EMPTY_UPLOAD);
      setFile(null);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errMsg(error, 'Could not upload resource'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button size="touch" className="rounded-xl" data-testid="resource-upload-open"><Plus className="mr-1.5 h-4 w-4" /> Upload PDF</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Upload resource</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label>Title *</Label><Input size="touch" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} data-testid="resource-title-input" /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} data-testid="resource-description-input" /></div>
          <div className="space-y-1.5"><Label>Category</Label><CategorySelect value={form.category_id} onValueChange={(category_id) => setForm({ ...form, category_id })} categories={categories} testId="resource-category-select" /></div>
          <div className="rounded-xl border border-border bg-card/50 p-3">
            <Label htmlFor="new-resource-category">+ Add new category</Label>
            <div className="mt-2 flex gap-2">
              <Input size="touch" id="new-resource-category" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Category name" data-testid="resource-new-category-input" />
              <Button size="touch" type="button" variant="outline" className="rounded-xl" disabled={addingCategory || !newCategory.trim()} onClick={addCategory} data-testid="resource-new-category-save">{addingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button>
            </div>
          </div>
          <div className="space-y-1.5"><Label>PDF file *</Label><Input size="touch" type="file" accept=".pdf,application/pdf" required onChange={(event) => setFile(event.target.files?.[0] || null)} data-testid="resource-file-input" /></div>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-3 text-sm">
            <span><span className="font-medium">Public resource</span><span className="block text-xs text-muted-foreground">Visible to every logged-in client</span></span>
            <Switch checked={form.is_public} onCheckedChange={(is_public) => setForm({ ...form, is_public })} data-testid="resource-public-switch" />
          </label>
          <DialogFooter><Button size="touch" type="submit" className="rounded-xl" disabled={saving || !form.title.trim() || !file} data-testid="resource-upload-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Upload resource'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ resource, categories, onClose, onSaved }) {
  const [form, setForm] = useState({ title: resource.title, description: resource.description || '', category_id: resource.category_id || '', is_public: resource.is_public });
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/resources/${resource.id}`, form);
      toast.success('Resource updated');
      onSaved();
    } catch (error) {
      toast.error(errMsg(error, 'Could not update resource'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit resource</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label>Title *</Label><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} data-testid="resource-edit-title" /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
          <div className="space-y-1.5"><Label>Category</Label><CategorySelect value={form.category_id} onValueChange={(category_id) => setForm({ ...form, category_id })} categories={categories} /></div>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-3 text-sm"><span>Public — visible to all clients</span><Switch checked={form.is_public} onCheckedChange={(is_public) => setForm({ ...form, is_public })} data-testid="resource-edit-public-switch" /></label>
          <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>Cancel</Button><Button type="submit" className="rounded-xl" disabled={saving} data-testid="resource-edit-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ resource, clients, onClose, onSaved }) {
  const currentIds = (resource.assignments || []).filter((assignment) => assignment.active).map((assignment) => assignment.client_id);
  const [selectedIds, setSelectedIds] = useState(currentIds);
  const [saving, setSaving] = useState(false);
  const toggle = (clientId, checked) => setSelectedIds((current) => checked ? [...new Set([...current, clientId])] : current.filter((id) => id !== clientId));
  const save = async () => {
    setSaving(true);
    try {
      const current = new Set(currentIds);
      const selected = new Set(selectedIds);
      await Promise.all([
        ...selectedIds.filter((clientId) => !current.has(clientId)).map((clientId) => api.post(`/resources/${resource.id}/assign`, { client_id: clientId })),
        ...currentIds.filter((clientId) => !selected.has(clientId)).map((clientId) => api.patch(`/resources/${resource.id}/assignments/${clientId}`)),
      ]);
      toast.success('Resource assignments updated');
      onSaved();
    } catch (error) {
      toast.error(errMsg(error, 'Could not update assignments'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Assign {resource.title}</DialogTitle></DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto" data-testid="resource-client-list">
          {clients.map((client) => (
            <label key={client.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm">
              <Checkbox checked={selectedIds.includes(client.id)} onCheckedChange={(checked) => toggle(client.id, checked === true)} data-testid={`resource-client-${client.id}`} />
              <span>{client.name}</span>
            </label>
          ))}
        </div>
        <DialogFooter><Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>Cancel</Button><Button type="button" className="rounded-xl" disabled={saving} onClick={save} data-testid="resource-assignment-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save assignments'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
