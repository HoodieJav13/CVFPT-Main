import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokenStore } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!tokenStore.access) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      setUser({ role: data.role, email: data.email, profile: data.profile });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.access_token, data.refresh_token);
    setUser({ role: data.role, email, profile: data.profile });
    return data;
  }, []);

  const signup = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/signup', { email, password });
    tokenStore.set(data.access_token, data.refresh_token);
    setUser({ role: data.role, email, profile: data.profile });
    return data;
  }, []);

  const logout = useCallback(() => {
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
