import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CircleSlash2, Clock3, MessageSquare } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { fmtDateTime } from '@/lib/format';
import { LoadingScreen, LoadErrorState, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function WorkoutLogDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [log, setLog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const isClient = user.role === 'client';

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/workout-logs/${id}`);
      setLog(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load workout'));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  if (!log && loadError) return <LoadErrorState message={loadError} scope="workout-detail" onRetry={load} />;
  if (!log) return <LoadingScreen />;

  const completed = log.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'completed').length;
  const skipped = log.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'skipped').length;

  return (
    <div>
      <button type="button" onClick={() => navigate(-1)} className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <PageHeader title={log.workout_name} subtitle={log.completed_at ? `Completed ${fmtDateTime(log.completed_at)}` : `Started ${fmtDateTime(log.started_at)}`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant="outline" className="bg-success/10 text-success-foreground"><Check className="mr-1 h-3.5 w-3.5" /> {completed} completed</Badge>
        {skipped > 0 && <Badge variant="outline"><CircleSlash2 className="mr-1 h-3.5 w-3.5" /> {skipped} skipped</Badge>}
        <Badge variant="outline"><Clock3 className="mr-1 h-3.5 w-3.5" /> {log.status}</Badge>
      </div>
      <div className="space-y-3">
        {log.exercises.map((exercise) => (
          <Card key={exercise.id}>
            <CardHeader className="pb-2"><CardTitle className="font-display text-lg">{exercise.exercise_name}</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {exercise.prescribed_reps && <span>Reps {exercise.prescribed_reps}</span>}
                {exercise.prescribed_rpe && <span>RPE {exercise.prescribed_rpe}</span>}
                {exercise.prescribed_rest && <span>Rest {exercise.prescribed_rest}</span>}
                {exercise.prescribed_tempo && <span>Tempo {exercise.prescribed_tempo}</span>}
              </div>
              <div className="divide-y divide-border/70">
                {exercise.sets.map((set) => (
                  <div key={set.id} className="grid min-h-11 grid-cols-[2.5rem_1fr_auto] items-center gap-2 py-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{set.set_number}</span>
                    <span>{set.actual_load_value === null ? 'No weight logged' : `${set.actual_load_value} ${set.actual_load_unit}`}</span>
                    <Badge variant={set.status === 'completed' ? 'default' : 'outline'}>{set.status}</Badge>
                  </div>
                ))}
              </div>
              {exercise.client_notes && <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm">{exercise.client_notes}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      {(log.feedback || log.notes) && (
        <Card className="mt-4"><CardContent className="space-y-3 p-4">
          {log.feedback && <div><p className="text-xs font-medium uppercase text-muted-foreground">Feedback</p><p className="mt-1 text-sm">{log.feedback}</p></div>}
          {log.notes && <div><p className="text-xs font-medium uppercase text-muted-foreground">Workout notes</p><p className="mt-1 text-sm">{log.notes}</p></div>}
        </CardContent></Card>
      )}
      {!isClient && log.client && (
        <Button asChild className="mb-16 mt-5 w-full sm:mb-0 sm:w-auto">
          <Link to={`/coach/messages/${log.client.id}`}><MessageSquare className="mr-2 h-4 w-4" /> Message client</Link>
        </Button>
      )}
    </div>
  );
}
