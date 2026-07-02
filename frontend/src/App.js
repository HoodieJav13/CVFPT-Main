import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import { LoadingScreen } from '@/components/common';
import AppShell from '@/components/layout/AppShell';
import PreviewToolbar from '@/components/PreviewToolbar';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import CoachDashboard from '@/pages/coach/Dashboard';
import Clients from '@/pages/coach/Clients';
import ClientDetail from '@/pages/coach/ClientDetail';
import CoachSessions from '@/pages/coach/Sessions';
import Programs from '@/pages/coach/Programs';
import CoachMessages from '@/pages/coach/Messages';
import CoachConversation from '@/pages/coach/Conversation';
import ClientHome from '@/pages/client/Home';
import ClientSessions from '@/pages/client/Sessions';
import ClientProgress from '@/pages/client/Progress';
import ClientPrograms from '@/pages/client/Programs';
import ClientMessages from '@/pages/client/Messages';
import ClientWaiver from '@/pages/client/Waiver';
import ClientPackages from '@/pages/client/Packages';
import AdminPage from '@/pages/admin/Admin';
import '@/App.css';

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
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RoleRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

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
            <Route path="programs" element={<Programs />} />
            <Route path="messages" element={<CoachMessages />} />
            <Route path="messages/:clientId" element={<CoachConversation />} />
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
            <Route path="progress" element={<ClientProgress />} />
            <Route path="programs" element={<ClientPrograms />} />
            <Route path="messages" element={<ClientMessages />} />
            <Route path="waiver" element={<ClientWaiver />} />
            <Route path="packages" element={<ClientPackages />} />
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
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}
