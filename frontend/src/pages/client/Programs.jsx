import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, LoadErrorState, EmptyState } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CalendarDays, ChevronRight, Dumbbell, Loader2, Play, StickyNote } from 'lucide-react';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientPrograms() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState(null);
  const [activeLog, setActiveLog] = useState(null);
  const [history, setHistory] = useState(null);
  const [starting, setStarting] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [assigned, active, logs] = await Promise.all([
        api.get('/programs/client/assigned'),
        api.get('/workout-logs/active'),
        api.get('/workout-logs/mine'),
      ]);
      setAssignments(Array.isArray(assigned.data) ? { programs: assigned.data, workouts: [] } : assigned.data);
      setActiveLog(active.data);
      setHistory(logs.data);
      setLoadError(null);
    } catch (error) {
      const message = errMsg(error, 'Failed to load programs');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startWorkout = async (key, source) => {
    setStarting(key);
    try {
      const { data } = await api.post('/workout-logs/start', source);
      navigate(`/client/workouts/${data.workout_log.id}/track`);
    } catch (error) {
      const active = error.response?.data?.active_workout;
      if (error.response?.status === 409 && active?.id) {
        setActiveLog(active);
        toast.error('Finish or abandon your active workout first.');
      } else {
        toast.error(errMsg(error));
      }
    } finally {
      setStarting(null);
    }
  };

  if ((!assignments || history === null) && loadError) return <LoadErrorState message={loadError} scope="client-programs" onRetry={load} />;
  if (!assignments || history === null) return <LoadingScreen />;

  const programAssignments = assignments.programs || [];
  const workoutAssignments = assignments.workouts || [];
  const activeWorkouts = workoutAssignments.filter((assignment) => assignment.assignment_mode === 'active');
  const datedWorkouts = workoutAssignments
    .filter((assignment) => assignment.assignment_mode === 'dated')
    .sort((a, b) => String(a.assigned_for || '').localeCompare(String(b.assigned_for || '')));
  const isEmpty = programAssignments.length === 0 && workoutAssignments.length === 0;

  return (
    <div>
      <PageHeader title="My programs" subtitle="Assigned training and workout history" />
      {activeLog && (
        <Card className="mb-5 border-primary/30 bg-primary/5" data-testid="active-workout-banner">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0"><p className="text-xs font-medium uppercase text-primary">In progress</p><p className="truncate font-display font-semibold">{activeLog.workout_name}</p></div>
            <Button asChild><Link to={`/client/workouts/${activeLog.id}/track`}>Resume</Link></Button>
          </CardContent>
        </Card>
      )}
      {isEmpty && <EmptyState icon={Dumbbell} title="No programs yet" subtitle="Your coach will assign workout programs here." testId="client-programs-empty" />}
      <div className="space-y-5">
        {programAssignments.map((assignment) => (
          <ProgramAssignmentCard key={assignment.id} assignment={assignment} starting={starting} onStart={startWorkout} />
        ))}

        {(activeWorkouts.length > 0 || datedWorkouts.length > 0) && (
          <section className="space-y-3">
            <div><h2 className="font-display text-lg font-semibold">Standalone workouts</h2><p className="text-sm text-muted-foreground">Active templates and one-off dated workouts.</p></div>
            {[...activeWorkouts, ...datedWorkouts].map((assignment) => (
              <WorkoutAssignmentCard key={assignment.id} assignment={assignment} starting={starting} onStart={startWorkout} />
            ))}
          </section>
        )}

        <section className="space-y-3" data-testid="client-workout-history">
          <div><h2 className="font-display text-lg font-semibold">Workout history</h2><p className="text-sm text-muted-foreground">Completed self-guided workouts.</p></div>
          {history.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No completed workouts yet.</div>
          ) : history.slice(0, 12).map((log) => <HistoryRow key={log.id} log={log} />)}
        </section>
      </div>
    </div>
  );
}

function ProgramAssignmentCard({ assignment, starting, onStart }) {
  const program = assignment.program || {};
  const frequency = program.frequency_days || program.days?.length || 0;
  return (
    <Card data-testid="client-program-card">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle className="font-display text-lg">{program.name}</CardTitle>{program.description && <p className="mt-1 text-sm text-muted-foreground">{program.description}</p>}</div>
          <Badge variant="outline" className="w-fit">{frequency} {frequency === 1 ? 'day' : 'days'}/week</Badge>
        </div>
        {assignment.notes && <AssignmentNote>{assignment.notes}</AssignmentNote>}
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" defaultValue={(program.days || []).length ? [`day-${program.days[0].day_number}`] : []} className="w-full">
          {(program.days || []).map((day) => (
            <WorkoutDay
              key={day.id || day.day_number} day={day} assignmentId={assignment.id}
              loads={(assignment.exercise_loads || []).filter((load) => load.program_day_id === day.id)}
              loading={starting === `${assignment.id}-${day.id}`}
              onStart={() => onStart(`${assignment.id}-${day.id}`, { program_assignment_id: assignment.id, program_day_id: day.id })}
            />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function WorkoutAssignmentCard({ assignment, starting, onStart }) {
  const workout = assignment.workout || {};
  const label = assignment.assignment_mode === 'dated'
    ? `Assigned for ${assignment.assigned_for ? fmtDate(assignment.assigned_for) : 'a date'}`
    : 'Ongoing workout template';
  return (
    <Card data-testid="client-workout-assignment-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-display font-semibold">{workout.name}</p>{(workout.goal || workout.description) && <p className="mt-1 text-sm text-muted-foreground">{workout.goal || workout.description}</p>}</div>
          <Button size="sm" disabled={starting === assignment.id} onClick={() => onStart(assignment.id, { workout_assignment_id: assignment.id })} data-testid="start-standalone-workout">
            {starting === assignment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start'}
          </Button>
        </div>
        <Badge variant="outline" className="w-fit"><CalendarDays className="mr-1 h-3.5 w-3.5" /> {label}</Badge>
        {assignment.notes && <AssignmentNote>{assignment.notes}</AssignmentNote>}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="exercises" className="last:border-b-0">
            <AccordionTrigger className="min-h-11 py-2.5 hover:no-underline"><span className="flex items-center gap-2">Exercises <Badge variant="outline">{(workout.exercises || []).length}</Badge></span></AccordionTrigger>
            <AccordionContent className="pb-0"><ExerciseList exercises={workout.exercises || []} loads={assignment.exercise_loads || []} /></AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function WorkoutDay({ day, assignmentId, loads, loading, onStart }) {
  return (
    <AccordionItem value={`day-${day.day_number}`} className="last:border-b-0">
      <AccordionTrigger className="min-h-11 py-3 hover:no-underline">
        <span className="flex min-w-0 items-center gap-2.5 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 font-display text-xs font-semibold text-primary">{day.day_number}</span>
          <span className="min-w-0"><span className="block truncate font-medium">{day.workout?.name || 'Workout day'}</span>{day.workout?.goal && <span className="block truncate text-xs text-muted-foreground">{day.workout.goal}</span>}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-3">
        {day.notes && <p className="text-xs text-muted-foreground">{day.notes}</p>}
        <ExerciseList exercises={day.workout?.exercises || []} loads={loads} assignmentId={assignmentId} dayId={day.id} />
        <Button size="sm" disabled={loading} onClick={onStart} data-testid="start-program-workout">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start workout'}
        </Button>
      </AccordionContent>
    </AccordionItem>
  );
}

function ExerciseList({ exercises, loads = [] }) {
  if (exercises.length === 0) return <p className="mt-3 text-sm text-muted-foreground">No exercises added yet.</p>;
  const loadByExercise = new Map(loads.map((load) => [load.workout_exercise_id, load]));
  return (
    <div className="mt-2 divide-y divide-border/70">
      {exercises.map((exercise, index) => {
        const assignedLoad = loadByExercise.get(exercise.id);
        const load = assignedLoad || (exercise.default_load_value !== null ? { load_value: exercise.default_load_value, load_unit: exercise.default_load_unit } : null);
        return (
          <div key={exercise.id || `${exerciseName(exercise)}-${index}`} className="py-2.5" data-testid="client-exercise-row">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{exerciseName(exercise)}</p>
              <span className="flex shrink-0 items-center gap-2">
                {exerciseVideo(exercise) && <a href={exerciseVideo(exercise)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"><Play className="h-3 w-3" /> Video</a>}
                {(exercise.sets || exercise.reps) && <Badge variant="outline">{exercise.sets || '?'} x {exercise.reps || '?'}</Badge>}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {[load && `Load: ${load.load_value} ${load.load_unit}`, exercise.target_rpe && `RPE: ${exercise.target_rpe}`, exercise.rest && `Rest: ${exercise.rest}`, exercise.tempo && `Tempo: ${exercise.tempo}`, clientExerciseNotes(exercise)].filter(Boolean).join(' - ')}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function HistoryRow({ log }) {
  const sets = log.exercises.flatMap((exercise) => exercise.sets);
  const completed = sets.filter((set) => set.status === 'completed').length;
  const hasUnreadCoachFeedback = (log.coach_responses || []).some((response) => !response.read_at);
  return (
    <Link to={`/client/workouts/${log.id}`} className="flex min-h-16 items-center justify-between gap-3 rounded-md border border-border bg-card/60 px-4 py-3 transition-colors hover:bg-card" data-testid="workout-history-row">
      <span className="min-w-0">
        <span className="block truncate font-medium">{log.workout_name}</span>
        <span className="text-xs text-muted-foreground">{fmtDateTime(log.completed_at)} - {completed} sets</span>
        {hasUnreadCoachFeedback && <span className="mt-1 block text-xs font-medium text-primary" data-testid="new-coach-feedback-marker">New coach feedback</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function AssignmentNote({ children }) {
  return <div className="mt-2 flex gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2"><StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><p className="text-xs">{children}</p></div>;
}

function exerciseName(exercise) { return exercise.library_exercise?.name || exercise.custom_name || exercise.name || 'Exercise'; }
function exerciseVideo(exercise) { return exercise.video_url || exercise.library_exercise?.video_url || ''; }
function clientExerciseNotes(exercise) { return exercise.client_notes || exercise.notes || ''; }
