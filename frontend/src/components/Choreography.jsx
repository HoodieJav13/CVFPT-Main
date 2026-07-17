import { Children, useEffect, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { MOTION_EASINGS, PAGE_ENTRANCE_MOTION, msToSeconds } from '@/lib/motion';
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

export function DashboardChoreography({ pageKey, children }) {
  const intensity = useVisualIntensity();
  const reducedMotion = useReducedMotion();
  const [shouldAnimate] = useState(() => !hasCompletedPageEntrance(pageKey));
  const recipe = PAGE_ENTRANCE_MOTION[intensity];
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
              duration: msToSeconds(recipe.durationMs),
              delay: animate
                ? Math.min(index * msToSeconds(recipe.staggerMs), msToSeconds(PAGE_ENTRANCE_MOTION.maxStaggerDelayMs))
                : 0,
              ease: MOTION_EASINGS.expressiveOut,
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
  const recipe = PAGE_ENTRANCE_MOTION[intensity];

  return (
    <m.div
      className="relative w-full max-w-sm"
      initial={reducedMotion ? false : { opacity: 0, y: recipe.distance, scale: recipe.scale }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: msToSeconds(recipe.durationMs + PAGE_ENTRANCE_MOTION.authDurationOffsetMs),
        ease: MOTION_EASINGS.expressiveOut,
      }}
    >
      {children}
    </m.div>
  );
}
