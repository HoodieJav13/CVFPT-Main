import { useEffect, useState } from 'react';

export const VISUAL_INTENSITIES = ['restrained', 'cinematic', 'spectacle'];
export const DEFAULT_VISUAL_INTENSITY = 'spectacle';

const STORAGE_KEY = 'cvfpt_visual_intensity';
const CHANGE_EVENT = 'cvfpt:visual-intensity-change';
const RUNTIME_VISUAL_INTENSITY_IS_FIXED = true;

function normalizeVisualIntensity(value) {
  return VISUAL_INTENSITIES.includes(value) ? value : DEFAULT_VISUAL_INTENSITY;
}

function resolveVisualIntensity(value) {
  const normalized = normalizeVisualIntensity(value);
  return RUNTIME_VISUAL_INTENSITY_IS_FIXED ? DEFAULT_VISUAL_INTENSITY : normalized;
}

export function getVisualIntensity() {
  if (typeof window === 'undefined') return DEFAULT_VISUAL_INTENSITY;
  return resolveVisualIntensity(window.localStorage.getItem(STORAGE_KEY));
}

export function setVisualIntensity(value) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeVisualIntensity(value);
  window.localStorage.setItem(STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: resolveVisualIntensity(normalized) }));
}

export function useVisualIntensity(override) {
  const [intensity, setIntensity] = useState(() => resolveVisualIntensity(override || getVisualIntensity()));

  useEffect(() => {
    if (override) {
      setIntensity(resolveVisualIntensity(override));
      return undefined;
    }
    const onChange = (event) => setIntensity(resolveVisualIntensity(event.detail));
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [override]);

  return intensity;
}
