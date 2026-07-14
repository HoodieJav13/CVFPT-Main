import { Children, useEffect, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { useVisualIntensity } from '@/lib/visualIntensity';

const PAGE_ENTRANCE_STORAGE_KEY = 'cvfpt.completedPageEntrances.v1';

function readCompletedPageEntrances() {
  try {
    const stored = JSON.parse(globalThis.sessionStorage?.getItem(PAGE_ENTRANCE_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

function hasCompletedPageEntrance(pageKey) {
  return readCompletedPageEntrances().has(pageKey);
}

function markPageEntranceCompleted(pageKey) {
  try {
    const completed = readCompletedPageEntrances();
    completed.add(pageKey);
    globalThis.sessionStorage?.setItem(PAGE_ENTRANCE_STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

const MOTION_RECIPES = {
  restrained: { duration: 0.34, distance: 5, stagger: 0.045, scale: 1 },
  cinematic: { duration: 0.52, distance: 11, stagger: 0.075, scale: 0.995 },
  spectacle: { duration: 0.68, distance: 18, stagger: 0.11, scale: 0.985 },
};

export function DashboardChoreography({ pageKey, children }) {
  const intensity = useVisualIntensity();
  const reducedMotion = useReducedMotion();
  const [shouldAnimate] = useState(() => !hasCompletedPageEntrance(pageKey));
  const recipe = MOTION_RECIPES[intensity];
  const animate = shouldAnimate && !reducedMotion;

  useEffect(() => {
    markPageEntranceCompleted(pageKey);
  }, [pageKey]);

  return (
    <div data-motion-intensity={intensity} data-entry-motion={animate ? 'enabled' : 'skipped'}>
      {Children.map(children, (child, index) => {
        if (!child) return child;
        return (
          <m.div
            className="flow-root"
            initial={animate ? { opacity: 0, y: recipe.distance, scale: recipe.scale } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: recipe.duration,
              delay: animate ? Math.min(index * recipe.stagger, 0.55) : 0,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {child}
          </m.div>
        );
      })}
    </div>
  );
}

export function AuthEntrance({ children }) {
  const intensity = useVisualIntensity();
  const reducedMotion = useReducedMotion();
  const recipe = MOTION_RECIPES[intensity];

  return (
    <m.div
      className="relative w-full max-w-sm"
      initial={reducedMotion ? false : { opacity: 0, y: recipe.distance, scale: recipe.scale }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: recipe.duration + 0.12, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </m.div>
  );
}
