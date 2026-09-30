import { useEffect, useRef, useState } from 'react';

export function formatTimer(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

// Owns the rest countdown's 250ms tick so a running timer re-renders only the
// component that shows it — not every exercise card and controlled input
// (audit #11). The opt-in end-of-rest cue lives here too, since it keys off
// the same tick. Mount it once per screen, or the cue fires twice.
export function useRestCountdown(restEndsAt, restAlerts) {
  const [now, setNow] = useState(Date.now());
  const announcedRef = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    if (!restEndsAt) return undefined;
    let timer;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= restEndsAt) window.clearInterval(timer);
    };
    timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [restEndsAt]);

  const complete = Boolean(restEndsAt && now >= restEndsAt);

  useEffect(() => {
    if (!complete) {
      announcedRef.current = false;
      return;
    }
    if (announcedRef.current || !restAlerts) return;
    announcedRef.current = true;
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(200);
    } catch { /* capability declined */ }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const context = new AudioCtx();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
        oscillator.onended = () => context.close();
      }
    } catch { /* audio unavailable or blocked */ }
  }, [complete, restAlerts]);

  const seconds = restEndsAt ? Math.max(0, Math.ceil((restEndsAt - now) / 1000)) : 0;
  return { seconds, complete };
}
