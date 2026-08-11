import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { api, errMsg } from '@/lib/api';
import { PageHeader, ListSkeleton, LoadErrorState, EmptyState } from '@/components/common';
import { ChatThread } from '@/components/Chat';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MessageSquare, ArrowLeft, UserRound, Megaphone, Loader2, Archive } from 'lucide-react';
import { initials, fmtDay, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { trackProductEvent } from '@/lib/telemetry';
import { useAuth } from '@/context/AuthContext';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

function ThreadRow({ thread, active, onSelect }) {
  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors text-left',
        active
          ? 'border-l-[3px] border-l-primary border-primary/40 bg-primary/15'
          : 'border-border bg-card/60 hover:bg-card',
      )}
      data-testid="message-thread-row"
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">{initials(thread.client_name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium truncate">{thread.client_name}</p>
          {thread.last_message && <p className="text-[10px] text-muted-foreground shrink-0">{fmtDay(thread.last_message.created_at)}</p>}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {thread.last_message ? `${thread.last_message.sender_role === 'coach' ? 'You: ' : ''}${thread.last_message.content}` : 'No messages yet'}
        </p>
      </div>
      {thread.unread > 0 && (
        <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" data-testid="thread-unread-badge">
          {thread.unread}
        </span>
      )}
    </button>
  );
}

/**
 * Coach messaging surface for both routes: /coach/messages (no selection)
 * and /coach/messages/:clientId. Mobile keeps the stacked list -> chat
 * navigation; at lg the two render side by side as thread rail +
 * conversation pane with a client-context header.
 */
export default function CoachMessages() {
  const navigate = useNavigate();
  const { clientId } = useParams();
  const [threads, setThreads] = useState(null);
  const [threadsError, setThreadsError] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [loadedClientId, setLoadedClientId] = useState(null);
  const [conversationError, setConversationError] = useState(null);
  const [sending, setSending] = useState(false);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const loadSequence = useRef(0);

  const loadThreads = useCallback(async ({ background = false } = {}) => {
    try {
      const { data } = await api.get('/messages/threads');
      setThreads(data);
      setThreadsError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load messages');
      setThreadsError(message);
      // Background polls fail silently — the inline error states cover it.
      if (!clientId && !background) toast.error(message);
    }
  }, [clientId]);

  useEffect(() => {
    loadThreads();
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadThreads({ background: true });
    }, 30000);
    return () => clearInterval(t);
  }, [loadThreads]);

  const loadConversation = useCallback(async ({ background = false } = {}) => {
    if (!clientId) return;
    const sequence = ++loadSequence.current;
    try {
      const { data } = await api.get(`/messages/with/${clientId}`);
      if (sequence !== loadSequence.current) return;
      setConversation(data);
      setLoadedClientId(clientId);
      setConversationError(null);
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      const message = errMsg(e, 'Failed to load conversation');
      setConversationError({ clientId, message });
      if (!background) toast.error(message);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return undefined;
    loadConversation();
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadConversation({ background: true });
    }, 12000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadConversation({ background: true }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [clientId, loadConversation]);

  const send = async (content) => {
    setSending(true);
    try {
      await api.post(`/messages/with/${clientId}`, { content });
      trackProductEvent('message_replied', { source: 'coach_messages' });
      await loadConversation();
      loadThreads();
      return true;
    } catch (e) {
      toast.error(errMsg(e, 'Failed to send'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const hasCurrentConversation = loadedClientId === clientId && conversation;

  const threadList = threads === null ? (
    <ListSkeleton rows={4} />
  ) : (
    <>
      {threads.length === 0 && (
        <EmptyState icon={MessageSquare} title="No conversations" subtitle="Threads appear here for each of your clients." testId="threads-empty-state" />
      )}
      <div className="space-y-2">
        {threads.map((t) => (
          <ThreadRow key={t.client_id} thread={t} active={t.client_id === clientId} onSelect={() => navigate(`/coach/messages/${t.client_id}`)} />
        ))}
      </div>
    </>
  );

  const conversationPane = !clientId ? null : (conversationError?.clientId === clientId && !hasCurrentConversation) ? (
    <LoadErrorState message={conversationError.message} scope="coach-conversation" onRetry={() => { setConversationError(null); loadConversation(); }} />
  ) : !hasCurrentConversation ? (
    <ListSkeleton rows={4} />
  ) : (
    <ChatThread messages={conversation.messages} myRole="coach" onSend={send} sending={sending} className="lg:h-auto lg:flex-1 lg:min-h-0 lg:max-w-none" />
  );

  if (!threads && threadsError && !clientId) {
    return <LoadErrorState message={threadsError} scope="coach-messages" onRetry={() => { setThreadsError(null); loadThreads(); }} />;
  }

  return (
    <div className="lg:flex lg:h-[calc(100dvh-140px)] lg:flex-col">
      {/* Page header: always on desktop; on mobile only in list view. */}
      <div className={cn(clientId && 'hidden lg:block')}>
        <PageHeader
          title="Messages"
          subtitle="Conversations with your clients"
          action={(
            <Button variant="outline" className="rounded-xl" onClick={() => setAnnouncementsOpen(true)} data-testid="open-announcements-button">
              <Megaphone className="mr-1.5 h-4 w-4" /> Announce
            </Button>
          )}
        />
      </div>
      <AnnouncementsDrawer open={announcementsOpen} onOpenChange={setAnnouncementsOpen} />

      {/* Mobile conversation header (back + name). */}
      {clientId && (
        <div className="mb-4 flex items-center gap-3 lg:hidden">
          <button onClick={() => navigate('/coach/messages')} aria-label="Back to conversations" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="back-to-threads-button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-xl font-semibold" data-testid="conversation-client-name">{conversation?.client?.name || '...'}</h1>
        </div>
      )}

      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_1fr] lg:gap-6">
        {/* Thread rail: the mobile list view, and the left pane on desktop. */}
        <aside className={cn('lg:block lg:min-h-0 lg:overflow-y-auto lg:pr-1', clientId && 'hidden')} data-testid="messages-thread-rail">
          {threadList}
        </aside>

        {/* Conversation pane: the mobile chat view, and the right pane on desktop. */}
        <section
          className={cn(
            'flex min-h-0 flex-col lg:rounded-2xl lg:border lg:border-border lg:bg-card/40 lg:px-5 lg:py-4',
            !clientId && 'hidden lg:flex',
          )}
          data-testid="messages-conversation-pane"
        >
          {!clientId ? (
            <div className="hidden flex-1 items-center justify-center lg:flex">
              <EmptyState icon={MessageSquare} title="Select a conversation" subtitle="Choose a client thread to read and reply." testId="conversation-empty-state" />
            </div>
          ) : (
            <>
              <div className="mb-2 hidden items-center justify-between gap-3 rounded-xl bg-primary/[0.08] px-4 py-3 lg:flex" data-testid="conversation-context-header">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-11 w-11 shrink-0">
                    <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">{initials(conversation?.client?.name || '')}</AvatarFallback>
                  </Avatar>
                  <h2 className="truncate font-display text-xl font-semibold" data-testid="conversation-client-name-desktop">{conversation?.client?.name || '...'}</h2>
                </div>
                <Button asChild variant="secondary" size="sm" className="rounded-lg shrink-0">
                  <Link to={`/coach/clients/${clientId}`} data-testid="conversation-view-client">
                    <UserRound className="mr-1.5 h-3.5 w-3.5" /> View client
                  </Link>
                </Button>
              </div>
              {conversationPane}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// Program 011 C: one-way announcements — compose, see reach, retract.
// Replies are impossible by design; clients only get a "Got it".
function AnnouncementsDrawer({ open, onOpenChange }) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [studioWide, setStudioWide] = useState(false);
  const [posting, setPosting] = useState(false);
  const [rows, setRows] = useState(null);
  const [archivingId, setArchivingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/announcements');
      setRows(data);
    } catch (e) {
      toast.error(errMsg(e, 'Could not load announcements'));
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const post = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setPosting(true);
    try {
      await api.post('/announcements', { content: content.trim(), studio_wide: studioWide });
      toast.success('Announcement posted — clients see it on their home screen');
      setContent('');
      setStudioWide(false);
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Could not post the announcement'));
    } finally {
      setPosting(false);
    }
  };

  const archive = async (row) => {
    setArchivingId(row.id);
    try {
      await api.patch(`/announcements/${row.id}/archive`);
      toast.success('Announcement removed');
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Could not remove it'));
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="announcements-drawer">
        <div className="mx-auto w-full max-w-md px-4 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle>Announcements</DrawerTitle>
            <DrawerDescription>One-way notes to your clients — they can't reply, only mark them seen. Announcements ride the daily digest, never their own email.</DrawerDescription>
          </DrawerHeader>
          <form onSubmit={post} className="space-y-3">
            <Textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              placeholder="Gym closes at 2pm this Friday…"
              data-testid="announcement-content-input"
            />
            {user?.role === 'admin' && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={studioWide} onCheckedChange={setStudioWide} data-testid="announcement-studio-wide-switch" />
                Send to every client in the studio
              </label>
            )}
            <Button type="submit" disabled={posting || !content.trim()} className="min-h-11 w-full rounded-xl font-semibold" data-testid="announcement-post-button">
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Megaphone className="mr-1.5 h-4 w-4" /> Post announcement</>}
            </Button>
          </form>
          <div className="mt-5 max-h-64 space-y-2 overflow-y-auto">
            {rows === null && <ListSkeleton rows={2} header={false} />}
            {rows?.length === 0 && <p className="py-2 text-center text-sm text-muted-foreground">Nothing posted yet.</p>}
            {(rows || []).map((row) => (
              <div key={row.id} className="rounded-xl border border-border bg-card/60 px-3 py-2.5" data-testid="announcement-row">
                <p className="whitespace-pre-wrap text-sm">{row.content}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDateTime(row.created_at)}
                    {row.studio_wide && <Badge variant="outline" className="ml-2 text-[10px]">Studio-wide</Badge>}
                  </p>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] tabular-nums text-muted-foreground" data-testid="announcement-seen-count">
                      Seen by {row.seen_count} of {row.audience_count}
                    </span>
                    <Button size="sm" variant="ghost" className="h-8 rounded-lg px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={archivingId === row.id} onClick={() => archive(row)} aria-label="Remove announcement" data-testid="announcement-archive-button">
                      {archivingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
