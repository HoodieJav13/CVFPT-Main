import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, previewReady, tokenStore } from '@/lib/api';
import { isPreviewMode } from '@/lib/previewFlag';
import { setCoachAnalyticsRole } from '@/lib/coachAnalytics';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const analyticsActive = useRef(false);
  const authEpoch = useRef(0);
  const updateUser = useCallback((nextUser, epoch = authEpoch.current) => {
    // Only the role boolean enters analytics, before children can emit events.
    // A late auth response must not restore a logged-out/replaced visit or user.
    if (!analyticsActive.current || epoch !== authEpoch.current) return false;
    setCoachAnalyticsRole(nextUser?.role);
    setUser(nextUser);
    return true;
  }, []);

  const loadMe = useCallback(async (attempt = 0, epoch = ++authEpoch.current) => {
    if (!analyticsActive.current || epoch !== authEpoch.current) return;
    if (isPreviewMode) {
      const preview = await previewReady;
      if (updateUser(preview.getPreviewUser(), epoch)) setLoading(false);
      return;
    }
    if (!tokenStore.access) {
      if (updateUser(null, epoch)) setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      if (updateUser({ role: data.role, email: data.email, profile: data.profile }, epoch)) setLoading(false);
    } catch (error) {
      if (!analyticsActive.current || epoch !== authEpoch.current) return;
      // Only a real server verdict (401/403/…) clears the session. A network
      // failure or backend cold start keeps the stored tokens and retries —
      // previously any blip dumped a still-authenticated user at /login.
      if (error?.response || attempt >= 3) {
        updateUser(null, epoch);
        setLoading(false);
      } else {
        window.setTimeout(() => loadMe(attempt + 1, epoch), 1500 * (attempt + 1));
      }
    }
  }, [updateUser]);

  useEffect(() => {
    analyticsActive.current = true;
    loadMe();
    if (!isPreviewMode) return () => { analyticsActive.current = false; authEpoch.current += 1; setCoachAnalyticsRole(null); };
    let cancelled = false;
    let unsubscribe = () => {};
    previewReady.then((preview) => {
      if (!cancelled && preview) unsubscribe = preview.onPreviewChange(() => updateUser(preview.getPreviewUser(), ++authEpoch.current));
    });
    return () => { cancelled = true; unsubscribe(); analyticsActive.current = false; authEpoch.current += 1; setCoachAnalyticsRole(null); };
  }, [loadMe, updateUser]);

  const login = useCallback(async (email, password) => {
    const epoch = ++authEpoch.current;
    setCoachAnalyticsRole(null);
    if (isPreviewMode) {
      const preview = await previewReady;
      const previewUser = preview.getPreviewUser();
      if (updateUser(previewUser, epoch)) setLoading(false);
      return previewUser;
    }
    const { data } = await api.post('/auth/login', { email, password }).catch(error => {
      if (analyticsActive.current && epoch === authEpoch.current) setLoading(false);
      throw error;
    });
    if (analyticsActive.current && epoch === authEpoch.current) {
      tokenStore.set(data.access_token, data.refresh_token);
      if (updateUser({ role: data.role, email, profile: data.profile }, epoch)) setLoading(false);
    }
    return data;
  }, [updateUser]);

  const signup = useCallback(async (email, password) => {
    const epoch = ++authEpoch.current;
    setCoachAnalyticsRole(null);
    if (isPreviewMode) {
      const preview = await previewReady;
      const previewUser = preview.getPreviewUser();
      if (updateUser(previewUser, epoch)) setLoading(false);
      return previewUser;
    }
    const { data } = await api.post('/auth/signup', { email, password }).catch(error => {
      if (analyticsActive.current && epoch === authEpoch.current) setLoading(false);
      throw error;
    });
    if (analyticsActive.current && epoch === authEpoch.current) {
      tokenStore.set(data.access_token, data.refresh_token);
      if (updateUser({ role: data.role, email, profile: data.profile }, epoch)) setLoading(false);
    }
    return data;
  }, [updateUser]);

  const logout = useCallback(() => {
    const epoch = ++authEpoch.current;
    setCoachAnalyticsRole(null);
    if (isPreviewMode) {
      previewReady.then((preview) => updateUser(preview.getPreviewUser(), epoch));
      return;
    }
    tokenStore.clear();
    updateUser(null, epoch);
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
