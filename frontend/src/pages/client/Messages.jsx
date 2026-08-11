import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, ListSkeleton, LoadErrorState } from '@/components/common';
import { ChatThread } from '@/components/Chat';
import { toast } from 'sonner';
import { trackProductEvent } from '@/lib/telemetry';

export default function ClientMessages() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async ({ background = false } = {}) => {
    try {
      const { data } = await api.get('/messages/mine');
      setData(data);
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load messages');
      setLoadError(message);
      // Background polls fail silently (the next poll may recover) — a toast
      // every 12s during a signal drop buries the conversation.
      if (!background) toast.error(message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      load({ background: true });
    }, 12000);
    const onVisible = () => { if (document.visibilityState === 'visible') load({ background: true }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const send = async (content) => {
    setSending(true);
    try {
      await api.post('/messages/mine', { content });
      trackProductEvent('message_replied', { source: 'client_messages' });
      await load();
      return true;
    } catch (e) {
      toast.error(errMsg(e, 'Failed to send'));
      return false;
    } finally {
      setSending(false);
    }
  };

  if (!data && loadError) return <LoadErrorState message={loadError} scope="client-messages" onRetry={() => { setLoadError(null); load(); }} />;
  if (!data) return <ListSkeleton rows={4} />;

  return (
    <div>
      <PageHeader title="Messages" subtitle={data.coach ? `Chat with ${data.coach.name}` : 'Chat with your coach'} />
      <ChatThread
        messages={data.messages}
        myRole="client"
        onSend={send}
        sending={sending}
        composerNote={data.coach?.messages_disabled
          ? `${data.coach?.name?.split(' ')[0] || 'Your coach'} isn't taking messages right now. You'll still get announcements — and session changes go through Ask to cancel on the session page.`
          : undefined}
      />
    </div>
  );
}
