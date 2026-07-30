import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Users } from 'lucide-react';
import { api } from '@/lib/api';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/format';

/**
 * Coach-only jump-to-client palette (roadmap UI-5). Opens via Cmd/Ctrl+K or
 * the header search trigger. Results are the coach's own roster — the
 * /clients endpoint is ownership-scoped server-side, so nothing here can
 * widen visibility.
 */
export default function ClientJump({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [clients, setClients] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/clients');
      setClients(data.filter((client) => !client.archived));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (open && clients === null) load();
  }, [open, clients, load]);

  const jump = (id) => {
    onOpenChange(false);
    navigate(`/coach/clients/${id}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to client..." data-testid="client-jump-input" />
      <CommandList>
        <CommandEmpty>
          {failed ? 'Could not load clients. Close and retry.' : clients === null ? 'Loading clients…' : 'No matching client.'}
        </CommandEmpty>
        {(clients || []).length > 0 && (
          <CommandGroup heading="Clients">
            {clients.map((client) => (
              <CommandItem
                key={client.id}
                value={`${client.name} ${client.email || ''}`}
                onSelect={() => jump(client.id)}
                data-testid="client-jump-item"
              >
                <Avatar className="mr-2 h-6 w-6">
                  <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">{initials(client.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="block truncate">{client.name}</span>
                  {client.email && <span className="block truncate text-xs text-muted-foreground">{client.email}</span>}
                </span>
                <Users className="ml-auto h-4 w-4 text-muted-foreground" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
