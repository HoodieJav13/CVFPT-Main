import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChevronDown, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPreviewClientId,
  getPreviewClients,
  getPreviewFailMode,
  getPreviewRole,
  getPreviewSpeed,
  isPreviewMode,
  onPreviewChange,
  onPreviewNotice,
  onPreviewSwitchChange,
  resetPreview,
  setPreviewClientId,
  setPreviewFailMode,
  setPreviewRole,
  setPreviewSpeed,
} from '@/lib/previewMode';
import { cn } from '@/lib/utils';
const LINKS = {
  client: [
    ['Home', '/client'],
    ['Sessions', '/client/sessions'],
    ['Progress', '/client/progress'],
    ['Programs', '/client/programs'],
    ['Messages', '/client/messages'],
    ['Waiver', '/client/waiver'],
  ],
  coach: [
    ['Home', '/coach'],
    ['Clients', '/coach/clients'],
    ['Client Detail', '/coach/clients/client_sarah'],
    ['Sessions', '/coach/sessions'],
    ['Programs', '/coach/programs'],
    ['Messages', '/coach/messages'],
    ['Analytics', '/coach/analytics'],
  ],
  admin: [
    ['Admin', '/admin'],
    ['Coach Home', '/coach'],
    ['Clients', '/coach/clients'],
    ['Sessions', '/coach/sessions'],
  ],
};

const CONTROL = 'h-11 rounded-lg border border-border bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:h-8';

export default function PreviewToolbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState(getPreviewRole());
  const [clientId, setClientId] = useState(getPreviewClientId());
  const [expanded, setExpanded] = useState(false);
  // Failure-state lever for owner review: flips the analytics response to
  // coverage.complete === false. Lives in the visible controls so review
  // stays link-tap accessible — no dev tools required.
  const [incompleteAnalytics, setIncompleteAnalytics] = useState(() => {
    try { return localStorage.getItem('cvf_preview_incomplete_analytics') === '1'; } catch { return false; }
  });
  const clients = useMemo(() => getPreviewClients(), []);
  const [speed, setSpeed] = useState(getPreviewSpeed());
  const [failMode, setFailMode] = useState(getPreviewFailMode());
  // A switch left on from an earlier visit is the main way this layer could
  // mislead, so its state is visible without opening the panel.
  const modified = speed !== 'normal' || failMode !== 'off';
  // On desktop the toolbar sits over page content, so the test-state controls
  // stay folded away unless opened or in use. The phone panel is already
  // behind its own toggle and shows them directly.
  const [showTestStates, setShowTestStates] = useState(false);

  useEffect(() => onPreviewChange(() => {
    setRole(getPreviewRole());
    setClientId(getPreviewClientId());
  }), []);

  // Fixed ids so repeated hits replace the toast instead of stacking. This
  // runs even when the calling screen swallowed the error.
  useEffect(() => onPreviewNotice(({ kind, method, path, reason }) => {
    if (kind === 'unsupported') {
      toast.info('Not available in preview', { id: 'preview-unsupported', description: reason });
    } else if (kind === 'missing') {
      toast.error('Preview is missing a mock', { id: 'preview-missing-mock', description: `${String(method).toUpperCase()} ${path}` });
    }
  }), []);

  useEffect(() => onPreviewSwitchChange(() => {
    setSpeed(getPreviewSpeed());
    setFailMode(getPreviewFailMode());
  }), []);

  if (!isPreviewMode) return null;

  const changeRole = (nextRole) => {
    setPreviewRole(nextRole);
    setExpanded(false);
    navigate(nextRole === 'client' ? '/client' : nextRole === 'admin' ? '/admin' : '/coach');
  };

  const changeClient = (nextClientId) => {
    setPreviewClientId(nextClientId);
    if (location.pathname.includes('/coach/clients/')) navigate(`/coach/clients/${nextClientId}`);
    if (location.pathname.startsWith('/client')) navigate('/client');
  };

  const toggleIncompleteAnalytics = (checked) => {
    setIncompleteAnalytics(checked);
    try {
      if (checked) localStorage.setItem('cvf_preview_incomplete_analytics', '1');
      else localStorage.removeItem('cvf_preview_incomplete_analytics');
    } catch { /* private mode: the lever just won't persist */ }
    // Hard-load the page so the flag is applied on the very next fetch even
    // when already viewing analytics (an in-app navigate would be a no-op
    // there). Preview fixtures reset on reload; role + flag persist.
    window.location.assign('/coach/analytics');
  };

  const reset = () => {
    resetPreview();
    // Hard load: fixtures live in memory and rebuild on load.
    window.location.assign(role === 'client' ? '/client' : role === 'admin' ? '/admin' : '/coach');
  };

  const links = LINKS[role] || LINKS.client;

  return (
    <div
      className={cn(
        'fixed z-50 rounded-xl border border-border bg-muted/95 p-1 shadow-xl backdrop-blur lg:bottom-4 lg:left-auto lg:right-4 lg:top-auto lg:w-[520px] lg:translate-x-0 lg:p-2',
        expanded ? 'left-3 right-3 top-[68px]' : 'left-1/2 right-auto top-2 -translate-x-1/2'
      )}
      data-testid="preview-toolbar"
    >
      <button
        type="button"
        className="relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
        aria-expanded={expanded}
        aria-controls="preview-toolbar-controls"
        aria-label={expanded ? 'Close preview controls' : 'Open preview controls'}
        onClick={() => setExpanded((current) => !current)}
        data-testid="preview-toolbar-toggle"
      >
        {expanded ? <ChevronDown className="h-5 w-5" aria-hidden /> : <Settings2 className="h-5 w-5" aria-hidden />}
        {modified && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden data-testid="preview-modified-marker" />}
      </button>
      <div id="preview-toolbar-controls" className={cn(expanded ? 'block' : 'hidden', 'lg:block')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden rounded-lg bg-secondary px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-secondary-foreground lg:inline-flex">
            Preview Mode{modified && <span data-testid="preview-modified-marker">&nbsp;· modified</span>}
          </span>
          <select
            value={role}
            onChange={(e) => changeRole(e.target.value)}
            aria-label="Preview role"
            className="h-11 rounded-lg border border-border bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:h-8"
            data-testid="preview-role-select"
          >
            <option value="client">Client</option>
            <option value="coach">Coach</option>
            <option value="admin">Admin</option>
          </select>
          <select
            value={clientId}
            onChange={(e) => changeClient(e.target.value)}
            aria-label="Preview client"
            className="h-11 min-w-[150px] rounded-lg border border-border bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:h-8"
            data-testid="preview-client-select"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          {role !== 'client' && (
            <label className="flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-2 text-xs lg:h-8" data-testid="preview-incomplete-analytics">
              <input
                type="checkbox"
                checked={incompleteAnalytics}
                onChange={(e) => toggleIncompleteAnalytics(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
                data-testid="preview-incomplete-analytics-checkbox"
              />
              Incomplete analytics
            </label>
          )}
          <button
            type="button"
            className={`${CONTROL} hidden font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline-flex lg:items-center`}
            aria-expanded={showTestStates || modified}
            aria-controls="preview-test-states"
            onClick={() => setShowTestStates((current) => !current)}
            data-testid="preview-test-states-toggle"
          >
            Test states
          </button>
          <div
            id="preview-test-states"
            className={cn('flex w-full flex-wrap items-center gap-2', !(showTestStates || modified) && 'lg:hidden')}
          >
            <select
              value={speed}
              onChange={(e) => setPreviewSpeed(e.target.value)}
              aria-label="Preview network speed"
              className={CONTROL}
              data-testid="preview-speed-select"
            >
              <option value="normal">Speed: normal</option>
              <option value="slow">Speed: slow (1.5s)</option>
              <option value="very-slow">Speed: very slow (4s)</option>
            </select>
            <select
              value={failMode}
              onChange={(e) => setPreviewFailMode(e.target.value)}
              aria-label="Preview simulated failures"
              className={CONTROL}
              data-testid="preview-fail-select"
            >
              <option value="off">Failures: off</option>
              <option value="write-once">Fail next save</option>
              <option value="reads">Fail loads</option>
            </select>
            <button
              type="button"
              onClick={reset}
              className={`${CONTROL} font-medium text-muted-foreground transition-colors hover:text-foreground`}
              data-testid="preview-reset-button"
            >
              Reset
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {links.map(([label, to]) => {
            const finalTo = to === '/coach/clients/client_sarah' ? `/coach/clients/${clientId}` : to;
            const active = location.pathname === finalTo;
            return (
              <button
                type="button"
                key={label}
                onClick={() => navigate(finalTo)}
                className={cn(
                  'min-h-11 shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:min-h-0',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/70 text-muted-foreground hover:text-foreground'
                )}
                data-testid="preview-quick-link"
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
