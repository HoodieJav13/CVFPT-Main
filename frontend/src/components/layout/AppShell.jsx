import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate, Link } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard, Users, CalendarDays, Dumbbell, MessageSquare,
  TrendingUp, FileSignature, ShieldCheck, LogOut, Home, Library, Bell, Search, BarChart3,
  Download, Share,
  Mail, KeyRound, Loader2,
} from 'lucide-react';
import { useNotifications } from '@/context/NotificationsContext';
import ClientJump from '@/components/ClientJump';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useInstallMode, promptInstall, dismissInstall } from '@/lib/pwa';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { api, errMsg } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ATTENTION_FEEDBACK_MOTION } from '@/lib/motion';
import { useVisualIntensity } from '@/lib/visualIntensity';

const COACH_NAV = [
  { to: '/coach', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/coach/clients', label: 'Clients', icon: Users },
  { to: '/coach/sessions', label: 'Sessions', icon: CalendarDays },
  { to: '/coach/programs', label: 'Programs', icon: Dumbbell },
  { to: '/coach/resources', label: 'Resources', icon: Library },
  { to: '/coach/messages', label: 'Messages', icon: MessageSquare },
];

const CLIENT_NAV = [
  { to: '/client', label: 'Home', icon: Home, end: true },
  { to: '/client/sessions', label: 'Sessions', icon: CalendarDays },
  { to: '/client/progress', label: 'Progress', icon: TrendingUp },
  { to: '/client/programs', label: 'Programs', icon: Dumbbell },
  { to: '/client/resources', label: 'Resources', icon: Library },
  { to: '/client/messages', label: 'Messages', icon: MessageSquare },
];

const COACH_EXTRA = [
  { to: '/coach/analytics', label: 'Analytics', icon: BarChart3 },
];

const CLIENT_EXTRA = [
  { to: '/client/waiver', label: 'Waiver', icon: FileSignature },
];

function BrandLogo({ size = 'desktop' }) {
  const [logoBroken, setLogoBroken] = useState(false);
  const classes = size === 'mobile'
    ? 'h-8 w-8 rounded-lg text-xs'
    : 'h-9 w-9 rounded-xl text-sm';
  if (logoBroken) {
    return (
      <div className={cn('flex items-center justify-center bg-primary text-primary-foreground font-display font-bold', classes)}>
        CVF
      </div>
    );
  }
  return (
    <img
      src="/logo.png"
      alt="CVF PT"
      className={cn('object-contain', classes)}
      onError={() => setLogoBroken(true)}
    />
  );
}

function NotificationCountBadge({ count, arrivalRevision, className, testId }) {
  const intensity = useVisualIntensity();
  const recipe = ATTENTION_FEEDBACK_MOTION[intensity];

  return (
    <span
      key={arrivalRevision}
      className={cn(className, arrivalRevision > 0 && 'motion-attention-pop-once')}
      style={{ '--motion-attention-scale': recipe.scale }}
      data-testid={testId}
      data-arrival-revision={arrivalRevision}
    >
      {count}
    </span>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { unread, unreadInitialized, refresh: refreshNotifications } = useNotifications();
  const isCoach = user.role === 'coach' || user.role === 'admin';
  const [jumpOpen, setJumpOpen] = useState(false);

  useEffect(() => {
    if (!isCoach) return undefined;
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setJumpOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCoach]);
  const notificationIdentity = `${user.role}:${user.profile?.id || user.email}`;
  const displayedUnread = Math.min(unread, 99);
  const previousDisplayedUnread = useRef(null);
  const previousNotificationIdentity = useRef(notificationIdentity);
  const [arrivalRevision, setArrivalRevision] = useState(0);
  const nav = isCoach ? COACH_NAV : CLIENT_NAV;
  const sidebarNav = isCoach
    ? [...COACH_NAV, ...COACH_EXTRA, ...(user.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: ShieldCheck }] : [])]
    : [...CLIENT_NAV, ...CLIENT_EXTRA];

  useEffect(() => { refreshNotifications(); }, [location.pathname, refreshNotifications]);

  useEffect(() => {
    const identityChanged = previousNotificationIdentity.current !== notificationIdentity;
    if (identityChanged || !unreadInitialized) {
      previousNotificationIdentity.current = notificationIdentity;
      previousDisplayedUnread.current = null;
      setArrivalRevision(0);
      return;
    }

    if (previousDisplayedUnread.current === null) {
      previousDisplayedUnread.current = displayedUnread;
      return;
    }

    if (displayedUnread > previousDisplayedUnread.current) {
      setArrivalRevision((revision) => revision + 1);
    }
    previousDisplayedUnread.current = displayedUnread;
  }, [displayedUnread, notificationIdentity, unreadInitialized]);

  return (
    <div className="min-h-dvh app-noise">
      <div className="top-glow fixed inset-x-0 top-0 h-64 pointer-events-none" />
      <div className="lg:grid lg:grid-cols-[250px_1fr]">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:h-dvh lg:sticky lg:top-0 border-r border-border bg-card/40 px-4 py-6 z-10">
          <Link to={isCoach ? '/coach' : '/client'} className="flex items-center gap-2.5 px-2" data-testid="sidebar-brand">
            <BrandLogo />
            <div>
              <p className="font-display font-semibold leading-none">CVF PT</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Fitness Done Right</p>
            </div>
          </Link>
          <nav className="mt-8 space-y-1 flex-1">
            {sidebarNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-testid={`sidebar-nav-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                className={({ isActive }) => cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors',
                  isActive && 'bg-primary/10 text-primary'
                )}
              >
                <item.icon className="h-[18px] w-[18px]" />
                <span className="flex-1">{item.label}</span>
                {!isCoach && item.label === 'Programs' && unread > 0 && (
                  <NotificationCountBadge
                    count={displayedUnread}
                    arrivalRevision={arrivalRevision}
                    className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground"
                    testId="desktop-programs-feedback-count"
                  />
                )}
              </NavLink>
            ))}
          </nav>
          {isCoach && (
            <button
              type="button"
              onClick={() => setJumpOpen(true)}
              className="mb-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              data-testid="desktop-client-jump-trigger"
            >
              <Search className="h-[18px] w-[18px]" />
              <span className="flex-1 text-left">Find client</span>
              <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
            </button>
          )}
          {isCoach && (
            <Link
              to="/coach/notifications"
              className="mb-2 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              data-testid="desktop-notifications-link"
            >
              <span className="relative">
                <Bell className="h-[18px] w-[18px]" />
                {unread > 0 && <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />}
              </span>
              <span className="flex-1">Notifications</span>
              {unread > 0 && (
                <NotificationCountBadge
                  count={displayedUnread}
                  arrivalRevision={arrivalRevision}
                  className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground"
                  testId="desktop-notification-count"
                />
              )}
            </Link>
          )}
          <UserMenu user={user} logout={logout} />
          <p className="mt-3 px-2 text-[11px] text-muted-foreground/70">Core Value Fitness - Albuquerque, NM</p>
        </aside>

        <div className="relative z-10">
          {/* Mobile top bar */}
          {/* pt-safe: standalone iOS draws the page under the status bar
              (black-translucent), so the sticky header pads itself below it. */}
          <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur" data-testid="mobile-header">
            <Link to={isCoach ? '/coach' : '/client'} className="flex items-center gap-2" data-testid="mobile-brand">
              <BrandLogo size="mobile" />
              <span className="font-display font-semibold">CVF PT</span>
            </Link>
            <div className="flex items-center gap-2" data-testid="mobile-header-actions">
              {isCoach && (
                <Button variant="ghost" size="icon" onClick={() => setJumpOpen(true)} data-testid="mobile-client-jump-trigger" aria-label="Find client">
                  <Search className="h-5 w-5" />
                </Button>
              )}
              {isCoach && (
                <Button variant="ghost" size="icon" className="relative" onClick={() => navigate('/coach/notifications')} data-testid="mobile-notifications-link" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                  <Bell className="h-5 w-5" />
                  {unread > 0 && (
                    <NotificationCountBadge
                      count={displayedUnread}
                      arrivalRevision={arrivalRevision}
                      className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
                      testId="mobile-notification-count"
                    />
                  )}
                </Button>
              )}
              {user.role === 'admin' && (
                <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} data-testid="mobile-admin-link">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </Button>
              )}
              <UserMenu user={user} logout={logout} compact />
            </div>
          </header>

          <main className="px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 lg:px-8 lg:pb-10 lg:pt-8 max-w-5xl mx-auto w-full">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom tabs */}
      {/* pb-safe keeps the tab row above the iPhone home indicator. */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/70" data-testid="mobile-bottom-navigation">
        <div className="grid grid-cols-6 h-16">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-testid={`bottom-tab-${item.label.toLowerCase()}`}
              className={({ isActive }) => cn(
                'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground',
                isActive && 'text-primary'
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -top-px h-[2px] w-10 rounded-full bg-primary" />}
                  <item.icon className="h-5 w-5" />
                  {item.label}
                  {!isCoach && item.label === 'Programs' && unread > 0 && (
                    <NotificationCountBadge
                      count={displayedUnread}
                      arrivalRevision={arrivalRevision}
                      className="absolute right-[calc(50%-1.4rem)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
                      testId="mobile-programs-feedback-count"
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {isCoach && <ClientJump open={jumpOpen} onOpenChange={setJumpOpen} />}
    </div>
  );
}

function UserMenu({ user, logout, compact }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isClient = user.role === 'client';
  const installMode = useInstallMode();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [emailHelpOpen, setEmailHelpOpen] = useState(false);
  const [digestOptOut, setDigestOptOut] = useState(false);
  const [emailPreferenceLoading, setEmailPreferenceLoading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);

  const submitPasswordChange = async (e) => {
    e.preventDefault();
    if (passwordForm.next.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (passwordForm.next !== passwordForm.confirm) { toast.error('New passwords do not match'); return; }
    setPasswordSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: passwordForm.current,
        new_password: passwordForm.next,
      });
      toast.success('Password updated');
      setPasswordOpen(false);
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch (error) {
      toast.error(errMsg(error, 'Could not change the password'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const openEmailPreferences = useCallback(() => {
    setEmailHelpOpen(true);
    setEmailPreferenceLoading(true);
    api.get('/email-preferences')
      .then(({ data }) => setDigestOptOut(Boolean(data.digest_opt_out)))
      .catch((error) => toast.error(errMsg(error, 'Could not load email settings')))
      .finally(() => setEmailPreferenceLoading(false));
  }, []);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('email-settings') === '1') openEmailPreferences();
  }, [location.search, openEmailPreferences]);

  const updateDigestPreference = async (checked) => {
    const previous = digestOptOut;
    setDigestOptOut(checked);
    setEmailPreferenceLoading(true);
    try {
      await api.patch('/email-preferences', { digest_opt_out: checked });
      toast.success(checked ? 'Daily digest turned off' : 'Daily digest turned on');
    } catch (error) {
      setDigestOptOut(previous);
      toast.error(errMsg(error, 'Could not save email settings'));
    } finally {
      setEmailPreferenceLoading(false);
    }
  };
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn('flex items-center gap-3 rounded-xl hover:bg-accent transition-colors', compact ? 'p-1' : 'px-3 py-2 w-full')}
          data-testid="user-menu-trigger"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">{initials(user.profile?.name)}</AvatarFallback>
          </Avatar>
          {!compact && (
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.profile?.name}</p>
              <p className="text-[11px] text-muted-foreground capitalize">{user.role}</p>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="truncate">{user.profile?.name}</p>
          <p className="text-xs font-normal text-muted-foreground truncate">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!isClient && (
          <>
            {/* The mobile tab row is capped at six daily surfaces, so this
                periodic page lives here — otherwise phones can only reach
                it by typing the URL. */}
            <DropdownMenuItem onClick={() => navigate('/coach/analytics')} data-testid="menu-analytics-link">
              <BarChart3 className="h-4 w-4 mr-2" /> Analytics
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {isClient && (
          <>
            <DropdownMenuItem onClick={() => navigate('/client/waiver')} data-testid="menu-waiver-link">
              <FileSignature className="h-4 w-4 mr-2" /> Waiver
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {installMode && (
          <>
            <DropdownMenuItem
              onClick={() => (installMode === 'prompt' ? promptInstall() : setIosHelpOpen(true))}
              data-testid="install-app-item"
            >
              <Download className="h-4 w-4 mr-2" /> Install app
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={openEmailPreferences} data-testid="email-preferences-item">
          <Mail className="h-4 w-4 mr-2" /> Email notifications
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setPasswordOpen(true)} data-testid="change-password-item">
          <KeyRound className="h-4 w-4 mr-2" /> Change password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} data-testid="logout-button">
          <LogOut className="h-4 w-4 mr-2" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={iosHelpOpen} onOpenChange={setIosHelpOpen}>
      <DialogContent className="max-w-sm" data-testid="ios-install-help">
        <DialogHeader>
          <DialogTitle className="pr-6">Add CVF PT to your Home Screen</DialogTitle>
          <DialogDescription>
            iPhones and iPads install web apps from Safari's share menu.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span className="font-semibold text-primary">1.</span>
            <span>Tap the <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> Share button in Safari's toolbar.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold text-primary">2.</span>
            <span>Scroll down and tap <span className="font-medium">Add to Home Screen</span>.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-semibold text-primary">3.</span>
            <span>Tap <span className="font-medium">Add</span> — CVF PT opens full-screen from your Home Screen.</span>
          </li>
        </ol>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => { dismissInstall(); setIosHelpOpen(false); }}
            data-testid="ios-install-dismiss"
          >
            Don't show again
          </Button>
          <Button onClick={() => setIosHelpOpen(false)} data-testid="ios-install-done">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={emailHelpOpen} onOpenChange={setEmailHelpOpen}>
      <DialogContent className="max-w-sm" data-testid="email-preferences-dialog">
        <DialogHeader>
          <DialogTitle>Email notifications</DialogTitle>
          <DialogDescription>Booking and session emails stay on. You can turn the non-urgent daily summary on or off.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Turn off daily digest</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Unread messages and new assignments remain visible in the app.</p>
          </div>
          <Switch
            checked={digestOptOut}
            disabled={emailPreferenceLoading}
            onCheckedChange={updateDigestPreference}
            aria-label="Turn off daily email digest"
            data-testid="digest-opt-out-switch"
          />
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={passwordOpen} onOpenChange={(open) => { setPasswordOpen(open); if (!open) setPasswordForm({ current: '', next: '', confirm: '' }); }}>
      <DialogContent className="max-w-sm" data-testid="change-password-dialog">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Confirm your current password, then choose a new one.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitPasswordChange} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" required autoComplete="current-password" value={passwordForm.current}
              onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))}
              className="h-11 rounded-xl" data-testid="change-password-current-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" required minLength={8} autoComplete="new-password" value={passwordForm.next}
              onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))}
              placeholder="At least 8 characters" className="h-11 rounded-xl" data-testid="change-password-new-input" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type="password" required minLength={8} autoComplete="new-password" value={passwordForm.confirm}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
              className="h-11 rounded-xl" data-testid="change-password-confirm-input" />
          </div>
          <DialogFooter>
            <Button type="submit" className="h-11 w-full rounded-xl font-semibold" disabled={passwordSaving} data-testid="change-password-submit-button">
              {passwordSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
