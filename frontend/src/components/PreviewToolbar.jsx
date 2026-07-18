import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Settings2 } from 'lucide-react';
import {
  getPreviewClientId,
  getPreviewClients,
  getPreviewRole,
  isPreviewMode,
  onPreviewChange,
  setPreviewClientId,
  setPreviewRole,
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
    ['Packages', '/client/packages'],
  ],
  coach: [
    ['Home', '/coach'],
    ['Clients', '/coach/clients'],
    ['Client Detail', '/coach/clients/client_sarah'],
    ['Sessions', '/coach/sessions'],
    ['Programs', '/coach/programs'],
    ['Messages', '/coach/messages'],
  ],
  admin: [
    ['Admin', '/admin'],
    ['Coach Home', '/coach'],
    ['Clients', '/coach/clients'],
    ['Sessions', '/coach/sessions'],
  ],
};

export default function PreviewToolbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState(getPreviewRole());
  const [clientId, setClientId] = useState(getPreviewClientId());
  const [expanded, setExpanded] = useState(false);
  const clients = useMemo(() => getPreviewClients(), []);

  useEffect(() => onPreviewChange(() => {
    setRole(getPreviewRole());
    setClientId(getPreviewClientId());
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
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
        aria-expanded={expanded}
        aria-controls="preview-toolbar-controls"
        aria-label={expanded ? 'Close preview controls' : 'Open preview controls'}
        onClick={() => setExpanded((current) => !current)}
        data-testid="preview-toolbar-toggle"
      >
        {expanded ? <ChevronDown className="h-5 w-5" aria-hidden /> : <Settings2 className="h-5 w-5" aria-hidden />}
      </button>
      <div id="preview-toolbar-controls" className={cn(expanded ? 'block' : 'hidden', 'lg:block')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden rounded-lg bg-secondary px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-secondary-foreground lg:inline-flex">
            Preview Mode
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
