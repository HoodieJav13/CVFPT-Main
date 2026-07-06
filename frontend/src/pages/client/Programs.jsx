import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Dumbbell, Play, StickyNote } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientPrograms() {
  const [assignments, setAssignments] = useState(null);

  useEffect(() => {
    api.get('/programs/client/assigned')
      .then(({ data }) => setAssignments(Array.isArray(data) ? { programs: data, workouts: [] } : data))
      .catch((e) => toast.error(errMsg(e, 'Failed to load programs')));
  }, []);

  if (!assignments) return <LoadingScreen />;

  const programAssignments = assignments.programs || [];
  const workoutAssignments = assignments.workouts || [];
  const activeWorkouts = workoutAssignments.filter((a) => a.assignment_mode === 'active');
  const datedWorkouts = workoutAssignments
    .filter((a) => a.assignment_mode === 'dated')
    .sort((a, b) => String(a.assigned_for || '').localeCompare(String(b.assigned_for || '')));
  const isEmpty = programAssignments.length === 0 && workoutAssignments.length === 0;

  return (
    <div>
      <PageHeader title="My programs" subtitle="Structured workouts assigned by your coach" />
      {isEmpty && (
        <EmptyState icon={Dumbbell} title="No programs yet" subtitle="Your coach will assign workout programs here." testId="client-programs-empty" />
      )}
      <div className="space-y-5">
        {programAssignments.map((assignment) => (
          <ProgramAssignmentCard key={assignment.id} assignment={assignment} />
        ))}

        {(activeWorkouts.length > 0 || datedWorkouts.length > 0) && (
          <section className="space-y-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">Standalone workouts</h2>
              <p className="text-sm text-muted-foreground">Active templates and one-off dated workouts.</p>
            </div>
            {activeWorkouts.map((assignment) => (
              <WorkoutAssignmentCard key={assignment.id} assignment={assignment} />
            ))}
            {datedWorkouts.map((assignment) => (
              <WorkoutAssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function ProgramAssignmentCard({ assignment }) {
  const program = assignment.program || {};
  return (
    <Card data-testid="client-program-card">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg font-display">{program.name}</CardTitle>
            {program.description && <p className="text-sm text-muted-foreground mt-1">{program.description}</p>}
          </div>
          <Badge variant="outline" className="w-fit">{program.frequency_days || program.days?.length || 0} days/week</Badge>
        </div>
        {assignment.notes && <AssignmentNote>{assignment.notes}</AssignmentNote>}
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {(program.days || []).map((day) => (
          <WorkoutDay key={day.id || day.day_number} dayNumber={day.day_number} workout={day.workout} notes={day.notes} />
        ))}
      </CardContent>
    </Card>
  );
}

function WorkoutAssignmentCard({ assignment }) {
  const workout = assignment.workout || {};
  const label = assignment.assignment_mode === 'dated'
    ? `Assigned for ${assignment.assigned_for ? fmtDate(assignment.assigned_for) : 'a date'}`
    : 'Ongoing workout template';

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-display font-semibold">{workout.name}</p>
            {(workout.goal || workout.description) && <p className="text-sm text-muted-foreground mt-1">{workout.goal || workout.description}</p>}
          </div>
          <Badge variant="outline" className="w-fit">
            <CalendarDays className="h-3.5 w-3.5 mr-1" /> {label}
          </Badge>
        </div>
        {assignment.notes && <AssignmentNote>{assignment.notes}</AssignmentNote>}
        <ExerciseList exercises={workout.exercises || []} />
      </CardContent>
    </Card>
  );
}

function WorkoutDay({ dayNumber, workout, notes }) {
  return (
    <section className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary text-xs font-display font-semibold tabular-nums shrink-0">
          {dayNumber}
        </span>
        <p className="font-medium">{workout?.name || 'Workout day'}</p>
        {workout?.goal && <Badge variant="outline" className="w-fit text-muted-foreground">{workout.goal}</Badge>}
      </div>
      {notes && <p className="text-xs text-muted-foreground mt-2">{notes}</p>}
      <ExerciseList exercises={workout?.exercises || []} />
    </section>
  );
}

function ExerciseList({ exercises }) {
  if (exercises.length === 0) return <p className="text-sm text-muted-foreground mt-3">No exercises added yet.</p>;
  return (
    <div className="divide-y divide-border/70 mt-2">
      {exercises.map((exercise, i) => (
        <div key={exercise.id || `${exerciseName(exercise)}-${i}`} className="py-2.5" data-testid="client-exercise-row">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm">
              <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>{exerciseName(exercise)}
            </p>
            <span className="flex items-center gap-2 shrink-0">
              {exerciseVideo(exercise) && (
                <a
                  href={exerciseVideo(exercise)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary font-medium hover:bg-primary/15"
                  data-testid="program-video-link"
                >
                  <Play className="h-3 w-3" /> Video
                </a>
              )}
              {(exercise.sets || exercise.reps) && (
                <Badge variant="outline" className="bg-secondary text-foreground/90 tabular-nums">
                  {exercise.sets || '?'} x {exercise.reps || '?'}
                </Badge>
              )}
            </span>
          </div>
          {[exercise.rest && `Rest: ${exercise.rest}`, exercise.tempo && `Tempo: ${exercise.tempo}`, exercise.notes].filter(Boolean).length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {[exercise.rest && `Rest: ${exercise.rest}`, exercise.tempo && `Tempo: ${exercise.tempo}`, exercise.notes].filter(Boolean).join(' - ')}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function AssignmentNote({ children }) {
  return (
    <div className="flex gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 mt-2">
      <StickyNote className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
      <p className="text-xs">{children}</p>
    </div>
  );
}

function exerciseName(exercise) {
  return exercise.library_exercise?.name || exercise.custom_name || exercise.name || 'Exercise';
}

function exerciseVideo(exercise) {
  return exercise.video_url || exercise.library_exercise?.video_url || '';
}
