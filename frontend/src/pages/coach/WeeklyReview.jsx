import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { contextFromWeek } from '@/lib/weeklyReviewContext';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ACTIVITY_LABELS, formatDay, formatDuration, formatWeekRange, resolveWeekStart, summarizeOutsideActivities, summaryText } from '@/lib/outsideActivities';
import { WEEKLY_REVIEW_LIMITS, createReviewStore, reviewScope, validateDraft } from '@/lib/weeklyReviewLocal';

const ACKNOWLEDGEMENT = 'I reviewed this proposal and want to confirm this local decision';
const RECEIPT_STATEMENT = 'Confirmed locally — program unchanged. Nothing sent.';
const STATUS_LABELS = { draft: 'Draft', proposed: 'Proposal ready', confirming: 'Confirming…', confirmed: 'Confirmed locally' };
const PROSE_CLASS = 'whitespace-pre-wrap text-sm [overflow-wrap:anywhere]';
const EMPTY_FORM = { adjustment: '', rationale: '' };

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// One macrotask, so "Confirming…" reaches the screen before the local write.
const paintBeforeCommit = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const formatTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });

function WeekFacts({ context, testId }) {
  return (
    <div className="space-y-4" data-testid={testId}>
      <section aria-label="Completed workouts">
        <h3 className="mb-2 text-sm font-semibold">Completed workouts</h3>
        <p className="text-sm">{context.pt_status === 'available' ? `${context.pt_completed_count} completed PT workouts` : 'PT workouts unavailable — count unknown.'}</p>
      </section>
      <section aria-label="Outside activities">
        <p className="mb-2 text-sm text-muted-foreground">{context.outside_partial ? 'Partial list: the first page only. This is not the whole outside-activity week.' : 'Outside activities visible to you at review time.'} Collection: {context.activity_collection.replaceAll('_', ' ')}. No logged activity does not mean rest.</p>
        <h3 className="mb-2 text-sm font-semibold">Outside activities</h3>
        <p className="mb-1.5 text-sm text-muted-foreground">{summaryText(summarizeOutsideActivities(context.outside_activities))}</p>
        <ul className="space-y-1.5 text-sm">
          {context.outside_activities.map((activity) => (
            <li key={activity.id} className="[overflow-wrap:anywhere]">
              {formatDay(activity.occurred_on)}: {ACTIVITY_LABELS[activity.activity_type]} · {activity.label} · {formatDuration(activity.duration_seconds)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FrozenText({ record }) {
  return (
    <dl className="space-y-3">
      <div>
        <dt className="text-sm font-semibold">Proposed adjustment</dt>
        <dd className={PROSE_CLASS}>{record.adjustment}</dd>
      </div>
      <div>
        <dt className="text-sm font-semibold">Rationale</dt>
        <dd className={PROSE_CLASS}>{record.rationale}</dd>
      </div>
    </dl>
  );
}

function Receipt({ receipt, testId }) {
  return (
    <div className="space-y-3" data-testid={testId} data-receipt-id={receipt.receiptId}>
      <p className="text-sm font-semibold text-[hsl(var(--success))]" data-testid={`${testId}-statement`}>{RECEIPT_STATEMENT}</p>
      <p className="text-sm text-muted-foreground">{receipt.context.caseLabel}, week of {formatWeekRange(receipt.context.weekStart)}. Confirmed {formatTime(receipt.confirmedAt)}.</p>
      <FrozenText record={receipt} />
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Receipt {receipt.receiptId}</p>
    </div>
  );
}

function ReviewWorkspace({ store, context, onReset }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [draftSaved, setDraftSaved] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  const [confirmFailed, setConfirmFailed] = useState(false);
  // This workspace is keyed by scope, so unmounting is the fence: a delayed
  // result from another case, week or actor finds aliveRef false and stops here.
  const aliveRef = useRef(false);
  const confirmingRef = useRef(false);
  const focusNextRef = useRef(null);
  const adjustmentRef = useRef(null);
  const proposalHeadingRef = useRef(null);
  const receiptHeadingRef = useRef(null);

  const adopt = useCallback((next) => {
    setState(next);
    setForm(next.draft ? { adjustment: next.draft.adjustment, rationale: next.draft.rationale } : EMPTY_FORM);
    setAcknowledged(false);
    setConfirmFailed(false);
  }, []);

  const refresh = useCallback(async () => {
    const result = await store.load();
    if (!aliveRef.current) return;
    if (result.ok) {
      setLoadError(null);
      adopt(result.state);
    } else {
      setState(null);
      setLoadError(result.message);
    }
  }, [adopt, store]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  useEffect(() => {
    const target = { draft: adjustmentRef, proposed: proposalHeadingRef, confirmed: receiptHeadingRef }[focusNextRef.current];
    if (target?.current) {
      target.current.focus();
      focusNextRef.current = null;
    }
  });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setDraftSaved(false);
    setFailure(null);
  }

  async function handleSaveDraft() {
    setBusy('saving');
    setFailure(null);
    const result = await store.saveDraft(form);
    if (!aliveRef.current) return;
    setBusy(null);
    if (result.ok) {
      setState(result.state);
      setFieldErrors({});
      setDraftSaved(true);
    } else {
      setFieldErrors(result.errors ?? {});
      setFailure(`Draft not saved. ${result.message}`);
    }
  }

  async function handlePropose() {
    const { valid, errors } = validateDraft(form);
    setFieldErrors(errors);
    setDraftSaved(false);
    if (!valid) {
      setFailure(null);
      return;
    }
    setBusy('saving');
    setFailure(null);
    const result = await store.propose({ ...form, context });
    if (!aliveRef.current) return;
    setBusy(null);
    if (result.ok) {
      focusNextRef.current = 'proposed';
      adopt(result.state);
    } else {
      setFailure(`Proposal not saved. ${result.message}`);
    }
  }

  async function handleEdit() {
    setBusy('saving');
    setFailure(null);
    const result = await store.edit();
    if (!aliveRef.current) return;
    setBusy(null);
    if (result.ok) {
      focusNextRef.current = 'draft';
      setDraftSaved(false);
      adopt(result.state);
    } else {
      setFailure(`Could not start a new draft. ${result.message}`);
    }
  }

  async function handleConfirm() {
    if (confirmingRef.current || !state?.proposal) return;
    confirmingRef.current = true;
    setBusy('confirming');
    setFailure(null);
    const result = await store.confirm({ revisionId: state.proposal.revisionId, acknowledged });
    confirmingRef.current = false;
    if (!aliveRef.current) return;
    setBusy(null);
    if (result.ok) {
      focusNextRef.current = 'confirmed';
      adopt(result.state);
    } else if (result.code === 'revision_mismatch') {
      await refresh();
      if (aliveRef.current) setFailure(`Not confirmed. ${result.message}`);
    } else {
      setConfirmFailed(true);
      setFailure(`Not confirmed. ${result.message}`);
    }
  }

  async function handleReset() {
    setBusy('saving');
    setFailure(null);
    const result = await store.reset();
    if (!aliveRef.current) return;
    setBusy(null);
    if (result.ok) onReset();
    else setFailure(result.message);
  }

  const confirming = busy === 'confirming';
  const locked = busy !== null;
  const status = state ? (confirming ? 'confirming' : state.status) : null;
  const history = state ? state.receipts.filter((entry) => entry.receiptId !== state.receipt?.receiptId) : [];

  return (
    <div className="space-y-4">
      {status && (
        <p role="status" className="flex items-center gap-2 text-sm font-semibold" data-testid="weekly-review-status">
          <span className="text-muted-foreground">Status:</span>
          <span className={status === 'confirmed' ? 'text-[hsl(var(--success))]' : status === 'draft' ? '' : 'text-[hsl(var(--gold))]'}>{STATUS_LABELS[status]}</span>
        </p>
      )}

      {loadError && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p role="alert" className="text-sm text-destructive" data-testid="weekly-review-load-error">{loadError}</p>
            <Button type="button" variant="outline" size="touch" onClick={refresh} data-testid="weekly-review-load-retry">Try again</Button>
          </CardContent>
        </Card>
      )}

      {failure && <p role="alert" className="text-sm text-destructive" data-testid="weekly-review-failure">{failure}</p>}

      {state?.status === 'draft' && (
        <Card data-testid="weekly-review-draft">
          <CardHeader>
            <CardTitle><h2 className="text-lg">Propose a future adjustment</h2></CardTitle>
            <CardDescription>Nothing here changes a program. Review proposal freezes this exact text for your confirmation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="weekly-review-adjustment">Proposed adjustment</Label>
              <Textarea
                id="weekly-review-adjustment"
                ref={adjustmentRef}
                rows={4}
                value={form.adjustment}
                disabled={locked}
                aria-invalid={Boolean(fieldErrors.adjustment)}
                aria-describedby={fieldErrors.adjustment ? 'weekly-review-adjustment-error' : undefined}
                onChange={(event) => updateField('adjustment', event.target.value)}
              />
              {fieldErrors.adjustment && <p id="weekly-review-adjustment-error" className="text-sm text-destructive">{fieldErrors.adjustment}</p>}
              <p className="text-xs text-muted-foreground">Required, up to {WEEKLY_REVIEW_LIMITS.adjustmentChars.toLocaleString('en-US')} characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="weekly-review-rationale">Rationale</Label>
              <Textarea
                id="weekly-review-rationale"
                rows={3}
                value={form.rationale}
                disabled={locked}
                aria-invalid={Boolean(fieldErrors.rationale)}
                aria-describedby={fieldErrors.rationale ? 'weekly-review-rationale-error' : undefined}
                onChange={(event) => updateField('rationale', event.target.value)}
              />
              {fieldErrors.rationale && <p id="weekly-review-rationale-error" className="text-sm text-destructive">{fieldErrors.rationale}</p>}
              <p className="text-xs text-muted-foreground">Required, up to {WEEKLY_REVIEW_LIMITS.rationaleChars.toLocaleString('en-US')} characters.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="touch" disabled={locked} onClick={handlePropose}>Review proposal</Button>
              <Button type="button" variant="outline" size="touch" disabled={locked} onClick={handleSaveDraft}>Save draft</Button>
              {draftSaved && <p role="status" className="text-sm text-muted-foreground" data-testid="weekly-review-draft-saved">Draft saved locally.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {state?.status === 'proposed' && (
        <Card data-testid="weekly-review-proposal">
          <CardHeader>
            <CardTitle><h2 ref={proposalHeadingRef} tabIndex={-1} className="text-lg focus:outline-none">Review your proposal</h2></CardTitle>
            <CardDescription>This text is frozen. Confirming records a decision in this browser only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.interrupted && !confirmFailed && !confirming && (
              <p className="text-sm text-[hsl(var(--gold))]" data-testid="weekly-review-interrupted">An earlier confirmation did not finish. This proposal is not confirmed.</p>
            )}
            <FrozenText record={state.proposal} />
            <div>
              <h3 className="mb-2 text-sm font-semibold">{state.proposal.context.caseLabel}, week of {formatWeekRange(state.proposal.context.weekStart)}</h3>
              <WeekFacts context={state.proposal.context} testId="weekly-review-frozen-context" />
            </div>
            <div className="flex min-h-11 items-start gap-3">
              <Checkbox
                id="weekly-review-acknowledgement"
                className="mt-0.5"
                checked={acknowledged}
                disabled={confirming}
                onCheckedChange={(value) => setAcknowledged(value === true)}
              />
              <Label htmlFor="weekly-review-acknowledgement" className="leading-5">{ACKNOWLEDGEMENT}</Label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="touch" disabled={!acknowledged || confirming} onClick={handleConfirm}>
                {confirming ? 'Confirming…' : confirmFailed ? 'Retry' : 'Confirm local decision'}
              </Button>
              <Button type="button" variant="outline" size="touch" disabled={locked} onClick={handleEdit}>Edit proposal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state?.status === 'confirmed' && (
        <Card>
          <CardHeader>
            <CardTitle><h2 ref={receiptHeadingRef} tabIndex={-1} className="text-lg focus:outline-none">Local receipt</h2></CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Receipt receipt={state.receipt} testId="weekly-review-receipt" />
            <Button type="button" variant="outline" size="touch" disabled={locked} onClick={handleEdit}>Edit as new draft</Button>
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card data-testid="weekly-review-history">
          <CardHeader>
            <CardTitle><h2 className="text-lg">Earlier receipts</h2></CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {history.map((entry) => <Receipt key={entry.receiptId} receipt={entry} testId="weekly-review-history-receipt" />)}
          </CardContent>
        </Card>
      )}

      {(state || loadError) && (
        <Button type="button" variant="outline" size="touch" disabled={locked} onClick={handleReset}>Reset this review</Button>
      )}
    </div>
  );
}

export default function WeeklyReview() {
  const { id } = useParams();
  const { user, sessionEpoch } = useAuth();
  const [params] = useSearchParams();
  const weekStart = resolveWeekStart(params.get('week'));
  const actorId = user?.profile?.id;
  const key = `${sessionEpoch}:${user?.role}:${actorId}:${id}:${weekStart}`;
  if (!actorId || !['coach', 'admin'].includes(user?.role)) return <p role="alert">A signed-in coach profile is required.</p>;
  return <AuthorizedReview key={key} actorId={actorId} clientId={id} weekStart={weekStart} />;
}

function AuthorizedReview({ actorId, clientId, weekStart }) {
  const alive = useRef(true);
  const requestGeneration = useRef(0);
  const [access, setAccess] = useState({ status: 'loading', context: null, message: null });
  const [checking, setChecking] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const storage = useMemo(browserStorage, []);
  const scope = reviewScope({ actorId, caseId: clientId, weekStart });
  const readWeek = useCallback(async () => {
    const { data } = await api.get(`/whole-week/clients/${clientId}`, { params: { week_start: weekStart } });
    return contextFromWeek(data, { clientId, weekStart });
  }, [clientId, weekStart]);
  // All access reads share one generation. Only the newest request may
  // restore facts, revoke access, or clear the verification mask.
  const checkAccess = useCallback(async (refreshContext = false) => {
    const generation = ++requestGeneration.current;
    setChecking(true);
    try {
      const context = await readWeek();
      if (!alive.current || generation !== requestGeneration.current) return false;
      if (refreshContext) setAccess({ status: 'available', context, message: null });
      return true;
    } catch (error) {
      if (alive.current && generation === requestGeneration.current) setAccess({ status: 'unavailable', context: null, message: errMsg(error, 'This client week could not be verified. Saved reviews stay private until access is restored.') });
      return false;
    } finally {
      if (alive.current && generation === requestGeneration.current) setChecking(false);
    }
  }, [readWeek]);
  const authorize = useCallback(() => checkAccess(false), [checkAccess]);
  const store = useMemo(() => createReviewStore({ storage, scope, authorize, isCurrent: () => alive.current, commitYield: paintBeforeCommit }), [storage, scope, authorize]);
  const load = useCallback(() => checkAccess(true), [checkAccess]);
  useEffect(() => {
    alive.current = true;
    load();
    window.addEventListener('focus', load);
    return () => { alive.current = false; requestGeneration.current += 1; window.removeEventListener('focus', load); };
  }, [load]);
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="weekly-review">
      <Link className="inline-flex min-h-11 items-center text-sm text-primary" to={`/coach/clients/${clientId}/week?week=${weekStart}`}>Back to whole week</Link>
      <PageHeader title="Weekly review" subtitle="Review this client's shared week and record a proposed future adjustment." testId="weekly-review-header" />
      <Badge variant="outline">Local decision only · saved in this browser</Badge>
      <p className="text-sm text-muted-foreground">Programs stay unchanged. Nothing is sent. Drafts and receipts are private to your signed-in profile on this browser; they do not synchronize.</p>
      {access.status === 'loading' && <p role="status">Verifying client access…</p>}
      {access.status === 'unavailable' && <div role="alert"><p>{access.message}</p><Button variant="outline" size="touch" onClick={load}>Try again</Button></div>}
      {access.status === 'available' && <div hidden={checking}>
        <Card><CardHeader><CardTitle><h2 className="text-lg">Week of {formatWeekRange(weekStart)}</h2></CardTitle><CardDescription>Authorized shared facts. Unknown stays unknown. Frozen proposals retain the facts shown when they were created.</CardDescription></CardHeader><CardContent><WeekFacts context={access.context} testId="weekly-review-facts" /></CardContent></Card>
        <ReviewWorkspace key={resetCount} store={store} context={access.context} onReset={() => setResetCount(count => count + 1)} />
      </div>}
      {checking && access.status !== 'loading' && <p role="status">Verifying client access…</p>}
    </div>
  );
}
