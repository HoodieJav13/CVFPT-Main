// Sky Field scene: the sky header behind the dashboard greetings and the
// sign-in screens. The ridge is the real Sandia skyline (three haze layers,
// src/lib/sandiaSkyline.js). Sunrise in the light theme, sunset with a real
// full moon in the dark theme. Decorative only (aria-hidden); everything
// animated stops under prefers-reduced-motion.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SANDIA_LAYERS } from '@/lib/sandiaSkyline';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Narrow screens zoom in on Sandia Crest to Tijeras Canyon (like a longer
// lens); wide screens show the whole range.
function frameFor(width) {
  return width < 700 ? { a0: 30, a1: 100, exag: 3.2 } : { a0: 18, a1: 128, exag: Math.max(1, Math.min(1.7, 1700 / width)) };
}

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function useWidth(ref) {
  const [width, setWidth] = useState(390);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth || 390);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const MOON = (
  <svg className="sky-scene__moon" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="sky-moon-lit" cx="44%" cy="40%" r="62%"><stop offset="0" stopColor="#FCF8EF" /><stop offset=".7" stopColor="#EDE6D8" /><stop offset="1" stopColor="#CFC5B3" /></radialGradient>
      <filter id="sky-moon-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" /></filter>
      <filter id="sky-moon-tex"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="3" seed="4" /><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .43  0 0 0 0 .40  0 0 0 .5 0" /></filter>
      <clipPath id="sky-moon-disc"><circle cx="50" cy="50" r="50" /></clipPath>
    </defs>
    <circle cx="50" cy="50" r="50" fill="url(#sky-moon-lit)" />
    <g clipPath="url(#sky-moon-disc)">
      {/* Maria in their real places: Procellarum, Imbrium, Frigoris, Serenitatis,
          Tranquillitatis, Crisium, Fecunditatis, Nectaris, Nubium, Humorum. */}
      <g fill="#8F8B84" opacity=".62" filter="url(#sky-moon-soft)">
        <ellipse cx="25" cy="50" rx="15" ry="22" transform="rotate(-12 25 50)" /><ellipse cx="38" cy="28" rx="14" ry="11" />
        <ellipse cx="46" cy="14" rx="20" ry="3.6" /><ellipse cx="60" cy="31" rx="9" ry="8" /><ellipse cx="67" cy="45" rx="11" ry="9" />
        <ellipse cx="83" cy="35" rx="6" ry="5" /><ellipse cx="77" cy="57" rx="6.5" ry="9" /><ellipse cx="66" cy="62" rx="4.5" ry="4.5" />
        <ellipse cx="42" cy="64" rx="10" ry="7" /><ellipse cx="25" cy="67" rx="5.5" ry="5" />
      </g>
      <rect width="100" height="100" filter="url(#sky-moon-tex)" opacity=".55" />
      <path d="M46,82 L30,62 M46,82 L58,60 M46,82 L70,88 M46,82 L28,92 M46,82 L44,58" stroke="#FFFFFF" strokeWidth=".7" opacity=".28" strokeLinecap="round" />
      <circle cx="46" cy="82" r="2.2" fill="#FFFFFF" />
      <circle cx="35" cy="44" r="1.6" fill="#FFFDF6" />
      <circle cx="50" cy="50" r="50" fill="none" stroke="#B8AD99" strokeOpacity=".5" strokeWidth="2" />
    </g>
  </svg>
);

const JAY = (
  <svg width="26" height="16" viewBox="0 0 50 30" fill="currentColor" aria-hidden="true">
    <path d="M2,15 L7.2,13.6 Q9,10.2 12.2,9.8 L14.6,5.8 L17.4,2.8 L16.2,7.6 L17.6,10.6 Q26,11.6 33,13.2 L46.6,11.8 Q50,13.8 47.4,16.4 L33,17.6 Q22,21.8 12.4,18.8 L7.2,16.2 Z" />
    <path className="wing" d="M18.5,13.4 Q20.5,2.6 31.5,0.6 Q32,7 27.5,13.6 Z" />
  </svg>
);

const ROADRUNNER = (
  <svg width="34" height="19" viewBox="0 0 60 34" fill="currentColor" aria-hidden="true">
    <path d="M1.5,13.2 L12,11.4 Q13.4,9.2 15,8.6 L15.8,4.6 L17.6,7.4 L19.2,4.2 L19.9,7.8 L21.6,6.4 L21.5,9.6 Q24,11.6 28,13 Q34,14.2 40,14 L56.8,4.2 Q59.4,5.4 58.4,7.6 L43.4,17.6 Q34.4,21.6 26.4,19.8 Q18.6,18 15.4,15 L12,13.8 Z" />
    <g className="leg-b" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M28,19 L23,25 L19,30 L15,30.6" /><path d="M31,19 L35,25 L41,28 L44.5,27" /></g>
    <g className="leg-a" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M28,19 L27,26 L24,31 L20,31.6" /><path d="M31,19 L32.4,25.4 L33.4,30.4 L37.4,31" /></g>
  </svg>
);

/**
 * @param height  scene height in px
 * @param overlap how far content overlaps the bottom of the scene (the ridge's
 *                lowest point sits this far above the bottom)
 */
export default function SkyScene({ height = 420, overlap = 28, className, testId = 'sky-scene' }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  const { a0, a1, exag } = frameFor(width);
  const base = height - overlap;

  const geometry = useMemo(() => {
    const lo = Math.min(...SANDIA_LAYERS.near.filter(([a]) => a >= a0 && a <= a1).map(([, v]) => v));
    const k = (width / (a1 - a0)) * exag;
    const x = (a) => ((a - a0) / (a1 - a0)) * width;
    const y = (v) => base - (v - lo) * k;
    const pts = (layer) => SANDIA_LAYERS[layer].filter(([a]) => a >= a0 - 0.5 && a <= a1 + 0.5).map(([a, v]) => `${x(a).toFixed(1)},${y(v).toFixed(1)}`);
    const path = (layer) => `M-2,${height} L${pts(layer).join(' L')} L${width + 2},${height} Z`;
    const crestY = (az) => y(SANDIA_LAYERS.far.reduce((b, p) => (Math.abs(p[0] - az) < Math.abs(b[0] - az) ? p : b))[1]);
    return { far: path('far'), mid: path('mid'), near: path('near'), rim: `M${pts('far').join(' L')}`, x, crestY };
  }, [width, height, base, a0, a1, exag]);

  // Sunrise sits where the sun rises in early October (~100°); the full moon
  // rises over the east at dusk, placed clear of the greeting.
  const orb = dark
    ? { left: width * (width < 700 ? 0.86 : 0.64), top: Math.max(60, base * 0.28) }
    : { left: geometry.x(Math.min(100, a1 - 16)), top: geometry.crestY(Math.min(100, a1 - 16)) + 6 };

  const stars = useMemo(() => {
    const rnd = seeded(width < 700 ? 7 : 11);
    const count = width < 700 ? 140 : 260;
    return Array.from({ length: count }, (_, i) => {
      const r = rnd(); const big = r > (width < 700 ? 0.985 : 0.975);
      const size = big ? 2 + rnd() * 0.7 : 0.6 + rnd() * 1.1;
      return {
        key: i, big, glint: r > 0.993,
        style: { left: `${(rnd() * 100).toFixed(2)}%`, top: `${(rnd() ** 1.6 * 100).toFixed(2)}%`, width: size, height: size,
          '--d': `${(2.2 + rnd() * 4).toFixed(2)}s`, '--dl': `${(-rnd() * 6).toFixed(2)}s`, '--o0': (0.15 + rnd() * 0.3).toFixed(2), '--o1': (0.7 + rnd() * 0.3).toFixed(2) },
      };
    });
  }, [width]);

  const clouds = useMemo(() => {
    const rnd = seeded(3);
    const rows = [[6, 0.9, 0.55, 210], [13, 0.6, 0.45, 260], [19, 1.1, 0.6, 180], [27, 0.7, 0.5, 240], [35, 1, 0.5, 200], [44, 0.55, 0.4, 280], [52, 0.8, 0.45, 230]];
    const scale = width < 700 ? 1 : 1.4;
    return rows.map(([top, sc0, op, dur], i) => {
      const sc = sc0 * scale;
      const puffs = Array.from({ length: 4 + (i % 3) }, (_, k) => {
        const w = (34 + rnd() * 34) * sc; const h = w * (0.55 + rnd() * 0.2);
        return { key: k, style: { left: k * 22 * sc + rnd() * 8, top: rnd() * 10 * sc - h / 2 + (k % 2 ? -4 : 4) * sc, width: w, height: h } };
      });
      return { key: i, puffs, style: { top: `${top}%`, opacity: op, '--cd': `${dur * scale}s`, '--cdl': `${-(dur * ((i * 0.37) % 1)).toFixed(1)}s`, '--x0': `-${Math.round(170 * sc)}px`, '--x1': `${width + 40}px` } };
    });
  }, [width]);

  // Parallax: the three ridge layers move at different speeds as the page scrolls.
  const ridgeRef = useRef(null);
  useEffect(() => {
    if (reduceMotion()) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = Math.min(window.scrollY, height);
        ridgeRef.current?.querySelectorAll('[data-depth]').forEach((el) => { el.style.translate = `0 ${-s * Number(el.dataset.depth)}px`; });
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [height]);

  // Critters are rare by design: about one visit in three sees one, then they
  // come back at random a minute or more apart.
  const jayRef = useRef(null);
  const roadRef = useRef(null);
  useEffect(() => {
    if (reduceMotion()) return undefined;
    const timers = [];
    let raf = 0;
    const send = (name) => {
      const el = name === 'jay' ? jayRef.current : roadRef.current;
      if (!el) return;
      const dur = name === 'jay' ? 8000 : 5200;
      const t0 = performance.now();
      el.classList.add('is-on');
      const step = (now) => {
        const t = (now - t0) / dur;
        if (t >= 1) { el.classList.remove('is-on'); return; }
        if (name === 'jay') {
          el.style.transform = `translate(${width + 30 - t * (width + 80)}px, ${base * 0.38 + Math.sin(t * Math.PI * 3) * 10 - t * 24}px)`;
        } else {
          const x = width + 20 - t * (width + 70);
          el.style.transform = `translate(${x}px, ${geometry.crestY(a0 + ((x + 17) / width) * (a1 - a0)) - 15}px)`;
          el.classList.toggle('is-step', Math.floor(t * 70) % 2 === 0);
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const maybe = () => {
      send(!dark && Math.random() < 0.5 ? 'jay' : 'road');
      timers.push(setTimeout(maybe, 60000 + Math.random() * 90000));
    };
    if (Math.random() < 0.35) timers.push(setTimeout(maybe, 8000 + Math.random() * 20000));
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [dark, width, base, geometry, a0, a1]);

  return (
    <div ref={ref} aria-hidden className={cn('sky-scene', className)} style={{ height }} data-testid={testId} data-theme-scene={dark ? 'sunset' : 'sunrise'}>
      <div className="sky-scene__sky" />
      <div className="sky-scene__milky" />
      <div className="sky-scene__stars">
        {stars.map((star) => (
          <span key={star.key} className={cn('sky-scene__star', star.big && 'sky-scene__star--big', star.glint && 'sky-scene__star--glint')} style={star.style} />
        ))}
      </div>
      <span className="sky-scene__planet" style={{ left: '78%', top: '9%', width: 4, height: 4, background: '#FFF1D2', boxShadow: '0 0 8px 2px rgb(255 236 200 / 0.6)' }} />
      <span className="sky-scene__planet" style={{ left: '18%', top: '27%', width: 3, height: 3, background: '#FFB79A', boxShadow: '0 0 6px 1px rgb(255 170 140 / 0.5)' }} />
      <span className="sky-scene__shoot" />
      <div className="sky-scene__rays" style={{ left: orb.left, top: orb.top }} />
      <div className="sky-scene__clouds">
        {clouds.map((cloud) => (
          <div key={cloud.key} className="sky-scene__cloud" style={cloud.style}>
            {cloud.puffs.map((puff) => <span key={puff.key} className="sky-scene__puff" style={puff.style} />)}
          </div>
        ))}
      </div>
      <div className="sky-scene__glow" style={{ top: base - 230, '--glow-x': `${(orb.left / width) * 100}%` }} />
      <div className="sky-scene__orb" style={{ left: orb.left, top: orb.top }}>{MOON}</div>
      <svg ref={ridgeRef} className="sky-scene__ridges" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sky-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--ridge-far)" /><stop offset="1" stopColor="var(--ridge-mid)" stopOpacity=".9" /></linearGradient>
          <linearGradient id="sky-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--ridge-mid)" /><stop offset="1" stopColor="var(--ridge-near)" /></linearGradient>
          <filter id="sky-soft"><feGaussianBlur stdDeviation=".6" /></filter>
        </defs>
        <path data-depth=".10" d={geometry.far} fill="url(#sky-far)" filter="url(#sky-soft)" />
        <path data-depth=".10" d={geometry.rim} fill="none" stroke="var(--ridge-rim)" strokeWidth="1.2" opacity=".7" filter="url(#sky-soft)" />
        <path data-depth=".18" d={geometry.mid} fill="url(#sky-mid)" />
        <path data-depth=".28" d={geometry.near} fill="var(--ridge-near)" />
      </svg>
      <span ref={jayRef} className="sky-scene__critter sky-scene__jay">{JAY}</span>
      <span ref={roadRef} className="sky-scene__critter sky-scene__road">{ROADRUNNER}</span>
      <div className="sky-scene__grain" />
    </div>
  );
}
