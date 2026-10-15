import { useId, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { defaultCrop, moveCrop, zoomCrop } from '@/lib/exerciseMedia';

const pct = (value) => `${(value * 100).toFixed(4)}%`;

// Keyboard-first 16:9 crop over an oriented source image. Arrow keys move
// (Shift = larger steps), +/- zoom, 0 recenters; every action also has a
// visible 44px button. The live preview shows exactly the saved crop; the
// server re-renders the real poster from the original source.
export function ImageCropEditor({ src, dims, crop, onChange, label = 'Crop', disabled = false, testId = 'image-crop-editor' }) {
  const frameRef = useRef(null);
  const drag = useRef(null);
  const helpId = useId();
  const current = crop || defaultCrop(dims);
  const set = (next) => { if (!disabled) onChange(next); };
  const move = (dx, dy, step) => set(moveCrop(current, dx, dy, step));
  const zoom = (factor) => set(zoomCrop(current, dims, factor));

  const onKeyDown = (event) => {
    const big = event.shiftKey ? 5 : 1;
    const actions = {
      ArrowLeft: () => move(-big, 0), ArrowRight: () => move(big, 0), ArrowUp: () => move(0, -big), ArrowDown: () => move(0, big),
      '+': () => zoom(0.9), '=': () => zoom(0.9), '-': () => zoom(1.1), _: () => zoom(1.1), 0: () => set(defaultCrop(dims)), Home: () => set(defaultCrop(dims)),
    };
    const action = actions[event.key];
    if (action) { event.preventDefault(); action(); }
  };

  const onPointerDown = (event) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop: current };
  };
  const onPointerMove = (event) => {
    if (!drag.current || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const dx = (event.clientX - drag.current.x) / rect.width;
    const dy = (event.clientY - drag.current.y) / rect.height;
    const start = drag.current.crop;
    // moveCrop steps are fractions of the crop size; convert absolute deltas.
    set(moveCrop(start, dx / start.width, dy / start.height, 1));
  };
  const onPointerUp = () => { drag.current = null; };

  const px = {
    x: Math.round(current.x * dims.width), y: Math.round(current.y * dims.height),
    width: Math.round(current.width * dims.width), height: Math.round(current.height * dims.height),
  };
  const backgroundSize = `${(100 / current.width).toFixed(4)}% ${(100 / current.height).toFixed(4)}%`;
  const backgroundPosition = `${current.width < 1 ? pct(current.x / (1 - current.width)) : '0%'} ${current.height < 1 ? pct(current.y / (1 - current.height)) : '0%'}`;

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div
          ref={frameRef}
          className="relative mx-auto w-full overflow-hidden rounded-lg bg-black"
          style={{ aspectRatio: `${dims.width} / ${dims.height}`, maxHeight: '45dvh', maxWidth: `calc(45dvh * ${(dims.width / dims.height).toFixed(4)})` }}
        >
          {src && <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full select-none object-fill" draggable={false} crossOrigin="anonymous" />}
          <div
            role="group"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${label}: crop area`}
            aria-describedby={helpId}
            className="absolute cursor-move rounded-sm border-2 border-primary shadow-[0_0_0_9999px_hsl(var(--background)/0.6)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ left: pct(current.x), top: pct(current.y), width: pct(current.width), height: pct(current.height), touchAction: 'none' }}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            data-testid={`${testId}-area`}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Preview (16:9)</p>
          <div
            className="aspect-video w-full rounded-lg border border-border/60 bg-secondary/50 bg-no-repeat"
            style={src ? { backgroundImage: `url("${src}")`, backgroundSize, backgroundPosition } : undefined}
            role="img"
            aria-label={`${label} preview`}
            data-testid={`${testId}-preview`}
          />
          <p id={helpId} className="text-xs text-muted-foreground" aria-live="polite" data-testid={`${testId}-readout`}>
            {px.width}×{px.height} px from ({px.x}, {px.y}). Arrow keys move, Shift moves farther, + and − zoom, 0 recenters.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label={`${label} controls`}>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => move(-1, 0)} aria-label="Move crop left"><ArrowLeft aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => move(1, 0)} aria-label="Move crop right"><ArrowRight aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => move(0, -1)} aria-label="Move crop up"><ArrowUp aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => move(0, 1)} aria-label="Move crop down"><ArrowDown aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => zoom(0.9)} aria-label="Zoom crop in"><ZoomIn aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => zoom(1.1)} aria-label="Zoom crop out"><ZoomOut aria-hidden /></Button>
        <Button type="button" variant="outline" size="touch" disabled={disabled} onClick={() => set(defaultCrop(dims))}><Crosshair aria-hidden /> Recenter</Button>
      </div>
    </div>
  );
}
