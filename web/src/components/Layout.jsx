import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox,
  FolderOpen,
  Users,
  UserCog,
  BarChart3,
  LogOut,
  Search,
  Menu,
  CheckCircle,
  Settings,
  X,
  Command,
  Sparkles,
  ChevronRight,
  Plus,
  FileText,
  ScrollText,
  Receipt,
  Briefcase,
  Bot,
  KeyRound,
  Home,
  Target,
  LayoutDashboard,
  UserSearch,
  Share2,
  PenSquare,
  UsersRound,
  Mail,
  Phone,
  FileEdit,
  Linkedin,
  MailPlus,
  Activity,
  MessageSquare,
  Wallet,
  Zap,
  GanttChartSquare,
  PieChart,
  Filter,
  ClipboardList,
  Palette,
  TrendingUp,
  Heart,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
} from 'lucide-react';
import { useState, useEffect } from 'react';
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

  const { data: pendingCount } = useQuery({
    queryKey: ['pending-count'],
    queryFn: async () => {
      try {
        return await api.getPendingApprovalCount();
      } catch { return 0; }
    },
    refetchInterval: 30000,
    enabled: isAdmin,
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
    ...(isAdmin && pendingCount > 0 ? [{ name: 'Approvals', href: '/approvals', icon: CheckCircle, badge: pendingCount }] : []),
    { name: 'Projects', href: '/projects', icon: FolderOpen },
    { name: 'Clients', href: '/clients', icon: Users },
    { name: 'Invoices', href: '/invoices', icon: Receipt },
  ];

  // Collapsible sections
  const financeNav = [
    { name: 'Pipeline', href: '/pipeline', icon: Filter },
    { name: 'Proposals', href: '/proposals', icon: FileText },
    { name: 'Contracts', href: '/contracts', icon: ScrollText },
    { name: 'Expenses', href: '/expenses', icon: Wallet },
    ...(isAdmin ? [
      { name: 'Retainers', href: '/retainers', icon: TrendingUp },
      { name: 'Invoice Chaser', href: '/invoice-chaser', icon: Zap },
      { name: 'Automations', href: '/automations', icon: Activity },
    ] : []),
  ];

  const projectToolsNav = [
    { name: 'Docs & Notes', href: '/docs', icon: BookOpen },
    { name: 'AI Planner', href: '/project-planner', icon: Sparkles },
    { name: 'Gantt Timeline', href: '/gantt', icon: GanttChartSquare },
    { name: 'Templates', href: '/project-templates', icon: FileText },
    { name: 'Activity', href: '/activity', icon: Activity },
    { name: 'Chat with Ash', href: '/chat', icon: MessageSquare },
    { name: 'Intake Forms', href: '/intake-forms', icon: ClipboardList },
  ];

  const aiNav = [
    { name: 'AI Chat', href: '/ai-chat', icon: Bot },
    { name: 'AI Team', href: '/ai-team', icon: UsersRound },
    { name: 'Email Triage', href: '/email-triage', icon: Mail },
    { name: 'Content Writer', href: '/content-writer', icon: FileEdit },
    { name: 'Lead Gen', href: '/lead-gen', icon: Target },
    { name: 'SEO Blog', href: '/seo-blog', icon: PenSquare },
    { name: 'Cold Email', href: '/cold-email', icon: MailPlus },
    { name: 'LinkedIn', href: '/linkedin-outreach', icon: Linkedin },
    { name: 'Call Screener', href: '/call-screener', icon: Phone },
    { name: 'Social Content', href: '/social-content', icon: Share2 },
  ];

  const marketingNav = [
    { name: 'Outreach', href: '/outreach', icon: UserSearch },
    { name: 'Social', href: '/social', icon: Share2 },
    { name: 'Blog', href: '/blog', icon: PenSquare },
    { name: 'Upwork', href: '/upwork', icon: Briefcase },
  ];

  const adminNav = isAdmin ? [
    { name: 'Team', href: '/team', icon: UserCog },
    { name: 'Revenue', href: '/revenue', icon: TrendingUp },
    { name: 'Client Health', href: '/client-health', icon: Heart },
    { name: 'Reports', href: '/reports', icon: PieChart },
    { name: 'Command Center', href: '/admin/command-center', icon: Command },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Credentials', href: '/credentials', icon: KeyRound },
    { name: 'Brand Settings', href: '/admin/brand', icon: Palette },
    { name: 'AI Context', href: '/admin/settings/ai-context', icon: Settings },
  ] : [
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  ];

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
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <item.icon className={cn('w-4 h-4 shrink-0', !sidebarCollapsed && 'mr-2.5')} />
          {!sidebarCollapsed && <span className="flex-1 truncate">{item.name}</span>}
          {badge > 0 && (
            sidebarCollapsed ? (
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                {badge > 9 ? '9+' : badge}
              </span>
            ) : (
              <span className={cn(
                'ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded-full min-w-[18px] text-center',
                isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary text-primary-foreground'
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
          className="w-full flex items-center px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
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
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-card border-r border-border',
          'transform transition-all duration-300 ease-out',
          'lg:translate-x-0',
          sidebarCollapsed ? 'w-[60px]' : 'w-72',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={cn('flex items-center h-16 border-b border-border', sidebarCollapsed ? 'px-2 justify-center' : 'px-4')}>
            <Link to="/" className={cn('flex items-center gap-2', sidebarCollapsed && 'justify-center')}>
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-primary-foreground" />
              </div>
              {!sidebarCollapsed && <h1 className="text-xl font-heading font-bold text-foreground">Ashbi</h1>}
            </Link>
            {!sidebarCollapsed && (
              <>
                <button
                  onClick={toggleCollapse}
                  className="ml-auto p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors hidden lg:flex"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="ml-auto p-2 text-muted-foreground hover:text-foreground lg:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
            {sidebarCollapsed && (
              <button
                onClick={toggleCollapse}
                className="absolute bottom-20 left-1/2 -translate-x-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors hidden lg:flex"
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

            <div className="border-t border-border pt-2 space-y-1">
              {renderCollapsibleSection('finance', 'Finance & Docs', financeNav)}
              {renderCollapsibleSection('tools', 'Project Tools', projectToolsNav)}
              {renderCollapsibleSection('ai', 'AI Agents', aiNav)}
              {renderCollapsibleSection('marketing', 'Marketing', marketingNav)}
              {renderCollapsibleSection('admin', 'Admin', adminNav)}
            </div>

            {/* Quick action */}
            <div className="pt-2 border-t border-border">
              {sidebarCollapsed ? (
                <button
                  onClick={() => navigate('/projects?create=true')}
                  className="w-full flex items-center justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                  title="New Project"
                >
                  <Plus className="w-4 h-4" />
                </button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => navigate('/projects?create=true')}
                >
                  New Project
                </Button>
              )}
            </div>
          </nav>

          {/* User section */}
          <div className={cn('border-t border-border', sidebarCollapsed ? 'p-2' : 'p-4')}>
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary">
                    {user?.name?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
                <Link to="/settings" className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors" title="Settings" onClick={() => setSidebarOpen(false)}>
                  <Settings className="w-3.5 h-3.5" />
                </Link>
                <button onClick={logout} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors" title="Logout">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-semibold text-primary">
                    {user?.name?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user?.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {isAdmin ? 'Administrator' : 'Team Member'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    to="/settings"
                    className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                    title="Settings"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Settings className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={logout}
                    className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
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
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-card/80 backdrop-blur-md border-b border-border lg:px-6 flex-shrink-0">
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
                isSearchFocused ? 'text-primary' : 'text-muted-foreground'
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
                  'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-card',
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
        <div className="flex-1 p-4 lg:p-6 animate-fade-in overflow-auto">
          {children}
        </div>
      </main>
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
          'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
          open ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
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
