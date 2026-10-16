import { useEffect, useId, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, Pause, Play, StepBack, StepForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clampTime, defaultCrop, formatMs, validatePreview } from '@/lib/exerciseMedia';
import { ImageCropEditor } from './ImageCropEditor';

const FRAME_MS = 33; // ≈1 frame at 30 fps; the server re-renders from exact timestamps.
const PREVIEW_ERRORS = {
  invalid_time: 'Choose a start and an end.',
  invalid_preview_range: 'A movement preview must be 1 to 8 seconds long.',
  time_out_of_range: 'The preview must end within the video.',
};

function SecondsField({ id, label, value, onCommit, durationMs, disabled }) {
  const [text, setText] = useState(value == null ? '' : (value / 1000).toFixed(3));
  useEffect(() => { setText(value == null ? '' : (value / 1000).toFixed(3)); }, [value]);
  const commit = () => {
    if (text.trim() === '') return onCommit(null);
    const seconds = Number(text);
    if (!Number.isFinite(seconds)) { setText(value == null ? '' : (value / 1000).toFixed(3)); return undefined; }
    return onCommit(clampTime(Math.round(seconds * 1000), durationMs));
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} inputMode="decimal" className="h-11" value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} aria-describedby={`${id}-unit`} />
      <span id={`${id}-unit`} className="sr-only">seconds</span>
    </div>
  );
}

// Coach scrubbing aid. Times are SELECTIONS (milliseconds), not promises of an
// exact source frame; the backend regenerates every output from the original.
// onSourceError(atMs) -> true when the owner refreshed an expired link (this
// player may remount while it loads); onSourceLoaded() -> position to resume.
export function VideoSelectionEditor({ src, facts, recipe, onChange, onServerFrame, onSourceError, onSourceLoaded, disabled = false }) {
  const videoRef = useRef(null);
  const baseId = useId();
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [undecodable, setUndecodable] = useState(false);
  const [cropTarget, setCropTarget] = useState(null); // poster | preview | end
  const [frame, setFrame] = useState(null); // { src, dims }
  const durationMs = facts.durationMs;

  const seek = (ms) => {
    const target = clampTime(ms, durationMs);
    setNow(target);
    if (videoRef.current && !undecodable) videoRef.current.currentTime = target / 1000;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onTime = () => setNow(Math.round(video.currentTime * 1000));
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeked', onTime);
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('seeked', onTime); video.pause?.(); };
  }, [src]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  };

  const captureFrame = async (target) => {
    setCropTarget(target);
    if (undecodable) {
      if (onServerFrame) setFrame({ src: await onServerFrame(now), dims: { width: facts.width, height: facts.height } });
      return;
    }
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    try {
      setFrame({ src: canvas.toDataURL('image/jpeg', 0.85), dims: { width: video.videoWidth, height: video.videoHeight } });
    } catch {
      setFrame(null);
    }
  };

  const previewError = recipe.preview_start_ms == null && recipe.preview_end_ms == null ? null : validatePreview(recipe.preview_start_ms, recipe.preview_end_ms, durationMs);
  const cropKey = { poster: 'poster_crop', preview: 'preview_crop', end: 'end_frame_crop' }[cropTarget];
  const dims = frame?.dims || { width: facts.width, height: facts.height };

  return (
    <div className="space-y-3" data-testid="video-selection-editor">
      {undecodable ? (
        <div className="rounded-lg border border-border/60 bg-secondary/40 p-3 text-sm" role="status" data-testid="video-undecodable">
          This browser can't play this video (for example HEVC from some phones). Enter times below and use
          {' '}<strong>Show frame</strong> to see a server-rendered still. Uploading a photo still works.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${facts.width} / ${facts.height}`, maxHeight: '45dvh', marginInline: 'auto', maxWidth: `calc(45dvh * ${(facts.width / facts.height).toFixed(4)})` }}>
          <video
            ref={videoRef} src={src} muted playsInline preload="metadata" crossOrigin="anonymous" className="h-full w-full object-contain"
            aria-label="Source video for selecting frames"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => {
              const resumeMs = onSourceLoaded?.();
              if (resumeMs != null) { event.currentTarget.currentTime = resumeMs / 1000; setNow(resumeMs); }
            }}
            onError={() => { if (!onSourceError?.(now)) setUndecodable(true); }}
            data-testid="video-selection-video"
          />
        </div>
      )}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <label htmlFor={`${baseId}-scrub`}>Position</label>
          <span className="tabular-nums" aria-live="off" data-testid="video-selection-time">{formatMs(now)} / {formatMs(durationMs)}</span>
        </div>
        <input
          id={`${baseId}-scrub`} type="range" min={0} max={Math.max(0, durationMs - 1)} step={1} value={now} disabled={disabled}
          onChange={(event) => seek(Number(event.target.value))}
          aria-valuetext={`${formatMs(now)} of ${formatMs(durationMs)}`}
          className="h-11 w-full accent-[hsl(var(--primary))]"
          data-testid="video-selection-scrub"
        />
      </div>
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Video position controls">
        {!undecodable && <Button type="button" variant="outline" size="touch" onClick={togglePlay} disabled={disabled}>{playing ? <Pause aria-hidden /> : <Play aria-hidden />}{playing ? 'Pause' : 'Play'}</Button>}
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => seek(now - 1000)} aria-label="Back 1 second"><ChevronsLeft aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => seek(now - FRAME_MS)} aria-label="Back about 1 frame"><StepBack aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => seek(now + FRAME_MS)} aria-label="Forward about 1 frame"><StepForward aria-hidden /></Button>
        <Button type="button" variant="outline" size="touchIcon" disabled={disabled} onClick={() => seek(now + 1000)} aria-label="Forward 1 second"><ChevronsRight aria-hidden /></Button>
        {undecodable && onServerFrame && <Button type="button" variant="outline" size="touch" disabled={disabled} onClick={() => captureFrame(cropTarget || 'poster')}>Show frame</Button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1 rounded-lg border border-border/60 p-2">
          <p className="text-sm font-medium">Poster frame</p>
          <p className="text-xs text-muted-foreground">{recipe.poster_mode === 'video_frame' && recipe.poster_frame_ms != null ? `At ${formatMs(recipe.poster_frame_ms)}` : recipe.poster_mode === 'uploaded_image' ? 'Using your uploaded image' : 'Not chosen'}</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="touch" variant="outline" disabled={disabled} onClick={() => onChange({ poster_mode: 'video_frame', poster_frame_ms: now, poster_crop: recipe.poster_mode === 'video_frame' && recipe.poster_crop ? recipe.poster_crop : defaultCrop(dims) })} data-testid="set-poster-frame">Use this frame</Button>
            {recipe.poster_mode === 'video_frame' && <Button type="button" size="touch" variant="ghost" disabled={disabled} onClick={() => captureFrame('poster')}>Crop poster</Button>}
          </div>
        </div>
        <div className="space-y-1 rounded-lg border border-border/60 p-2">
          <p className="text-sm font-medium">Movement preview (optional, 1–8 s)</p>
          <p className="text-xs text-muted-foreground" data-testid="preview-range">{recipe.preview_start_ms != null ? `${formatMs(recipe.preview_start_ms)} → ${formatMs(recipe.preview_end_ms ?? recipe.preview_start_ms)}` : 'No preview'}</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="touch" variant="outline" disabled={disabled} onClick={() => onChange({ preview_start_ms: now, preview_end_ms: Math.min(durationMs, Math.max(recipe.preview_end_ms ?? 0, now + 2000)), preview_crop: recipe.preview_crop || defaultCrop(dims) })} data-testid="set-preview-in">Set start</Button>
            <Button type="button" size="touch" variant="outline" disabled={disabled || recipe.preview_start_ms == null} onClick={() => onChange({ preview_end_ms: now })} data-testid="set-preview-out">Set end</Button>
            {recipe.preview_start_ms != null && <Button type="button" size="touch" variant="ghost" disabled={disabled} onClick={() => captureFrame('preview')}>Crop preview</Button>}
            {recipe.preview_start_ms != null && <Button type="button" size="touch" variant="ghost" disabled={disabled} onClick={() => onChange({ preview_start_ms: null, preview_end_ms: null, preview_crop: null })}>Clear</Button>}
          </div>
          {previewError && <p className="text-xs text-destructive" role="alert" data-testid="preview-error">{PREVIEW_ERRORS[previewError]}</p>}
        </div>
        <div className="space-y-1 rounded-lg border border-border/60 p-2 sm:col-span-2">
          <p className="text-sm font-medium">End still (optional)</p>
          <p className="text-xs text-muted-foreground">{recipe.end_frame_ms != null ? `At ${formatMs(recipe.end_frame_ms)} — pairs with the poster as start/end stills` : 'No end still'}</p>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="touch" variant="outline" disabled={disabled} onClick={() => onChange({ end_frame_ms: now, end_frame_crop: recipe.end_frame_crop || defaultCrop(dims) })} data-testid="set-end-frame">Use this frame</Button>
            {recipe.end_frame_ms != null && <Button type="button" size="touch" variant="ghost" disabled={disabled} onClick={() => captureFrame('end')}>Crop end still</Button>}
            {recipe.end_frame_ms != null && <Button type="button" size="touch" variant="ghost" disabled={disabled} onClick={() => onChange({ end_frame_ms: null, end_frame_crop: null })}>Clear</Button>}
          </div>
        </div>
      </div>
      <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <legend className="mb-1 text-xs text-muted-foreground">Exact times (seconds)</legend>
        <SecondsField id={`${baseId}-poster`} label="Poster" value={recipe.poster_mode === 'video_frame' ? recipe.poster_frame_ms : null} durationMs={durationMs} disabled={disabled}
          onCommit={(ms) => onChange(ms == null ? {} : { poster_mode: 'video_frame', poster_frame_ms: ms, poster_crop: recipe.poster_mode === 'video_frame' && recipe.poster_crop ? recipe.poster_crop : defaultCrop(dims) })} />
        <SecondsField id={`${baseId}-in`} label="Preview start" value={recipe.preview_start_ms} durationMs={durationMs} disabled={disabled}
          onCommit={(ms) => onChange(ms == null ? { preview_start_ms: null, preview_end_ms: null, preview_crop: null } : { preview_start_ms: ms, preview_end_ms: recipe.preview_end_ms ?? Math.min(durationMs, ms + 2000), preview_crop: recipe.preview_crop || defaultCrop(dims) })} />
        <SecondsField id={`${baseId}-out`} label="Preview end" value={recipe.preview_end_ms} durationMs={durationMs + 1} disabled={disabled || recipe.preview_start_ms == null}
          onCommit={(ms) => onChange({ preview_end_ms: ms })} />
        <SecondsField id={`${baseId}-end`} label="End still" value={recipe.end_frame_ms} durationMs={durationMs} disabled={disabled}
          onCommit={(ms) => onChange(ms == null ? { end_frame_ms: null, end_frame_crop: null } : { end_frame_ms: ms, end_frame_crop: recipe.end_frame_crop || defaultCrop(dims) })} />
      </fieldset>
      {cropTarget && frame && (
        <div className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="video-frame-crop">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Crop {cropTarget === 'end' ? 'end still' : cropTarget}</p>
            <Button type="button" size="touch" variant="ghost" onClick={() => { setCropTarget(null); setFrame(null); }}>Done</Button>
          </div>
          <ImageCropEditor src={frame.src} dims={dims} crop={recipe[cropKey]} onChange={(crop) => onChange({ [cropKey]: crop })} label={`Crop ${cropTarget}`} disabled={disabled} testId={`crop-${cropTarget}`} />
        </div>
      )}
    </div>
  );
}
