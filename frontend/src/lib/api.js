import axios from 'axios';

const BACKEND_URL = import.meta.env.REACT_APP_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || '';

export const api = axios.create({ baseURL: `${BACKEND_URL}/api` });

const TOKEN_KEY = 'cvf_access_token';
const REFRESH_KEY = 'cvf_refresh_token';

export const tokenStore = {
  get access() { return localStorage.getItem(TOKEN_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(access, refresh) {
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh') || original?.url?.includes('/auth/signup');
    if (status === 401 && !original?._retried && !isAuthCall && tokenStore.refresh) {
      original._retried = true;
      try {
        if (!refreshPromise) {
          refreshPromise = api.post('/auth/refresh', { refresh_token: tokenStore.refresh }).finally(() => { refreshPromise = null; });
        }
        const { data } = await refreshPromise;
        tokenStore.set(data.access_token, data.refresh_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch (e) {
        tokenStore.clear();
        if (window.location.pathname !== '/login') window.location.href = '/login';
        return Promise.reject(e);
      }
    }
    return Promise.reject(error);
  }
);

export function errMsg(error, fallback = 'Something went wrong') {
  return error?.response?.data?.error || fallback;
}
