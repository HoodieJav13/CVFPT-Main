import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen } from '@/components/common';
import { ChatThread } from '@/components/Chat';
import { toast } from 'sonner';

export default function ClientMessages() {
  const [data, setData] = useState(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/messages/mine');
      setData(data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load messages'));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  const send = async (content) => {
    setSending(true);
    try {
      await api.post('/messages/mine', { content });
      await load();
      return true;
    } catch (e) {
      toast.error(errMsg(e, 'Failed to send'));
      return false;
    } finally {
      setSending(false);
    }
  };

  if (!data) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Messages" subtitle={data.coach ? `Chat with ${data.coach.name}` : 'Chat with your coach'} />
      <ChatThread messages={data.messages} myRole="client" onSend={send} sending={sending} />
    </div>
  );
}
