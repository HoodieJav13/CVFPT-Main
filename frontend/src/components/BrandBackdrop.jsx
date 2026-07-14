import { cn } from '@/lib/utils';
import { useVisualIntensity } from '@/lib/visualIntensity';

const photoModules = import.meta.glob('/src/assets/photos/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const PHOTO_SLOTS = {
  auth: '/src/assets/photos/login-bg.jpg',
  dashboard: '/src/assets/photos/dashboard-header.jpg',
};

export function BrandBackdrop({ variant = 'dashboard', photoSlot, intensity: intensityOverride, className }) {
  const intensity = useVisualIntensity(intensityOverride);
  const photoPath = photoSlot ? PHOTO_SLOTS[photoSlot] : null;
  const photoUrl = photoPath ? photoModules[photoPath] : null;

  return (
    <div
      aria-hidden
      className={cn('brand-backdrop', className)}
      data-variant={variant}
      data-intensity={intensity}
      data-photo-state={photoUrl ? 'ready' : 'fallback'}
      data-testid={`brand-backdrop-${variant}`}
    >
      {photoUrl ? (
        <div className="brand-backdrop__photo" style={{ backgroundImage: `url(${photoUrl})` }} />
      ) : null}
      <div className="brand-backdrop__glow" />
      <div className="brand-backdrop__ridge" />
      <div className="brand-backdrop__veil" />
    </div>
  );
}

export function DashboardHero({ title, subtitle, action, testId }) {
  return (
    <section
      className="relative isolate mb-5 min-h-[148px] overflow-hidden rounded-3xl border border-primary/15 bg-card/55 px-5 py-5 shadow-[var(--app-elev-soft)] sm:min-h-[160px] sm:px-6 sm:py-6"
      data-testid={testId}
    >
      <BrandBackdrop variant="dashboard" photoSlot="dashboard" />
      <div className="relative z-10 flex min-h-[106px] items-end justify-between gap-4 sm:min-h-[110px]">
        <div>
          <div className="mb-2 h-[3px] w-9 rounded-full bg-primary" aria-hidden />
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-foreground/75">{subtitle}</p> : null}
        </div>
        {action ? <div className="relative z-10 shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}

