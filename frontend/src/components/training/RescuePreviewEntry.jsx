import { lazy, Suspense } from 'react';
import { isPreviewMode } from '@/lib/previewFlag';
import { useAuth } from '@/context/AuthContext';
const Rescue = lazy(() => import('./WorkoutRescue'));
export default function RescuePreviewEntry({ programId, dayId, dayNumber = 1, ...props }) {
  const { user, sessionEpoch } = useAuth();
  if (!programId || !dayId || dayNumber !== 1) return null;
  if (isPreviewMode && (programId !== 'program_foundation' || dayId !== 'day_foundation_1')) return null;
  if (!['coach', 'admin', 'client'].includes(user?.role)) return null;
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading demonstration…</p>}>
    <Rescue key={`${sessionEpoch}-${user.role}-${user.profile?.id}`} role={user.role} programId={programId} dayId={dayId} {...props} />
  </Suspense>;
}
