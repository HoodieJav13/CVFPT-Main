import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, previewReady, tokenStore } from '@/lib/api';
import { isPreviewMode } from '@/lib/previewFlag';
import { setCoachAnalyticsRole } from '@/lib/coachAnalytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const analyticsActive = useRef(false);
  const updateUser = useCallback((nextUser) => {
    // Only the role boolean enters analytics, before children can emit events.
    // A late response after provider unmount must not reopen collection.
    if (analyticsActive.current) setCoachAnalyticsRole(nextUser?.role);
    setUser(nextUser);
  }, []);

  const loadMe = useCallback(async (attempt = 0) => {
    if (isPreviewMode) {
      const preview = await previewReady;
      updateUser(preview.getPreviewUser());
      setLoading(false);
      return;
    }
    if (!tokenStore.access) {
      updateUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      updateUser({ role: data.role, email: data.email, profile: data.profile });
      setLoading(false);
    } catch (error) {
      // Only a real server verdict (401/403/…) clears the session. A network
      // failure or backend cold start keeps the stored tokens and retries —
      // previously any blip dumped a still-authenticated user at /login.
      if (error?.response || attempt >= 3) {
        updateUser(null);
        setLoading(false);
      } else {
        window.setTimeout(() => loadMe(attempt + 1), 1500 * (attempt + 1));
      }
    }
  }, [updateUser]);

  useEffect(() => {
    analyticsActive.current = true;
    loadMe();
    if (!isPreviewMode) return () => { analyticsActive.current = false; setCoachAnalyticsRole(null); };
    let cancelled = false;
    let unsubscribe = () => {};
    previewReady.then((preview) => {
      if (!cancelled && preview) unsubscribe = preview.onPreviewChange(() => updateUser(preview.getPreviewUser()));
    });
    return () => { cancelled = true; unsubscribe(); analyticsActive.current = false; setCoachAnalyticsRole(null); };
  }, [loadMe, updateUser]);

  const login = useCallback(async (email, password) => {
    setCoachAnalyticsRole(null);
    if (isPreviewMode) {
      const preview = await previewReady;
      const previewUser = preview.getPreviewUser();
      updateUser(previewUser);
      return previewUser;
    }
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.access_token, data.refresh_token);
    updateUser({ role: data.role, email, profile: data.profile });
    return data;
  }, [updateUser]);

  const signup = useCallback(async (email, password) => {
    setCoachAnalyticsRole(null);
    if (isPreviewMode) {
      const preview = await previewReady;
      const previewUser = preview.getPreviewUser();
      updateUser(previewUser);
      return previewUser;
    }
    const { data } = await api.post('/auth/signup', { email, password });
    tokenStore.set(data.access_token, data.refresh_token);
    updateUser({ role: data.role, email, profile: data.profile });
    return data;
  }, [updateUser]);

  const logout = useCallback(() => {
    setCoachAnalyticsRole(null);
    if (isPreviewMode) {
      previewReady.then((preview) => updateUser(preview.getPreviewUser()));
      return;
    }
    tokenStore.clear();
    updateUser(null);
    window.location.href = '/login';
  }, [updateUser]);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, reload: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
