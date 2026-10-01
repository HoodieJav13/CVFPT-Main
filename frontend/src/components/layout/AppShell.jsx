import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate, Link } from 'react-router';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard, Users, CalendarDays, Dumbbell, MessageSquare,
  TrendingUp, FileSignature, ShieldCheck, LogOut, Home, Library, Bell, Search, BarChart3,
  Download,
  Mail, KeyRound, Loader2, Sunrise, Sunset, MonitorSmartphone, Plus,
} from 'lucide-react';
import { useNotifications } from '@/context/NotificationsContext';
import ClientJump from '@/components/ClientJump';
import CornerMenu from '@/components/layout/CornerMenu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useInstallGuide } from '@/components/InstallGuide';
import { pushSupport, pushPermission, currentSubscription, enablePush, disablePush } from '@/lib/push';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { api, errMsg } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ATTENTION_FEEDBACK_MOTION } from '@/lib/motion';
import { useVisualIntensity } from '@/lib/visualIntensity';
import { useTheme } from '@/lib/theme';

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



function BrandLogo({ size = 'desktop' }) {
  const [logoBroken, setLogoBroken] = useState(false);
  const classes = size === 'mobile'
    ? 'h-10 w-10 rounded-lg text-xs'
    : 'h-11 w-11 rounded-xl text-sm drop-shadow-[0_4px_10px_rgb(0_0_0/0.18)]';
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
  const desktopNav = isCoach
    ? [...COACH_NAV, ...COACH_EXTRA, ...(user.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: ShieldCheck }] : [])]
    : CLIENT_NAV;
  // The workout tracker has its own bottom controls; the corner menu stays off it.
  const onTracker = /\/workouts\/[^/]+\/track$/.test(location.pathname);

  // The top bar is clear over the sky and turns to glass once the page scrolls.
  // Its height is published as --shell-top so a page's sky can sit under it.
  const headerRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  // While the phone corner menu is open the page behind it is inert.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => document.documentElement.style.setProperty('--shell-top', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const programsBadge = (testId, className) => (!isCoach && unread > 0 ? (
    <NotificationCountBadge count={displayedUnread} arrivalRevision={arrivalRevision} className={className} testId={testId} />
  ) : null);

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header
        ref={headerRef}
        inert={menuOpen}
        className={cn(
          'sticky top-0 z-40 flex items-center gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] transition-[background-color,box-shadow,backdrop-filter] duration-300 lg:px-6 lg:pb-4 lg:pt-4 xl:gap-4 xl:px-8',
          scrolled ? 'bg-background/90 shadow-[0_1px_0_hsl(var(--border)/0.7)] backdrop-blur-xl' : 'bg-transparent'
        )}
        data-testid="mobile-header"
      >
        <Link to={isCoach ? '/coach' : '/client'} className="flex shrink-0 items-center gap-2.5" data-testid="mobile-brand">
          <BrandLogo />
          <span className="font-display text-lg font-semibold tracking-[0.08em] lg:hidden xl:inline xl:text-xl">CVF PT</span>
        </Link>

        {/* Desktop: wide glass tabs along the top (the sidebar is gone). */}
        <nav aria-label="Main" className="glass-surface hidden min-w-0 max-w-[52rem] flex-1 items-center gap-0.5 rounded-2xl p-1 lg:flex xl:ml-2" data-testid="desktop-navigation">
          {desktopNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-testid={`topnav-${item.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              className={({ isActive }) => cn(
                // Tabs share the bar and may shrink, so the actions on the right
                // (search, New session, notifications, account) always stay on screen.
                'relative flex min-h-10 min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-xl px-1.5 text-[13px] font-semibold transition-colors xl:gap-1.5 xl:px-2 xl:text-sm',
                isActive
                  ? 'bg-[image:linear-gradient(180deg,hsl(var(--action-a)),hsl(var(--action-b)))] text-action-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.22)]'
                  : 'hover:bg-foreground/5'
              )}
            >
              <span className="truncate">{item.label}</span>
              {item.label === 'Programs' && programsBadge('desktop-programs-feedback-count', 'rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-gold-foreground')}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2" data-testid="mobile-header-actions">
          {isCoach && (
            <button
              type="button"
              onClick={() => setJumpOpen(true)}
              className="glass-surface relative hidden h-11 w-11 items-center justify-center rounded-2xl lg:flex"
              aria-label="Find client (⌘K)"
              title="Find client (⌘K)"
              data-testid="desktop-client-jump-trigger"
            >
              <Search className="h-[18px] w-[18px]" />
              <kbd className="absolute -bottom-1.5 -right-1.5 rounded-md border border-border bg-card px-1 text-[9px] font-semibold text-muted-foreground">⌘K</kbd>
            </button>
          )}
          {isCoach && (
            <Button variant="ghost" size="icon" className="glass-surface h-11 w-11 rounded-2xl lg:hidden" onClick={() => setJumpOpen(true)} data-testid="mobile-client-jump-trigger" aria-label="Find client">
              <Search className="h-5 w-5" />
            </Button>
          )}
          {isCoach && (
            <Link
              to="/coach/sessions?new=1"
              className="glass-surface flex h-11 items-center gap-1.5 rounded-2xl px-3 text-sm font-semibold lg:px-4 [background:linear-gradient(hsl(var(--primary)/0.22),hsl(var(--primary)/0.22)),hsl(var(--glass))]"
              aria-label="New session"
              data-testid="dashboard-new-session-button"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline lg:hidden xl:inline">New session</span>
            </Link>
          )}
          {isCoach && (
            <Link
              to="/coach/notifications"
              className="glass-surface relative hidden h-11 w-11 items-center justify-center rounded-2xl lg:flex"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              data-testid="desktop-notifications-link"
            >
              <Bell className="h-[18px] w-[18px]" />
              {unread > 0 && (
                <NotificationCountBadge
                  count={displayedUnread}
                  arrivalRevision={arrivalRevision}
                  className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground"
                  testId="desktop-notification-count"
                />
              )}
            </Link>
          )}
          {isCoach && (
            <Button variant="ghost" size="icon" className="glass-surface relative h-11 w-11 rounded-2xl lg:hidden" onClick={() => navigate('/coach/notifications')} data-testid="mobile-notifications-link" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <NotificationCountBadge
                  count={displayedUnread}
                  arrivalRevision={arrivalRevision}
                  className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-gold-foreground"
                  testId="mobile-notification-count"
                />
              )}
            </Button>
          )}
          {user.role === 'admin' && (
            <Button variant="ghost" size="icon" className="glass-surface h-11 w-11 rounded-2xl lg:hidden" onClick={() => navigate('/admin')} data-testid="mobile-admin-link" aria-label="Admin">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </Button>
          )}
          <UserMenu user={user} logout={logout} compact />
        </div>
      </header>

      <main inert={menuOpen} className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 lg:max-w-6xl lg:px-8 lg:pb-10 lg:pt-6">
        <Outlet />
      </main>

      {/* Phone navigation: one corner button. pb-safe keeps it above the iPhone home indicator. */}
      {!onTracker && (
        <CornerMenu
          items={nav}
          onOpenChange={setMenuOpen}
          badgeFor={(item) => (item.label === 'Programs' ? programsBadge(undefined, 'ml-1 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-bold text-gold-foreground') : null)}
          closedBadge={programsBadge('mobile-programs-feedback-count', 'absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-gold px-1 text-[10px] font-bold text-gold-foreground')}
        />
      )}

      {isCoach && <ClientJump open={jumpOpen} onOpenChange={setJumpOpen} />}
    </div>
  );
}

function UserMenu({ user, logout, compact }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isClient = user.role === 'client';
  const { mode: installMode, start: startInstall, dialog: installGuide } = useInstallGuide();
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme();
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

  const [messagesPaused, setMessagesPaused] = useState(false);
  const [messagesPausedLoading, setMessagesPausedLoading] = useState(false);
  // Program 012: lock-screen notifications. Deliberate-tap enrollment only.
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushState = pushSupport();

  const refreshPushState = useCallback(() => {
    if (pushState !== 'supported') return;
    currentSubscription()
      .then((subscription) => setPushEnabled(Boolean(subscription) && pushPermission() === 'granted'))
      .catch(() => {});
  }, [pushState]);

  const togglePush = async (checked) => {
    setPushBusy(true);
    try {
      if (checked) {
        await enablePush();
        setPushEnabled(true);
        toast.success('Lock-screen notifications on');
      } else {
        await disablePush();
        setPushEnabled(false);
        toast.success('Lock-screen notifications off');
      }
    } catch (error) {
      toast.error(error?.code === 'unconfigured' || error?.code === 'denied'
        ? error.message
        : errMsg(error, 'Could not update notifications'));
      refreshPushState();
    } finally {
      setPushBusy(false);
    }
  };

  const openEmailPreferences = useCallback(() => {
    setEmailHelpOpen(true);
    setEmailPreferenceLoading(true);
    api.get('/email-preferences')
      .then(({ data }) => setDigestOptOut(Boolean(data.digest_opt_out)))
      .catch((error) => toast.error(errMsg(error, 'Could not load email settings')))
      .finally(() => setEmailPreferenceLoading(false));
    if (!isClient) {
      setMessagesPausedLoading(true);
      api.get('/messages/availability')
        .then(({ data }) => setMessagesPaused(Boolean(data.messages_disabled)))
        .catch(() => {})
        .finally(() => setMessagesPausedLoading(false));
    }
    refreshPushState();
  }, [isClient, refreshPushState]);

  const updateMessagesPaused = async (checked) => {
    const previous = messagesPaused;
    setMessagesPaused(checked);
    setMessagesPausedLoading(true);
    try {
      await api.patch('/messages/availability', { messages_disabled: checked });
      toast.success(checked ? 'Client messages paused' : 'Client messages back on');
    } catch (error) {
      setMessagesPaused(previous);
      toast.error(errMsg(error, 'Could not save message settings'));
    } finally {
      setMessagesPausedLoading(false);
    }
  };

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
          className={cn('flex items-center gap-3 transition-colors', compact ? 'glass-surface h-11 w-11 justify-center rounded-full' : 'w-full rounded-xl px-3 py-2 hover:bg-accent')}
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
              onClick={startInstall}
              data-testid="install-app-item"
            >
              <Download className="h-4 w-4 mr-2" /> Install app
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {/* Sunrise (light) / sunset (dark), following the device unless pinned. */}
        <div className="px-2 py-1.5" role="group" aria-label="Appearance">
          <p className="mb-1.5 text-xs text-muted-foreground">Appearance</p>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {[['system', 'Device', MonitorSmartphone], ['light', 'Sunrise', Sunrise], ['dark', 'Sunset', Sunset]].map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setThemeChoice(value)}
                aria-pressed={themeChoice === value}
                className={cn('flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium text-muted-foreground transition-colors',
                  themeChoice === value && 'bg-card text-foreground shadow-sm')}
                data-testid={`theme-choice-${value}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </div>
        <DropdownMenuSeparator />
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
    {installGuide}
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
        {/* 012: lock-screen notifications for the signals the app already
            sends. Honest iOS story: install to home screen first. */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Lock-screen notifications</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pushState === 'ios_needs_install'
                ? 'On iPhone, install CVF PT to your Home Screen first — then this switch appears.'
                : pushState === 'unsupported'
                  ? "This browser can't show push notifications."
                  : 'Session changes, announcements, and client activity reach your phone even when the app is closed.'}
            </p>
          </div>
          {pushState === 'supported' && (
            <Switch
              checked={pushEnabled}
              disabled={pushBusy}
              onCheckedChange={togglePush}
              aria-label="Lock-screen notifications"
              data-testid="push-toggle-switch"
            />
          )}
        </div>
        {/* 011 D: coaches can pause incoming client messages. Announcements
            and the ask-to-cancel flow keep working while paused. */}
        {!isClient && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-medium">Pause client messages</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Clients can't message you while paused. Announcements and cancel requests still reach them and you.</p>
            </div>
            <Switch
              checked={messagesPaused}
              disabled={messagesPausedLoading}
              onCheckedChange={updateMessagesPaused}
              aria-label="Pause incoming client messages"
              data-testid="messages-paused-switch"
            />
          </div>
        )}
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
