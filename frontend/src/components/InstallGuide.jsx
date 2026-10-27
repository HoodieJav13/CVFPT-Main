import { useState } from 'react';
import { Copy, EllipsisVertical, Share, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { dismissInstall, promptInstall, useInstallMode } from '@/lib/pwa';
import { trackProductEvent } from '@/lib/telemetry';

const ShareIcon = () => <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" />;
const MenuIcon = () => <EllipsisVertical className="inline h-4 w-4 align-text-bottom" aria-label="menu" />;
const B = ({ children }) => <span className="font-medium">{children}</span>;

const SAFARI_STEPS = [
  <>Tap the <ShareIcon /> <B>Share</B> button. On newer iPhones it's inside the <B>⋯</B> menu at the bottom of Safari.</>,
  <>Scroll down and tap <B>Add to Home Screen</B>.</>,
  <>Tap <B>Add</B>. CVF PT now opens from your Home Screen like any app.</>,
];

const ANDROID_STEPS = [
  <>Tap your browser's <MenuIcon /> <B>menu</B> (top right).</>,
  <>Tap <B>Add to Home screen</B> or <B>Install app</B>.</>,
  <>Tap <B>Install</B> or <B>Add</B>. CVF PT now opens from your Home screen like any app.</>,
];

const GUIDES = {
  'ios-safari': {
    description: 'Takes about 10 seconds in Safari.',
    steps: SAFARI_STEPS,
  },
  'ios-chrome': {
    description: 'Takes about 10 seconds in Chrome.',
    steps: [
      <>Tap the <ShareIcon /> <B>Share</B> button at the right end of the address bar (or <B>⋯</B> menu → <B>Share</B>).</>,
      <>Tap <B>Add to Home Screen</B>. You may need to tap <B>More</B> to see it.</>,
      <>Tap <B>Add</B>. CVF PT now opens from your Home Screen like any app.</>,
    ],
  },
  'ios-other': {
    description: "This browser can't add apps to your Home Screen, so open CVF PT in Safari first.",
    copyTo: 'Safari',
    steps: [
      <>Tap <B>Copy link</B> below, open <B>Safari</B>, paste it in the address bar and sign in.</>,
      ...SAFARI_STEPS,
    ],
  },
  android: {
    description: 'Takes about 10 seconds.',
    steps: ANDROID_STEPS,
  },
  'android-inapp': {
    description: "This app's built-in browser can't add apps to your Home screen, so open CVF PT in Chrome first.",
    copyTo: 'Chrome',
    steps: [
      <>Tap the menu at the top right (<B>⋮</B> or <B>⋯</B>) and choose <B>Open in Chrome</B> or <B>Open in browser</B>. Or tap <B>Copy link</B> below and paste it into Chrome.</>,
      ...ANDROID_STEPS,
    ],
  },
};

async function copyAppLink(browser) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/`);
    toast.success(`Link copied. Paste it into ${browser}.`);
  } catch {
    toast.error(`Could not copy. Type ${window.location.host} into ${browser} instead.`);
  }
}

export function InstallGuideDialog({ mode, open, onOpenChange }) {
  const guide = GUIDES[mode];
  if (!guide) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="install-guide" data-install-mode={mode}>
        <DialogHeader>
          <DialogTitle className="pr-6">Add CVF PT to your Home Screen</DialogTitle>
          <DialogDescription>{guide.description}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-2.5 text-sm">
          {guide.steps.map((step, index) => (
            // Steps are a fixed per-mode list, so the index is a stable key.
            // eslint-disable-next-line react/no-array-index-key
            <li key={index} className="flex items-start gap-2">
              <span className="font-semibold text-primary">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant={guide.copyTo ? 'outline' : 'default'} onClick={() => onOpenChange(false)} data-testid="install-guide-done">Got it</Button>
          {/* Copying the link is the first step here, so it is the primary
              button (last child: on top in the stacked mobile footer). */}
          {guide.copyTo && (
            <Button onClick={() => copyAppLink(guide.copyTo)} data-testid="install-guide-copy-link">
              <Copy className="mr-1.5 h-4 w-4" /> Copy link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Opens the native prompt when the browser offers one, otherwise the steps.
export function useInstallGuide(source) {
  const mode = useInstallMode();
  const [open, setOpen] = useState(false);
  const start = () => {
    if (mode === 'prompt') {
      promptInstall(source);
      return;
    }
    // The menu entry passes no source: only the card's opens are counted.
    if (source) trackProductEvent('pwa_install_requested', { source });
    setOpen(true);
  };
  const dialog = <InstallGuideDialog mode={mode} open={open} onOpenChange={setOpen} />;
  return { mode, start, dialog };
}

export function InstallCard() {
  const { start, dialog } = useInstallGuide('client_home');
  return (
    <>
      <div className="mb-4 rounded-2xl border border-border bg-secondary/40 px-4 py-3.5" data-testid="install-card">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="min-w-0 text-sm font-semibold">Add CVF PT to your home screen</p>
        </div>
        <div className="mt-3 flex gap-2 pl-8">
          <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={start} data-testid="install-card-show-how">Show me how</Button>
          <Button size="sm" variant="ghost" className="min-h-11 rounded-xl" onClick={dismissInstall} data-testid="install-card-dismiss">Not now</Button>
        </div>
      </div>
      {dialog}
    </>
  );
}
