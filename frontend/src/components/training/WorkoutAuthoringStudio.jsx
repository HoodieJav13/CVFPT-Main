import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExerciseTrackingFields } from '@/components/training/ExerciseTrackingFields';
import { useFormChanges } from '@/context/UnsavedChangesContext';
import { trackingType } from '@/lib/workoutMetrics';
import { cn } from '@/lib/utils';
import {
  acceptEnteredPrescription, addBlankRow, buildAuthoringReview, canUseEnteredPrescription, chooseCatalogEntry,
  createAcceptLatch, keepAsCustom, keepPrescriptionAsCoachNote, removeDayRow, renameRow, resolveExtraLine,
  reviewDayToWorkoutForm, reviewIssues, selectDay, selectedDay, updateDayRow, updateRow, updateSelectedDay,
} from '@/lib/workoutAuthoring';

const EDIT_TEXT_WARNING = 'Change the text? The draft below and any edits to it will be discarded.';

function Field({ label, children, className }) {
  const id = useId();
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

function catalogTags(entry) {
  return [entry.category, entry.equipment, entry.primary_muscle].filter(Boolean).join(' · ') || 'No tags';
}

function CatalogChoice({ row, byId, library, onChange }) {
  const headingId = useId();
  if (row.catalog === 'matched') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="authoring-catalog-status" data-status="matched">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> In exercise catalog
      </p>
    );
  }
  if (row.catalog === 'custom') {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="authoring-catalog-status" data-status="custom">
        <p className="text-xs text-muted-foreground">Custom exercise · only in this workout, not added to the catalog</p>
        <Button type="button" variant="ghost" size="touch" className="h-auto min-h-11 rounded-xl px-2 text-xs" onClick={() => onChange((current) => renameRow(current, current.name, library))}>
          Choose from catalog instead
        </Button>
      </div>
    );
  }
  if (row.catalog === 'unnamed') {
    return <p className="text-xs text-muted-foreground" data-testid="authoring-catalog-status" data-status="unnamed">Enter an exercise name.</p>;
  }
  const ambiguous = row.catalog === 'ambiguous';
  const options = (ambiguous ? row.candidate_ids : row.suggestion_ids).map((id) => byId.get(id)).filter(Boolean);
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0 space-y-2 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm" data-testid="authoring-catalog-status" data-status={row.catalog}>
      <p id={headingId} className="font-medium [overflow-wrap:anywhere]">
        {ambiguous
          ? `${options.length} catalog exercises are named “${row.name.trim()}”. Choose the one you mean.`
          : `“${row.name.trim()}” is not in the exercise catalog.`}
      </p>
      {!ambiguous && options.length > 0 && <p className="text-xs text-muted-foreground">Possible matches. None is picked for you.</p>}
      {options.length > 0 && (
        <div className="flex flex-col gap-2">
          {options.map((entry, index) => (
            <Button key={entry.id} type="button" variant="outline" size="touch"
              className="h-auto min-h-11 w-full justify-start whitespace-normal rounded-xl text-left"
              onClick={() => onChange((current) => chooseCatalogEntry(current, entry))}
              data-testid={ambiguous ? 'authoring-candidate-button' : 'authoring-suggestion-button'}>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block font-medium">{ambiguous ? `Use catalog entry ${index + 1}: ${entry.name}` : `Use ${entry.name}`}</span>
                <span className="block text-xs font-normal text-muted-foreground">{catalogTags(entry)}{entry.author?.name ? ` · ${entry.author.name}` : ''}</span>
              </span>
            </Button>
          ))}
        </div>
      )}
      {ambiguous ? (
        <p className="text-xs text-muted-foreground">To use a custom exercise instead, give it a different name.</p>
      ) : (
        <Button type="button" variant="outline" size="touch" className="h-auto min-h-11 w-full whitespace-normal rounded-xl text-left"
          onClick={() => onChange(keepAsCustom)} data-testid="authoring-keep-custom-button">
          Keep “{row.name.trim()}” as a custom exercise
        </Button>
      )}
    </div>
  );
}

function PrescriptionIssue({ row, onChange }) {
  const headingId = useId();
  const canUse = canUseEnteredPrescription(row);
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0 space-y-2 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm" data-testid="authoring-prescription-issue">
      <p id={headingId} className="font-medium [overflow-wrap:anywhere]">Prescription needs a decision: “{row.prescription_issue.raw}”</p>
      <p className="text-xs text-muted-foreground">{row.prescription_issue.reason} It was not turned into reps or any other value.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="touch" className="h-auto min-h-11 whitespace-normal rounded-xl" onClick={() => onChange(keepPrescriptionAsCoachNote)} data-testid="authoring-keep-coach-note-button">
          Keep as coach note
        </Button>
        <Button type="button" variant="outline" size="touch" className="h-auto min-h-11 whitespace-normal rounded-xl" disabled={!canUse} onClick={() => onChange(acceptEnteredPrescription)} data-testid="authoring-use-entered-button">
          Use what I entered
        </Button>
      </div>
      {!canUse && <p className="text-xs text-muted-foreground">To use your own values, edit the sets, reps, time or distance below first.</p>}
    </div>
  );
}

function ExerciseCard({ row, index, library, byId, onChange, onRemove }) {
  const label = row.name.trim() || `exercise ${index + 1}`;
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border bg-card/50 p-3" data-testid="authoring-exercise-card" data-catalog={row.catalog}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 pt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="authoring-heard">
          {row.source_line ? <>From your text: “{row.source_line}”</> : 'Added in the studio'}
        </p>
        <IconButton label={`Remove ${label}`} size="touchIcon" variant="ghost" className="shrink-0 rounded-lg text-muted-foreground" onClick={onRemove} data-testid="authoring-remove-exercise-button">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
      <Field label="Exercise name">
        {(id) => <Input id={id} className="min-h-11" value={row.name} onChange={(event) => onChange((current) => renameRow(current, event.target.value, library))} placeholder={`Exercise ${index + 1}`} data-testid="authoring-exercise-name-input" />}
      </Field>
      <CatalogChoice row={row} byId={byId} library={library} onChange={onChange} />
      {row.prescription_issue && <PrescriptionIssue row={row} onChange={onChange} />}
      <ExerciseTrackingFields exercise={row} onChange={(fields) => onChange((current) => updateRow(current, fields))} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Sets">{(id) => <Input id={id} className="min-h-11" value={row.sets} onChange={(event) => onChange((current) => updateRow(current, { sets: event.target.value }))} data-testid="authoring-sets-input" />}</Field>
        {trackingType(row) === 'reps_weight' && (
          <Field label="Reps">{(id) => <Input id={id} className="min-h-11" value={row.reps} onChange={(event) => onChange((current) => updateRow(current, { reps: event.target.value }))} data-testid="authoring-reps-input" />}</Field>
        )}
        <Field label="Rest">{(id) => <Input id={id} className="min-h-11" value={row.rest} onChange={(event) => onChange((current) => updateRow(current, { rest: event.target.value }))} data-testid="authoring-rest-input" />}</Field>
        <Field label="Tempo">{(id) => <Input id={id} className="min-h-11" value={row.tempo} onChange={(event) => onChange((current) => updateRow(current, { tempo: event.target.value }))} data-testid="authoring-tempo-input" />}</Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Client notes">{(id) => <Input id={id} className="min-h-11" value={row.client_notes} onChange={(event) => onChange((current) => updateRow(current, { client_notes: event.target.value }))} data-testid="authoring-client-notes-input" />}</Field>
        <Field label="Coach notes (internal)">{(id) => <Input id={id} className="min-h-11" value={row.coach_notes} onChange={(event) => onChange((current) => updateRow(current, { coach_notes: event.target.value }))} data-testid="authoring-coach-notes-input" />}</Field>
      </div>
    </div>
  );
}

// Text → editable draft → explicit choices → one accepted day in the workout
// builder. Nothing is sent to the server here; the builder's own Save writes.
export function WorkoutAuthoringStudio({ open, onOpenChange, library, makeRow, onAccept, builderActive, builderDirty, builderSaving, editingName }) {
  const transcriptId = useId();
  const dayPickerName = useId();
  const issuesId = useId();
  const [transcript, setTranscript] = useState('');
  const [review, setReview] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [keptFromLastAccept, setKeptFromLastAccept] = useState(false);
  const latch = useRef(createAcceptLatch());
  const changes = useFormChanges({ transcript, review }, `authoring:${open}`, open);
  const byId = useMemo(() => new Map(library.map((entry) => [entry.id, entry])), [library]);

  // A new opening may accept again; within one opening only the first tap counts.
  useEffect(() => { if (open) latch.current.release(); }, [open]);

  const day = selectedDay(review);
  const issues = review ? reviewIssues(review) : [];
  const canAccept = Boolean(review) && issues.length === 0 && !builderSaving;

  const discardDraft = () => {
    setReview(null);
    setParseError(null);
  };

  const close = () => {
    if (!changes.confirmDiscard()) return;
    discardDraft();
    setTranscript('');
    setKeptFromLastAccept(false);
    onOpenChange(false);
  };

  const build = () => {
    const result = buildAuthoringReview(transcript, library);
    if (!result.ok) {
      setReview(null);
      setParseError(result.error);
      return;
    }
    setParseError(null);
    setReview(result.review);
  };

  const editText = () => {
    if (review && !window.confirm(EDIT_TEXT_WARNING)) return;
    discardDraft();
  };

  const updateDay = (update) => setReview((current) => updateSelectedDay(current, update));
  const updateRowByKey = (key) => (update) => updateDay((current) => updateDayRow(current, key, update));

  const accept = () => {
    if (!canAccept || !latch.current.claim()) return;
    const form = reviewDayToWorkoutForm(day, library, makeRow);
    if (!onAccept(form)) {
      latch.current.release();
      return;
    }
    // The text stays for another day of the same paste; the accepted draft is gone from here.
    discardDraft();
    setKeptFromLastAccept(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[92dvh] max-w-3xl grid-cols-1 overflow-y-auto overflow-x-hidden [&>button]:h-11 [&>button]:w-11" data-testid="authoring-dialog">
        <DialogHeader>
          <DialogTitle>Draft a workout from text</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground" data-testid="authoring-intro">
            <p>Type or paste a workout, one exercise per line, for example “Goblet squat 3x10”, “Plank 3 x 30 sec” or “Run 1.5 mi”. To dictate, use the microphone on your device keyboard; it turns speech into text in this box. CVF PT does not record or receive audio.</p>
            <p>Reading is rule-based and limited: numbers must be digits. Separate cues with commas; unclear units or targets need your decision. It does not write or check prescriptions.</p>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={transcriptId}>Workout text</Label>
            <Textarea
              id={transcriptId}
              rows={7}
              value={transcript}
              readOnly={Boolean(review)}
              aria-describedby={review ? `${transcriptId}-kept` : undefined}
              onChange={(event) => { setTranscript(event.target.value); setParseError(null); setKeptFromLastAccept(false); }}
              placeholder={'Day 1 Lower\nGoblet squat 3 sets of 8 to 10, rest 90 seconds\nPlank 3 x 30 sec'}
              className="min-w-0"
              data-testid="authoring-transcript"
            />
            {review && <p id={`${transcriptId}-kept`} className="text-xs text-muted-foreground">Your original text is kept as written while you review the draft.</p>}
            {!review && keptFromLastAccept && transcript && <p className="text-xs text-muted-foreground" data-testid="authoring-kept-text">This is the text from your last draft, kept so you can bring in another day.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {review ? (
              <Button type="button" variant="outline" size="touch" className="rounded-xl" onClick={editText} data-testid="authoring-edit-text-button">Change text</Button>
            ) : (
              <>
                <Button type="button" size="touch" className="rounded-xl" onClick={build} data-testid="authoring-build-button">Build draft</Button>
                {transcript && <Button type="button" variant="ghost" size="touch" className="rounded-xl" onClick={() => { setTranscript(''); setParseError(null); setKeptFromLastAccept(false); }} data-testid="authoring-clear-text-button">Clear text</Button>}
              </>
            )}
          </div>

          {parseError && (
            <Alert className="border-primary/30 bg-primary/10" aria-live="polite" data-testid="authoring-parse-error">
              <CircleAlert className="h-4 w-4 text-primary" aria-hidden />
              <AlertTitle>{parseError.message}</AlertTitle>
              <AlertDescription>
                <p>Put one exercise on each line with its prescription in digits, for example “Goblet squat 3x10”, “Plank 3 x 30 sec” or “Row 500 m”. If dictation spelled numbers out (“three sets of ten”), change them to digits.</p>
                {parseError.lines.length > 0 && (
                  <>
                    <p className="mt-2 font-medium">Lines read:</p>
                    <ul className="mt-1 list-disc pl-5 [overflow-wrap:anywhere]">
                      {parseError.lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
                    </ul>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {review && (
            <div className="min-w-0 space-y-4" data-testid="authoring-review">
              {review.days.length > 1 && (
                <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0" data-testid="authoring-day-picker">
                  <legend className="mb-1 text-sm font-medium">Choose the day to bring into the builder</legend>
                  <p className="text-xs text-muted-foreground" data-testid="authoring-day-hint">
                    This text has {review.days.length} days. This first version moves one day at a time into the workout builder; the text stays here so you can come back for another day. To build a whole program with these targets, save each reviewed day, then select those workouts in Programs. Program import uses its own formats.
                  </p>
                  {review.days.map((option, index) => (
                    <label key={option.key} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm', review.selected_day === index ? 'border-primary/50 bg-primary/10' : 'border-border bg-card/50')} data-testid="authoring-day-option">
                      <input type="radio" name={dayPickerName} className="h-4 w-4 shrink-0 accent-primary" checked={review.selected_day === index} onChange={() => setReview((current) => selectDay(current, index))} />
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                        {option.name || `Day ${option.day_number}`} · {option.exercises.length} exercise{option.exercises.length === 1 ? '' : 's'}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {day && (
                <div className="min-w-0 space-y-4" data-testid="authoring-day" key={day.key}>
                  <Field label="Workout day name">
                    {(id) => <Input id={id} className="min-h-11" value={day.name} onChange={(event) => updateDay((current) => ({ ...current, name: event.target.value }))} data-testid="authoring-workout-name-input" />}
                  </Field>

                  {day.extra_lines.length > 0 && (
                    <section className="min-w-0 space-y-2" aria-label="Lines that are not exercises" data-testid="authoring-extra-lines">
                      <h3 className="text-sm font-medium">Lines that are not exercises</h3>
                      <p className="text-xs text-muted-foreground">Workout notes go into the workout description. Lines with numbers or workout words need your decision so nothing is lost or misread.</p>
                      {day.extra_lines.map((entry) => (
                        <div key={entry.key} className={cn('min-w-0 space-y-2 rounded-xl border p-3 text-sm', entry.choice ? 'border-border bg-card/50' : 'border-gold/30 bg-gold/10')} data-testid="authoring-extra-line" data-choice={entry.choice || 'pending'}>
                          <p className="[overflow-wrap:anywhere]">“{entry.line}”</p>
                          <p className="text-xs text-muted-foreground">{entry.choice === 'note' ? 'Kept as a workout note' : 'Needs a decision'}</p>
                          <div className="flex flex-wrap gap-2">
                            {entry.choice !== 'note' && (
                              <Button type="button" variant="outline" size="touch" className="rounded-xl" onClick={() => updateDay((current) => resolveExtraLine(current, entry.key, 'note', library))} data-testid="authoring-keep-note-button">Keep as workout note</Button>
                            )}
                            <Button type="button" variant="outline" size="touch" className="rounded-xl" onClick={() => updateDay((current) => resolveExtraLine(current, entry.key, 'exercise', library))} data-testid="authoring-make-exercise-button">Add as exercise</Button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  <section className="min-w-0 space-y-3" aria-label="Exercises" data-testid="authoring-exercises">
                    {day.exercises.length === 0 && (
                      <p className="rounded-xl border border-border bg-card/50 p-3 text-sm text-muted-foreground" data-testid="authoring-no-exercises">This day has no exercises yet. Add one below, or change the text.</p>
                    )}
                    {day.exercises.map((row, index) => (
                      <ExerciseCard key={row.key} row={row} index={index} library={library} byId={byId}
                        onChange={updateRowByKey(row.key)}
                        onRemove={() => updateDay((current) => removeDayRow(current, row.key))} />
                    ))}
                    <Button type="button" variant="secondary" size="touch" className="w-full rounded-xl" onClick={() => updateDay(addBlankRow)} data-testid="authoring-add-exercise-button">
                      <Plus className="mr-1.5 h-4 w-4" /> Add exercise
                    </Button>
                  </section>
                </div>
              )}

              <div id={issuesId} aria-live="polite" data-testid="authoring-issues" data-count={issues.length}>
                {issues.length > 0 ? (
                  <div className="rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm">
                    <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 shrink-0 text-gold" aria-hidden /> {issues.length} {issues.length === 1 ? 'item needs' : 'items need'} your decision before accepting</p>
                    <ul className="mt-2 list-disc pl-5 [overflow-wrap:anywhere]">
                      {issues.map((issue, index) => <li key={`${issue.code}-${issue.key || ''}-${index}`}>{issue.message}</li>)}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden /> Ready to move into the workout builder.</p>
                )}
              </div>

              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="authoring-replace-copy">
                {builderActive
                  ? `Accepting replaces what is open in the workout builder${editingName ? ` (${editingName})` : ''} with this draft as a new workout day${editingName ? `; ${editingName} itself is not changed` : ''}.${builderDirty ? ' The builder has unsaved changes, so you will be asked before they are discarded.' : ''}`
                  : 'Accepting opens this draft in the workout builder as a new workout day.'}
                {' '}Nothing is saved until you press Save workout there.
                {builderSaving && ' Wait for the current save to finish.'}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="touch" className="rounded-xl" onClick={close} data-testid="authoring-cancel-button">Cancel</Button>
          {review && (
            <Button type="button" size="touch" className="rounded-xl" disabled={!canAccept} aria-describedby={issuesId} onClick={accept} data-testid="authoring-accept-button">
              Accept into builder
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
