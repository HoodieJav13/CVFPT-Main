import { useEffect, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Shared conversation UI. `myRole` is 'coach' or 'client'.
 */
export function ChatThread({ messages = [], myRole, onSend, sending }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const submit = async (e) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    const ok = await onSend(content);
    if (ok !== false) setText('');
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-260px)] lg:h-[calc(100dvh-220px)] lg:max-w-3xl">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1" data-testid="chat-message-list">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center pt-10">No messages yet. Say hello!</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_role === myRole;
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
                  mine
                    ? 'bg-primary/15 border border-primary/20 rounded-br-sm'
                    : 'bg-secondary border border-border rounded-bl-sm'
                )}
                data-testid={`chat-bubble-${m.sender_role}`}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{fmtDateTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="mt-3 flex items-center gap-2 border-t border-border/70 pt-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="h-11 rounded-xl"
          data-testid="chat-input"
        />
        <Button type="submit" size="icon" className="h-11 w-11 rounded-xl shrink-0" disabled={sending || !text.trim()} data-testid="chat-send-button">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
