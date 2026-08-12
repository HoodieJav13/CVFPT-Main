import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { domAnimation, LazyMotion } from 'framer-motion';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { Toaster } from '@/components/ui/sonner';
import { LoadingScreen } from '@/components/common';
import AppShell from '@/components/layout/AppShell';
import { isPreviewMode } from '@/lib/previewFlag';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import ClientHome from '@/pages/client/Home';
import ClientSessions from '@/pages/client/Sessions';
import ClientSessionDetail from '@/pages/client/SessionDetail';
import ClientProgress from '@/pages/client/Progress';
import ClientPrograms from '@/pages/client/Programs';
import ClientResources from '@/pages/client/Resources';
import ClientMessages from '@/pages/client/Messages';
import ClientWaiver from '@/pages/client/Waiver';
import WorkoutLogDetail from '@/pages/WorkoutLogDetail';
import WorkoutTracker from '@/pages/client/WorkoutTracker';
import '@/App.css';

// The coach/admin tree (including the large Training Builder) loads on
// demand — phone-first clients no longer download it. Client pages stay
// eager: they are the perf-sensitive persona and avoid chunk waterfalls
// on gym Wi-Fi.
const CoachDashboard = lazy(() => import('@/pages/coach/Dashboard'));
const Clients = lazy(() => import('@/pages/coach/Clients'));
const ClientDetail = lazy(() => import('@/pages/coach/ClientDetail'));
const CoachSessions = lazy(() => import('@/pages/coach/Sessions'));
const CoachSessionDetail = lazy(() => import('@/pages/coach/SessionDetail'));
const CoachCalendar = lazy(() => import('@/pages/coach/Calendar'));
const Programs = lazy(() => import('@/pages/coach/Programs'));
const CoachResources = lazy(() => import('@/pages/coach/Resources'));
const CoachMessages = lazy(() => import('@/pages/coach/Messages'));
const CoachNotifications = lazy(() => import('@/pages/coach/Notifications'));
const CoachAnalytics = lazy(() => import('@/pages/coach/Analytics'));
const AdminPage = lazy(() => import('@/pages/admin/Admin'));
// Dev/preview only: never even fetched in production builds.
const PreviewToolbar = isPreviewMode ? lazy(() => import('@/components/PreviewToolbar')) : () => null;
// Agentation click-to-annotate overlay (docs/design-reference-links.md):
// dev and preview/demo builds only, and never under test automation —
// Playwright sets navigator.webdriver, and the toolbar would otherwise
// add stray interactive elements to every e2e snapshot.
const annotationEnabled = (import.meta.env.DEV || isPreviewMode)
  && typeof navigator !== 'undefined' && !navigator.webdriver;
const AnnotationOverlay = annotationEnabled
  ? lazy(() => import('agentation').then((m) => ({ default: m.Agentation })))
  : () => null;

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'client' ? '/client' : '/coach'} replace />;
}

function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'client' ? '/client' : '/coach'} replace />;
  }
  return children;
}

export default function App() {
  return (
    <LazyMotion features={domAnimation} strict>
      <AuthProvider>
        <NotificationsProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<RoleRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/coach"
            element={
              <Protected roles={['coach', 'admin']}>
                <AppShell />
              </Protected>
            }
          >
            <Route index element={<CoachDashboard />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="sessions" element={<CoachSessions />} />
            <Route path="sessions/:id" element={<CoachSessionDetail />} />
            <Route path="calendar" element={<CoachCalendar />} />
            <Route path="analytics" element={<CoachAnalytics />} />
            <Route path="programs" element={<Programs />} />
            <Route path="resources" element={<CoachResources />} />
            <Route path="messages" element={<CoachMessages />} />
            <Route path="messages/:clientId" element={<CoachMessages />} />
            <Route path="notifications" element={<CoachNotifications />} />
            <Route path="workouts/:id" element={<WorkoutLogDetail />} />
            <Route path="workouts/:id/track" element={<WorkoutTracker />} />
          </Route>

          <Route
            path="/client"
            element={
              <Protected roles={['client']}>
                <AppShell />
              </Protected>
            }
          >
            <Route index element={<ClientHome />} />
            <Route path="sessions" element={<ClientSessions />} />
            <Route path="sessions/:id" element={<ClientSessionDetail />} />
            <Route path="progress" element={<ClientProgress />} />
            <Route path="programs" element={<ClientPrograms />} />
            <Route path="resources" element={<ClientResources />} />
            <Route path="messages" element={<ClientMessages />} />
            <Route path="waiver" element={<ClientWaiver />} />
            <Route path="packages" element={<Navigate to="/client" replace />} />
            <Route path="workouts/:id" element={<WorkoutLogDetail />} />
            <Route path="workouts/:id/track" element={<WorkoutTracker />} />
          </Route>

          <Route
            path="/admin"
            element={
              <Protected roles={['admin']}>
                <AppShell />
              </Protected>
            }
          >
            <Route index element={<AdminPage />} />
          </Route>

            <Route path="*" element={<RoleRedirect />} />
          </Routes>
          <PreviewToolbar />
          <AnnotationOverlay />
          </Suspense>
        </BrowserRouter>
        </NotificationsProvider>
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </LazyMotion>
  );
}
