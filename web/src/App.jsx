import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, AuthProvider } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider, useToast } from './hooks/useToast';

// Public entry points are split so each deep link loads only its route module.
const Login = lazy(() => import('./pages/Login'));
const UiLab = lazy(() => import('./pages/UiLab'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Portal = lazy(() => import('./pages/Portal'));
const PortalProposal = lazy(() => import('./pages/PortalProposal'));
const PortalContract = lazy(() => import('./pages/PortalContract'));
const PortalInvoice = lazy(() => import('./pages/PortalInvoice'));
const PortalBooking = lazy(() => import('./pages/PortalBooking'));
const PortalIntakeForm = lazy(() => import('./pages/PortalIntakeForm'));
const PortalEstimate = lazy(() => import('./pages/PortalEstimate'));
const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const Layout = lazy(() => import('./components/Layout'));
const QueryProvider = lazy(() => import('./components/QueryProvider'));

function QueryRoute({ children }) {
  return <QueryProvider>{children}</QueryProvider>;
}

function RootRedirect() {
  const { user, isLoading, authState, checkAuth } = useAuth();
  if (isLoading) return <PageLoader />;
  if (authState.status === 'error') return <AuthCheckFailure authState={authState} onRetry={checkAuth} />;
  return user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />;
}

// Lazy loaded pages
const Inbox = lazy(() => import('./pages/Inbox'));
const Thread = lazy(() => import('./pages/Thread'));
const Projects = lazy(() => import('./pages/Projects'));
const Project = lazy(() => import('./pages/Project'));
const Clients = lazy(() => import('./pages/Clients'));
const Client = lazy(() => import('./pages/Client'));
const Team = lazy(() => import('./pages/Team'));
const GlobalSearch = lazy(() => import('./pages/GlobalSearch'));
const ApprovalQueue = lazy(() => import('./pages/ApprovalQueue'));
const TaskPage = lazy(() => import('./pages/TaskPage'));
const TaskKanban = lazy(() => import('./pages/TaskKanban'));
const TimeTracking = lazy(() => import('./pages/TimeTracking'));
const Proposals = lazy(() => import('./pages/Proposals'));
const ProposalDetail = lazy(() => import('./pages/ProposalDetail'));
const Contracts = lazy(() => import('./pages/Contracts'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Credentials = lazy(() => import('./pages/Credentials'));
const Chat = lazy(() => import('./pages/Chat'));
const AiContextSettings = lazy(() => import('./pages/AiContextSettings'));
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const Docs = lazy(() => import('./pages/Docs'));
// Project Tools
const ProjectPlanner = lazy(() => import('./pages/ProjectPlanner'));
const ProjectTemplates = lazy(() => import('./pages/ProjectTemplates'));
const Automations = lazy(() => import('./pages/Automations'));
// Admin / Finance
const BrandSettings = lazy(() => import('./pages/BrandSettings'));
const Retainers = lazy(() => import('./pages/Retainers'));
const InvoiceChaser = lazy(() => import('./pages/InvoiceChaser'));
const Settings = lazy(() => import('./pages/Settings'));
// Marketing Suite
const Notifications = lazy(() => import('./pages/Notifications'));
// Advanced Features
const AssetLibrary = lazy(() => import('./pages/AssetLibrary'));
const WPSites = lazy(() => import('./pages/WPSites'));
const SemanticSearch = lazy(() => import('./pages/SemanticSearch'));
// New Features
const Estimates = lazy(() => import('./pages/Estimates'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Timesheets = lazy(() => import('./pages/Timesheets'));
const RateCards = lazy(() => import('./pages/RateCards'));
// Agent Pages (client acquisition pipeline)

// Cold Email
// Side-nav targets that previously had no route (UX audit finding)
const Trash = lazy(() => import('./pages/Trash'));

function PageLoader() {
  return (
    <div role="status" aria-live="polite" aria-label="Checking your session" className="flex items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
      <div aria-hidden="true" className="animate-spin motion-reduce:animate-none rounded-full h-8 w-8 border-b-2 border-primary"></div>
      <span>Checking your session…</span>
    </div>
  );
}

function RouteLoader() {
  return (
    <main role="status" aria-live="polite" aria-label="Loading page" className="flex min-h-[60vh] items-center justify-center gap-3 bg-background p-6 text-muted-foreground">
      <div aria-hidden="true" className="h-8 w-8 animate-spin motion-reduce:animate-none rounded-full border-b-2 border-primary"></div>
      <span>Loading page...</span>
    </main>
  );
}

function AuthCheckFailure({ authState, onRetry }) {
  const copy = {
    offline: ['You appear to be offline', 'Reconnect and try again. You have not been signed out, and locally saved drafts remain on this device.'],
    timeout: ['The session check timed out', 'The server took too long to respond. Try again; you have not been signed out.'],
    server: ['We could not verify your session', 'The service is temporarily unavailable. Try again; you have not been signed out.'],
    forbidden: ['Access could not be verified', 'Your account may not have permission for this workspace. Try again or contact an administrator.'],
    unknown: ['We could not verify your session', 'Try again. You have not been signed out.'],
  };
  const [title, message] = copy[authState.reason] || copy.unknown;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <section role="alert" className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 text-muted-foreground">{message}</p>
        <button type="button" onClick={onRetry} className="mt-6 min-h-11 rounded-full bg-primary px-5 py-2.5 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Try again
        </button>
      </section>
    </main>
  );
}

function PrivateRoute({ children }) {
  const { user, isLoading, authState, checkAuth } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (authState.status === 'error') return <AuthCheckFailure authState={authState} onRetry={checkAuth} />;
  return user ? children : <Navigate to="/login" replace state={{ reason: authState.reason, message: authState.message, returnTo: safePrivateReturn(location) }} />;
}

function safePrivateReturn(location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function AdminRoute({ children }) {
  const { user, isLoading, authState, checkAuth } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (authState.status === 'error') return <AuthCheckFailure authState={authState} onRetry={checkAuth} />;
  if (!user) return <Navigate to="/login" replace state={{ reason: authState.reason, message: authState.message, returnTo: safePrivateReturn(location) }} />;
  if (user.role !== 'ADMIN') return (
    <section role="alert" className="m-6 rounded-xl border border-warning/40 bg-warning/10 p-5 text-foreground">
      <h1 className="font-semibold">Administrator access required</h1>
      <p className="mt-1 text-sm">Your account is signed in, but it does not have permission to open this page.</p>
    </section>
  );
  return children;
}

function NotFound() {
  // UX (audit 2026-07-09): previously /typo landed on a blank page with
  // no explanation. Show a recoverable 404 with a link back to the
  // dashboard so the user isn't stuck.
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-foreground mb-2">404</h1>
        <p className="text-muted-foreground mb-4">We couldn't find that page.</p>
        <a href="/dashboard" className="text-primary hover:underline">
          Go to dashboard →
        </a>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
      <ErrorBoundary>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
          <Route path="/login" element={<Login />} />
          {import.meta.env.DEV && (
            <Route path="/ui-lab" element={<UiLab />} />
          )}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/portal/:token" element={<QueryRoute><Portal /></QueryRoute>} />
          <Route path="/portal/proposal/:token" element={<QueryRoute><PortalProposal /></QueryRoute>} />
          <Route path="/portal/contract/:token" element={<QueryRoute><PortalContract /></QueryRoute>} />
          <Route path="/portal/invoice/:token" element={<QueryRoute><PortalInvoice /></QueryRoute>} />
          <Route path="/portal/book" element={<QueryRoute><PortalBooking /></QueryRoute>} />
          <Route path="/portal/form/:token" element={<QueryRoute><PortalIntakeForm /></QueryRoute>} />
          <Route path="/portal/estimate/:viewToken" element={<QueryRoute><PortalEstimate /></QueryRoute>} />
          <Route path="/client-portal" element={<ClientPortal />} />
          <Route path="/client-portal/verify" element={<ClientPortal />} />
          <Route path="/client/login" element={<ClientPortal />} />
          <Route path="/client/dashboard" element={<ClientPortal />} />
          <Route path="/" element={<RootRedirect />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <QueryRoute>
              <Layout>
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                  <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/" element={<Navigate to="/dashboard" />} />
                  <Route path="/inbox" element={<Inbox />} />
                  <Route path="/thread/:id" element={<Thread />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/project/:id" element={<Project />} />
                  <Route path="/task/:id" element={<TaskPage />} />
                  <Route path="/project/:projectId/kanban" element={<TaskKanban />} />
                  <Route path="/project/:projectId/time" element={<TimeTracking />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/client/:id" element={<Client />} />
                  <Route path="/team" element={<AdminRoute><Team /></AdminRoute>} />
                                    <Route path="/search" element={<GlobalSearch />} />
                  <Route path="/approvals" element={<AdminRoute><ApprovalQueue /></AdminRoute>} />
                  <Route path="/proposals" element={<Proposals />} />
                  <Route path="/proposal/:id" element={<ProposalDetail />} />
                  <Route path="/contracts" element={<Contracts />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/:id" element={<InvoiceDetail />} />
                  <Route path="/expenses" element={<Expenses />} />
                  <Route path="/pipeline" element={<Pipeline />} />
                                                                        <Route path="/estimates" element={<Estimates />} />
                  <Route path="/schedule" element={<Schedule />} />
                  <Route path="/timesheets" element={<Timesheets />} />
                  <Route path="/rate-cards" element={<AdminRoute><RateCards /></AdminRoute>} />
                                                      <Route path="/credentials" element={<AdminRoute><Credentials /></AdminRoute>} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/admin/settings/ai-context" element={<AdminRoute><AiContextSettings /></AdminRoute>} />
                  <Route path="/admin/command-center" element={<AdminRoute><CommandCenter /></AdminRoute>} />
                  <Route path="/admin/brand" element={<AdminRoute><BrandSettings /></AdminRoute>} />
                                    <Route path="/trash" element={<AdminRoute><Trash /></AdminRoute>} />
                                    <Route path="/automations" element={<AdminRoute><Automations /></AdminRoute>} />
                  <Route path="/docs" element={<Docs />} />
                  <Route path="/project-planner" element={<ProjectPlanner />} />
                  <Route path="/project-templates" element={<ProjectTemplates />} />
                                                      <Route path="/retainers" element={<AdminRoute><Retainers /></AdminRoute>} />
                  <Route path="/invoice-chaser" element={<AdminRoute><InvoiceChaser /></AdminRoute>} />
                  <Route path="/settings" element={<Settings />} />
                                                                                          <Route path="/notifications" element={<Notifications />} />
                  {/* Advanced Features */}
                  <Route path="/assets" element={<AssetLibrary />} />
                  <Route path="/wp-sites" element={<AdminRoute><WPSites /></AdminRoute>} />
                  <Route path="/semantic-search" element={<SemanticSearch />} />
                  <Route path="*" element={<NotFound />} />
                  </Routes>
                  </Suspense>
                </ErrorBoundary>
              </Layout>
            </QueryRoute>
          </PrivateRoute>
        }
      />
          </Routes>
        </Suspense>
      </ErrorBoundary>
  );
}

// Component to handle global API error events
function GlobalErrorHandler({ children }) {
  const { expireSession } = useAuth();
  const toast = useToast();

  useEffect(() => {
    const handleUnauthorized = (event) => {
      const { message } = event.detail;
      expireSession(message || 'Your session expired. Please sign in again.');
    };

    const handleApiError = (event) => {
      const { error, retry } = event.detail;
      // Show error toast for failed requests (but not 401s - those are handled separately)
      if (error.status !== 401) {
        // Don't show toast for network errors or timeouts in development
        // as they can be noisy during development
        const isNetworkError = error.name === 'NetworkError';
        const isTimeout = error.name === 'TimeoutError';

        if (isNetworkError) {
          toast.error({
            title: 'Network error',
            message: retry ? 'Check your connection, then try this read-only request again.' : 'Check your connection. Your action was not retried to avoid a duplicate change.',
            duration: 0,
            action: retry ? { label: 'Try again', onClick: retry } : undefined,
          });
        } else if (isTimeout) {
          toast.error({
            title: 'Request timed out',
            message: retry ? 'The server took too long. You can safely retry this read-only request.' : 'The result is uncertain, so the action was not retried. Check the page before trying again.',
            duration: 0,
            action: retry ? { label: 'Try again', onClick: retry } : undefined,
          });
        } else if (error.status >= 500) {
          toast.error({
            title: 'Server error',
            message: retry ? 'The request failed on the server. Try this read-only request again.' : 'The action may not have completed. Check the current record before trying again.',
            duration: 0,
            action: retry ? { label: 'Try again', onClick: retry } : undefined,
          });
        } else if (error.status >= 400) {
          toast.error('Request Failed', error.message || 'Please check your input and try again.');
        }
      }
    };

    window.addEventListener('api:unauthorized', handleUnauthorized);
    window.addEventListener('api:error', handleApiError);

    return () => {
      window.removeEventListener('api:unauthorized', handleUnauthorized);
      window.removeEventListener('api:error', handleApiError);
    };
  }, [expireSession, toast]);

  return children;
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <GlobalErrorHandler>
          <AppRoutes />
        </GlobalErrorHandler>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
