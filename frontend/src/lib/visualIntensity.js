import { useEffect, useState } from 'react';

export const VISUAL_INTENSITIES = ['restrained', 'cinematic', 'spectacle'];
export const DEFAULT_VISUAL_INTENSITY = 'cinematic';

const STORAGE_KEY = 'cvfpt_visual_intensity';
const CHANGE_EVENT = 'cvfpt:visual-intensity-change';

function normalizeVisualIntensity(value) {
  return VISUAL_INTENSITIES.includes(value) ? value : DEFAULT_VISUAL_INTENSITY;
}

export function getVisualIntensity() {
  if (typeof window === 'undefined') return DEFAULT_VISUAL_INTENSITY;
  return normalizeVisualIntensity(window.localStorage.getItem(STORAGE_KEY));
}

export function setVisualIntensity(value) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeVisualIntensity(value);
  window.localStorage.setItem(STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));
}

export function useVisualIntensity(override) {
  const [intensity, setIntensity] = useState(() => normalizeVisualIntensity(override || getVisualIntensity()));

  useEffect(() => {
    if (override) {
      setIntensity(normalizeVisualIntensity(override));
      return undefined;
    }
    const onChange = (event) => setIntensity(normalizeVisualIntensity(event.detail));
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [override]);

  return intensity;
}

