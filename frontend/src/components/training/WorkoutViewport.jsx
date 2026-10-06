import { useLayoutEffect, useRef, useState } from 'react';

// Reserve separate content and control regions using the shell's actual bottom
// clearance. Nothing floats over the entries and the shell/navigation stay intact.
export function WorkoutViewport({ children, controls }) {
  const root = useRef(null);
  const entries = useRef(null);
  const footer = useRef(null);
  const [{ height, viewportHeight, viewportTop }, setViewport] = useState({ height: null, viewportHeight: window.innerHeight, viewportTop: 0 });

  useLayoutEffect(() => {
    const main = root.current.closest('main');
    const measure = () => {
      const top = root.current.getBoundingClientRect().top + window.scrollY;
      const bottom = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const gap = parseFloat(getComputedStyle(root.current).rowGap) || 0;
      const visibleHeight = window.visualViewport?.height || window.innerHeight;
      const visibleTop = window.visualViewport?.offsetTop || 0;
      const available = visibleHeight - top - bottom;
      // A short window or keyboard must not squeeze entries out of existence.
      // Allow room for a full active input and its label/notes, then fall back
      // to document scrolling on shorter windows. Keep every viewport resize.
      setViewport({ height: visibleTop <= top && available >= footer.current.offsetHeight + gap + 120 ? available : null, viewportHeight: visibleHeight, viewportTop: visibleTop });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer.current);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, []);

  useLayoutEffect(() => {
    const keepFocusVisible = () => {
      const active = document.activeElement;
      if (active !== entries.current && root.current.contains(active)) {
        if (height !== null) {
          if (entries.current.contains(active)) active.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          return;
        }
        // scrollIntoView alone ignores fixed navigation and the smaller visual
        // viewport used by a phone keyboard. Position the focused field inside
        // the actual unobstructed area, even across successive fallback resizes.
        const main = root.current.closest('main');
        const headerBottom = main.previousElementSibling?.getBoundingClientRect().bottom || 0;
        const navigation = [...document.querySelectorAll('nav')].find((node) => getComputedStyle(node).position === 'fixed');
        const navRect = navigation?.getBoundingClientRect();
        const visibleBottom = viewportTop + viewportHeight;
        const bottom = (navRect?.height && navRect.top < visibleBottom && navRect.bottom > viewportTop ? navRect.top : visibleBottom) - 8;
        const top = Math.max(viewportTop, headerBottom) + 8;
        const rect = active.getBoundingClientRect();
        const delta = rect.height > bottom - top || rect.top < top ? rect.top - top : Math.max(0, rect.bottom - bottom);
        if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
      }
    };
    keepFocusVisible();
    let frame;
    const onFocus = () => {
      cancelAnimationFrame(frame);
      // Run after native focus scrolling, using the latest active element.
      frame = requestAnimationFrame(keepFocusVisible);
    };
    const element = root.current;
    element.addEventListener('focusin', onFocus);
    return () => { element.removeEventListener('focusin', onFocus); cancelAnimationFrame(frame); };
  }, [height, viewportHeight, viewportTop]);

  return (
    <div ref={root} data-testid="workout-tracker" className="flex min-h-0 flex-col gap-3" style={{ height: height ?? undefined }}>
      <div ref={entries} data-testid="workout-scroll-region" role="region" aria-label="Workout entries" tabIndex={0}
        className={height === null ? 'min-h-0' : 'min-h-0 flex-1 overflow-y-auto'}>
        {children}
      </div>
      <div ref={footer} className="shrink-0">{controls}</div>
    </div>
  );
}
