import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  const clients = useMemo(() => getPreviewClients(), []);

  useEffect(() => onPreviewChange(() => {
    setRole(getPreviewRole());
    setClientId(getPreviewClientId());
  }), []);

  if (!isPreviewMode) return null;

  const changeRole = (nextRole) => {
    setPreviewRole(nextRole);
    navigate(nextRole === 'client' ? '/client' : nextRole === 'admin' ? '/admin' : '/coach');
  };

  const changeClient = (nextClientId) => {
    setPreviewClientId(nextClientId);
    if (location.pathname.includes('/coach/clients/')) navigate(`/coach/clients/${nextClientId}`);
    if (location.pathname.startsWith('/client')) navigate('/client');
  };

  const links = LINKS[role] || LINKS.client;

  return (
    <div className="fixed inset-x-3 bottom-[76px] z-[80] rounded-xl border border-gold/30 bg-background/95 p-2 shadow-[0_16px_40px_rgba(0,0,0,.35)] backdrop-blur lg:bottom-4 lg:left-auto lg:right-4 lg:w-[520px]" data-testid="preview-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-gold/15 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-gold">
          Preview Mode
        </span>
        <select
          value={role}
          onChange={(e) => changeRole(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
          data-testid="preview-role-select"
        >
          <option value="client">Client</option>
          <option value="coach">Coach</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={clientId}
          onChange={(e) => changeClient(e.target.value)}
          className="h-8 min-w-[150px] rounded-lg border border-border bg-card px-2 text-xs"
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
              key={label}
              onClick={() => navigate(finalTo)}
              className={cn(
                'shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
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
  );
}
