import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ImageUp, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Upload, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errMsg } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MEDIA_KIND_LABELS, MEDIA_LIMITS, checkFileBeforeUpload, createRefreshGate, defaultCrop, formatMs } from '@/lib/exerciseMedia';
import { ImageCropEditor } from './ImageCropEditor';
import { VideoSelectionEditor } from './VideoSelectionEditor';
import { useMediaLinks } from './mediaLinks';

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (globalThis.crypto.getRandomValues(new Uint8Array(1))[0] % 16); return (c === 'x' ? r : (r % 4) + 8).toString(16); }));

const STATUS_COPY = {
  draft: 'Draft', processing: 'Processing', ready: 'Ready for review', failed: 'Processing failed',
};
const FAILURE_COPY = {
  source_missing: 'A source file is missing. Upload it again.',
  processor_timeout: 'Processing took too long. Try a shorter clip.',
  attempts_exhausted: 'Processing kept failing. Check the clip and retry.',
  preview_too_large: 'The preview could not fit 2 MB. Choose a shorter or simpler section.',
  instruction_too_large: 'The full video could not fit 25 MB. Upload a shorter clip.',
  poster_too_large: 'The poster could not be compressed enough. Try another image.',
};
const ERROR_COPY = {
  alt_text_required: 'Add alt text describing the exercise setup.',
  poster_required: 'Choose a poster: your uploaded image or a frame from the video.',
  poster_crop_required: 'Confirm the poster crop.',
  source_image_required: 'Upload an image or choose a frame from the video.',
  poster_frame_required: 'Choose the poster frame.',
  end_frame_incomplete: 'Crop the end still and add its alt text.',
  crop_aspect_mismatch: 'The crop must stay 16:9.',
  invalid_preview_range: 'A movement preview must be 1 to 8 seconds long.',
  time_out_of_range: 'That time is outside the video.',
  invalid_caption_cues: 'Captions need ordered times inside the video and short plain text.',
  captions_required: 'Narrated instruction needs captions and a transcript before review.',
  replace_requires_admin: 'Another coach owns the current guide. An admin must approve replacing it.',
  stale: 'This changed elsewhere. Reload to continue from the latest version.',
};
const explain = (error, fallback) => ERROR_COPY[error?.response?.data?.code] || errMsg(error, fallback);

const EDITABLE = ['alt_text', 'end_frame_alt_text', 'cues', 'transcript', 'caption_language', 'caption_cues', 'instruction_audio',
  'include_instruction', 'poster_mode', 'poster_frame_ms', 'poster_crop', 'preview_start_ms', 'preview_end_ms', 'preview_crop', 'end_frame_ms', 'end_frame_crop'];

function formFromDraft(draft) {
  return {
    alt_text: draft.text.alt_text || '', end_frame_alt_text: draft.text.end_frame_alt_text || '',
    cues: [...(draft.text.cues || []), '', '', ''].slice(0, 3), transcript: draft.text.transcript || '',
    caption_language: draft.text.caption_language || 'en', caption_cues: draft.text.caption_cues || [],
    instruction_audio: Boolean(draft.text.instruction_audio), ...draft.recipe,
  };
}
function normalized(form) {
  return {
    ...form,
    alt_text: form.alt_text.trim() || null,
    end_frame_alt_text: form.end_frame_alt_text.trim() || null,
    cues: form.cues.map((cue) => cue.trim()).filter(Boolean),
    transcript: form.transcript.trim() || null,
    caption_language: form.caption_language || null,
  };
}
function patchFor(draft, form) {
  const next = normalized(form);
  const before = normalized(formFromDraft(draft));
  const patch = {};
  for (const key of EDITABLE) if (JSON.stringify(next[key] ?? null) !== JSON.stringify(before[key] ?? null)) patch[key] = next[key] ?? null;
  return patch;
}

function StatusBadge({ draft }) {
  if (draft.is_current) return <Badge className="border-success/40 bg-success/10 text-success" variant="outline">Current guide</Badge>;
  if (draft.status === 'ready' && draft.review_status === 'approved') return <Badge variant="outline" className="border-primary/40 text-primary">Approved — ready to publish</Badge>;
  return <Badge variant="outline" className={draft.status === 'failed' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'}>{STATUS_COPY[draft.status]}</Badge>;
}

function UploadControl({ role, disabled, onUpload }) {
  const [file, setFile] = useState(null);
  const [rights, setRights] = useState('owned');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(null);
  const [problem, setProblem] = useState(null);
  const controller = useRef(null);
  const inputRef = useRef(null);
  const id = `upload-${role}`;
  useEffect(() => () => controller.current?.abort(), []);
  const start = async () => {
    const early = checkFileBeforeUpload(file, role);
    if (early) { setProblem(early.message); return; }
    controller.current = new AbortController();
    setProblem(null); setProgress(0);
    try {
      await onUpload({ file, rights, note, signal: controller.current.signal, onProgress: setProgress });
      setFile(null); setConfirmed(false); setNote('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      if (error?.code !== 'ERR_CANCELED') setProblem(explain(error, 'Upload failed. Your draft is unchanged.'));
    } finally { setProgress(null); controller.current = null; }
  };
  const label = role === 'source_image' ? 'Upload image' : 'Upload video';
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3" data-testid={`media-upload-${role}`}>
      <div className="flex items-center gap-2 font-medium">{role === 'source_image' ? <ImageUp className="h-4 w-4" aria-hidden /> : <Video className="h-4 w-4" aria-hidden />}{label}</div>
      <Label htmlFor={id} className="text-xs text-muted-foreground">{role === 'source_image' ? 'JPEG, PNG or still WebP, up to 10 MB. Works without any video.' : 'MP4, MOV or WebM up to 2 minutes and 100 MB.'}</Label>
      <Input ref={inputRef} id={id} type="file" accept={role === 'source_image' ? MEDIA_LIMITS.image.mimes.join(',') : `${MEDIA_LIMITS.video.mimes.join(',')},.mov`} disabled={disabled || progress !== null}
        onChange={(event) => { setFile(event.target.files?.[0] || null); setProblem(null); }} className="h-11" data-testid={`media-file-${role}`} />
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium">Rights</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {['owned', 'permissioned'].map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2">
              <input type="radio" name={`${id}-rights`} value={value} checked={rights === value} onChange={() => setRights(value)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              {value === 'owned' ? 'We recorded/own it' : 'We have written permission'}
            </label>
          ))}
        </div>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-1" data-testid={`media-rights-confirm-${role}`} />
          <span>I confirm we own or have permission to use this media. Never upload copied demos or YouTube downloads.</span>
        </label>
        <Label htmlFor={`${id}-note`} className="text-xs text-muted-foreground">Private permission note (optional, coaches only)</Label>
        <Textarea id={`${id}-note`} rows={2} maxLength={MEDIA_LIMITS.text.rightsNoteMax} value={note} onChange={(event) => setNote(event.target.value)} />
      </fieldset>
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
      {progress !== null ? (
        <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Uploading {Math.round(progress * 100)}% — not saved until checked
          <Button type="button" variant="ghost" size="touch" onClick={() => controller.current?.abort()}><X aria-hidden /> Cancel</Button>
        </div>
      ) : (
        <Button type="button" size="touch" disabled={disabled || !file || !confirmed} onClick={start} data-testid={`media-upload-start-${role}`}><Upload aria-hidden /> {label}</Button>
      )}
    </div>
  );
}

function CaptionRows({ cues, onChange, durationMs, disabled }) {
  const update = (index, patch) => onChange(cues.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)));
  const seconds = (ms) => (ms / 1000).toFixed(1);
  return (
    <div className="space-y-2" data-testid="caption-rows">
      {cues.map((cue, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={index} className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_2.75rem] items-end gap-1">
          <div><Label className="text-xs" htmlFor={`cap-s-${index}`}>Start s</Label><Input id={`cap-s-${index}`} className="h-11" inputMode="decimal" defaultValue={seconds(cue.start_ms)} disabled={disabled} onBlur={(e) => update(index, { start_ms: Math.max(0, Math.round(Number(e.target.value) * 1000) || 0) })} /></div>
          <div><Label className="text-xs" htmlFor={`cap-e-${index}`}>End s</Label><Input id={`cap-e-${index}`} className="h-11" inputMode="decimal" defaultValue={seconds(cue.end_ms)} disabled={disabled} onBlur={(e) => update(index, { end_ms: Math.max(0, Math.round(Number(e.target.value) * 1000) || 0) })} /></div>
          <div><Label className="text-xs" htmlFor={`cap-t-${index}`}>Caption</Label><Input id={`cap-t-${index}`} className="h-11" maxLength={500} value={cue.text} disabled={disabled} onChange={(e) => update(index, { text: e.target.value })} /></div>
          <Button type="button" variant="ghost" size="touchIcon" disabled={disabled} onClick={() => onChange(cues.filter((_, i) => i !== index))} aria-label={`Remove caption ${index + 1}`}><Trash2 aria-hidden /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="touch" disabled={disabled || cues.length >= 500} onClick={() => {
        const last = cues.at(-1);
        const start = last ? last.end_ms : 0;
        onChange([...cues, { start_ms: start, end_ms: Math.min(durationMs || start + 2000, start + 2000), text: '' }]);
      }}><Plus aria-hidden /> Add caption</Button>
    </div>
  );
}

// Review player: an expired 60 s link refreshes once and resumes; a repeated
// failure shows a retry instead of a broken player.
function ReviewVideo({ url, retry, label, muted = false }) {
  const gate = useRef(createRefreshGate());
  const resumeAt = useRef(null);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-border/60 bg-secondary/40 p-3 text-center text-sm text-muted-foreground" role="status">
        <span>{label} unavailable right now.</span>
        <Button type="button" variant="outline" size="touch" onClick={() => { gate.current.reset(); setFailed(false); retry(); }}><RefreshCw aria-hidden /> Retry</Button>
      </div>
    );
  }
  if (!url) return <div className="aspect-video w-full rounded-lg border border-border/60 bg-black" aria-hidden />;
  return (
    <video
      src={url} controls muted={muted} playsInline preload="none" crossOrigin="anonymous" className="aspect-video w-full rounded-lg border border-border/60 bg-black" aria-label={label}
      onLoadedMetadata={(event) => { gate.current.onLoaded(); if (resumeAt.current != null) { event.currentTarget.currentTime = resumeAt.current; resumeAt.current = null; } }}
      onError={(event) => {
        if (gate.current.onError() === 'refresh') { resumeAt.current = event.currentTarget.currentTime || 0; retry(); return; }
        setFailed(true);
      }}
    />
  );
}

function DerivativeReview({ draft }) {
  const context = useMemo(() => ({ type: 'revision', id: draft.id }), [draft.id]);
  const ids = draft.derivatives.filter((d) => d.role !== 'captions').map((d) => d.asset_id);
  const links = useMediaLinks(context, ids, true);
  const url = (role) => links.urls.get(draft.derivatives.find((d) => d.role === role)?.asset_id);
  const by = Object.fromEntries(draft.derivatives.map((d) => [d.role, d]));
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="media-derivative-review">
      {by.poster && <figure><img src={url('poster')} alt={draft.text.alt_text || ''} width={640} height={360} crossOrigin="anonymous" className="aspect-video w-full rounded-lg border border-border/60 bg-secondary/50 object-cover" data-testid="review-poster" /><figcaption className="mt-1 text-xs text-muted-foreground">Generated poster · {(by.poster.bytes / 1024).toFixed(0)} KB</figcaption></figure>}
      {by.end_frame && <figure><img src={url('end_frame')} alt={draft.text.end_frame_alt_text || ''} width={640} height={360} crossOrigin="anonymous" className="aspect-video w-full rounded-lg border border-border/60 bg-secondary/50 object-cover" /><figcaption className="mt-1 text-xs text-muted-foreground">Generated end still</figcaption></figure>}
      {by.preview && <figure><ReviewVideo url={url('preview')} retry={links.retry} muted label="Generated movement preview" /><figcaption className="mt-1 text-xs text-muted-foreground">Preview · {formatMs(by.preview.duration_ms)} · {(by.preview.bytes / 1024).toFixed(0)} KB · silent</figcaption></figure>}
      {by.instruction && <figure><ReviewVideo url={url('instruction')} retry={links.retry} label="Generated full instruction video" /><figcaption className="mt-1 text-xs text-muted-foreground">Full instruction · {formatMs(by.instruction.duration_ms)} · {(by.instruction.bytes / (1024 * 1024)).toFixed(1)} MB{by.instruction.has_audio ? ' · audio' : ''}</figcaption></figure>}
    </div>
  );
}

// Coach media panel for ONE exact library exercise. Drafts never replace the
// current client guide until a reviewed publication succeeds.
export function ExerciseMediaEditor({ exercise, onChanged }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [attest, setAttest] = useState({ variant: false, rights: false, content: false });
  const [frameUrls, setFrameUrls] = useState([]);
  // Once a draft has a source, its upload panel folds behind "Replace …" so
  // review and recipe controls are not buried under upload forms.
  const [replacing, setReplacing] = useState({ source_image: false, source_video: false });
  const seq = useRef(0);
  const live = useRef(true);
  const frameUrlsRef = useRef([]);
  frameUrlsRef.current = frameUrls;
  // Fence late replies after close; release every server-frame blob URL.
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; frameUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);

  const load = useCallback(async (selectId) => {
    const mine = ++seq.current;
    try {
      const { data: next } = await api.get(`/exercise-media/exercises/${exercise.id}/revisions`);
      if (!live.current || mine !== seq.current) return;
      setData(next); setLoadError(null);
      const pick = next.drafts.find((d) => d.id === selectId) || next.drafts[0] || null;
      setSelectedId(pick?.id || null);
      setForm(pick ? formFromDraft(pick) : null);
    } catch (error) {
      if (live.current && mine === seq.current) setLoadError(errMsg(error, 'Could not load exercise media.'));
    }
  }, [exercise.id]);
  useEffect(() => { load(); }, [load]);

  const draft = data?.drafts.find((d) => d.id === selectedId) || null;
  const replaceDraft = (next) => {
    setData((current) => current && { ...current, drafts: current.drafts.map((d) => (d.id === next.id ? next : d)) });
    setForm(formFromDraft(next));
  };

  // Bounded status polling while processing (<= 5 minutes, stops on close).
  useEffect(() => {
    if (draft?.status !== 'processing') return undefined;
    let polls = 0;
    const timer = setInterval(async () => {
      polls += 1;
      if (polls > 200) { clearInterval(timer); return; }
      try {
        const { data: next } = await api.get(`/exercise-media/revisions/${draft.id}`);
        if (!live.current) return;
        if (next.status !== 'processing') { clearInterval(timer); replaceDraft(next); onChanged?.(); }
      } catch (error) {
        if (error?.response?.status === 404) { clearInterval(timer); setProblem('You no longer have access to this draft.'); load(); }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [draft?.id, draft?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceContext = useMemo(() => (draft ? { type: 'revision', id: draft.id } : null), [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceIds = draft?.sources ? [draft.sources.image?.asset_id, draft.sources.video?.asset_id] : [];
  const sources = useMediaLinks(sourceContext, sourceIds.filter(Boolean), Boolean(draft?.sources));
  // The source scrubber may remount while a fresh link loads, so the editor
  // owns its refresh budget: one fresh 300 s link per successful load.
  const sourceGate = useRef(createRefreshGate());
  const sourceResume = useRef(null);
  useEffect(() => { sourceGate.current.reset(); sourceResume.current = null; }, [draft?.id]);
  const onSourceError = (atMs) => {
    if (sourceGate.current.onError() !== 'refresh') return false;
    sourceResume.current = atMs;
    sources.retry();
    return true;
  };
  const onSourceLoaded = () => { sourceGate.current.onLoaded(); const at = sourceResume.current; sourceResume.current = null; return at; };
  const currentContext = useMemo(() => ({ type: 'library', exercise_id: exercise.id }), [exercise.id]);
  const currentPoster = data?.current?.derivatives.find((d) => d.role === 'poster')?.asset_id;
  const currentLinks = useMediaLinks(currentContext, currentPoster ? [currentPoster] : [], Boolean(currentPoster));

  const act = async (name, fn) => {
    setBusy(name); setProblem(null);
    try { await fn(); } catch (error) {
      const code = error?.response?.data?.code;
      setProblem(explain(error, 'That did not work. Nothing was published.'));
      if (code === 'stale' || error?.response?.status === 404) await load(selectedId);
    } finally { if (live.current) setBusy(null); }
  };

  const createDraft = (base = null) => act('create', async () => {
    const { data: created } = await api.post(`/exercise-media/exercises/${exercise.id}/drafts`, { request_id: uuid(), confirm_exercise_id: exercise.id, ...(base ? { base_revision_id: base } : {}) });
    await load(created.revision.id);
  });

  const upload = (role) => async ({ file, rights, note, signal, onProgress }) => {
    const body = new FormData();
    body.append('request_id', uuid());
    body.append('expected_version', String(draft.version));
    body.append('rights_basis', rights);
    body.append('rights_confirmed', 'true');
    if (note.trim()) body.append('rights_note', note.trim());
    body.append('file', file);
    const { data: result } = await api.post(`/exercise-media/revisions/${draft.id}/sources?role=${role}`, body, {
      signal, timeout: 15 * 60 * 1000, onUploadProgress: (event) => event.total && onProgress(event.loaded / event.total),
    });
    replaceDraft(result.revision);
    setReplacing((current) => ({ ...current, [role]: false }));
    toast.success(role === 'source_image' ? 'Image uploaded. Crop it and add alt text.' : 'Video uploaded. Choose the poster and preview.');
  };

  const save = () => act('save', async () => {
    const patch = patchFor(draft, form);
    if (!Object.keys(patch).length) return;
    const { data: next } = await api.patch(`/exercise-media/revisions/${draft.id}/recipe`, { expected_version: draft.version, ...patch });
    replaceDraft(next);
    toast.success('Draft saved');
  });
  const processDraft = () => act('process', async () => {
    const { data: next } = await api.post(`/exercise-media/revisions/${draft.id}/process`, { expected_version: draft.version });
    replaceDraft(next);
  });
  const review = () => act('review', async () => {
    const { data: next } = await api.post(`/exercise-media/revisions/${draft.id}/review`, { expected_version: draft.version, variant_confirmed: attest.variant, rights_confirmed: attest.rights, content_confirmed: attest.content });
    replaceDraft(next); setAttest({ variant: false, rights: false, content: false });
  });
  const publish = () => act('publish', async () => {
    await api.post(`/exercise-media/exercises/${exercise.id}/publish`, { revision_id: draft.id, expected_current_version: data.current_version });
    toast.success('Published. Every workout using this exercise now shows this guide.');
    onChanged?.(); await load();
  });
  const archive = (revision, current = false) => act('archive', async () => {
    await api.post(`/exercise-media/revisions/${revision.id}/archive`, current ? { expected_current_version: data.current_version } : {});
    toast.success(current ? 'Guide withdrawn. Clients see text and external links only.' : 'Draft removed');
    onChanged?.(); await load();
  });
  const serverFrame = async (timeMs) => {
    const { data: blob } = await api.post(`/exercise-media/revisions/${draft.id}/frame-preview`, { time_ms: timeMs }, { responseType: 'blob' });
    const url = URL.createObjectURL(blob);
    setFrameUrls((current) => [...current, url]);
    return url;
  };

  if (loadError) return <div className="space-y-2" role="alert"><p className="text-sm">{loadError}</p><Button type="button" size="touch" variant="outline" onClick={() => load()}>Retry</Button></div>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading media…</p>;

  const identity = [exercise.name, exercise.equipment, exercise.category].filter(Boolean).join(' · ');
  const current = data.current;
  const editable = Boolean(draft?.permissions.can_edit);
  const set = (patch) => setForm((value) => ({ ...value, ...patch }));
  const dirty = draft && form ? Object.keys(patchFor(draft, form)).length > 0 : false;
  const video = draft?.sources?.video;
  const image = draft?.sources?.image;
  const imageUrl = image ? sources.urls.get(image.asset_id) : null;
  const videoUrl = video ? sources.urls.get(video.asset_id) : null;

  return (
    <div className="space-y-5" data-testid="exercise-media-editor">
      {(current?.simulation || data.drafts.some((d) => d.simulation)) && (
        <p className="rounded-lg border border-gold/35 bg-gold/10 p-2 text-xs" role="note" data-testid="media-simulation-note">
          Preview simulation: uploads and processing are simulated in this demo and media is synthetic. The real pipeline runs on the server.
        </p>
      )}
      <section className="rounded-lg bg-secondary/40 p-3 text-sm">
        <p className="font-medium" data-testid="media-exact-identity">{identity}</p>
        <p className="text-xs text-muted-foreground">Media attaches to this exact library exercise. Variants (equipment, grip, stance, side) need their own media.</p>
      </section>

      <section className="space-y-2" aria-labelledby="media-current-heading">
        <h3 id="media-current-heading" className="font-display text-base">Current guide</h3>
        {current ? (
          <div className="flex flex-wrap items-start gap-3" data-testid="media-current">
            {currentLinks.urls.get(currentPoster) && <img src={currentLinks.urls.get(currentPoster)} alt={current.text.alt_text || ''} width={640} height={360} crossOrigin="anonymous" className="aspect-video w-40 rounded-lg border border-border/60 object-cover" />}
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p>{MEDIA_KIND_LABELS[current.derivatives.some((d) => d.role === 'preview') ? 'video' : current.derivatives.some((d) => d.role === 'end_frame') ? 'frames' : 'photo']}{current.derivatives.some((d) => d.role === 'instruction') ? ' + full instruction' : ''}</p>
              <p className="text-xs text-muted-foreground">{current.owned_by_you ? 'Published by you' : `Published by ${current.owner_name || 'another coach'}`} · version {data.current_version}</p>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="touch" variant="outline" disabled={Boolean(busy)} onClick={() => createDraft(current.id)} data-testid="media-new-from-current"><Plus aria-hidden /> New draft from this guide</Button>
                {current.permissions.can_archive && <Button type="button" size="touch" variant="ghost" className="text-destructive" disabled={Boolean(busy)} onClick={() => archive(current, true)} data-testid="media-withdraw">Withdraw guide</Button>}
              </div>
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground" data-testid="media-none">No media yet. Clients see the exercise name, cues you write in the workout and any external link.</p>}
      </section>

      <section className="space-y-2" aria-labelledby="media-drafts-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="media-drafts-heading" className="font-display text-base">Your drafts</h3>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox checked={identityConfirmed} onCheckedChange={(value) => setIdentityConfirmed(value === true)} data-testid="media-confirm-identity" />
            This media is for exactly this exercise and variant
          </label>
          <Button type="button" size="touch" disabled={!identityConfirmed || Boolean(busy)} onClick={() => createDraft()} data-testid="media-new-draft"><Plus aria-hidden /> New draft</Button>
        </div>
        {data.drafts.length === 0 && <p className="text-sm text-muted-foreground">No drafts. Start one to upload an image or a video.</p>}
        <div className="flex flex-wrap gap-2" role="list">
          {data.drafts.map((d) => (
            <button key={d.id} type="button" role="listitem" onClick={() => { setSelectedId(d.id); setForm(formFromDraft(d)); setProblem(null); setReplacing({ source_image: false, source_video: false }); }}
              className={`min-h-11 rounded-lg border px-3 py-1 text-left text-sm ${d.id === selectedId ? 'border-primary bg-primary/10' : 'border-border'}`} aria-pressed={d.id === selectedId} data-testid="media-draft-chip">
              <StatusBadge draft={d} /> <span className="ml-1 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </section>

      {problem && <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-sm" role="alert" data-testid="media-problem"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{problem}</p>}

      {draft && form && (
        <section className="space-y-4 rounded-lg border border-border/70 p-3" aria-label="Draft editor" data-testid="media-draft-editor" data-status={draft.status}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><StatusBadge draft={draft} />{draft.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}</div>
            {draft.permissions.can_archive && <Button type="button" variant="ghost" size="touch" className="text-muted-foreground" disabled={Boolean(busy)} onClick={() => archive(draft)} data-testid="media-remove-draft"><Trash2 aria-hidden /> Remove draft</Button>}
          </div>
          <p className="sr-only" aria-live="polite" data-testid="media-status-live">{STATUS_COPY[draft.status]}</p>
          {draft.status === 'failed' && <p className="text-sm text-destructive" role="alert" data-testid="media-failed">{FAILURE_COPY[draft.failure_code] || 'Processing failed. Check the source and retry.'}</p>}

          {editable && (
            <div className="space-y-2">
              {((image && !replacing.source_image) || (video && !replacing.source_video)) && (
                <div className="flex flex-wrap gap-2">
                  {image && !replacing.source_image && <Button type="button" variant="outline" size="touch" disabled={Boolean(busy)} onClick={() => setReplacing((current) => ({ ...current, source_image: true }))} data-testid="media-replace-image"><ImageUp aria-hidden /> Replace image</Button>}
                  {video && !replacing.source_video && <Button type="button" variant="outline" size="touch" disabled={Boolean(busy)} onClick={() => setReplacing((current) => ({ ...current, source_video: true }))} data-testid="media-replace-video"><Video aria-hidden /> Replace video</Button>}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {(!image || replacing.source_image) && <UploadControl role="source_image" disabled={Boolean(busy)} onUpload={upload('source_image')} />}
                {(!video || replacing.source_video) && <UploadControl role="source_video" disabled={Boolean(busy)} onUpload={upload('source_video')} />}
              </div>
            </div>
          )}
          {(image || video) && (
            <p className="text-xs text-muted-foreground" data-testid="media-source-facts">
              {image && <>Image {image.width}×{image.height}{image.copied ? ' (kept from current guide)' : ''}. </>}
              {video && <>Video {video.width}×{video.height}, {formatMs(video.duration_ms)}{video.has_audio ? ', has audio' : ''}{video.copied ? ' (kept from current guide)' : ''}.</>}
            </p>
          )}

          {image && (
            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input type="radio" name="poster-mode" checked={form.poster_mode === 'uploaded_image'} disabled={!editable} onChange={() => set({ poster_mode: 'uploaded_image', poster_crop: defaultCrop(image) })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                Use the uploaded image as the poster
              </label>
              {form.poster_mode === 'uploaded_image' && (
                <ImageCropEditor src={imageUrl} dims={image} crop={form.poster_crop} onChange={(crop) => set({ poster_crop: crop })} label="Poster crop" disabled={!editable} testId="poster-crop" />
              )}
            </div>
          )}
          {video && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Choose from video</p>
              {videoUrl ? (
                <VideoSelectionEditor src={videoUrl} facts={{ durationMs: video.duration_ms, width: video.width, height: video.height }} recipe={form} onChange={set} onServerFrame={serverFrame} onSourceError={onSourceError} onSourceLoaded={onSourceLoaded} disabled={!editable} />
              ) : <p className="text-sm text-muted-foreground">Loading source…</p>}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="media-alt">Alt text (required)</Label>
              <Textarea id="media-alt" rows={2} maxLength={MEDIA_LIMITS.text.altMax} value={form.alt_text} disabled={!editable} onChange={(event) => set({ alt_text: event.target.value })} aria-describedby="media-alt-help" data-testid="media-alt-text" />
              <p id="media-alt-help" className="text-xs text-muted-foreground">Describe the setup and variant, e.g. equipment and stance. {form.alt_text.length}/{MEDIA_LIMITS.text.altMax}</p>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Brief cues (up to 3)</legend>
              {form.cues.map((cue, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <Input key={index} className="h-11" maxLength={MEDIA_LIMITS.text.cueMax} value={cue} disabled={!editable} aria-label={`Cue ${index + 1}`} onChange={(event) => set({ cues: form.cues.map((c, i) => (i === index ? event.target.value : c)) })} data-testid={`media-cue-${index}`} />
              ))}
            </fieldset>
            {form.end_frame_ms != null && (
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="media-end-alt">End still alt text</Label>
                <Input id="media-end-alt" className="h-11" maxLength={MEDIA_LIMITS.text.altMax} value={form.end_frame_alt_text} disabled={!editable} onChange={(event) => set({ end_frame_alt_text: event.target.value })} />
              </div>
            )}
          </div>

          {video && (
            <fieldset className="space-y-2 rounded-lg border border-border/60 p-3">
              <legend className="px-1 text-sm font-medium">Full instruction (separate from the inline preview)</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={Boolean(form.include_instruction)} disabled={!editable} onCheckedChange={(value) => set({ include_instruction: value === true })} data-testid="media-include-instruction" /> Offer the full video as instruction</label>
              {form.include_instruction && (
                <>
                  <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={form.instruction_audio} disabled={!editable} onCheckedChange={(value) => set({ instruction_audio: value === true })} /> The audio has meaningful narration (captions and transcript required)</label>
                  <CaptionRows cues={form.caption_cues} onChange={(caption_cues) => set({ caption_cues })} durationMs={video.duration_ms} disabled={!editable} />
                  <Label htmlFor="media-transcript">Transcript</Label>
                  <Textarea id="media-transcript" rows={3} maxLength={MEDIA_LIMITS.text.transcriptMax} value={form.transcript} disabled={!editable} onChange={(event) => set({ transcript: event.target.value })} />
                </>
              )}
            </fieldset>
          )}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="touch" disabled={!dirty || Boolean(busy)} onClick={save} data-testid="media-save">{busy === 'save' ? <Loader2 className="animate-spin" aria-hidden /> : null}Save draft</Button>
              <Button type="button" size="touch" variant="outline" disabled={dirty || Boolean(busy) || !draft.permissions.can_process} onClick={processDraft} data-testid="media-process">
                {busy === 'process' ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{draft.status === 'failed' ? 'Retry processing' : 'Process media'}
              </Button>
              {dirty && <span className="self-center text-xs text-muted-foreground">Save changes before processing.</span>}
            </div>
          )}

          {draft.status === 'ready' && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3" data-testid="media-review">
              <h4 className="font-display text-base">Review the generated media</h4>
              <DerivativeReview draft={draft} />
              {draft.review_status === 'needs_review' && draft.permissions.can_review && (
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Before approving, confirm:</legend>
                  <label className="flex min-h-11 items-start gap-2 text-sm"><Checkbox className="mt-1" checked={attest.variant} onCheckedChange={(v) => setAttest((a) => ({ ...a, variant: v === true }))} data-testid="attest-variant" />It shows exactly {identity}.</label>
                  <label className="flex min-h-11 items-start gap-2 text-sm"><Checkbox className="mt-1" checked={attest.rights} onCheckedChange={(v) => setAttest((a) => ({ ...a, rights: v === true }))} data-testid="attest-rights" />We own it or have permission to use it.</label>
                  <label className="flex min-h-11 items-start gap-2 text-sm"><Checkbox className="mt-1" checked={attest.content} onCheckedChange={(v) => setAttest((a) => ({ ...a, content: v === true }))} data-testid="attest-content" />The media, alt text and cues are accurate for this exercise.</label>
                  <Button type="button" size="touch" disabled={!attest.variant || !attest.rights || !attest.content || Boolean(busy)} onClick={review} data-testid="media-approve"><ShieldCheck aria-hidden /> Approve</Button>
                </fieldset>
              )}
              {draft.review_status === 'approved' && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Approved{draft.reviewed?.by_you ? ' by you' : ''}.</p>
                  {draft.permissions.publish_requires_admin && <p className="text-sm text-muted-foreground">Another coach owns the current guide; an admin must publish this replacement.</p>}
                  <Button type="button" size="touch" disabled={!draft.permissions.can_publish || Boolean(busy)} onClick={publish} data-testid="media-publish">Publish as current guide</Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
