import { useEffect, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtTime } from '@/lib/format';
import { parseISO, isToday, isYesterday, format } from 'date-fns';
import { cn } from '@/lib/utils';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function dayLabel(iso) {
  const date = parseISO(iso);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d, yyyy');
}

/**
 * Messages annotated for rendering: day boundaries get a separator label,
 * and consecutive same-sender messages inside a five-minute window group
 * into one visual cluster (tail = last of the cluster, carries the
 * timestamp and the pointed corner).
 */
function annotate(messages) {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const ts = Date.parse(m.created_at);
    const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
    const groupedWithPrev = !newDay && prev && prev.sender_role === m.sender_role
      && ts - Date.parse(prev.created_at) < GROUP_WINDOW_MS;
    const groupedWithNext = next && next.sender_role === m.sender_role
      && dayLabel(next.created_at) === dayLabel(m.created_at)
      && Date.parse(next.created_at) - ts < GROUP_WINDOW_MS;
    return { ...m, newDay, groupedWithPrev, tail: !groupedWithNext };
  });
}

/**
 * Shared conversation UI. `myRole` is 'coach' or 'client'.
 * `className` lets a parent (the desktop two-pane shell) own the height.
 */
export function ChatThread({ messages = [], myRole, onSend, sending, className }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const autogrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const submit = async (e) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    const ok = await onSend(content);
    if (ok !== false) {
      setText('');
      requestAnimationFrame(autogrow);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const annotated = annotate(messages);

  return (
    <div className={cn('flex flex-col h-[calc(100dvh-260px)] lg:h-[calc(100dvh-220px)] lg:max-w-3xl', className)}>
      <div className="flex-1 overflow-y-auto pr-1" data-testid="chat-message-list">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center pt-10">No messages yet. Say hello!</p>
        )}
        {annotated.map((m) => {
          const mine = m.sender_role === myRole;
          return (
            <div key={m.id}>
              {m.newDay && (
                <div className="my-3 flex items-center gap-3" data-testid="chat-day-separator">
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="text-[10px] font-medium text-muted-foreground">{dayLabel(m.created_at)}</span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
              )}
              <div className={cn('flex', mine ? 'justify-end' : 'justify-start', m.groupedWithPrev ? 'mt-1' : 'mt-3')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
                    mine
                      ? cn('bg-primary/15 border border-primary/20', m.tail && 'rounded-br-sm')
                      : cn('bg-secondary border border-border', m.tail && 'rounded-bl-sm'),
                  )}
                  data-testid={`chat-bubble-${m.sender_role}`}
                  data-grouped={m.groupedWithPrev ? 'true' : undefined}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  {m.tail && <p className="mt-1 text-[10px] text-muted-foreground">{fmtTime(m.created_at)}</p>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="mt-3 flex items-end gap-2 border-t border-border/70 pt-3">
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={(e) => { setText(e.target.value); autogrow(); }}
          onKeyDown={onKeyDown}
          placeholder="Type a message..."
          className="min-h-11 max-h-[120px] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="chat-input"
        />
        <Button type="submit" size="icon" className="h-11 w-11 rounded-xl shrink-0" disabled={sending || !text.trim()} data-testid="chat-send-button">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
