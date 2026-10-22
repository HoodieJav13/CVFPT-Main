import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { makeId } from '@/lib/workoutOutbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { setValueText } from '@/components/training/SessionCorrections';

// Coach decisions on pt-session-events/v1 (L12/CONTRACT.md §1, §5). Every
// decision carries an event id, so a repeated tap or a lost reply replays.

export function CoachConflictActions({ conflict, logId, onDone }) {
  const [busy, setBusy] = useState(false);
  if (conflict.status !== 'open') return null;
  const resolve = async (choice) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/workout-logs/${logId}/sets/${conflict.workout_log_set_id}/conflicts/${conflict.id}/resolve`, { event_id: makeId(), choice });
      toast.success('Final value saved. Both entries stay in the history.');
      onDone?.(data.log);
    } catch (error) {
      toast.error(errMsg(error, 'Not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const label = (role) => (role === 'coach' ? 'yours' : "the client's");
  return (
    <div className="col-span-full flex flex-wrap gap-2" data-testid="conflict-actions">
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => resolve('current')} data-testid="conflict-keep-current">
        Keep {label(conflict.kept_actor_role)}: {setValueText(conflict.kept_value)}
      </Button>
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => resolve('incoming')} data-testid="conflict-keep-incoming">
        Keep {label(conflict.incoming_actor_role)}: {setValueText(conflict.incoming_value)}
      </Button>
    </div>
  );
}

function ProgramApplyDialog({ sub, assignmentId, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [targets, setTargets] = useState({ sets: '', reps: '', load_value: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/programs/assignments/${assignmentId}/substitution-preview`, { params: { substitution_id: sub.id } });
      setPreview(data);
      setError('');
    } catch (err) {
      setError(errMsg(err, 'Could not build the preview.'));
    }
  }, [assignmentId, sub.id]);
  useEffect(() => { load(); }, [load]);
  const apply = async () => {
    setBusy(true);
    try {
      const clean = {};
      if (String(targets.sets).trim()) clean.sets = Number(targets.sets);
      if (String(targets.reps).trim()) clean.reps = String(targets.reps).trim();
      if (String(targets.load_value).trim()) { clean.load_value = Number(targets.load_value); clean.load_unit = 'lb'; }
      await api.post(`/programs/assignments/${assignmentId}/apply-substitution`, {
        event_id: makeId(), substitution_id: sub.id, expected_item_ids: preview.items.map((item) => item.workout_exercise_id), targets: clean,
      });
      toast.success(`Updated ${preview.items.length} future program item(s). Logged workouts are unchanged.`);
      onClose(true);
    } catch (err) {
      setError(errMsg(err, 'Not applied. The preview was refreshed; check it again.'));
      load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(false); }}>
      <DialogContent data-testid="program-apply-dialog">
        <DialogHeader>
          <DialogTitle>Apply to the rest of this program?</DialogTitle>
          <DialogDescription>
            Replace {sub.original_name} with {sub.replacement_name} in this client&apos;s future program workouts only.
            Workouts already logged keep exactly what was done. This is your choice; the client cannot do it.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {preview?.program?.shared && <p className="text-sm text-destructive">This program still uses shared template workouts. Change it in the program builder instead.</p>}
        {preview && !preview.program.shared && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1" data-testid="program-apply-items">
              {preview.items.map((item) => (
                <li key={item.workout_exercise_id}>Day {item.day_number} · {item.workout_name}: {sub.original_name} ({[item.current.sets && `${item.current.sets} sets`, item.current.reps && `${item.current.reps} reps`, item.current.load_value != null && `${item.current.load_value} ${item.current.load_unit}`].filter(Boolean).join(' × ') || 'no targets'}) → {sub.replacement_name}</li>
              ))}
              {!preview.items.length && <li>Nothing in the remaining program uses {sub.original_name}.</li>}
            </ul>
            <fieldset className="space-y-1">
              <legend className="text-xs text-muted-foreground">Targets for {sub.replacement_name} (blank stays blank; nothing is copied across movements)</legend>
              <div className="grid grid-cols-3 gap-2">
                <Input className="min-h-11" placeholder="Sets" value={targets.sets} onChange={(e) => setTargets((t) => ({ ...t, sets: e.target.value }))} data-testid="program-apply-sets" />
                <Input className="min-h-11" placeholder="Reps" value={targets.reps} onChange={(e) => setTargets((t) => ({ ...t, reps: e.target.value }))} data-testid="program-apply-reps" />
                <Input className="min-h-11" placeholder="Load lb" value={targets.load_value} onChange={(e) => setTargets((t) => ({ ...t, load_value: e.target.value }))} data-testid="program-apply-load" />
              </div>
            </fieldset>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>Keep this workout only</Button>
          <Button disabled={!preview || preview.program.shared || !preview.items.length || busy} onClick={apply} data-testid="program-apply-confirm">Apply to {preview?.items.length || 0} item(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SOURCE = { coach_backup: 'your planned backup', catalog_suggestion: 'a catalog suggestion' };

export function CoachSwapActions({ log, onDone }) {
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(null);
  const subs = log.substitutions || [];
  if (!subs.length) return null;
  const post = async (path, body, success) => {
    setBusy(true);
    try {
      const { data } = await api.post(path, { event_id: makeId(), ...body });
      toast.success(success);
      onDone?.(data.log);
    } catch (error) {
      toast.error(errMsg(error, 'Not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2" data-testid="coach-swaps">
      <h3 className="text-sm font-semibold">Exercise swaps</h3>
      {subs.map((sub) => (
        <div key={sub.id} className="space-y-1 rounded-lg border border-border p-3 text-sm" data-testid={`coach-swap-${sub.id}`} data-status={sub.status} data-review={sub.coach_review_status}>
          <p><span className="font-medium">{sub.original_name} → {sub.replacement_name}</span> · {SOURCE[sub.source]}{sub.offline ? ' · chosen offline' : ''}</p>
          <p className="text-xs text-muted-foreground">
            Why: {sub.trigger.replace(/_/g, ' ')}{sub.reason ? ` · “${sub.reason}”` : ''}
            {sub.source === 'catalog_suggestion' && sub.status === 'active' && !sub.decided_by_coach_id && sub.actor_role === 'client' ? ' · client-recorded deviation, not your endorsement' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {sub.status === 'pending_confirmation' && (
              <>
                <Button type="button" size="sm" className="min-h-11" disabled={busy} onClick={() => post(`/workout-logs/${log.id}/substitutions/${sub.id}/decision`, { decision: 'approve' }, 'Approved for this workout.')} data-testid="swap-approve">Approve for this workout</Button>
                <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => post(`/workout-logs/${log.id}/substitutions/${sub.id}/decision`, { decision: 'decline' }, 'Declined.')} data-testid="swap-decline">Decline</Button>
              </>
            )}
            {sub.coach_review_status === 'pending' && (
              <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => post(`/workout-logs/${log.id}/substitutions/${sub.id}/review`, {}, 'Marked reviewed.')} data-testid="swap-review">Mark reviewed</Button>
            )}
            {sub.status === 'active' && log.program_assignment_id && (
              <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setApplying(sub)} data-testid="swap-apply-program">Apply to remaining program…</Button>
            )}
            {sub.status === 'declined' && <span className="text-xs text-muted-foreground">Declined</span>}
          </div>
        </div>
      ))}
      {applying && <ProgramApplyDialog sub={applying} assignmentId={log.program_assignment_id} onClose={(changed) => { setApplying(null); if (changed) onDone?.(); }} />}
    </section>
  );
}
