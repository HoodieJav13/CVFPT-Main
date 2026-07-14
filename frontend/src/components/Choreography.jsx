import { Children, useEffect, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { useVisualIntensity } from '@/lib/visualIntensity';

const completedPageEntrances = new Set();

const MOTION_RECIPES = {
  restrained: { duration: 0.34, distance: 5, stagger: 0.045, scale: 1 },
  cinematic: { duration: 0.52, distance: 11, stagger: 0.075, scale: 0.995 },
  spectacle: { duration: 0.68, distance: 18, stagger: 0.11, scale: 0.985 },
};

export function DashboardChoreography({ pageKey, children }) {
  const intensity = useVisualIntensity();
  const reducedMotion = useReducedMotion();
  const [shouldAnimate] = useState(() => !completedPageEntrances.has(pageKey));
  const recipe = MOTION_RECIPES[intensity];
  const animate = shouldAnimate && !reducedMotion;

  useEffect(() => {
    completedPageEntrances.add(pageKey);
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
