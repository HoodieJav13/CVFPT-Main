import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { ListSkeleton, LoadErrorState } from '@/components/common';
import { ChatThread } from '@/components/Chat';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function CoachConversation() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadedClientId, setLoadedClientId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const { data } = await api.get(`/messages/with/${clientId}`);
      if (sequence !== loadSequence.current) return;
      setData(data);
      setLoadedClientId(clientId);
      setLoadError(null);
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      const message = errMsg(e, 'Failed to load conversation');
      setLoadError({ clientId, message });
      toast.error(message);
    }
  }, [clientId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  const send = async (content) => {
    setSending(true);
    try {
      await api.post(`/messages/with/${clientId}`, { content });
      await load();
      return true;
    } catch (e) {
      toast.error(errMsg(e, 'Failed to send'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const hasCurrentConversation = loadedClientId === clientId;
  if (!hasCurrentConversation && loadError?.clientId === clientId) return <LoadErrorState message={loadError.message} scope="coach-conversation" onRetry={() => { setLoadError(null); load(); }} />;
  if (!data || !hasCurrentConversation) return <ListSkeleton rows={4} />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/coach/messages')} className="text-muted-foreground hover:text-foreground" data-testid="back-to-threads-button">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-xl font-semibold" data-testid="conversation-client-name">{data.client?.name}</h1>
      </div>
      <ChatThread messages={data.messages} myRole="coach" onSend={send} sending={sending} />
    </div>
  );
}
