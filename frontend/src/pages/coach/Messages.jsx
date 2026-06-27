import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState } from '@/components/common';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MessageSquare } from 'lucide-react';
import { initials, fmtDay } from '@/lib/format';
import { toast } from 'sonner';

export default function CoachMessages() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState(null);

  useEffect(() => {
    api.get('/messages/threads')
      .then(({ data }) => setThreads(data))
      .catch((e) => toast.error(errMsg(e, 'Failed to load messages')));
  }, []);

  if (!threads) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Messages" subtitle="Conversations with your clients" />
      {threads.length === 0 && (
        <EmptyState icon={MessageSquare} title="No conversations" subtitle="Threads appear here for each of your clients." testId="threads-empty-state" />
      )}
      <div className="space-y-2">
        {threads.map((t) => (
          <button
            key={t.client_id}
            onClick={() => navigate(`/coach/messages/${t.client_id}`)}
            className="w-full flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:bg-card transition-colors text-left"
            data-testid="message-thread-row"
          >
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">{initials(t.client_name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium truncate">{t.client_name}</p>
                {t.last_message && <p className="text-[10px] text-muted-foreground shrink-0">{fmtDay(t.last_message.created_at)}</p>}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {t.last_message ? `${t.last_message.sender_role === 'coach' ? 'You: ' : ''}${t.last_message.content}` : 'No messages yet'}
              </p>
            </div>
            {t.unread > 0 && (
              <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" data-testid="thread-unread-badge">
                {t.unread}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
