import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { fmtDateTime } from '@/lib/format';

// One cancel dialog for the Sessions list and the session detail page. Series
// sessions choose "just this one" or "this and all future"; every session can opt
// out of the client notification (default on).
export function CancelSessionDialog({ session, open, onOpenChange, futureCount, busy = false, onConfirm }) {
  const [scope, setScope] = useState('one');
  const [notify, setNotify] = useState(true);
  useEffect(() => { if (open) { setScope('one'); setNotify(true); } }, [open, session?.id]);
  const inSeries = Boolean(session?.series_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="session-cancel-dialog">
        <DialogHeader>
          <DialogTitle>{scope === 'future' ? 'Cancel these sessions?' : 'Cancel this session?'}</DialogTitle>
          <DialogDescription>
            {session && `${session.client?.name} — ${fmtDateTime(session.scheduled_at)}.`}
          </DialogDescription>
        </DialogHeader>
        {inSeries && (
          <RadioGroup value={scope} onValueChange={setScope} className="gap-3" aria-label="What to cancel">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="one" id="cancel-scope-one" data-testid="session-cancel-scope-one" />
              <Label htmlFor="cancel-scope-one">Just this one</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="future" id="cancel-scope-future" data-testid="session-cancel-scope-future" />
              <Label htmlFor="cancel-scope-future">
                This and all future{typeof futureCount === 'number' ? ` (${futureCount})` : ''}
              </Label>
            </div>
          </RadioGroup>
        )}
        <div className="flex items-center gap-2">
          <Checkbox id="cancel-notify" checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} data-testid="session-cancel-notify" />
          <Label htmlFor="cancel-notify">Notify the client</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => onOpenChange(false)} data-testid="session-cancel-keep">
            Keep {scope === 'future' ? 'sessions' : 'session'}
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={() => onConfirm({ scope, notify })}
            data-testid="session-cancel-confirm"
          >
            {scope === 'future' ? 'Cancel sessions' : 'Cancel session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
