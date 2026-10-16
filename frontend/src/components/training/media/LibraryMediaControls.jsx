import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExerciseMediaEditor } from './ExerciseMediaEditor';

// Server-computed catalog readiness. { enabled: false } (or any failure) means
// media is off in this environment: every control here hides and the library
// works as before.
export function useLibraryMediaStatus() {
  const [state, setState] = useState({ enabled: false, byExercise: new Map(), summary: null });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const { data } = await api.get('/exercise-media/library-status');
      if (mine !== seq.current) return;
      if (data?.enabled === false) { setState({ enabled: false, byExercise: new Map(), summary: null }); return; }
      setState({ enabled: true, byExercise: new Map(data.items.map((item) => [item.exercise_id, item])), summary: data.summary });
    } catch {
      if (mine === seq.current) setState({ enabled: false, byExercise: new Map(), summary: null });
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export const MEDIA_FILTERS = [
  ['all', 'All media states', () => true],
  ['none', 'No media', (item) => !item || item.current_kind === 'none'],
  ['photo', 'Photo only', (item) => item?.current_kind === 'photo'],
  ['frames', 'Start/end stills', (item) => item?.current_kind === 'frames'],
  ['video', 'Ready video', (item) => item?.current_kind === 'video'],
  ['needs_review', 'Needs review', (item) => item?.drafts_needs_review > 0 || item?.drafts_ready_to_publish > 0],
  ['failed', 'Processing failed', (item) => item?.drafts_failed > 0],
];
export function matchesMediaFilter(item, filter) {
  const entry = MEDIA_FILTERS.find(([key]) => key === filter);
  return entry ? entry[2](item) : true;
}

export function MediaReadinessFilter({ value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 w-full rounded-xl" aria-label="Filter by media readiness" data-testid="exercise-library-filter-media"><SelectValue /></SelectTrigger>
      <SelectContent>{MEDIA_FILTERS.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export function LibraryMediaSummary({ summary }) {
  if (!summary) return null;
  const parts = [
    [summary.photo_only, 'photo only'], [summary.frames, 'stills'], [summary.ready_video, 'video'],
    [summary.needs_review, 'need review'], [summary.processing, 'processing'], [summary.processing_failed, 'failed'], [summary.no_media, 'no media'],
  ].filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  return <p className="text-xs text-muted-foreground" data-testid="exercise-library-media-summary">Media: {parts.join(' · ') || 'none yet'}</p>;
}

const KIND_BADGE = { photo: 'Photo', frames: 'Stills', video: 'Video' };
export function ExerciseMediaBadge({ item }) {
  if (!item) return null;
  const labels = [];
  if (KIND_BADGE[item.current_kind]) labels.push([KIND_BADGE[item.current_kind] + (item.current_has_instruction ? ' + instruction' : ''), 'text-primary border-primary/40']);
  if (item.drafts_needs_review > 0 || item.drafts_ready_to_publish > 0) labels.push(['Needs review', 'border-gold/40 text-gold']);
  if (item.drafts_processing > 0) labels.push(['Processing', 'text-muted-foreground']);
  if (item.drafts_failed > 0) labels.push(['Processing failed', 'border-destructive/40 text-destructive']);
  return labels.map(([label, className]) => <Badge key={label} variant="outline" className={className} data-testid="exercise-media-badge">{label}</Badge>);
}

export function ExerciseMediaButton({ exercise, onOpen }) {
  return (
    <Button type="button" variant="ghost" size="touchIcon" className="rounded-lg" onClick={() => onOpen(exercise)} aria-label={`Media for ${exercise.name}`} title="Photo and video" data-testid="exercise-library-media-button">
      <ImageIcon className="h-3.5 w-3.5" />
    </Button>
  );
}

export function ExerciseMediaDialog({ exercise, onClose, onChanged }) {
  const opener = useRef(null);
  return (
    <Dialog open={Boolean(exercise)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-h-[92dvh] max-w-3xl overflow-y-auto [&>button]:h-11 [&>button]:w-11"
        onOpenAutoFocus={() => { opener.current = document.activeElement; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus?.(); }}
        data-testid="exercise-media-dialog"
      >
        <DialogHeader>
          <DialogTitle className="pr-10">Photo and video: {exercise?.name}</DialogTitle>
          <DialogDescription>Upload owned media, crop and review it, then publish. Clients see only the published guide.</DialogDescription>
        </DialogHeader>
        {exercise && <ExerciseMediaEditor exercise={exercise} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}
