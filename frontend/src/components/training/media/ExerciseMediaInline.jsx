import { useEffect, useRef, useState } from 'react';
import { Expand, ImageIcon, Loader2, Pause, Play, RotateCcw, Shrink, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MEDIA_KIND_LABELS, prefersDataSaver } from '@/lib/exerciseMedia';
import { claimPlayback, releasePlayback, useMediaLinks } from './mediaLinks';

const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// Inline exercise guide for a workout card. Poster first; the short preview
// plays only on an explicit tap (muted, inline, no loop, one player at a time).
// Media never blocks logging: failures fall back to text with a retry.
export function ExerciseMediaInline({ media, mediaStatus, context, exerciseName, load = true, onRequestLoad, onOpenInstruction, onRetryMetadata }) {
  const [expanded, setExpanded] = useState(false);
  // Failure is tracked per URL: a fresh link after Retry gets a fresh chance,
  // and a URL that already failed never renders as a broken image.
  const [failedUrl, setFailedUrl] = useState(null);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [playback, setPlayback] = useState('idle'); // idle | playing | paused | ended | error
  const videoRef = useRef(null);
  const slotRef = useRef(null);
  const posterIds = media ? [media.poster.asset_id, media.end_frame?.asset_id].filter(Boolean) : [];
  const posters = useMediaLinks(context, posterIds, Boolean(media && load));
  const preview = useMediaLinks(context, media?.preview ? [media.preview.asset_id] : [], Boolean(media?.preview && previewRequested));
  const previewUrl = media?.preview ? preview.urls.get(media.preview.asset_id) : null;

  // A rejected play() after a decode/network error must not mask the error.
  const settleRejectedPlay = (video) => setPlayback(video?.error ? 'error' : 'paused');

  // Pause when scrolled away, when the page is hidden, and on unmount.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onHidden = () => { if (document.hidden) video.pause(); };
    document.addEventListener('visibilitychange', onHidden);
    let observer;
    if ('IntersectionObserver' in window && slotRef.current) {
      observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) video.pause(); });
      observer.observe(slotRef.current);
    }
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      observer?.disconnect();
      try { video.pause(); } catch { /* detached */ }
      releasePlayback(video);
    };
  }, [previewUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl || playback !== 'idle') return;
    claimPlayback(video);
    video.play().catch(() => settleRejectedPlay(video));
  }, [previewUrl, playback]);

  if (!media) {
    if (mediaStatus !== 'unavailable') return null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="exercise-media-unavailable" role="status">
        <span>Exercise guide unavailable right now.</span>
        {onRetryMetadata && <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={onRetryMetadata}>Retry</Button>}
      </div>
    );
  }

  const kindLabel = MEDIA_KIND_LABELS[media.kind] || 'Exercise guide';
  if (!load) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="exercise-media-deferred">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground" onClick={onRequestLoad}>
          <ImageIcon className="h-4 w-4" aria-hidden /> Show {kindLabel.toLowerCase()}
        </Button>
        {media.instruction && onOpenInstruction && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-primary" onClick={() => onOpenInstruction(media)}>
            <Video className="h-4 w-4" aria-hidden /> Full instruction
          </Button>
        )}
      </div>
    );
  }

  const posterUrl = posters.urls.get(media.poster.asset_id);
  const endUrl = media.end_frame ? posters.urls.get(media.end_frame.asset_id) : null;
  const failed = (posterUrl && failedUrl === posterUrl) || posters.status === 'error';
  const retryPoster = () => { posters.retry(); };
  const showVideo = previewRequested && playback !== 'error';
  const startPreview = () => {
    if (previewUrl && videoRef.current) {
      claimPlayback(videoRef.current);
      if (playback === 'ended') videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => settleRejectedPlay(videoRef.current));
      return;
    }
    setPlayback('idle');
    setPreviewRequested(true);
  };

  return (
    <div className={cn('flex gap-3', expanded ? 'flex-col' : 'items-start')} data-testid="exercise-media-inline" data-media-kind={media.kind}>
      <div
        ref={slotRef}
        className={cn('relative shrink-0 overflow-hidden rounded-lg border border-border/60 bg-secondary/50 aspect-video', expanded ? 'w-full max-w-md' : 'w-24')}
        data-testid="exercise-media-slot"
      >
        {failed ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[11px] leading-tight text-muted-foreground" role="status">
            <span>Preview unavailable</span>
          </div>
        ) : showVideo && previewUrl ? (
          <video
            ref={videoRef}
            src={previewUrl}
            poster={posterUrl}
            muted
            playsInline
            preload="none"
            crossOrigin="anonymous"
            className="h-full w-full object-cover"
            aria-label={`${exerciseName} movement preview`}
            onPlay={() => setPlayback('playing')}
            onPause={() => setPlayback((current) => (current === 'ended' || current === 'error' ? current : 'paused'))}
            onEnded={() => setPlayback('ended')}
            onError={() => setPlayback('error')}
            data-testid="exercise-media-preview"
          />
        ) : posterUrl ? (
          <img
            key={posterUrl}
            src={posterUrl}
            alt={media.alt_text}
            width={media.poster.width}
            height={media.poster.height}
            loading="lazy"
            decoding="async"
            crossOrigin="anonymous"
            className="h-full w-full object-cover"
            onError={() => setFailedUrl(posterUrl)}
            data-testid="exercise-media-poster"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" aria-hidden>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        )}
      </div>
      {expanded && media.kind === 'frames' && endUrl && !failed && (
        <figure className="w-full max-w-md">
          <img src={endUrl} alt={media.end_frame.alt_text} width={media.end_frame.width} height={media.end_frame.height} loading="lazy" decoding="async" crossOrigin="anonymous" className="aspect-video w-full rounded-lg border border-border/60 object-cover" data-testid="exercise-media-end-frame" />
          <figcaption className="mt-1 text-xs text-muted-foreground">End position</figcaption>
        </figure>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        {media.cues?.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label={`${exerciseName} cues`}>
            {media.cues.map((cue) => <li key={cue} className="break-words">{cue}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0">
          {failed && (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={retryPoster} data-testid="exercise-media-retry">
              <RotateCcw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          )}
          {media.preview && !failed && (playback === 'playing' ? (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={() => videoRef.current?.pause()} data-testid="exercise-media-pause">
              <Pause className="h-4 w-4" aria-hidden /> Pause
            </Button>
          ) : playback === 'error' ? (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={() => { preview.retry(); setPlayback('idle'); }}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Retry preview
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2" onClick={startPreview} disabled={previewRequested && preview.status === 'loading'} data-testid="exercise-media-play">
              {playback === 'ended' ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {playback === 'ended' ? 'Replay' : 'Play preview'}
              {prefersDataSaver() && media.preview.bytes ? <span className="text-muted-foreground">({megabytes(media.preview.bytes)})</span> : null}
            </Button>
          ))}
          {media.instruction && onOpenInstruction && (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-primary" onClick={() => onOpenInstruction(media)} data-testid="exercise-media-instruction">
              <Video className="h-4 w-4" aria-hidden /> Full instruction
            </Button>
          )}
          <Button
            type="button" variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground"
            onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
            aria-label={expanded ? `Show smaller ${kindLabel.toLowerCase()}` : `Show larger ${kindLabel.toLowerCase()}`}
            data-testid="exercise-media-expand"
          >
            {expanded ? <Shrink className="h-4 w-4" aria-hidden /> : <Expand className="h-4 w-4" aria-hidden />}
            {expanded ? 'Smaller' : 'Larger'}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">{playback === 'playing' ? 'Preview playing' : playback === 'ended' ? 'Preview finished' : ''}</p>
      </div>
    </div>
  );
}
