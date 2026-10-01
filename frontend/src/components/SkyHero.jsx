// The dashboard hero (Sky Field): full-width sky that runs under the clear
// top bar, a greeting, and a sheet the page content sits on, sliding over
// the bottom of the mountains.
import SkyScene from '@/components/SkyScene';
import { cn } from '@/lib/utils';

const OVERLAP = 28;

export function SkyHero({ title, subtitle, subtitleTestId, height = 400, testId, children }) {
  return (
    <section
      className="relative ml-[calc(50%-50vw)] w-screen -mt-[calc(var(--shell-top,4.5rem)+1.25rem)] lg:-mt-[calc(var(--shell-top,5rem)+1.5rem)]"
      style={{ height }}
      data-testid={testId}
    >
      <SkyScene height={height} overlap={OVERLAP} />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-5xl flex-col justify-center px-5 pt-[var(--shell-top,4.5rem)] lg:max-w-6xl lg:px-8" style={{ paddingBottom: OVERLAP + 96 }}>
        <h1 className="sky-text font-display text-[2.5rem] font-semibold leading-[1.02] tracking-tight drop-shadow-[0_1px_18px_rgb(0_0_0/0.08)] sm:text-5xl lg:text-6xl">{title}</h1>
        {subtitle ? <p className="sky-text-soft mt-1.5 text-sm font-medium sm:text-base" data-testid={subtitleTestId}>{subtitle}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function SkySheet({ className, children }) {
  return (
    <div
      className="relative z-10 ml-[calc(50%-50vw)] w-screen rounded-t-[30px] bg-background shadow-[0_-18px_40px_-24px_rgb(0_0_0/0.35)]"
      style={{ marginTop: -OVERLAP }}
    >
      <div aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-border" />
      <div className={cn('mx-auto w-full max-w-5xl px-4 pt-6 lg:max-w-6xl lg:px-8', className)}>{children}</div>
    </div>
  );
}

/** Sky behind the sign-in screens: the top ~60% of the viewport. */
export function AuthSky() {
  const height = Math.max(340, Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.62));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height }}>
      <SkyScene height={height} overlap={0} testId="sky-scene-auth" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
