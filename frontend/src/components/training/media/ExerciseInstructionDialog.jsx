import { useEffect, useRef, useState } from 'react';
import { Captions, CaptionsOff, FileText, Loader2, RotateCcw } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MEDIA_KIND_LABELS } from '@/lib/exerciseMedia';
import { claimPlayback, releasePlayback, useMediaLinks } from './mediaLinks';

// Full instruction is a separate, deliberate action: an accessible dialog with
// native controls, a captions toggle and an on-demand transcript. Historical
// views label it "Current exercise guide" — it is today's guide, not a record
// of what was shown when the workout happened.
export function ExerciseInstructionDialog({ media, context, exerciseName, open, onOpenChange, historical = false }) {
  const videoRef = useRef(null);
  const opener = useRef(null);
  const resumeAt = useRef(0);
  const refreshed = useRef(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [transcript, setTranscript] = useState({ status: 'idle', text: null, error: null });
  const instruction = media?.instruction || null;
  const assetIds = instruction ? [instruction.asset_id, instruction.captions_asset_id] : [media?.poster?.asset_id, media?.end_frame?.asset_id];
  const links = useMediaLinks(context, assetIds.filter(Boolean), Boolean(open && media));
  const videoUrl = instruction ? links.urls.get(instruction.asset_id) : null;
  const captionsUrl = instruction?.captions_asset_id ? links.urls.get(instruction.captions_asset_id) : null;

  useEffect(() => {
    if (!open) {
      setTranscript({ status: 'idle', text: null, error: null });
      setVideoFailed(false);
      refreshed.current = false;
    }
  }, [open]);

  useEffect(() => {
    const track = videoRef.current?.textTracks?.[0];
    if (track) track.mode = captionsOn ? 'showing' : 'hidden';
  }, [captionsOn, captionsUrl, videoUrl]);

  useEffect(() => () => {
    const video = videoRef.current;
    if (video) { try { video.pause(); } catch { /* detached */ } releasePlayback(video); }
  }, []);

  const onVideoError = () => {
    // A link may expire mid-watch: refresh once and resume where it stopped.
    if (!refreshed.current) {
      refreshed.current = true;
      resumeAt.current = videoRef.current?.currentTime || 0;
      links.retry();
      return;
    }
    setVideoFailed(true);
  };

  const loadTranscript = async () => {
    setTranscript({ status: 'loading', text: null, error: null });
    try {
      const { data } = await api.post('/exercise-media/text', { context, exercise_id: media.exercise_id });
      setTranscript({ status: 'ready', text: data.transcript, error: null });
    } catch (error) {
      setTranscript({ status: 'error', text: null, error: errMsg(error, 'Transcript unavailable right now.') });
    }
  };

  if (!media) return null;
  const title = historical ? 'Current exercise guide' : instruction ? 'Full instruction' : MEDIA_KIND_LABELS[media.kind];
  const posterUrl = links.urls.get(media.poster.asset_id);
  const endUrl = media.end_frame ? links.urls.get(media.end_frame.asset_id) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] max-w-2xl overflow-y-auto [&>button]:h-11 [&>button]:w-11"
        // Opened programmatically (no DialogTrigger): return focus to the opener.
        onOpenAutoFocus={() => { opener.current = document.activeElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus?.(); }}
        data-testid="exercise-instruction-dialog"
      >
        <DialogHeader>
          <DialogTitle className="pr-10 font-display">{exerciseName}</DialogTitle>
          <DialogDescription>
            {title}
            {historical && ' — shows today\'s guide for this exercise, not a record of what was shown during this workout.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {instruction ? (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-black" style={{ aspectRatio: `${instruction.width} / ${instruction.height}`, maxHeight: '60dvh' }}>
              {videoFailed ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground" role="status">
                  <span>The full instruction video is unavailable right now.</span>
                  <Button type="button" variant="outline" size="touch" onClick={() => { refreshed.current = false; setVideoFailed(false); links.retry(); }}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> Retry
                  </Button>
                </div>
              ) : videoUrl ? (
                <video
                  key={videoUrl}
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  crossOrigin="anonymous"
                  className="h-full w-full object-contain"
                  aria-label={`${exerciseName} full instruction video`}
                  onPlay={(event) => claimPlayback(event.currentTarget)}
                  onLoadedMetadata={(event) => { if (resumeAt.current) { event.currentTarget.currentTime = resumeAt.current; resumeAt.current = 0; } }}
                  onError={onVideoError}
                  data-testid="exercise-instruction-video"
                >
                  {captionsUrl && <track kind="captions" src={captionsUrl} srcLang={instruction.caption_language || 'en'} label="Captions" />}
                </video>
              ) : (
                <div className="flex h-full items-center justify-center" aria-hidden><Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" /></div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {posterUrl && <img src={posterUrl} alt={media.alt_text} width={640} height={360} crossOrigin="anonymous" className="aspect-video w-full rounded-lg border border-border/60 object-cover" />}
              {endUrl && <figure><img src={endUrl} alt={media.end_frame.alt_text} width={640} height={360} crossOrigin="anonymous" className="aspect-video w-full rounded-lg border border-border/60 object-cover" /><figcaption className="mt-1 text-xs text-muted-foreground">End position</figcaption></figure>}
            </div>
          )}
          {links.status === 'error' && !videoFailed && (
            <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
              <span className="text-muted-foreground">Media unavailable right now.</span>
              <Button type="button" variant="outline" size="touch" onClick={links.retry}>Retry</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {instruction?.captions_available && (
              <Button type="button" variant="outline" size="touch" onClick={() => setCaptionsOn((value) => !value)} aria-pressed={captionsOn} data-testid="exercise-instruction-captions">
                {captionsOn ? <Captions className="h-4 w-4" aria-hidden /> : <CaptionsOff className="h-4 w-4" aria-hidden />}
                Captions {captionsOn ? 'on' : 'off'}
              </Button>
            )}
            {media.transcript_available && transcript.status !== 'ready' && (
              <Button type="button" variant="outline" size="touch" onClick={loadTranscript} disabled={transcript.status === 'loading'} data-testid="exercise-instruction-transcript">
                <FileText className="h-4 w-4" aria-hidden /> {transcript.status === 'loading' ? 'Loading transcript…' : 'Show transcript'}
              </Button>
            )}
          </div>
          {transcript.status === 'error' && <p role="alert" className="text-sm text-muted-foreground">{transcript.error}</p>}
          {transcript.status === 'ready' && (
            <section aria-label="Transcript" className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-sm" data-testid="exercise-instruction-transcript-text">{transcript.text}</section>
          )}
          <p className="text-sm text-muted-foreground">{media.alt_text}</p>
          {media.cues?.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Cues">{media.cues.map((cue) => <li key={cue}>{cue}</li>)}</ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
