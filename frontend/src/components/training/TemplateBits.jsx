import { useEffect, useState } from 'react';
import { EyeOff, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// Small coach-only building blocks for the shared template library. None of
// these render anything a client sees; client responses carry no attribution.

export function AuthorFilter({ value, onChange, options, testId = 'author-filter' }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full rounded-xl sm:w-48" aria-label="Filter by author" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All authors</SelectItem>
        <SelectItem value="me">Mine</SelectItem>
        {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AuthorByline({ author, className = '' }) {
  if (!author?.name) return null;
  return <span className={`text-[11px] text-muted-foreground/75 ${className}`} data-testid="template-author">by {author.name}</span>;
}

export function HiddenBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground" data-testid="template-hidden-badge">
      <EyeOff className="h-3 w-3" aria-hidden="true" /> Hidden
    </Badge>
  );
}

// Shown when the server refuses to edit a template that clients are still
// live-linked to (409 LEGACY_ASSIGNMENTS). Offers the safe alternative.
export function LegacyLockDialog({ open, message, busy, onCancel, onSaveVariation }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-md" data-testid="legacy-lock-dialog">
        <DialogHeader>
          <DialogTitle>This template is in use</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Your changes will be saved as a new hidden variation. The original stays exactly as it is for the clients using it.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-xl" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" className="rounded-xl" onClick={onSaveVariation} disabled={busy} data-testid="legacy-lock-save-variation">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save as variation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Save as template" for a client's copy (or a duplicate of a template).
// `parent` is the template it came from, if it still exists.
export function SaveTemplateDialog({ open, onOpenChange, kindLabel, defaultName, parent, busy, onSubmit }) {
  const [name, setName] = useState(defaultName || '');
  const [nest, setNest] = useState(Boolean(parent));
  useEffect(() => {
    if (open) { setName(defaultName || ''); setNest(Boolean(parent)); }
  }, [open, defaultName, parent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="save-template-dialog">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Saves a copy of this {kindLabel} to the shared library, without this client&apos;s loads or coach-only notes.
            It starts hidden so you can review it before other coaches can assign it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => { event.preventDefault(); onSubmit({ name: name.trim(), variation_of: nest && parent ? parent.id : null }); }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="save-template-name">Name</Label>
            <Input id="save-template-name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="save-template-name" />
          </div>
          {parent && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={nest} onChange={(e) => setNest(e.target.checked)} data-testid="save-template-nest" />
              <span>Save as a variation of <span className="font-medium">{parent.name}</span></span>
            </label>
          )}
          <DialogFooter>
            <Button type="submit" className="rounded-xl" disabled={busy || !name.trim()} data-testid="save-template-submit">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
