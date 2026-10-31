import { lazy, Suspense } from 'react';
import { isPreviewMode } from '@/lib/previewFlag';
import { useAuth } from '@/context/AuthContext';
const LocalCueRetry = lazy(() => import('./LocalCueRetry'));

export function CueRetryEntry({ log, exercise }) {
  const { user } = useAuth();
  if (isPreviewMode && log.client_id !== 'client_cue_demo') return null;
  return <Suspense fallback={<p className="py-2 text-xs text-muted-foreground">Loading coaching cue…</p>}>
    <LocalCueRetry key={`${log.id}:${exercise.id}:${user.role}:${user.profile?.id}`} log={log} exercise={exercise} actor={user} localDemo={isPreviewMode} />
  </Suspense>;
}
