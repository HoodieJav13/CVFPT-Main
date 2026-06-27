import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dumbbell, Play, StickyNote } from 'lucide-react';
import { toast } from 'sonner';

export default function ClientPrograms() {
  const [assignments, setAssignments] = useState(null);

  useEffect(() => {
    api.get('/programs/client/assigned')
      .then(({ data }) => setAssignments(data))
      .catch((e) => toast.error(errMsg(e, 'Failed to load programs')));
  }, []);

  if (!assignments) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="My programs" subtitle="Workouts assigned by your coach" />
      {assignments.length === 0 && (
        <EmptyState icon={Dumbbell} title="No programs yet" subtitle="Your coach will assign workout programs here." testId="client-programs-empty" />
      )}
      <div className="space-y-4">
        {assignments.map((a) => (
          <Card key={a.id} data-testid="client-program-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-display">{a.program.name}</CardTitle>
              {a.program.description && <p className="text-sm text-muted-foreground">{a.program.description}</p>}
              {a.notes && (
                <div className="flex gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 mt-1">
                  <StickyNote className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs">{a.notes}</p>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2.5">
              {a.program.exercises.map((ex, i) => (
                <div key={ex.id} className="rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="client-exercise-row">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">
                      <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>{ex.name}
                    </p>
                    {(ex.sets || ex.reps) && (
                      <Badge variant="outline" className="bg-secondary text-foreground/90 shrink-0 tabular-nums">
                        {ex.sets || '?'} x {ex.reps || '?'}
                      </Badge>
                    )}
                  </div>
                  {ex.notes && <p className="text-xs text-muted-foreground mt-1">{ex.notes}</p>}
                  {ex.video_url && (
                    <a
                      href={ex.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary font-medium mt-2 hover:underline"
                      data-testid="program-video-link"
                    >
                      <Play className="h-3.5 w-3.5" /> Watch demo video
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
