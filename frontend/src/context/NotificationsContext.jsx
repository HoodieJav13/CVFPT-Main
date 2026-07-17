import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const isCoach = user?.role === 'coach' || user?.role === 'admin';

  const refresh = useCallback(async () => {
    if (!isCoach || document.visibilityState === 'hidden') return;
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnread(data.unread || 0);
    } catch {
      // Page-level retry states handle API failures; the shell badge stays quiet.
    }
  }, [isCoach]);

  useEffect(() => {
    if (!isCoach) {
      setUnread(0);
      return undefined;
    }
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isCoach, refresh]);

  const value = useMemo(() => ({ unread, setUnread, refresh }), [unread, refresh]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext) || { unread: 0, setUnread: () => {}, refresh: () => {} };
}
