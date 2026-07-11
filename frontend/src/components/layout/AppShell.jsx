import { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard, Users, CalendarDays, Dumbbell, MessageSquare,
  TrendingUp, FileSignature, CreditCard, ShieldCheck, LogOut, Plus, Home,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const COACH_NAV = [
  { to: '/coach', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/coach/clients', label: 'Clients', icon: Users },
  { to: '/coach/sessions', label: 'Sessions', icon: CalendarDays },
  { to: '/coach/programs', label: 'Programs', icon: Dumbbell },
  { to: '/coach/messages', label: 'Messages', icon: MessageSquare },
];

const CLIENT_NAV = [
  { to: '/client', label: 'Home', icon: Home, end: true },
  { to: '/client/sessions', label: 'Sessions', icon: CalendarDays },
  { to: '/client/progress', label: 'Progress', icon: TrendingUp },
  { to: '/client/programs', label: 'Programs', icon: Dumbbell },
  { to: '/client/messages', label: 'Messages', icon: MessageSquare },
];

const CLIENT_EXTRA = [
  { to: '/client/waiver', label: 'Waiver', icon: FileSignature },
  { to: '/client/packages', label: 'Packages & Credits', icon: CreditCard },
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

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isCoach = user.role === 'coach' || user.role === 'admin';
  const nav = isCoach ? COACH_NAV : CLIENT_NAV;
  const sidebarNav = isCoach
    ? [...COACH_NAV, ...(user.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: ShieldCheck }] : [])]
    : [...CLIENT_NAV, ...CLIENT_EXTRA];

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
                {item.label}
              </NavLink>
            ))}
          </nav>
          <UserMenu user={user} logout={logout} />
          <p className="mt-3 px-2 text-[11px] text-muted-foreground/70">Core Value Fitness - Albuquerque, NM</p>
        </aside>

        <div className="relative z-10">
          {/* Mobile top bar */}
          <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur" data-testid="mobile-header">
            <Link to={isCoach ? '/coach' : '/client'} className="flex items-center gap-2" data-testid="mobile-brand">
              <BrandLogo size="mobile" />
              <span className="font-display font-semibold">CVF PT</span>
            </Link>
            <div className="flex items-center gap-2" data-testid="mobile-header-actions">
              {user.role === 'admin' && (
                <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} data-testid="mobile-admin-link">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </Button>
              )}
              <UserMenu user={user} logout={logout} compact />
            </div>
          </header>

          <main className="px-4 pb-24 pt-5 lg:px-8 lg:pb-10 lg:pt-8 max-w-5xl mx-auto w-full">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Coach quick-add FAB (mobile) */}
      {isCoach && (
        <Button
          size="icon"
          onClick={() => navigate('/coach/sessions?new=1')}
          data-testid="coach-quick-add-button"
          className="lg:hidden fixed bottom-20 right-4 z-50 h-[52px] w-[52px] rounded-full shadow-[0_10px_24px_rgba(91,194,212,.3)]"
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Mobile bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70" data-testid="mobile-bottom-navigation">
        <div className="grid grid-cols-5 h-16">
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
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function UserMenu({ user, logout, compact }) {
  const navigate = useNavigate();
  const isClient = user.role === 'client';
  return (
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
        {isClient && (
          <>
            <DropdownMenuItem onClick={() => navigate('/client/waiver')} data-testid="menu-waiver-link">
              <FileSignature className="h-4 w-4 mr-2" /> Waiver
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/client/packages')} data-testid="menu-packages-link">
              <CreditCard className="h-4 w-4 mr-2" /> Packages & Credits
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={logout} data-testid="logout-button">
          <LogOut className="h-4 w-4 mr-2" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
