import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, previewReady, tokenStore } from '@/lib/api';
import { isPreviewMode } from '@/lib/previewFlag';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (attempt = 0) => {
    if (isPreviewMode) {
      const preview = await previewReady;
      setUser(preview.getPreviewUser());
      setLoading(false);
      return;
    }
    if (!tokenStore.access) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser({ role: data.role, email: data.email, profile: data.profile });
      setLoading(false);
    } catch (error) {
      // Only a real server verdict (401/403/…) clears the session. A network
      // failure or backend cold start keeps the stored tokens and retries —
      // previously any blip dumped a still-authenticated user at /login.
      if (error?.response || attempt >= 3) {
        setUser(null);
        setLoading(false);
      } else {
        window.setTimeout(() => loadMe(attempt + 1), 1500 * (attempt + 1));
      }
    }
  }, []);

  useEffect(() => {
    loadMe();
    if (!isPreviewMode) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};
    previewReady.then((preview) => {
      if (!cancelled && preview) unsubscribe = preview.onPreviewChange(() => setUser(preview.getPreviewUser()));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [loadMe]);

  const login = useCallback(async (email, password) => {
    if (isPreviewMode) {
      const preview = await previewReady;
      const previewUser = preview.getPreviewUser();
      setUser(previewUser);
      return previewUser;
    }
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.access_token, data.refresh_token);
    setUser({ role: data.role, email, profile: data.profile });
    return data;
  }, []);

  const signup = useCallback(async (email, password) => {
    if (isPreviewMode) {
      const preview = await previewReady;
      const previewUser = preview.getPreviewUser();
      setUser(previewUser);
      return previewUser;
    }
    const { data } = await api.post('/auth/signup', { email, password });
    tokenStore.set(data.access_token, data.refresh_token);
    setUser({ role: data.role, email, profile: data.profile });
    return data;
  }, []);

  const logout = useCallback(() => {
    if (isPreviewMode) {
      previewReady.then((preview) => setUser(preview.getPreviewUser()));
      return;
    }
    tokenStore.clear();
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, reload: loadMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
