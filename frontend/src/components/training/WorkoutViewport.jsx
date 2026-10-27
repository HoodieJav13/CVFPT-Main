import { useLayoutEffect, useRef, useState } from 'react';

// Reserve separate content and control regions using the shell's actual bottom
// clearance. Nothing floats over the entries and the shell/navigation stay intact.
// An optional `header` (the compact workout outline) sits in its own row above
// the entries; in the short-window document-scroll fallback it stays sticky
// while collapsed (`headerSticky`) and there is room for a whole set row below
// it, and returns to normal flow when expanded or when the window is too short, so
// it never covers entry fields.
export function WorkoutViewport({ children, controls, header = null, headerSticky = true }) {
  const root = useRef(null);
  const entries = useRef(null);
  const footer = useRef(null);
  const headerRef = useRef(null);
  const [headerTop, setHeaderTop] = useState(0);
  const [roomToStick, setRoomToStick] = useState(true);
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
      const shellBottom = main.previousElementSibling?.getBoundingClientRect().bottom || 0;
      setHeaderTop(shellBottom);
      // A short window or keyboard must not squeeze entries out of existence.
      // Allow room for a full active input and its label/notes, then fall back
      // to document scrolling on shorter windows. Keep every viewport resize.
      // With the outline row the entries region must still hold one whole set
      // row (inputs, labels and the repeat action), or a revealed row would be
      // clipped; shorter windows use the document-scroll fallback instead.
      const headerHeight = headerRef.current ? headerRef.current.offsetHeight + gap : 0;
      const minEntries = headerRef.current ? 176 : 120;
      // In the fallback the outline sticks only while a whole set row still
      // fits between it and the bottom clearance; on very short windows it
      // scrolls away instead of covering the focused field.
      setRoomToStick(visibleHeight - shellBottom - bottom - headerHeight >= minEntries);
      setViewport({ height: visibleTop <= top && available >= footer.current.offsetHeight + headerHeight + gap + minEntries ? available : null, viewportHeight: visibleHeight, viewportTop: visibleTop });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(footer.current);
    if (headerRef.current) observer.observe(headerRef.current);
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
        const shellBottom = main.previousElementSibling?.getBoundingClientRect().bottom || 0;
        // A sticky outline row also covers the top of the visible area.
        const outline = headerRef.current?.getBoundingClientRect();
        const outlineBottom = outline && getComputedStyle(headerRef.current).position === 'sticky' && outline.top <= shellBottom + 1 ? outline.bottom : 0;
        const headerBottom = Math.max(shellBottom, outlineBottom);
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
      {header && (
        <div ref={headerRef} className={height === null && headerSticky && roomToStick ? 'sticky z-10 shrink-0 bg-background' : 'shrink-0'}
          style={height === null && headerSticky && roomToStick ? { top: headerTop } : undefined} data-testid="workout-outline-row">
          {header}
        </div>
      )}
      <div ref={entries} data-testid="workout-scroll-region" role="region" aria-label="Workout entries" tabIndex={0}
        className={height === null ? 'min-h-0' : 'min-h-0 flex-1 overflow-y-auto'}>
        {children}
      </div>
      <div ref={footer} className="shrink-0">{controls}</div>
    </div>
  );
}
