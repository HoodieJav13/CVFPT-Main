import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';

const Context = createContext(null);
const snapshot = (form) => JSON.stringify(form, (key, value) => key === '_uid' ? undefined : value);
const WARNING = 'You have unsaved workout changes. Discard them and continue?';
export function UnsavedChangesProvider({ children }) {
  const entries = useRef(new Map());
  const register = useCallback((id, dirty, onDiscard, warning) => { entries.current.set(id, { dirty, onDiscard, warning }); return () => entries.current.delete(id); }, []);
  const confirmDiscard = useCallback(() => {
    const dirty = [...entries.current.values()].filter((entry) => entry.dirty);
    if (!dirty.length) return true;
    // One dirty form names itself; several, or a form without its own text, keep the original wording.
    const warning = dirty.length === 1 && dirty[0].warning ? dirty[0].warning : WARNING;
    if (!window.confirm(warning)) return false;
    dirty.forEach((entry) => entry.onDiscard?.());
    return true;
  }, []);
  const blocker = useBlocker(() => [...entries.current.values()].some((entry) => entry.dirty));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (confirmDiscard()) blocker.proceed();
    else blocker.reset();
  }, [blocker, confirmDiscard]);
  useEffect(() => {
    const beforeUnload = (event) => {
      if (![...entries.current.values()].some((entry) => entry.dirty)) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  return <Context.Provider value={{ register, confirmDiscard }}>{children}</Context.Provider>;
}
export function useDiscardChanges() { return useContext(Context).confirmDiscard; }
export function useUnsavedChanges(dirty, onDiscard, warning) {
  const id = useId();
  const { register } = useContext(Context);
  const discardRef = useRef(onDiscard);
  discardRef.current = onDiscard;
  useLayoutEffect(() => register(id, dirty, () => discardRef.current?.(), warning), [id, dirty, register, warning]);
}
export function useFormChanges(form, identity, active = true, onDiscard) {
  const [baseline, setBaseline] = useState(() => snapshot(form));
  const lastIdentity = useRef(identity);
  // Reset synchronously when selecting another editor; never treat loaded data as an edit.
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    setBaseline(snapshot(form));
  }
  const dirty = active && baseline !== snapshot(form);
  useUnsavedChanges(dirty, onDiscard);
  return { dirty, markSaved: (saved = form) => setBaseline(snapshot(saved)),
    confirmDiscard: () => {
      if (!dirty) return true;
      if (!window.confirm(WARNING)) return false;
      onDiscard?.();
      return true;
    } };
}
