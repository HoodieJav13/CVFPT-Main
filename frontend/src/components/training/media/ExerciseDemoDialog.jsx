import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMediaLinks } from './mediaLinks';
import { mountYouTubePlayer, playerErrorMessage } from './youtubePlayer';

// Full general demo on YouTube (docs/exercise-guides/design.md). Opening the
// dialog shows only first-party content: the identifying photo (when there is
// one), the cues and a plain notice. Nothing is requested from YouTube until
// the viewer presses Play; then one privacy-enhanced player loads. Closing the
// dialog destroys it. Open on YouTube stays available throughout and is never
// promised to work. Historical views label it as today's demo.
export function ExerciseDemoDialog({ demo, exerciseName, media = null, context = null, open, onOpenChange, historical = false }) {
  const opener = useRef(null);
  const slot = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState({ state: 'idle', code: null });
  const [attempt, setAttempt] = useState(0);
  const posterId = media?.poster?.asset_id || null;
  const links = useMediaLinks(context, posterId ? [posterId] : [], Boolean(open && posterId && context));
  const posterUrl = posterId ? links.urls.get(posterId) : null;

  useEffect(() => {
    if (!open) { setPlaying(false); setStatus({ state: 'idle', code: null }); }
  }, [open]);

  useEffect(() => {
    if (!open || !playing || !slot.current || demo?.kind !== 'youtube') return undefined;
    const player = mountYouTubePlayer({
      container: slot.current,
      videoId: demo.video_id,
      title: `${exerciseName} demo video (YouTube)`,
      onState: (state, code = null) => setStatus({ state, code }),
    });
    // Play (or Try again) unmounts the control that had focus. Focus the player
    // region in this document, not the cross-origin iframe, so Escape still
    // closes the dialog; Tab moves into the player.
    slot.current.focus();
    const onHidden = () => { if (document.hidden) player.pause(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      player.release();
    };
  }, [open, playing, attempt, demo?.kind, demo?.video_id, exerciseName]);

  if (!demo) return null;
  const statusText = {
    loading: 'Loading the YouTube player…',
    ready: 'Player ready. Use its controls to play, pause, turn on captions or go full screen.',
    limited: 'Player controls are limited because the YouTube player script did not load. The video may still play; Open on YouTube always works when YouTube is reachable.',
    error: '',
    idle: '',
  }[status.state];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] max-w-2xl overflow-y-auto [&>button]:h-11 [&>button]:w-11"
        // Opened programmatically (no DialogTrigger): return focus to the opener.
        onOpenAutoFocus={() => { opener.current = document.activeElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus?.(); }}
        data-testid="exercise-demo-dialog"
      >
        <DialogHeader>
          <DialogTitle className="pr-10 font-display">{exerciseName}</DialogTitle>
          <DialogDescription>
            {historical ? 'Current demo: today\'s demo for this exercise, not a record of what was shown during this workout.' : 'Demo video'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {playing ? (
            <div ref={slot} tabIndex={-1} role="group" aria-label={`${exerciseName} demo player`}
              className="w-full min-w-[200px] overflow-hidden rounded-lg border border-border/60 bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="exercise-demo-player" />
          ) : (
            <div className="relative flex aspect-video min-h-[200px] w-full items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-secondary/50" data-testid="exercise-demo-facade">
              {posterUrl ? (
                <img src={posterUrl} alt={media.alt_text || `${exerciseName} photo`} width={640} height={360} crossOrigin="anonymous"
                  className="h-full w-full object-cover" data-testid="exercise-demo-poster" />
              ) : (
                <span className="px-4 text-center font-display text-lg text-muted-foreground">{exerciseName}</span>
              )}
            </div>
          )}
          {status.state === 'error' && (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert" data-testid="exercise-demo-error">
              <p>{playerErrorMessage(status.code)}</p>
              <Button type="button" variant="outline" size="touch" onClick={() => { setStatus({ state: 'idle', code: null }); setAttempt((n) => n + 1); }}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Try again
              </Button>
            </div>
          )}
          <p className={status.state === 'loading' ? 'flex items-center gap-2 text-sm text-muted-foreground' : 'text-sm text-muted-foreground'} role="status" aria-live="polite" data-testid="exercise-demo-status">
            {status.state === 'loading' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {statusText}
          </p>
          {media?.cues?.length > 0 && (
            <ul className="space-y-0.5 text-sm" aria-label={`${exerciseName} cues`} data-testid="exercise-demo-cues">
              {media.cues.map((cue) => <li key={cue} className="break-words">{cue}</li>)}
            </ul>
          )}
          {!playing && (
            <p className="text-xs text-muted-foreground" data-testid="exercise-demo-notice">
              Play loads YouTube in privacy-enhanced mode. YouTube may show ads or suggestions, and a link can stop working.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!playing && (
              <Button type="button" size="touch" onClick={() => setPlaying(true)} data-testid="exercise-demo-play">
                <Play className="h-4 w-4" aria-hidden /> Play demo
              </Button>
            )}
            <Button asChild type="button" variant="outline" size="touch">
              <a href={demo.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${exerciseName} demo on YouTube (opens in a new tab)`} data-testid="exercise-demo-external">
                <ExternalLink className="h-4 w-4" aria-hidden /> Open on YouTube
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The demo action for one exercise: a click-to-load YouTube demo opens the
// dialog; any other safe link stays an external link that opens in a new tab.
export function ExerciseDemoAction({ demo, exerciseName, onView, variant = 'row' }) {
  if (!demo) return null;
  if (demo.kind === 'youtube') {
    return (
      <Button type="button" variant="ghost" size="sm" className="min-h-11 w-fit px-2 text-primary" onClick={onView}
        aria-label={`View demo: ${exerciseName}`} data-testid={variant === 'history' ? 'history-current-demo' : 'tracker-exercise-demo'}>
        <Play className="h-4 w-4" aria-hidden /> {variant === 'history' ? 'Current demo' : 'View demo'}
      </Button>
    );
  }
  return (
    <a href={demo.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      aria-label={`External video: ${exerciseName} (opens in a new tab)`} data-testid={variant === 'history' ? 'history-current-demo-link' : 'tracker-exercise-video'}>
      <Play className="h-4 w-4" aria-hidden /> External video
    </a>
  );
}
