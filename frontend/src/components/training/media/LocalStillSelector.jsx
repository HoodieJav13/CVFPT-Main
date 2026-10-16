import { useEffect, useId, useRef, useState } from 'react';
import { Check, Film, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMs } from '@/lib/exerciseMedia';
import {
  checkStillBlob, confirmationIsCurrent, exportStill, seekVideo, sourceKey, stillFileName,
} from '@/lib/localStill';

const METADATA_TIMEOUT_MS = 8000;

// Optional: pick one frame from a clip on THIS device and hand the resulting
// image to the normal photo upload. Only that image is uploaded; the clip stays
// on the device and is never backed up by CVF. Decoding happens in this
// browser, so an unsupported clip simply falls back to uploading a photo.
// A confirmed still is bound to its clip and time: changing either clears it.
export function LocalStillSelector({ disabled = false, onStill, onInvalidate, onClose }) {
  const id = useId();
  const videoRef = useRef(null);
  const urls = useRef({ clip: null, still: null });
  // Bumped whenever the clip changes or the selector closes/unmounts: an export
  // still in flight from an earlier generation is dropped, never delivered.
  const generation = useRef(0);
  const [file, setFile] = useState(null);
  const [clipUrl, setClipUrl] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [durationMs, setDurationMs] = useState(0);
  const [timeMs, setTimeMs] = useState(0);
  const [timeText, setTimeText] = useState('0.0');
  const [confirmed, setConfirmed] = useState(null);
  const [stillUrl, setStillUrl] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  // A confirmed still was cleared because the time moved (not the clip).
  const [stale, setStale] = useState(false);

  const revoke = (which) => {
    if (urls.current[which]) { URL.revokeObjectURL(urls.current[which]); urls.current[which] = null; }
  };
  useEffect(() => () => { generation.current += 1; revoke('clip'); revoke('still'); }, []);

  // No metadata in time: treat the clip as unreadable here.
  useEffect(() => {
    if (status !== 'loading') return undefined;
    const timer = setTimeout(() => setStatus((current) => (current === 'loading' ? 'error' : current)), METADATA_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, clipUrl]);

  const invalidate = () => {
    if (!confirmed) return false;
    setConfirmed(null);
    revoke('still');
    setStillUrl(null);
    onInvalidate?.();
    return true;
  };

  const choose = (next) => {
    generation.current += 1;
    invalidate();
    setStale(false);
    revoke('clip');
    revoke('still');
    setStillUrl(null);
    setConfirmed(null);
    setProblem(null);
    setFile(next);
    setTimeMs(0);
    setTimeText('0.0');
    if (!next) { setClipUrl(null); setStatus('idle'); return; }
    const url = URL.createObjectURL(next);
    urls.current.clip = url;
    setClipUrl(url);
    setStatus('loading');
  };

  const seek = async (ms) => {
    const video = videoRef.current;
    if (!video || status !== 'ready') return;
    const target = Math.min(Math.max(0, Math.round(ms)), Math.max(0, durationMs - 1));
    if (confirmed && confirmed.timeMs !== target && invalidate()) setStale(true);
    setTimeMs(target);
    setTimeText((target / 1000).toFixed(1));
    try { await seekVideo(video, target); } catch { setStatus('error'); }
  };

  const commitText = () => {
    const seconds = Number(timeText);
    if (Number.isFinite(seconds)) seek(seconds * 1000);
  };

  const useFrame = async () => {
    const video = videoRef.current;
    if (!video || !file) return;
    const run = generation.current;
    const live = () => generation.current === run;
    setBusy(true);
    setProblem(null);
    try {
      await seekVideo(video, timeMs);
      if (!live()) return;
      const { blob } = await exportStill(video);
      if (!live()) return;
      const issue = checkStillBlob(blob);
      if (issue) { setProblem(issue.message); return; }
      const still = new File([blob], stillFileName(timeMs, blob.type, file.name), { type: blob.type, lastModified: Date.now() });
      revoke('still');
      const url = URL.createObjectURL(blob);
      urls.current.still = url;
      setStillUrl(url);
      const next = { key: sourceKey(file), timeMs };
      setConfirmed(next);
      setStale(false);
      onStill?.(still, next);
    } catch (error) {
      if (!live()) return;
      setProblem(error?.code === 'too_small' ? 'This clip is too small for a useful still. Upload a photo instead.' : 'This frame could not be exported here. Try another frame or upload a photo.');
    } finally { if (live()) setBusy(false); }
  };

  const close = () => { generation.current += 1; invalidate(); revoke('clip'); revoke('still'); onClose?.(); };
  const current = confirmationIsCurrent(confirmed, { file, timeMs });

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="media-still-selector">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-medium"><Film className="h-4 w-4" aria-hidden /> Still from a clip on this device</div>
        <Button type="button" variant="ghost" size="touchIcon" onClick={close} disabled={busy} aria-label="Close still selection" data-testid="media-still-close"><X aria-hidden /></Button>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="media-still-disclosure">
        Only the still image you choose is uploaded. The original clip is not uploaded or backed up, so keep your original video file.
      </p>
      <label htmlFor={`${id}-file`} className="text-xs text-muted-foreground">Clip (stays on this device)</label>
      <Input id={`${id}-file`} type="file" accept="video/*,.mov,.mp4,.webm" className="h-11" disabled={disabled || busy}
        onChange={(event) => choose(event.target.files?.[0] || null)} data-testid="media-still-file" />
      {status === 'error' && (
        <p className="text-sm text-destructive" role="alert" data-testid="media-still-error">
          This browser can&apos;t read that clip. Upload a photo instead, or export a still on your device and upload it as a photo.
        </p>
      )}
      {clipUrl && status !== 'error' && (
        <div className="space-y-2">
          <video
            ref={videoRef} src={clipUrl} muted playsInline preload="auto"
            className="aspect-video w-full rounded-lg border border-border/60 bg-black object-contain"
            aria-label="Clip for choosing a still (no sound)"
            onLoadedMetadata={(event) => {
              const ms = Math.round((event.currentTarget.duration || 0) * 1000);
              if (!Number.isFinite(ms) || ms <= 0 || !event.currentTarget.videoWidth) { setStatus('error'); return; }
              setDurationMs(ms);
              setStatus('ready');
            }}
            onError={() => setStatus('error')}
            data-testid="media-still-video"
          />
          {status === 'ready' && (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-end gap-2">
                <div className="min-w-0 space-y-1">
                  <label htmlFor={`${id}-scrub`} className="text-xs text-muted-foreground">Frame time</label>
                  <input id={`${id}-scrub`} type="range" min={0} max={Math.max(0, durationMs - 1)} step={100} value={timeMs}
                    onChange={(event) => seek(Number(event.target.value))} className="h-11 w-full accent-[hsl(var(--primary))]" disabled={disabled || busy} />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-time`} className="text-xs text-muted-foreground">Seconds</label>
                  <Input id={`${id}-time`} className="h-11" inputMode="decimal" value={timeText} disabled={disabled || busy}
                    onChange={(event) => setTimeText(event.target.value)} onBlur={commitText}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitText(); } }}
                    data-testid="media-still-time" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">At {formatMs(timeMs)} of {formatMs(durationMs)}</p>
              <Button type="button" size="touch" variant="outline" disabled={disabled || busy} onClick={useFrame} data-testid="media-still-use">
                <Check aria-hidden /> Use this frame
              </Button>
            </>
          )}
        </div>
      )}
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
      {stillUrl && current && (
        <figure className="space-y-1">
          <img src={stillUrl} alt="Chosen still from your clip" className="aspect-video w-full max-w-sm rounded-lg border border-border/60 object-contain" data-testid="media-still-preview" />
          <figcaption className="text-xs" data-testid="media-still-confirmed">Still at {formatMs(confirmed.timeMs)} is ready to upload above. Only this image will be uploaded.</figcaption>
        </figure>
      )}
      {stale && !current && (
        <p className="text-xs" role="status" data-testid="media-still-stale">You moved to a different time. Use this frame again to confirm it.</p>
      )}
    </div>
  );
}
