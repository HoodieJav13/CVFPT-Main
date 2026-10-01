import { useState } from 'react';
import { Check, ChevronRight, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatRestSeconds } from '@/lib/rest';
import { formatTimer, useRestCountdown } from '@/lib/useRestCountdown';
import { nextExercise as nextInRound } from '@/lib/supersets';

// Focused set entry (round-2 design decision, 2026-09-29): one set at a time,
// with a dedicated rest screen and explicit corrections. It reuses the
// tracker's save/log/rest handlers, so what gets stored is identical to the
// set table. Rule: a target never becomes a logged value on its own. Blank
// fields save as blank ("Not recorded"); only a typed value or a +/- tap
// fills a field.

const LOAD_STEP = { lb: 5, kg: 2.5 };

function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

function firstNumber(text) {
  const match = String(text ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function tidy(value) {
  return Number(value.toFixed(2));
}

function loadUnit(exercise, set) {
  return set.actual_load_unit || exercise.prescribed_load_unit || 'lb';
}

function describeSet(exercise, set) {
  const weight = isBlank(set.actual_load_value) ? 'Weight not recorded' : `${set.actual_load_value} ${loadUnit(exercise, set)}`;
  const reps = isBlank(set.actual_reps) ? 'reps not recorded' : `${set.actual_reps} reps`;
  const rpe = isBlank(set.actual_rpe) ? 'RPE not recorded' : `RPE ${set.actual_rpe}`;
  return `${weight} · ${reps} · ${rpe}`;
}

function targetParts(exercise) {
  const parts = [];
  if (exercise.prescribed_reps) parts.push(`${exercise.sets.length} × ${exercise.prescribed_reps}`);
  if (exercise.prescribed_load_value != null) parts.push(`${exercise.prescribed_load_value} ${exercise.prescribed_load_unit || 'lb'}`);
  if (exercise.prescribed_rpe) parts.push(`RPE ${exercise.prescribed_rpe}`);
  if (exercise.prescribed_rest_seconds != null) parts.push(`rest ${formatRestSeconds(exercise.prescribed_rest_seconds)}`);
  else if (exercise.prescribed_rest) parts.push(`rest ${exercise.prescribed_rest}`);
  if (exercise.prescribed_tempo) parts.push(`tempo ${exercise.prescribed_tempo}`);
  return parts;
}

function Stepper({ id, label, hint, value, onChange, onBlur, onStep, disabled, inputMode, step, min, max, target, extra }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex h-8 items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}{hint && <>{' '}<span className="font-normal normal-case tracking-normal">{hint}</span></>}
        </label>
        {extra}
      </div>
      <div className="flex items-stretch gap-1.5">
        <Button type="button" variant="outline" className="h-16 w-11 shrink-0 px-0" disabled={disabled} onClick={() => onStep(-1)} aria-label={`Decrease ${label === 'RPE' ? label : label.toLowerCase()}`}>
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          id={id}
          type="number"
          inputMode={inputMode}
          step={step}
          min={min}
          max={max}
          value={value ?? ''}
          placeholder="—"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="h-16 min-w-0 flex-1 px-1 text-center font-display text-3xl font-semibold tabular-nums placeholder:text-muted-foreground/50"
        />
        <Button type="button" variant="outline" className="h-16 w-11 shrink-0 px-0" disabled={disabled} onClick={() => onStep(1)} aria-label={`Increase ${label === 'RPE' ? label : label.toLowerCase()}`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground" data-testid={`${id}-target`}>{target ? `Target ${target}` : 'No target'}</p>
    </div>
  );
}

function RestPanel({ seconds, restTotal, nextLabel, onExtend, onSkip }) {
  const pct = restTotal ? Math.max(0, Math.min(100, Math.round((1 - seconds / restTotal) * 100))) : 0;
  return (
    <section className="rounded-xl border border-primary/40 bg-primary/10 p-5 text-center" data-testid="focused-rest">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Rest</p>
      <p className="mt-1 font-display text-6xl font-semibold tabular-nums" role="timer" aria-label={`Rest, ${formatTimer(seconds)} left`}>{formatTimer(seconds)}</p>
      {restTotal > 0 && (
        <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-background/60" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-4 flex justify-center gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onExtend}>+30s</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onSkip}>Skip rest</Button>
      </div>
      {nextLabel && <p className="mt-4 text-sm text-muted-foreground">Next: <span className="font-medium text-foreground">{nextLabel}</span></p>}
    </section>
  );
}

export default function FocusedEntry({
  log, sealed, restEndsAt, restAlerts, attentionScale,
  onExtendRest, onSkipRest, setLocalValue, saveSet, toggleSet, removeSet,
  onOpenFinish, completedCount, totalCount, renderExerciseTools,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);
  // One countdown for the whole screen: it stays mounted while the rest panel
  // comes and goes, so the opt-in end-of-rest cue always fires exactly once.
  const { seconds: restSeconds, complete: restComplete } = useRestCountdown(restEndsAt, restAlerts);

  const exercises = log.exercises;
  // Same "current exercise" rule as the set table: inside a superset or
  // giant set it alternates between members round by round.
  const firstOpen = nextInRound(exercises);
  const exercise = exercises.find((row) => row.id === selectedId) || firstOpen || exercises[0];
  if (!exercise) return null;

  const index = exercises.indexOf(exercise);
  const pendingSet = exercise.sets.find((set) => set.status !== 'completed');
  const editingSet = editing ? exercise.sets.find((set) => set.id === editing.setId) : null;
  const currentSet = editingSet || pendingSet;
  const loggedSets = exercise.sets.filter((set) => set.status === 'completed');
  // Up next: what the round order picks once this set is logged, else the
  // next exercise with sets left.
  const afterThisSet = pendingSet
    ? exercises.map((row) => (row.id !== exercise.id ? row : {
      ...row, sets: row.sets.map((set) => (set.id === pendingSet.id ? { ...set, status: 'completed' } : set)),
    }))
    : exercises;
  const inRound = nextInRound(afterThisSet);
  const nextExercise = (inRound && inRound.id !== exercise.id ? exercises.find((row) => row.id === inRound.id) : null)
    || exercises.slice(index + 1).find((row) => row.sets.some((set) => set.status !== 'completed'))
    || exercises.slice(0, index).find((row) => row.sets.some((set) => set.status !== 'completed'));
  const resting = Boolean(restEndsAt) && !restComplete && !editingSet;
  const allDone = totalCount > 0 && completedCount === totalCount;

  const selectExercise = (id) => {
    setEditing(null);
    setSelectedId(id);
  };

  const commit = (set, patch) => {
    Object.entries(patch).forEach(([key, value]) => setLocalValue(exercise.id, set.id, key, value));
    saveSet(exercise, { ...set, ...patch });
  };

  const step = (set, key, direction) => {
    const current = set[key];
    if (key === 'actual_load_value') {
      const unit = loadUnit(exercise, set);
      const next = isBlank(current)
        ? (exercise.prescribed_load_value ?? 0)
        : Math.max(0, tidy(Number(current) + direction * LOAD_STEP[unit]));
      commit(set, { actual_load_value: next, actual_load_unit: unit });
    } else if (key === 'actual_reps') {
      const next = isBlank(current)
        ? (firstNumber(exercise.prescribed_reps) ?? (direction > 0 ? 1 : 0))
        : Math.max(0, Number(current) + direction);
      commit(set, { actual_reps: next });
    } else {
      const next = isBlank(current)
        ? Math.min(10, Math.max(1, firstNumber(exercise.prescribed_rpe) ?? 7))
        : Math.min(10, Math.max(1, tidy(Number(current) + direction * 0.5)));
      commit(set, { actual_rpe: next });
    }
  };

  const startEdit = (set) => {
    setEditing({
      setId: set.id,
      snapshot: {
        actual_load_value: set.actual_load_value ?? null,
        actual_load_unit: set.actual_load_unit ?? null,
        actual_reps: set.actual_reps ?? null,
        actual_rpe: set.actual_rpe ?? null,
      },
    });
  };

  const cancelEdit = () => {
    if (editingSet) commit(editingSet, editing.snapshot);
    setEditing(null);
  };

  const saveEdit = () => {
    saveSet(exercise, editingSet);
    setEditing(null);
  };

  const undoLog = () => {
    toggleSet(exercise, editingSet);
    setEditing(null);
  };

  let primary;
  if (editingSet) primary = { label: `Save set ${editingSet.set_number}`, onClick: saveEdit, testId: 'focused-save-edit' };
  else if (resting && pendingSet) primary = { label: `Start set ${pendingSet.set_number} now`, onClick: onSkipRest, testId: 'focused-skip-rest' };
  else if (pendingSet) {
    primary = {
      label: `Log set ${pendingSet.set_number}`,
      // Inside a superset, logging hands off to the round's next member.
      onClick: () => { if (exercise.superset_group) setSelectedId(null); toggleSet(exercise, pendingSet); },
      testId: 'focused-log-set',
    };
  }
  else if (nextExercise) primary = { label: 'Next exercise', onClick: () => selectExercise(nextExercise.id), testId: 'focused-next-exercise' };
  else primary = { label: 'Finish workout', onClick: onOpenFinish, testId: 'focused-finish-all', disabled: !completedCount };

  const unit = currentSet ? loadUnit(exercise, currentSet) : 'lb';
  const setTotal = exercise.sets.length;
  const nextLabel = pendingSet
    ? `set ${pendingSet.set_number}${exercise.prescribed_reps ? ` · target ${exercise.prescribed_reps}` : ''}${exercise.prescribed_load_value != null ? ` × ${exercise.prescribed_load_value} ${exercise.prescribed_load_unit || 'lb'}` : ''}`
    : nextExercise ? nextExercise.exercise_name : null;

  return (
    <div className="space-y-5" data-testid="focused-entry">
      <nav aria-label="Exercises" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {exercises.map((row, rowIndex) => {
          const done = row.sets.filter((set) => set.status === 'completed').length;
          const selected = row.id === exercise.id;
          const finished = row.sets.length > 0 && done === row.sets.length;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => selectExercise(row.id)}
              aria-pressed={selected}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors motion-reduce:transition-none',
                selected ? 'border-foreground bg-card font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
              data-testid="focused-exercise-chip"
            >
              {finished ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <span className="tabular-nums">{rowIndex + 1}</span>}
              <span className="max-w-[10rem] truncate">{row.exercise_name}</span>
              <span className="tabular-nums text-muted-foreground" aria-label={`${done} of ${row.sets.length} sets logged`}>{done}/{row.sets.length}</span>
            </button>
          );
        })}
      </nav>

      <header className="space-y-2">
        <h2 className="font-display text-3xl font-semibold uppercase leading-none tracking-tight">{exercise.exercise_name}</h2>
        {targetParts(exercise).length > 0 && (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground" data-testid="focused-target-line">
            <span className="rounded border border-dashed border-muted-foreground/60 px-1.5 text-[11px] font-semibold uppercase tracking-wider">Target</span>
            <span>{targetParts(exercise).join(' · ')}</span>
          </p>
        )}
        {exercise.prescribed_notes && <p className="text-sm">{exercise.prescribed_notes}</p>}
      </header>

      {resting && pendingSet ? (
        <RestPanel
          seconds={restSeconds}
          restTotal={exercise.prescribed_rest_seconds || 0}
          nextLabel={nextLabel}
          onExtend={onExtendRest}
          onSkip={onSkipRest}
        />
      ) : currentSet ? (
        <section className="space-y-4" data-testid="focused-set-fields">
          {editingSet ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2" data-testid="focused-editing-banner">
              <p className="text-sm font-semibold">Editing set {editingSet.set_number}</p>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={undoLog} disabled={sealed}>Mark not done</Button>
                <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={cancelEdit}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-xl font-semibold uppercase">Set {currentSet.set_number} of {setTotal}</p>
              {restEndsAt && restComplete && (
                <p className="motion-attention-pop-once text-sm font-semibold text-success" style={{ '--motion-attention-scale': attentionScale }}>Rest complete</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Stepper
              id="focused-weight"
              label="Weight"
              value={currentSet.actual_load_value}
              onChange={(value) => setLocalValue(exercise.id, currentSet.id, 'actual_load_value', value)}
              onBlur={() => saveSet(exercise, currentSet)}
              onStep={(direction) => step(currentSet, 'actual_load_value', direction)}
              disabled={sealed}
              inputMode="decimal"
              step="0.5"
              min="0"
              target={exercise.prescribed_load_value != null ? `${exercise.prescribed_load_value} ${exercise.prescribed_load_unit || 'lb'}` : null}
              extra={(
                <div className="flex overflow-hidden rounded-md border border-border text-xs" role="group" aria-label="Weight unit">
                  {['lb', 'kg'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={sealed}
                      aria-pressed={unit === option}
                      onClick={() => commit(currentSet, { actual_load_unit: option })}
                      className={cn('min-h-8 px-2.5 font-medium', unit === option ? 'bg-foreground text-background' : 'text-muted-foreground')}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            />
            <Stepper
              id="focused-reps"
              label="Reps"
              hint="(optional)"
              value={currentSet.actual_reps}
              onChange={(value) => setLocalValue(exercise.id, currentSet.id, 'actual_reps', value)}
              onBlur={() => saveSet(exercise, currentSet)}
              onStep={(direction) => step(currentSet, 'actual_reps', direction)}
              disabled={sealed}
              inputMode="numeric"
              step="1"
              min="0"
              target={exercise.prescribed_reps || null}
            />
          </div>
          <Stepper
            id="focused-rpe"
            label="RPE"
            hint="(optional)"
            value={currentSet.actual_rpe}
            onChange={(value) => setLocalValue(exercise.id, currentSet.id, 'actual_rpe', value)}
            onBlur={() => saveSet(exercise, currentSet)}
            onStep={(direction) => step(currentSet, 'actual_rpe', direction)}
            disabled={sealed}
            inputMode="decimal"
            step="0.5"
            min="1"
            max="10"
            target={exercise.prescribed_rpe || null}
            extra={!isBlank(currentSet.actual_rpe) && (
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={sealed} onClick={() => commit(currentSet, { actual_rpe: null })}>
                Clear
              </Button>
            )}
          />
          {!editingSet && currentSet.set_origin === 'extra' && (
            <Button type="button" size="sm" variant="ghost" className="min-h-11 text-muted-foreground" disabled={sealed} onClick={() => removeSet(exercise, currentSet)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove this extra set
            </Button>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-success/40 bg-success/5 p-5 text-center" data-testid="focused-exercise-done">
          <p className="font-display text-xl font-semibold uppercase">All {setTotal} sets logged</p>
          <p className="mt-1 text-sm text-muted-foreground">{nextExercise ? `Up next: ${nextExercise.exercise_name}` : allDone ? 'That was the last set.' : ''}</p>
        </section>
      )}

      {loggedSets.length > 0 && (
        <section aria-label="Logged sets" className="divide-y divide-border/70 border-y border-border/70" data-testid="focused-logged-sets">
          {loggedSets.map((set) => {
            const isEditing = editingSet?.id === set.id;
            return (
              <div key={set.id} className={cn('flex min-h-12 items-center gap-3 py-1', isEditing && '-mx-2 rounded-md bg-gold/10 px-2')}>
                <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <span className="w-12 shrink-0 text-sm text-muted-foreground">Set {set.set_number}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold tabular-nums" data-testid="focused-logged-values">{describeSet(exercise, set)}</span>
                <Button
                  type="button" variant="ghost" size="sm" className="min-h-11 shrink-0"
                  disabled={sealed || isEditing}
                  onClick={() => startEdit(set)}
                  aria-label={`Edit set ${set.set_number}`}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" /> {isEditing ? 'Editing' : 'Edit'}
                </Button>
              </div>
            );
          })}
        </section>
      )}

      {renderExerciseTools(exercise)}

      {nextExercise && pendingSet && (
        <button
          type="button"
          onClick={() => selectExercise(nextExercise.id)}
          className="flex min-h-12 w-full items-center justify-between border-t border-border/70 pt-3 text-left"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next</span>
            <span className="text-sm font-medium">{nextExercise.exercise_name}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </button>
      )}

      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="rest-complete-announcement">
        {restEndsAt && restComplete ? 'Rest complete' : ''}
      </div>

      <div className="signature-glass sticky bottom-20 z-30 flex flex-col gap-2 rounded-2xl p-2.5 lg:bottom-4" data-testid="workout-control-dock">
        <div className="flex items-center gap-2 px-1">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Sets completed"
            aria-valuemin={0}
            aria-valuemax={totalCount}
            aria-valuenow={completedCount}
            data-testid="workout-progress-bar"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${allDone ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${totalCount ? Math.round((completedCount / totalCount) * 100) : 0}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{completedCount}/{totalCount}</span>
        </div>
        <Button
          type="button"
          className="min-h-12 font-display text-base font-semibold uppercase tracking-wide"
          disabled={sealed || primary.disabled}
          onClick={primary.onClick}
          data-testid={primary.testId}
        >
          {primary.label}
        </Button>
      </div>
    </div>
  );
}
