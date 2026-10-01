// Phone navigation (Sky Field, owner 2026-10-01): one glass button in the
// bottom-right corner instead of a six-tab bar. Tap to open, or press and
// slide onto a page and let go. Keyboard: Enter/Space opens, arrows move,
// Escape closes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const isActive = (item, pathname) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`));

export default function CornerMenu({ items, badgeFor, closedBadge }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(null);
  const fabRef = useRef(null);
  const itemRefs = useRef([]);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0 });
  const current = items.find((item) => isActive(item, pathname)) || items[0];
  const CurrentIcon = current.icon;

  const close = useCallback(() => { setOpen(false); setHot(null); }, []);
  useEffect(() => { close(); }, [pathname, close]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { close(); fabRef.current?.focus(); }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const index = itemRefs.current.indexOf(document.activeElement);
        const step = event.key === 'ArrowUp' ? 1 : -1;
        itemRefs.current[(index + step + items.length) % items.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, items.length]);

  const choose = (item) => { close(); if (!isActive(item, pathname) || item.to !== pathname) navigate(item.to); };
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
    if (open) { drag.current.active = false; return; }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { active: true, moved: false, x: event.clientX, y: event.clientY };
    setOpen(true);
  };
  const onPointerMove = (event) => {
    if (!drag.current.active) return;
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 8) drag.current.moved = true;
    const index = itemAt(event.clientX, event.clientY);
    setHot((previous) => { if (index !== previous && index !== null) buzz(); return index; });
  };
  const onPointerUp = (event) => {
    if (!drag.current.active) { close(); return; }
    drag.current.active = false;
    if (!drag.current.moved) return; // a plain tap leaves the menu open
    const index = itemAt(event.clientX, event.clientY);
    if (index !== null) choose(items[index]); else close();
  };
  const onClick = (event) => {
    // Keyboard activation (pointer handlers above cover touch and mouse).
    if (event.detail !== 0) return;
    if (open) { close(); return; }
    setOpen(true);
    requestAnimationFrame(() => itemRefs.current[0]?.focus());
  };

  return (
    <div className="lg:hidden" data-testid="mobile-bottom-navigation">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-28 bg-gradient-to-b from-transparent to-background/95" />
      <div
        aria-hidden
        onClick={close}
        className={cn('fixed inset-0 z-40 bg-[hsl(var(--scrim))] backdrop-blur-[6px] transition-opacity duration-200 motion-reduce:transition-none',
          open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <nav aria-label="Main" className={cn('fixed right-[1.4rem] z-50 bottom-[calc(6.4rem+env(safe-area-inset-bottom))]', !open && 'pointer-events-none')}>
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
                <button
                  ref={(el) => { itemRefs.current[index] = el; }}
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => choose(item)}
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
                </button>
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
        onPointerCancel={() => { drag.current.active = false; close(); }}
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
