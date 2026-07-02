import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Archive, BookOpen, CalendarDays, Dumbbell, FileUp, Loader2, Pencil,
  Plus, Trash2, UserPlus, Video,
} from 'lucide-react';
import { toast } from 'sonner';

const EMPTY_LIBRARY = { name: '', category: '', equipment: '', primary_muscle: '', secondary_muscles: '', video_url: '', notes: '' };
const EMPTY_EXERCISE = { exercise_library_id: '', custom_name: '', sets: '', reps: '', rest: '', tempo: '', notes: '', video_url: '' };
const EMPTY_WORKOUT = { name: '', description: '', goal: '', exercises: [{ ...EMPTY_EXERCISE }] };

export default function Programs() {
  const [library, setLibrary] = useState(null);
  const [workouts, setWorkouts] = useState(null);
  const [programs, setPrograms] = useState(null);
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    try {
      const [lib, w, p, c] = await Promise.all([
        api.get('/programs/exercise-library'),
        api.get('/programs/workouts'),
        api.get('/programs'),
        api.get('/clients'),
      ]);
      setLibrary(lib.data);
      setWorkouts(w.data);
      setPrograms(p.data);
      setClients(c.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load training builder'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!library || !workouts || !programs) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Training builder" subtitle="Manage exercise library, workout days, structured programs, and assignments" />
      <Tabs defaultValue="library">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl">
          <TabsTrigger value="library">Exercise Library</TabsTrigger>
          <TabsTrigger value="workouts">Workout Days</TabsTrigger>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
        </TabsList>
        <TabsContent value="library"><ExerciseLibraryTab library={library} reload={load} /></TabsContent>
        <TabsContent value="workouts"><WorkoutsTab workouts={workouts} library={library} reload={load} /></TabsContent>
        <TabsContent value="programs"><StructuredProgramsTab programs={programs} workouts={workouts} reload={load} /></TabsContent>
        <TabsContent value="assignments"><AssignmentsTab programs={programs} workouts={workouts} clients={clients} reload={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function ExerciseLibraryTab({ library, reload }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_LIBRARY);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = library.filter((ex) => [ex.name, ex.category, ex.equipment, ex.primary_muscle].join(' ').toLowerCase().includes(search.toLowerCase()));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_LIBRARY);
    setOpen(true);
  };

  const openEdit = (exercise) => {
    setEditing(exercise);
    setForm({
      name: exercise.name || '',
      category: exercise.category || '',
      equipment: exercise.equipment || '',
      primary_muscle: exercise.primary_muscle || '',
      secondary_muscles: exercise.secondary_muscles || '',
      video_url: exercise.video_url || '',
      notes: exercise.notes || '',
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/programs/exercise-library/${editing.id}`, form);
        toast.success('Exercise updated');
      } else {
        await api.post('/programs/exercise-library', form);
        toast.success('Exercise added');
      }
      setOpen(false);
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (exercise) => {
    try {
      await api.patch(`/programs/exercise-library/${exercise.id}/archive`);
      toast.success('Exercise archived');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const importCsv = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const { data } = await api.post('/programs/exercise-library/import', { rows });
      toast.success(`Imported ${data.imported} exercises`);
      reload();
    } catch (e) {
      toast.error(errMsg(e, 'Could not import CSV'));
    }
  };

  return (
    <div className="space-y-4 mt-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exercises..." className="h-11 rounded-xl sm:max-w-sm" />
        <div className="flex gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-border px-3 text-sm font-medium hover:bg-accent">
            <FileUp className="h-4 w-4 mr-1.5" /> Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
          </label>
          <Button className="rounded-xl" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" /> Add exercise
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">CSV columns: name, category, equipment, primary_muscle, secondary_muscles, video_url, notes</p>
      {filtered.length === 0 && <EmptyState icon={BookOpen} title="No exercises found" subtitle="Import a CSV or add an exercise manually." />}
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((exercise) => (
          <Card key={exercise.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{exercise.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {[exercise.category, exercise.equipment, exercise.primary_muscle].filter(Boolean).join(' - ') || 'No tags'}
                  </p>
                  {exercise.video_url && <a href={exercise.video_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-medium text-primary hover:underline">Video</a>}
                </div>
                <div className="flex gap-1.5">
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => openEdit(exercise)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-muted-foreground" onClick={() => archive(exercise)}><Archive className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit exercise' : 'Add exercise'}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-3.5">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Exercise name" />
            <div className="grid grid-cols-2 gap-3">
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
              <Input value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Equipment" />
              <Input value={form.primary_muscle} onChange={(e) => setForm({ ...form, primary_muscle: e.target.value })} placeholder="Primary muscle" />
              <Input value={form.secondary_muscles} onChange={(e) => setForm({ ...form, secondary_muscles: e.target.value })} placeholder="Secondary muscles" />
            </div>
            <Input value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} placeholder="YouTube video URL" />
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" />
            <DialogFooter><Button disabled={saving} className="rounded-xl">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save exercise'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkoutsTab({ workouts, library, reload }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_WORKOUT);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_WORKOUT);
    setOpen(true);
  };

  const openEdit = (workout) => {
    setEditing(workout);
    setForm({
      name: workout.name || '',
      description: workout.description || '',
      goal: workout.goal || '',
      exercises: workout.exercises.length ? workout.exercises.map((ex) => ({
        exercise_library_id: ex.exercise_library_id || '',
        custom_name: ex.custom_name || ex.library_exercise?.name || '',
        sets: ex.sets || '',
        reps: ex.reps || '',
        rest: ex.rest || '',
        tempo: ex.tempo || '',
        notes: ex.notes || '',
        video_url: ex.video_url || ex.library_exercise?.video_url || '',
      })) : [{ ...EMPTY_EXERCISE }],
    });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.exercises.some((ex) => ex.exercise_library_id || ex.custom_name.trim())) {
      toast.error('Add at least one exercise');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/programs/workouts/${editing.id}`, form);
        toast.success('Workout updated');
      } else {
        await api.post('/programs/workouts', form);
        toast.success('Workout created');
      }
      setOpen(false);
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (workout) => {
    try {
      await api.patch(`/programs/workouts/${workout.id}/archive`);
      toast.success('Workout archived');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4 mt-1">
      <div className="flex justify-end">
        <Button className="rounded-xl" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> New workout day</Button>
      </div>
      {workouts.length === 0 && <EmptyState icon={Dumbbell} title="No workout days yet" subtitle="Create reusable day templates from library exercises or custom movements." />}
      <div className="grid gap-3 md:grid-cols-2">
        {workouts.map((workout) => (
          <Card key={workout.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-display">{workout.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{workout.goal || workout.description || 'Workout day template'}</p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => openEdit(workout)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-muted-foreground" onClick={() => archive(workout)}><Archive className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="text-muted-foreground">{workout.exercise_count} exercises</Badge>
              <div className="mt-3 space-y-1.5">
                {workout.exercises.slice(0, 4).map((ex, i) => (
                  <p key={ex.id} className="text-sm text-muted-foreground"><span className="tabular-nums">{i + 1}.</span> {exerciseName(ex)}</p>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <WorkoutDialog open={open} onOpenChange={setOpen} form={form} setForm={setForm} library={library} saving={saving} onSubmit={save} editing={editing} />
    </div>
  );
}

function StructuredProgramsTab({ programs, workouts, reload }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', frequency_days: '3', days: [] });
  const [saving, setSaving] = useState(false);

  const resetDays = (frequency, existing = []) => Array.from({ length: Number(frequency) }, (_, i) => ({
    day_number: i + 1,
    workout_id: existing.find((d) => Number(d.day_number) === i + 1)?.workout_id || '',
    notes: existing.find((d) => Number(d.day_number) === i + 1)?.notes || '',
  }));

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', frequency_days: '3', days: resetDays(3) });
    setOpen(true);
  };

  const openEdit = (program) => {
    setEditing(program);
    const frequency = String(program.frequency_days || 3);
    setForm({
      name: program.name || '',
      description: program.description || '',
      frequency_days: frequency,
      days: resetDays(frequency, program.days || []),
    });
    setOpen(true);
  };

  const setFrequency = (frequency) => setForm({ ...form, frequency_days: frequency, days: resetDays(frequency, form.days) });

  const save = async (e) => {
    e.preventDefault();
    if (form.days.some((day) => !day.workout_id)) {
      toast.error('Assign one workout to each program day');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/programs/${editing.id}`, form);
        toast.success('Program updated');
      } else {
        await api.post('/programs', form);
        toast.success('Program created');
      }
      setOpen(false);
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (program) => {
    try {
      await api.patch(`/programs/${program.id}/archive`);
      toast.success('Program archived');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4 mt-1">
      <div className="flex justify-end"><Button className="rounded-xl" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> New program</Button></div>
      {programs.length === 0 && <EmptyState icon={CalendarDays} title="No structured programs yet" subtitle="Build a 3-5 day weekly program from saved workout days." />}
      <div className="space-y-3">
        {programs.map((program) => (
          <Card key={program.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-semibold">{program.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{program.frequency_days} days/week - {program.exercise_count} total exercises</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {(program.days || []).map((day) => (
                      <div key={day.id || day.day_number} className="rounded-xl border border-border bg-card/60 px-3 py-2">
                        <p className="text-xs font-semibold text-muted-foreground">Day {day.day_number}</p>
                        <p className="text-sm font-medium mt-0.5">{day.workout?.name || 'No workout'}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => openEdit(program)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-muted-foreground" onClick={() => archive(program)}><Archive className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit program' : 'New structured program'}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Program name" />
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Program description" />
            <div className="space-y-1.5">
              <Label>Days per week</Label>
              <Select value={form.frequency_days} onValueChange={setFrequency}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>{['3', '4', '5'].map((d) => <SelectItem key={d} value={d}>{d} days/week</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              {form.days.map((day, index) => (
                <div key={day.day_number} className="rounded-xl border border-border bg-card/50 p-3 space-y-2">
                  <Label>Day {day.day_number}</Label>
                  <Select value={day.workout_id} onValueChange={(workout_id) => setForm({ ...form, days: form.days.map((d, i) => i === index ? { ...d, workout_id } : d) })}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose workout day..." /></SelectTrigger>
                    <SelectContent>{workouts.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={day.notes} onChange={(e) => setForm({ ...form, days: form.days.map((d, i) => i === index ? { ...d, notes: e.target.value } : d) })} placeholder="Day notes" />
                </div>
              ))}
            </div>
            <DialogFooter><Button disabled={saving} className="rounded-xl">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save program'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignmentsTab({ programs, workouts, clients, reload }) {
  const [type, setType] = useState('program');
  const [clientId, setClientId] = useState('');
  const [programId, setProgramId] = useState('');
  const [workoutId, setWorkoutId] = useState('');
  const [mode, setMode] = useState('active');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!clientId) return toast.error('Choose a client');
    setSaving(true);
    try {
      if (type === 'program') {
        if (!programId) throw new Error('Choose a program');
        await api.post(`/programs/${programId}/assign`, { client_id: clientId, notes });
        toast.success('Program assigned');
      } else {
        if (!workoutId) throw new Error('Choose a workout');
        await api.post('/programs/workout-assignments', {
          client_id: clientId,
          workout_id: workoutId,
          assignment_mode: mode,
          assigned_for: mode === 'dated' ? date : null,
          notes,
        });
        toast.success('Workout assigned');
      }
      setNotes('');
      reload();
    } catch (err) {
      toast.error(errMsg(err, err.message || 'Assignment failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-1">
      <CardContent className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Assignment type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="program">Long-term program</SelectItem>
                  <SelectItem value="workout">Standalone workout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose client..." /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {type === 'program' ? (
            <div className="space-y-1.5">
              <Label>Program</Label>
              <Select value={programId} onValueChange={setProgramId}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose program..." /></SelectTrigger>
                <SelectContent>{programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label>Workout</Label>
                <Select value={workoutId} onValueChange={setWorkoutId}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Choose workout..." /></SelectTrigger>
                  <SelectContent>{workouts.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active template</SelectItem><SelectItem value="dated">Dated workout</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" disabled={mode !== 'dated'} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
          )}
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Assignment notes" />
          <Button disabled={saving} className="rounded-xl"><UserPlus className="h-4 w-4 mr-1.5" /> {saving ? 'Assigning...' : 'Assign'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WorkoutDialog({ open, onOpenChange, form, setForm, library, saving, onSubmit, editing }) {
  const setExercise = (index, updates) => {
    setForm({ ...form, exercises: form.exercises.map((ex, i) => i === index ? { ...ex, ...updates } : ex) });
  };

  const chooseExercise = (index, value) => {
    const match = library.find((ex) => ex.name.toLowerCase() === value.toLowerCase());
    if (match) {
      setExercise(index, { exercise_library_id: match.id, custom_name: match.name, video_url: match.video_url || '' });
    } else {
      setExercise(index, { exercise_library_id: '', custom_name: value });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Edit workout day' : 'New workout day'}</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Workout day name" />
            <Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="Goal/focus" />
          </div>
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" />
          <datalist id="exercise-library-options">
            {library.map((exercise) => <option key={exercise.id} value={exercise.name} />)}
          </datalist>
          <div className="space-y-3">
            {form.exercises.map((exercise, index) => (
              <div key={index} className="rounded-xl border border-border bg-card/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input list="exercise-library-options" value={exercise.custom_name} onChange={(e) => chooseExercise(index, e.target.value)} placeholder={`Exercise ${index + 1}`} />
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-lg text-muted-foreground" onClick={() => setForm({ ...form, exercises: form.exercises.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Input value={exercise.sets} onChange={(e) => setExercise(index, { sets: e.target.value })} placeholder="Sets" />
                  <Input value={exercise.reps} onChange={(e) => setExercise(index, { reps: e.target.value })} placeholder="Reps" />
                  <Input value={exercise.rest} onChange={(e) => setExercise(index, { rest: e.target.value })} placeholder="Rest" />
                  <Input value={exercise.tempo} onChange={(e) => setExercise(index, { tempo: e.target.value })} placeholder="Tempo" />
                </div>
                <div className="relative">
                  <Video className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={exercise.video_url} onChange={(e) => setExercise(index, { video_url: e.target.value })} placeholder="Video URL" className="pl-9" />
                </div>
                <Input value={exercise.notes} onChange={(e) => setExercise(index, { notes: e.target.value })} placeholder="Notes / coaching cues" />
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" className="w-full rounded-xl" onClick={() => setForm({ ...form, exercises: [...form.exercises, { ...EMPTY_EXERCISE }] })}>
            <Plus className="h-4 w-4 mr-1.5" /> Add exercise
          </Button>
          <DialogFooter><Button disabled={saving} className="rounded-xl">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save workout'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function exerciseName(exercise) {
  return exercise.library_exercise?.name || exercise.custom_name || 'Exercise';
}

function parseCsv(text) {
  const rows = [];
  const parsed = [];
  let current = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (current || row.length) {
        row.push(current);
        parsed.push(row);
      }
      current = '';
      row = [];
      if (char === '\r' && next === '\n') i += 1;
    } else {
      current += char;
    }
  }
  if (current || row.length) {
    row.push(current);
    parsed.push(row);
  }
  const headers = (parsed.shift() || []).map((h) => h.trim());
  for (const values of parsed) {
    const obj = {};
    headers.forEach((header, i) => { obj[header] = (values[i] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}
