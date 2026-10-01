// Phone navigation (Sky Field, owner 2026-10-01): one glass button in the
// bottom-right corner instead of a six-tab bar. Tap (or a screen reader's
// activate) opens it; press and slide onto a page and let go is an optional
// shortcut. While open it behaves like a modal: focus moves into the list,
// the page behind is inert (AppShell), Tab stays inside, Escape or a tap
// outside closes, and focus returns to the button. While closed the list is
// inert and hidden from assistive technology.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const isActive = (item, pathname) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`));

export default function CornerMenu({ items, badgeFor, closedBadge, onOpenChange }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(null);
  const fabRef = useRef(null);
  const itemRefs = useRef([]);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0 });
  // Set when a press opened the menu, so the click that ends the same press
  // doesn't toggle it shut again. A screen reader's activate sends only the
  // click, which then opens or closes the menu on its own.
  const pressOpened = useRef(false);
  const restoreFocus = useRef(false);
  const current = items.find((item) => isActive(item, pathname)) || items[0];
  const CurrentIcon = current.icon;

  const close = useCallback((returnFocus = true) => {
    restoreFocus.current = returnFocus;
    setOpen(false);
    setHot(null);
  }, []);
  useEffect(() => { close(false); }, [pathname, close]);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (open) {
      // Focus the current page's item so screen readers land inside the menu.
      const index = Math.max(0, items.findIndex((item) => isActive(item, pathname)));
      requestAnimationFrame(() => itemRefs.current[index]?.focus({ preventScroll: true }));
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      fabRef.current?.focus({ preventScroll: true });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const index = itemRefs.current.indexOf(document.activeElement);
        const step = event.key === 'ArrowUp' ? 1 : -1;
        itemRefs.current[(index + step + items.length) % items.length]?.focus();
      }
      if (event.key === 'Tab') {
        // Keep focus inside the open menu: its items plus the close button.
        const stops = [...itemRefs.current.filter(Boolean), fabRef.current];
        const at = stops.indexOf(document.activeElement);
        event.preventDefault();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, items.length]);

  const choose = (item) => { close(false); if (item.to !== pathname) navigate(item.to); };
  const itemAt = (x, y) => {
    const index = itemRefs.current.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left - 16 && x <= r.right + 16 && y >= r.top - 5 && y <= r.bottom + 5;
    });
    return index >= 0 ? index : null;
  };
  const buzz = () => { try { navigator.vibrate?.(6); } catch { /* not supported */ } };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A press on the open menu's button closes it on click; a slide that
    // ended without a click must not leave the press flag set.
    if (open) { drag.current.active = false; pressOpened.current = false; return; }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { active: true, moved: false, x: event.clientX, y: event.clientY };
    pressOpened.current = true;
    setOpen(true);
  };
  const onPointerMove = (event) => {
    if (!drag.current.active) return;
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 8) drag.current.moved = true;
    const index = itemAt(event.clientX, event.clientY);
    setHot((previous) => { if (index !== previous && index !== null) buzz(); return index; });
  };
  const onPointerUp = (event) => {
    if (!drag.current.active) return; // the click handler closes an open menu
    drag.current.active = false;
    if (!drag.current.moved) return; // a plain tap leaves the menu open
    const index = itemAt(event.clientX, event.clientY);
    if (index !== null) choose(items[index]); else close();
  };
  const onClick = () => {
    if (pressOpened.current) { pressOpened.current = false; return; }
    if (open) close(); else setOpen(true);
  };

  return (
    <div className="lg:hidden" data-testid="mobile-bottom-navigation">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-28 bg-gradient-to-b from-transparent to-background/95" />
      <div
        aria-hidden
        onClick={() => close()}
        className={cn('fixed inset-0 z-40 bg-[hsl(var(--scrim))] backdrop-blur-[6px] transition-opacity duration-200 motion-reduce:transition-none',
          open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <nav
        aria-label="Main"
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={cn('fixed right-[1.4rem] z-50 bottom-[calc(6.4rem+env(safe-area-inset-bottom))]', !open && 'pointer-events-none')}
        data-state={open ? 'open' : 'closed'}
      >
        <ul id="corner-menu" className="m-0 flex list-none flex-col-reverse gap-2.5 p-0">
          {items.map((item, index) => {
            const active = isActive(item, pathname);
            const badge = badgeFor?.(item);
            return (
              <li
                key={item.to}
                className={cn('flex justify-end transition-[opacity,transform] duration-300 [transition-timing-function:var(--motion-ease-spring)] motion-reduce:transition-none',
                  open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-90 opacity-0')}
                style={{ transitionDelay: open ? `${index * 30}ms` : '0ms' }}
              >
                <Link
                  ref={(el) => { itemRefs.current[index] = el; }}
                  to={item.to}
                  onClick={(event) => { event.preventDefault(); choose(item); }}
                  aria-current={active ? 'page' : undefined}
                  className="group flex items-center gap-3 rounded-2xl outline-none"
                  data-testid={`bottom-tab-${item.label.toLowerCase()}`}
                >
                  <span className={cn('glass-surface flex h-10 items-center gap-2 rounded-[13px] px-3.5 text-[15px] font-semibold transition-transform duration-200 [transition-timing-function:var(--motion-ease-spring)] group-focus-visible:ring-2 group-focus-visible:ring-ring',
                    hot === index && '-translate-x-2 scale-[1.08] !bg-[image:linear-gradient(180deg,hsl(var(--action-a)),hsl(var(--action-b)))] !text-action-foreground')}>
                    {item.label}{badge}
                  </span>
                  <span className={cn('flex h-[50px] w-[50px] items-center justify-center rounded-full transition-transform duration-200 [transition-timing-function:var(--motion-ease-spring)]',
                    active ? 'bg-[image:linear-gradient(180deg,hsl(var(--action-a)),hsl(var(--action-b)))] text-action-foreground shadow-[var(--glass-shadow)]' : 'glass-surface',
                    hot === index && 'scale-[1.14]')}>
                    <item.icon className="h-[21px] w-[21px]" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        ref={fabRef}
        type="button"
        aria-label={open ? 'Close menu' : `Menu, ${current.label}`}
        aria-expanded={open}
        aria-controls="corner-menu"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current.active = false; pressOpened.current = false; close(); }}
        onClick={onClick}
        className="glass-surface fixed right-4 z-50 flex h-[60px] w-[60px] touch-none select-none items-center justify-center rounded-full transition-transform duration-200 [transition-timing-function:var(--motion-ease-spring)] active:scale-[0.92] bottom-[calc(1.25rem+env(safe-area-inset-bottom))] motion-reduce:transition-none"
        data-testid="mobile-menu-button"
      >
        <CurrentIcon className={cn('h-6 w-6 transition-[transform,opacity] duration-300', open && 'rotate-90 scale-50 opacity-0')} aria-hidden />
        <X className={cn('absolute h-6 w-6 transition-[transform,opacity] duration-300', open ? 'opacity-100' : '-rotate-90 scale-50 opacity-0')} aria-hidden />
        {!open && closedBadge}
      </button>
    </div>
  );
}
