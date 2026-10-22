import { useState } from 'react';
import { MessageSquareText, Scale } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

// pt-session-events/v1 client views (L12/PT-Sub). Only facts about the
// client's own workout appear here; nothing from the coach's private notes.

export function setValueText(value = {}) {
  const parts = [];
  if (value.actual_reps != null) parts.push(`${value.actual_reps} reps`);
  if (value.actual_load_value != null) parts.push(`${Number(value.actual_load_value)} ${value.actual_load_unit || 'lb'}`);
  if (value.actual_duration_value != null) parts.push(`${value.actual_duration_value} ${value.actual_duration_unit || ''}`.trim());
  if (value.actual_distance_value != null) parts.push(`${value.actual_distance_value} ${value.actual_distance_unit || ''}`.trim());
  const text = parts.join(' × ') || 'no values';
  return value.status === 'completed' ? `${text} (done)` : `${text} (not done)`;
}

const whoLabel = (role, viewer) => (role === viewer ? 'You' : role === 'coach' ? 'Your coach' : 'Your client');

/** One retained disagreement on a set, with the client's optional note. */
export function SetConflictNotice({ conflict, logId, viewer = 'client', online = true, onChanged }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const open = conflict.status === 'open';
  const chosen = conflict.resolution_choice === 'current' ? conflict.kept_value : conflict.resolution_choice === 'incoming' ? conflict.incoming_value : conflict.resolved_value;
  const sendNote = async () => {
    setSaving(true);
    try {
      await api.post(`/workout-logs/${logId}/sets/${conflict.workout_log_set_id}/conflicts/${conflict.id}/note`, { note });
      setNote('');
      toast.success('Note sent to your coach');
      onChanged?.();
    } catch (error) {
      toast.error(errMsg(error, 'The note was not saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="col-span-full space-y-2 rounded-md border border-gold/40 bg-gold/10 p-2 text-xs" data-testid="set-conflict" data-status={conflict.status}>
      <p className="flex items-start gap-1.5 font-medium">
        <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {viewer === 'coach'
          ? (open ? 'Two different values were entered for this set. Both are kept until you choose.' : 'You chose the final value for this set.')
          : (open ? 'Two different values were entered for this set. Both are kept until your coach chooses.' : 'Your coach chose the final value for this set.')}
      </p>
      <ul className="space-y-0.5 text-muted-foreground">
        <li data-testid="set-conflict-kept">{whoLabel(conflict.kept_actor_role, viewer)}: {setValueText(conflict.kept_value)}</li>
        <li data-testid="set-conflict-incoming">{whoLabel(conflict.incoming_actor_role, viewer)}{conflict.incoming_offline ? ' (entered offline)' : ''}: {setValueText(conflict.incoming_value)}</li>
        {!open && <li className="text-foreground" data-testid="set-conflict-final">Final: {setValueText(chosen)}</li>}
      </ul>
      {conflict.client_note && <p className="flex items-start gap-1.5"><MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Client note: {conflict.client_note}</p>}
      {viewer === 'client' && (
        online ? (
          <div className="flex gap-2">
            <Input className="h-11 min-w-0 flex-1 text-sm" maxLength={500} value={note} placeholder="Add a note for your coach"
              onChange={(event) => setNote(event.target.value)} aria-label="Note about this set for your coach" data-testid="set-conflict-note-input" />
            <Button type="button" size="sm" className="min-h-11" disabled={!note.trim() || saving} onClick={sendNote} data-testid="set-conflict-note-send">Send</Button>
          </div>
        ) : <p className="text-muted-foreground">Connect to add a note.</p>
      )}
    </div>
  );
}

const SOURCE_LABEL = {
  coach_backup: 'coach-approved backup',
  catalog_suggestion: 'your choice from suggestions',
};

/** Exercise-level swap status: original kept, substitute labelled honestly. */
export function SwapStatus({ exercise, log, viewer = 'client' }) {
  const coachView = viewer === 'coach';
  const subs = log.substitutions || [];
  if (exercise.substitutes_log_exercise_id) {
    const sub = subs.find((row) => row.id === exercise.substitution_id) || exercise.pending_swap_meta;
    const original = log.exercises.find((row) => row.id === exercise.substitutes_log_exercise_id);
    const review = sub?.coach_review_status === 'pending' ? (coachView ? ' · chosen offline, needs your review' : ' · chosen offline, your coach will review')
      : sub?.coach_review_status === 'reviewed' ? (coachView ? ' · reviewed' : ' · reviewed by your coach') : '';
    const approval = sub?.decided_by_coach_id ? (coachView ? ' · approved by you' : ' · approved by your coach') : '';
    return (
      <p className="text-xs text-primary" data-testid="swap-substitute-label">
        Substitute for {original?.exercise_name || 'the planned exercise'}{sub ? ` · ${SOURCE_LABEL[sub.source] || 'swap'}` : ''}{approval}{review}{exercise.local_only ? ' · saved on this phone, syncing' : ''}
      </p>
    );
  }
  const sub = [...subs].reverse().find((row) => row.original_log_exercise_id === exercise.id);
  const local = exercise.pending_swap;
  if (sub?.status === 'pending_confirmation' || (local && !local.activate && !sub)) {
    return <p className="text-xs text-gold" data-testid="swap-waiting">{coachView ? `Asks to swap to ${sub?.replacement_name || local?.name}. Approve or decline below.` : `Waiting for your coach to approve ${sub?.replacement_name || local?.name}. Do the planned exercise or wait.`}</p>;
  }
  if (sub?.status === 'declined') return <p className="text-xs text-muted-foreground" data-testid="swap-declined">{coachView ? 'You declined' : 'Your coach declined'} {sub.replacement_name}. The planned exercise stays.</p>;
  if (sub?.status === 'active' || local?.activate) {
    const name = sub?.replacement_name || local?.name;
    return <p className="text-xs text-muted-foreground" data-testid="swap-original-kept">Swapped for {name} this workout. Original plan kept: {[exercise.prescribed_sets && `${exercise.prescribed_sets} sets`, exercise.prescribed_reps && `${exercise.prescribed_reps} reps`, exercise.prescribed_load_value != null && `${exercise.prescribed_load_value} ${exercise.prescribed_load_unit || 'lb'}`].filter(Boolean).join(' × ') || 'as written'}.</p>;
  }
  return null;
}

export function canSwap(exercise, log, sealed) {
  if (sealed || exercise.substitutes_log_exercise_id || exercise.pending_swap) return false;
  return !(log.substitutions || []).some((row) => row.original_log_exercise_id === exercise.id && ['active', 'pending_confirmation'].includes(row.status));
}
