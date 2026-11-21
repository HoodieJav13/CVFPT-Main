// What a client was looking at just before an undoable action: where the
// acted-on part of the page (the anchor, e.g. the exercise card) sat on screen,
// the page and region scroll positions, and the control that had focus. Undo
// puts these back after the restored rows render (owner decision 2026-11-12:
// "Undo restores everything as it was"). The anchor is put back at the same
// screen position, so content that legitimately changed above it (an older
// Undo bar that cannot come back) does not shift the view. Browser-only
// helpers; nothing is stored.

function describeFocus(root) {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  if (!active || active === document.body || !root?.contains(active)) return null;
  return {
    node: active,
    id: active.id || null,
    testId: active.getAttribute('data-testid'),
    label: active.getAttribute('aria-label'),
    scope: active.closest('[data-exercise-id]')?.getAttribute('data-exercise-id') ?? null,
  };
}

/** Snapshot of the anchor's screen position, scroll positions (window plus the given scrolling elements) and focus inside root. */
export function captureUndoView(root, scrollers = [], anchor = null) {
  if (typeof window === 'undefined') return null;
  const anchorNode = anchor && root ? root.querySelector(anchor) : null;
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    scrollers: scrollers.filter(Boolean).map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft })),
    anchor: anchorNode ? { selector: anchor, top: anchorNode.getBoundingClientRect().top } : null,
    focus: describeFocus(root),
  };
}

function findFocusTarget(focus, root) {
  if (!focus) return null;
  if (focus.node?.isConnected && root.contains(focus.node)) return focus.node;
  if (focus.id) {
    const byId = document.getElementById(focus.id);
    if (byId && root.contains(byId)) return byId;
  }
  if (!focus.testId) return null;
  const scope = focus.scope ? root.querySelector(`[data-exercise-id="${CSS.escape(focus.scope)}"]`) : root;
  const candidates = [...(scope || root).querySelectorAll(`[data-testid="${CSS.escape(focus.testId)}"]`)];
  return candidates.find((element) => element.getAttribute('aria-label') === focus.label) || candidates[0] || null;
}

const INPUTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
const SETTLE_FRAMES = 12;

const scrollable = (element) => element.isConnected && element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element).overflowY !== 'visible';

function applyScroll(view, root) {
  const anchor = view.anchor && root.querySelector(view.anchor.selector);
  if (anchor) {
    const delta = Math.round(anchor.getBoundingClientRect().top - view.anchor.top);
    if (!delta) return;
    const container = view.scrollers.map((row) => row.element).find((element) => element.contains(anchor) && scrollable(element));
    if (container) {
      const before = container.scrollTop;
      container.scrollTop += delta;
      if (container.scrollTop !== before) return;
    }
    window.scrollBy(0, delta);
    return;
  }
  for (const { element, top, left } of view.scrollers) {
    if (element.isConnected && (element.scrollTop !== top || element.scrollLeft !== left)) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }
  if (window.scrollX !== view.windowX || window.scrollY !== view.windowY) window.scrollTo(view.windowX, view.windowY);
}

/**
 * Puts the captured view back. Focus returns to the same control (or the
 * fallback selector inside root) only when the Undo left focus nowhere (the
 * Undo button is gone), so it never pulls focus from something the person
 * moved to. Focus never scrolls. The scroll positions are applied now and
 * again for a few frames while the layout settles (the Undo bar leaving can
 * switch the tracker between region and page scrolling), until the person
 * scrolls, taps or presses a key. Returns a cancel function.
 */
export function restoreUndoView(view, root, { fallback = null } = {}) {
  if (!view || !root) return () => {};
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) {
    const target = findFocusTarget(view.focus, root) || (fallback ? root.querySelector(fallback) : null);
    target?.focus({ preventScroll: true });
  }
  applyScroll(view, root);
  let frame;
  let count = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    INPUTS.forEach((type) => window.removeEventListener(type, stop, true));
  };
  const settle = () => {
    applyScroll(view, root);
    count += 1;
    if (count < SETTLE_FRAMES) frame = requestAnimationFrame(settle);
    else stop();
  };
  INPUTS.forEach((type) => window.addEventListener(type, stop, { capture: true, passive: true }));
  frame = requestAnimationFrame(settle);
  return stop;
}
