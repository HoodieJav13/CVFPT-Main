import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';

const Context = createContext(null);
const WARNING = 'You have unsaved workout changes. Discard them and continue?';
export function UnsavedChangesProvider({ children }) {
  const entries = useRef(new Map());
  const register = useCallback((id, dirty) => { entries.current.set(id, dirty); return () => entries.current.delete(id); }, []);
  const confirmDiscard = useCallback(() => ![...entries.current.values()].some(Boolean) || window.confirm(WARNING), []);
  const blocker = useBlocker(() => [...entries.current.values()].some(Boolean));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (confirmDiscard()) blocker.proceed();
    else blocker.reset();
  }, [blocker, confirmDiscard]);
  useEffect(() => {
    const beforeUnload = (event) => {
      if (![...entries.current.values()].some(Boolean)) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  return <Context.Provider value={{ register, confirmDiscard }}>{children}</Context.Provider>;
}
export function useDiscardChanges() { return useContext(Context).confirmDiscard; }
export function useUnsavedChanges(dirty) {
  const id = useId();
  const { register } = useContext(Context);
  useLayoutEffect(() => register(id, dirty), [id, dirty, register]);
}
export function useFormChanges(form, identity, active = true) {
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const lastIdentity = useRef(identity);
  // Reset synchronously when selecting another editor; never treat loaded data as an edit.
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    setBaseline(JSON.stringify(form));
  }
  const dirty = active && baseline !== JSON.stringify(form);
  useUnsavedChanges(dirty);
  return { dirty, markSaved: (saved = form) => setBaseline(JSON.stringify(saved)),
    confirmDiscard: () => !dirty || window.confirm(WARNING) };
}
