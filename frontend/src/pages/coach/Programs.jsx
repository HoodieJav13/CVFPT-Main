import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from '@/components/ui/drawer';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Dumbbell, MoreVertical, Pencil, Archive, UserPlus, Trash2, Loader2, Video } from 'lucide-react';
import { toast } from 'sonner';

const EMPTY_EX = { name: '', sets: '', reps: '', video_url: '', notes: '' };

export default function Programs() {
  const [programs, setPrograms] = useState(null);
  const [clients, setClients] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assignFor, setAssignFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.get('/programs'), api.get('/clients')]);
      setPrograms(p.data);
      setClients(c.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load programs'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const archive = async (p) => {
    try {
      await api.patch(`/programs/${p.id}/archive`);
      toast.success(`"${p.name}" archived`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openEdit = async (p) => {
    try {
      const { data } = await api.get(`/programs/${p.id}`);
      setEditing(data);
      setDrawerOpen(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!programs) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title="Programs"
        subtitle="Workout templates you can assign to clients"
        action={
          <Button className="rounded-xl" onClick={() => { setEditing(null); setDrawerOpen(true); }} data-testid="program-create-button">
            <Plus className="h-4 w-4 mr-1.5" /> New program
          </Button>
        }
      />

      {programs.length === 0 && (
        <EmptyState icon={Dumbbell} title="No programs yet" subtitle="Build your first workout program and assign it to clients." testId="programs-empty-state" />
      )}

      <div className="space-y-3">
        {programs.map((p) => (
          <Card key={p.id} data-testid="program-card">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-semibold">{p.name}</p>
                  {p.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="outline" className="text-muted-foreground">{p.exercise_count} exercises</Badge>
                    {p.active_assignments.map((a) => (
                      <Badge key={a.id} variant="outline" className="bg-primary/10 text-primary border-primary/25">{a.client?.name}</Badge>
                    ))}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg shrink-0" data-testid="program-actions-button">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setAssignFor(p)} data-testid="program-assign-action">
                      <UserPlus className="h-4 w-4 mr-2" /> Assign to client
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openEdit(p)} data-testid="program-edit-action">
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => archive(p)} className="text-destructive" data-testid="program-archive-action">
                      <Archive className="h-4 w-4 mr-2" /> Archive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProgramDrawer open={drawerOpen} onOpenChange={setDrawerOpen} editing={editing} onSaved={() => { setDrawerOpen(false); load(); }} />
      <AssignDialog program={assignFor} clients={clients} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); load(); }} />
    </div>
  );
}

function ProgramDrawer({ open, onOpenChange, editing, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [exercises, setExercises] = useState([{ ...EMPTY_EX }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name);
        setDescription(editing.description || '');
        setExercises(editing.exercises.length ? editing.exercises.map((ex) => ({
          name: ex.name, sets: ex.sets || '', reps: ex.reps || '', video_url: ex.video_url || '', notes: ex.notes || '',
        })) : [{ ...EMPTY_EX }]);
      } else {
        setName('');
        setDescription('');
        setExercises([{ ...EMPTY_EX }]);
      }
    }
  }, [open, editing]);

  const setEx = (i, key, value) => {
    setExercises((list) => list.map((ex, idx) => (idx === i ? { ...ex, [key]: value } : ex)));
  };

  const submit = async (e) => {
    e.preventDefault();
    const cleaned = exercises.filter((ex) => ex.name.trim());
    if (!cleaned.length) {
      toast.error('Add at least one exercise');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/programs/${editing.id}`, { name, description, exercises: cleaned });
        toast.success('Program updated');
      } else {
        await api.post('/programs', { name, description, exercises: cleaned });
        toast.success('Program created');
      }
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <div className="mx-auto w-full max-w-lg px-4 pb-6 overflow-y-auto">
          <DrawerHeader className="px-0">
            <DrawerTitle>{editing ? 'Edit program' : 'New program'}</DrawerTitle>
          </DrawerHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Program name *</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Foundation Strength - Phase 1" className="rounded-xl h-11" data-testid="program-name-input" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Goals, frequency, focus..." data-testid="program-description-input" />
            </div>
            <div className="space-y-3">
              <Label>Exercises</Label>
              {exercises.map((ex, i) => (
                <div key={i} className="rounded-xl border border-border bg-card/60 p-3 space-y-2" data-testid="exercise-editor-row">
                  <div className="flex items-center gap-2">
                    <Input value={ex.name} onChange={(e) => setEx(i, 'name', e.target.value)} placeholder={`Exercise ${i + 1} name`} className="rounded-lg" data-testid="exercise-name-input" />
                    <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-lg text-muted-foreground shrink-0"
                      onClick={() => setExercises((l) => l.filter((_, idx) => idx !== i))} data-testid="exercise-remove-button">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={ex.sets} onChange={(e) => setEx(i, 'sets', e.target.value)} placeholder="Sets (e.g. 3)" className="rounded-lg" data-testid="exercise-sets-input" />
                    <Input value={ex.reps} onChange={(e) => setEx(i, 'reps', e.target.value)} placeholder="Reps (e.g. 8-12)" className="rounded-lg" data-testid="exercise-reps-input" />
                  </div>
                  <div className="relative">
                    <Video className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input value={ex.video_url} onChange={(e) => setEx(i, 'video_url', e.target.value)} placeholder="Video URL (YouTube/Drive, optional)" className="rounded-lg pl-9" data-testid="exercise-video-input" />
                  </div>
                  <Input value={ex.notes} onChange={(e) => setEx(i, 'notes', e.target.value)} placeholder="Coaching cues / notes" className="rounded-lg" data-testid="exercise-notes-input" />
                </div>
              ))}
              <Button type="button" variant="secondary" className="w-full rounded-xl" onClick={() => setExercises((l) => [...l, { ...EMPTY_EX }])} data-testid="add-exercise-button">
                <Plus className="h-4 w-4 mr-1.5" /> Add exercise
              </Button>
            </div>
            <DrawerFooter className="px-0">
              <Button type="submit" disabled={saving} className="rounded-xl h-11 font-semibold" data-testid="program-save-button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save changes' : 'Create program'}
              </Button>
            </DrawerFooter>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function AssignDialog({ program, clients, onClose, onSaved }) {
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelected(''); }, [program]);

  const submit = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await api.post(`/programs/${program.id}/assign`, { client_id: selected });
      toast.success('Program assigned');
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(program)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Assign "{program?.name}"</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="rounded-xl" data-testid="assign-client-select">
              <SelectValue placeholder="Choose client..." />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="submit" disabled={saving || !selected} className="rounded-xl w-full sm:w-auto" data-testid="assign-save-button">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
