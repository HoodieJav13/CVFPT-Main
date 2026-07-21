import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [unreadInitialized, setUnreadInitialized] = useState(false);
  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const isClient = user?.role === 'client';
  const notificationIdentity = `${user?.role || 'signed-out'}:${user?.profile?.id || user?.email || 'anonymous'}`;

  const refresh = useCallback(async () => {
    if ((!isCoach && !isClient) || document.visibilityState === 'hidden') return;
    try {
      const { data } = await api.get(isCoach ? '/notifications/unread-count' : '/workout-logs/coach-feedback/unread-count');
      setUnread(data.unread || 0);
      setUnreadInitialized(true);
    } catch {
      // Page-level retry states handle API failures; the shell badge stays quiet.
    }
  }, [isClient, isCoach]);

  useEffect(() => {
    setUnreadInitialized(false);
    if (!isCoach && !isClient) {
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
  }, [isClient, isCoach, notificationIdentity, refresh]);

  const value = useMemo(
    () => ({ unread, unreadInitialized, setUnread, refresh }),
    [unread, unreadInitialized, refresh],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext) || {
    unread: 0,
    unreadInitialized: false,
    setUnread: () => {},
    refresh: () => {},
  };
}
