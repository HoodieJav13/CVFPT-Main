// Sunrise (light) / sunset (dark) theme. Follows the device by default;
// people can pin either one from the account menu (round-2 decision,
// 2026-09-29). index.html applies the same rule before first paint so the
// page never flashes the wrong theme.
import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'cvf_theme';
export const THEME_CHOICES = ['system', 'light', 'dark'];
const FRAME = { light: '#F6F4EF', dark: '#161211' };

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function readThemeChoice() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEME_CHOICES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(choice) {
  if (choice === 'light' || choice === 'dark') return choice;
  return media()?.matches ? 'dark' : 'light';
}

export function applyTheme(choice) {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', FRAME[resolved]);
  return resolved;
}

/** Current resolved theme, kept in sync with the device and the account-menu choice. */
export function useTheme() {
  const [choice, setChoiceState] = useState(readThemeChoice);
  const [resolved, setResolved] = useState(() => resolveTheme(readThemeChoice()));

  useEffect(() => {
    setResolved(applyTheme(choice));
    if (choice !== 'system') return undefined;
    const mq = media();
    if (!mq) return undefined;
    const onChange = () => setResolved(applyTheme('system'));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [choice]);

  useEffect(() => {
    // Another tab (or the account menu) changed the choice.
    const onStorage = (event) => { if (event.key === THEME_KEY) setChoiceState(readThemeChoice()); };
    const onLocal = () => setChoiceState(readThemeChoice());
    window.addEventListener('storage', onStorage);
    window.addEventListener('cvf-theme-change', onLocal);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('cvf-theme-change', onLocal); };
  }, []);

  const setChoice = useCallback((next) => {
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: still apply for this visit */ }
    setChoiceState(next);
    window.dispatchEvent(new Event('cvf-theme-change'));
  }, []);

  return { choice, resolved, setChoice };
}
