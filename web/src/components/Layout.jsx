import GlobalAIChat from './GlobalAIChat';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Inbox,
  FolderOpen,
  Users,
  UserCog,
  LogOut,
  Search,
  Menu,
  Settings,
  X,
  ChevronRight,
  Plus,
  FileText,
  ScrollText,
  Receipt,
  LayoutDashboard,
  Wallet,
  PieChart,
  Filter,
  TrendingUp,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Briefcase,
  Key,
  Calculator,
  Calendar,
  Clock,
  CreditCard,
  BookOpen,
  ClipboardList,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Download, Sun, Moon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import NotificationsDropdown from './NotificationsDropdown';
import { Button } from './ui';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { usePushNotifications } from '../hooks/usePushNotifications';

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const sidebarRef = useRef(null);
  const { isInstallable, install } = useInstallPrompt();
  const { permission, subscribed, subscribe } = usePushNotifications();
  const [installDismissed, setInstallDismissed] = useState(false);

  // Auto-subscribe to push on login if permission already granted
  useEffect(() => {
    if (user && permission === 'granted' && !subscribed) {
      subscribe();
    }
  }, [user, permission, subscribed, subscribe]);

  const isAdmin = user?.role === 'ADMIN';

  const { data: stats } = useQuery({
    queryKey: ['inbox-stats'],
    queryFn: api.getInboxStats,
    refetchInterval: 30000,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
    refetchInterval: 60000,
  });

  const activeProjectCount = projects?.filter(
    p => !['LAUNCHED', 'CANCELLED'].includes(p.status)
  ).length || 0;

  // Track which sections are expanded
  const [expandedSections, setExpandedSections] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('nav-expanded') || '{}');
    } catch { return {}; }
  });

  const toggleSection = (key) => {
    setExpandedSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('nav-expanded', JSON.stringify(next));
      return next;
    });
  };

  // Core nav — always visible, no section header
  const coreNav = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard, exact: true },
    { name: 'Inbox', href: '/inbox', icon: Inbox, badge: stats?.needsResponse },
    { name: 'Projects', href: '/projects', icon: FolderOpen },
    { name: 'Clients', href: '/clients', icon: Users },
    { name: 'Invoices', href: '/invoices', icon: Receipt },
  ];

  // Finance & Docs — collapsible section
  const financeNav = [
    { name: 'Pipeline', href: '/pipeline', icon: Filter },
    { name: 'Proposals', href: '/proposals', icon: FileText },
    { name: 'Estimates', href: '/estimates', icon: ClipboardList },
    { name: 'Contracts', href: '/contracts', icon: ScrollText },
    { name: 'Expenses', href: '/expenses', icon: Wallet },
    { name: 'Schedule', href: '/schedule', icon: Calendar },
    { name: 'Upwork', href: '/upwork-contracts', icon: Briefcase },
  ];

  // Admin — collapsible section, only visible to admins
  const adminNav = isAdmin ? [
    { name: 'Team', href: '/team', icon: UserCog },
    { name: 'Revenue', href: '/revenue', icon: TrendingUp },
    { name: 'Timesheets', href: '/timesheets', icon: Clock },
    { name: 'Rate Cards', href: '/rate-cards', icon: CreditCard },
    { name: 'Bookkeeping', href: '/bookkeeping', icon: BookOpen },
    { name: 'Reports', href: '/reports', icon: PieChart },
    { name: 'Credentials', href: '/credentials', icon: Key },
    { name: 'Settings', href: '/settings', icon: Settings },
  ] : [];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.querySelector('input[type="text"]')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, user?.role]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim().length >= 2) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const toggleCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  function renderNavItems(items) {
    return items.map((item) => {
      const isActive = item.exact
        ? location.pathname === item.href
        : location.pathname.startsWith(item.href) && item.href !== '/';
      const badge = item.badge;
      return (
        <Link
          key={item.name}
          to={item.href}
          onClick={() => setSidebarOpen(false)}
          title={sidebarCollapsed ? item.name : undefined}
          className={cn(
            'flex items-center text-sm font-medium rounded-lg transition-all duration-150',
            sidebarCollapsed ? 'px-2.5 py-2 justify-center' : 'px-3 py-1.5',
            'group relative',
            isActive
              ? 'bg-[#e6f354]/10 text-[#e6f354] border-l-2 border-[#e6f354]'
              : 'text-white/70 hover:text-white hover:bg-white/5'
          )}
        >
          <item.icon className={cn('w-4 h-4 shrink-0', !sidebarCollapsed && 'mr-2.5')} />
          {!sidebarCollapsed && <span className="flex-1 truncate">{item.name}</span>}
          {badge > 0 && (
            sidebarCollapsed ? (
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold rounded-full bg-[#e6f354] text-[#2e2958] flex items-center justify-center">
                {badge > 9 ? '9+' : badge}
              </span>
            ) : (
              <span className={cn(
                'ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded-full min-w-[18px] text-center',
                isActive ? 'bg-[#e6f354]/20 text-[#e6f354]' : 'bg-[#e6f354] text-[#2e2958]'
              )}>
                {badge > 99 ? '99+' : badge}
              </span>
            )
          )}
        </Link>
      );
    });
  }

  function renderCollapsibleSection(key, label, items) {
    const isExpanded = expandedSections[key];
    const hasActiveChild = items.some(item =>
      item.exact ? location.pathname === item.href : location.pathname.startsWith(item.href) && item.href !== '/'
    );
    const show = isExpanded || hasActiveChild;

    if (sidebarCollapsed) {
      // In collapsed mode: show all items as icons (no section headers)
      return <div className="space-y-0.5">{renderNavItems(items)}</div>;
    }

    return (
      <div className="space-y-0.5">
        <button
          onClick={() => toggleSection(key)}
          className="w-full flex items-center px-3 py-1.5 text-xs font-semibold text-white/40 uppercase tracking-wider hover:text-white/70 transition-colors"
        >
          <ChevronRight className={cn('w-3 h-3 mr-1 transition-transform duration-150', show && 'rotate-90')} />
          {label}
        </button>
        {show && <div className="space-y-0.5 pl-1">{renderNavItems(items)}</div>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Skip to content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        Skip to main content
      </a>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-[#2e2958] border-r border-white/10',
          'transform transition-all duration-300 ease-out',
          'lg:translate-x-0',
          sidebarCollapsed ? 'w-[60px]' : 'w-72',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={cn('flex items-center h-16 border-b border-white/10', sidebarCollapsed ? 'px-2 justify-center' : 'px-4')}>
            <Link to="/" className={cn('flex items-center gap-2', sidebarCollapsed && 'justify-center')}>
              <div className="w-8 h-8 rounded-lg bg-[#e6f354] flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-[#2e2958]" />
              </div>
              {!sidebarCollapsed && <h1 className="text-xl font-heading font-bold text-white">Ashbi</h1>}
            </Link>
            {!sidebarCollapsed && (
              <>
                <button
                  onClick={toggleCollapse}
                  className="ml-auto p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors hidden lg:flex"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="ml-auto p-2 text-white/60 hover:text-white lg:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
            {sidebarCollapsed && (
              <button
                onClick={toggleCollapse}
                className="absolute bottom-20 left-1/2 -translate-x-1/2 p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors hidden lg:flex"
                title="Expand sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className={cn('flex-1 py-3 space-y-1 overflow-y-auto', sidebarCollapsed ? 'px-1.5' : 'px-3')}>
            {/* Core — always visible */}
            <div className="space-y-0.5 pb-2">
              {renderNavItems(coreNav)}
            </div>

            <div className="border-t border-white/10 pt-2 space-y-1">
              {renderCollapsibleSection('finance', 'Finance & Docs', financeNav)}
              {adminNav.length > 0 && renderCollapsibleSection('admin', 'Admin', adminNav)}
            </div>

            {/* Quick action */}
            <div className="pt-2 border-t border-white/10">
              {sidebarCollapsed ? (
                <button
                  onClick={() => navigate('/projects?create=true')}
                  className="w-full flex items-center justify-center p-2 text-[#e6f354] hover:bg-[#e6f354]/10 rounded-lg transition-colors"
                  title="New Project"
                >
                  <Plus className="w-4 h-4" />
                </button>
              ) : (
                <button
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-full bg-[#e6f354] text-[#2e2958] hover:bg-[#d0dd9a] transition-colors"
                  onClick={() => navigate('/projects?create=true')}
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Project
                </button>
              )}
            </div>
          </nav>

          {/* User section */}
          <div className={cn('border-t border-white/10', sidebarCollapsed ? 'p-2' : 'p-4')}>
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#e6f354]/20 flex items-center justify-center">
                  <span className="text-xs font-semibold text-[#e6f354]">
                    {user?.name?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
                <Link to="/settings" className="p-1.5 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors" title="Settings" onClick={() => setSidebarOpen(false)}>
                  <Settings className="w-3.5 h-3.5" />
                </Link>
                <button onClick={logout} className="p-1.5 text-white/60 hover:text-red-400 rounded-lg hover:bg-white/10 transition-colors" title="Logout">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#e6f354]/20 flex items-center justify-center">
                  <span className="text-sm font-semibold text-[#e6f354]">
                    {user?.name?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {user?.name}
                  </p>
                  <p className="text-xs text-white/50 truncate">
                    {isAdmin ? 'Administrator' : 'Team Member'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    to="/settings"
                    className="p-2 text-white/60 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                    title="Settings"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Settings className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={logout}
                    className="p-2 text-white/60 hover:text-red-400 rounded-lg hover:bg-white/10 transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className={cn(
        'flex-1 min-h-screen flex flex-col w-full transition-all duration-300',
        sidebarCollapsed ? 'lg:ml-[60px]' : 'lg:ml-72'
      )}>
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-card/80 backdrop-blur-md border-b border-border/60 lg:px-6 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground lg:hidden"
          >
            <Menu className="w-6 h-6" />
          </button>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl mx-4">
            <div
              className={cn(
                'relative group transition-all duration-200',
                isSearchFocused && 'scale-[1.02]'
              )}
            >
              <Search className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-200',
                isSearchFocused ? 'text-[#2e2958]' : 'text-muted-foreground'
              )} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                placeholder="Search threads, clients, projects..."
                className={cn(
                  'w-full pl-10 pr-20 py-2 text-sm bg-muted border-0 rounded-xl',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-[#2e2958]/20 focus:bg-card',
                  'transition-all duration-200'
                )}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-sans font-medium text-muted-foreground bg-background border border-border rounded">
                  <Command className="w-3 h-3" /> K
                </kbd>
              </div>
            </div>
          </form>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            <QuickCreateMenu navigate={navigate} isAdmin={isAdmin} />
            <button
              onClick={toggleTheme}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <NotificationsDropdown />
          </div>
        </header>

        {/* Install App Banner */}
        {isInstallable && !installDismissed && (
          <div className="mx-4 mt-4 lg:mx-6 flex items-center justify-between rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-blue-700 dark:text-blue-300">Install Ashbi Hub as an app for quick access</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await install();
                  if (permission !== 'granted') subscribe();
                }}
              >
                Install
              </Button>
              <button
                onClick={() => setInstallDismissed(true)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Push notification prompt */}
        {user && permission === 'default' && !subscribed && (
          <div className="mx-4 mt-2 lg:mx-6 flex items-center justify-between rounded-lg bg-muted border border-border px-4 py-2">
            <span className="text-sm text-muted-foreground">Enable push notifications to stay updated</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={subscribe}
            >
              Enable
            </Button>
          </div>
        )}

        {/* Page content */}
        <div id="main-content" className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6 animate-fade-in overflow-auto" tabIndex={-1}>
          {children}
        </div>
      </main>

      {/* Mobile bottom nav with More menu */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-card/80 backdrop-blur-lg border-t border-border/60 flex lg:hidden safe-area-inset-bottom shadow-[0_-4px_10px_-1px_rgba(0,0,0,0.05)]" role="navigation" aria-label="Mobile navigation">
        {[
          { href: '/', icon: LayoutDashboard, label: 'Home', exact: true },
          { href: '/inbox', icon: Inbox, label: 'Inbox', badge: stats?.needsResponse },
          { href: '/projects', icon: FolderOpen, label: 'Projects' },
          { href: '/invoices', icon: Receipt, label: 'Invoices' },
          { href: '#more', icon: MoreHorizontal, label: 'More', isMore: true },
        ].map((item) => {
          const isActive = item.exact
            ? location.pathname === item.href
            : location.pathname.startsWith(item.href) && item.href !== '/';

          if (item.isMore) {
            return (
              <div key="more" className="relative flex-1">
                <button
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className={cn(
                    'w-full flex flex-col items-center justify-center py-2.5 text-xs transition-all active:scale-90',
                    moreMenuOpen ? 'text-primary' : 'text-muted-foreground'
                  )}
                  aria-expanded={moreMenuOpen}
                  aria-haspopup="true"
                >
                  <MoreHorizontal className="w-5 h-5 mb-0.5" />
                  <span className="text-[10px] font-medium uppercase tracking-tighter">More</span>
                </button>

                {/* More menu dropdown */}
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-50 bg-black/5 backdrop-blur-sm" onClick={() => setMoreMenuOpen(false)} aria-hidden="true" />
                    <div className="absolute bottom-full right-2 mb-4 w-64 bg-card/90 backdrop-blur-xl border border-border/40 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300" role="menu">
                      {/* Quick Actions */}
                      <div className="px-4 py-3 border-b border-border/40">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Quick Actions</p>
                      </div>
                      <div className="py-2">
                        {[
                          { label: 'New Project', icon: Plus, href: '/projects?create=true' },
                          { label: 'New Invoice', icon: Receipt, href: '/invoices?create=true' },
                          { label: 'New Client', icon: Users, href: '/clients?create=true' },
                        ].map((action) => (
                          <Link
                            key={action.label}
                            to={action.href}
                            onClick={() => setMoreMenuOpen(false)}
                            className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-primary/5 transition-colors"
                            role="menuitem"
                          >
                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                              <action.icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <span className="font-medium text-foreground">{action.label}</span>
                          </Link>
                        ))}
                      </div>

                      {/* Admin */}
                      {adminNav.length > 0 && (
                        <>
                          <div className="px-4 py-3 border-t border-border/40">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Admin</p>
                          </div>
                          <div className="py-2">
                            {adminNav.map((item) => (
                              <Link
                                key={item.name}
                                to={item.href}
                                onClick={() => setMoreMenuOpen(false)}
                                className={cn(
                                  'flex items-center gap-4 px-5 py-3 text-sm transition-colors',
                                  location.pathname === item.href ? 'bg-primary/5 text-primary' : 'hover:bg-primary/5'
                                )}
                                role="menuitem"
                              >
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center",
                                  location.pathname === item.href ? "bg-primary/10" : "bg-muted"
                                )}>
                                  <item.icon className="w-4 h-4" />
                                </div>
                                <span className="font-medium">{item.name}</span>
                              </Link>
                            ))}
                          </div>
                        </>
                      )}

                      {/* Theme & Settings */}
                      <div className="border-t border-border/40 py-2 bg-muted/30">
                        <button
                          onClick={() => { toggleTheme(); setMoreMenuOpen(false); }}
                          className="w-full flex items-center gap-4 px-5 py-3 text-sm hover:bg-primary/5 transition-colors"
                          role="menuitem"
                        >
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                            {isDark ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
                          </div>
                          <span className="font-medium">{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                        </button>
                        <Link
                          to="/settings"
                          onClick={() => setMoreMenuOpen(false)}
                          className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-primary/5 transition-colors"
                          role="menuitem"
                        >
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                            <Settings className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <span className="font-medium">Settings</span>
                        </Link>
                        <button
                          onClick={() => { logout(); setMoreMenuOpen(false); }}
                          className="w-full flex items-center gap-4 px-5 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                          role="menuitem"
                        >
                          <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                            <LogOut className="w-4 h-4" />
                          </div>
                          <span className="font-bold uppercase tracking-tight">Logout</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setMoreMenuOpen(false)}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2.5 text-xs transition-all active:scale-90 relative',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                <item.icon className={cn('w-5 h-5 mb-0.5', isActive && 'scale-110')} aria-hidden="true" />
                {item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 text-[9px] font-bold rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm" aria-label={`${item.badge} unread items`}>
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>
              <span className={cn('text-[10px] uppercase tracking-tighter', isActive ? 'font-bold' : 'font-medium')}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Global AI Chat Widget */}
      <GlobalAIChat />
    </div>
  );
}

function QuickCreateMenu({ navigate, isAdmin }) {
  const [open, setOpen] = useState(false);

  const actions = [
    { label: 'New Project', icon: FolderOpen, href: '/projects?create=true' },
    { label: 'New Client', icon: Users, href: '/clients?create=true' },
    { label: 'New Invoice', icon: Receipt, href: '/invoices?create=true', adminOnly: true },
    { label: 'New Proposal', icon: FileText, href: '/proposals?create=true' },
    { label: 'New Note', icon: BookOpen, href: '/docs?create=true' },
  ].filter(a => !a.adminOnly || isAdmin);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
          open ? 'bg-[#e6f354] text-[#2e2958]' : 'bg-[#e6f354] text-[#2e2958] hover:bg-[#d0dd9a]'
        )}
        title="Quick create"
      >
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">Create</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
            {actions.map(({ label, icon: Icon, href }) => (
              <button
                key={label}
                onClick={() => { navigate(href); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Icon className="w-4 h-4 text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
