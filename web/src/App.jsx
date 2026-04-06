import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, AuthProvider } from './hooks/useAuth';
import Layout from './components/Layout';

// Eagerly loaded (auth + portal — always needed before user is known)
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Portal from './pages/Portal';
import PortalProposal from './pages/PortalProposal';
import PortalContract from './pages/PortalContract';
import PortalInvoice from './pages/PortalInvoice';
import PortalBooking from './pages/PortalBooking';
import PortalIntakeForm from './pages/PortalIntakeForm';
import ClientPortal from './pages/ClientPortal';
import ClientLogin from './pages/ClientLogin';
import ClientSignup from './pages/ClientSignup';
import ClientDashboard from './pages/ClientDashboard';
import ClientProjectDetail from './pages/ClientProjectDetail';

// Lazy loaded pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Thread = lazy(() => import('./pages/Thread'));
const Projects = lazy(() => import('./pages/Projects'));
const Project = lazy(() => import('./pages/Project'));
const Clients = lazy(() => import('./pages/Clients'));
const Client = lazy(() => import('./pages/Client'));
const Team = lazy(() => import('./pages/Team'));
const Analytics = lazy(() => import('./pages/Analytics'));
const GlobalSearch = lazy(() => import('./pages/GlobalSearch'));
const Search = lazy(() => import('./pages/Search'));
const PendingApprovals = lazy(() => import('./pages/PendingApprovals'));
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
const Upwork = lazy(() => import('./pages/Upwork'));
const UpworkContracts = lazy(() => import('./pages/UpworkContracts'));
const Credentials = lazy(() => import('./pages/Credentials'));
const Outreach = lazy(() => import('./pages/Outreach'));
const Social = lazy(() => import('./pages/Social'));
const Blog = lazy(() => import('./pages/Blog'));
const AiTeam = lazy(() => import('./pages/AiTeam'));
const AiChat = lazy(() => import('./pages/AiChat'));
const AIQuery = lazy(() => import('./pages/AIQuery'));
const Chat = lazy(() => import('./pages/Chat'));
// AI Employee Suite
const EmailAgent = lazy(() => import('./pages/EmailAgent'));
const ContentAgent = lazy(() => import('./pages/ContentAgent'));
const LinkedInAgent = lazy(() => import('./pages/LinkedInAgent'));
const ColdEmail = lazy(() => import('./pages/ColdEmail'));
const CallAgent = lazy(() => import('./pages/CallAgent'));
const LeadGen = lazy(() => import('./pages/LeadGen'));
const SocialContent = lazy(() => import('./pages/SocialContent'));
const SeoBlog = lazy(() => import('./pages/SeoBlog'));
const AiContextSettings = lazy(() => import('./pages/AiContextSettings'));
// Command Center & Integrations
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const ShopifyDashboard = lazy(() => import('./pages/ShopifyDashboard'));
const WordPressDashboard = lazy(() => import('./pages/WordPressDashboard'));
const AgentTeamDashboard = lazy(() => import('./pages/AgentTeamDashboard'));
const SkillsCatalog = lazy(() => import('./pages/SkillsCatalog'));
const IntegrationDashboard = lazy(() => import('./pages/IntegrationDashboard'));
// Project Tools
const GanttView = lazy(() => import('./pages/GanttView'));
const ProjectPlanner = lazy(() => import('./pages/ProjectPlanner'));
const ProjectTemplates = lazy(() => import('./pages/ProjectTemplates'));
const IntakeForms = lazy(() => import('./pages/IntakeForms'));
const ActivityFeed = lazy(() => import('./pages/ActivityFeed'));
const Automations = lazy(() => import('./pages/Automations'));
// Admin / Finance
const Reports = lazy(() => import('./pages/Reports'));
const BrandSettings = lazy(() => import('./pages/BrandSettings'));
const Retainers = lazy(() => import('./pages/Retainers'));
const InvoiceChaser = lazy(() => import('./pages/InvoiceChaser'));
const Settings = lazy(() => import('./pages/Settings'));
const Revenue = lazy(() => import('./pages/Revenue'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  return user ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/portal/proposal/:token" element={<PortalProposal />} />
      <Route path="/portal/contract/:token" element={<PortalContract />} />
      <Route path="/portal/invoice/:token" element={<PortalInvoice />} />
      <Route path="/portal/book" element={<PortalBooking />} />
      <Route path="/portal/form/:token" element={<PortalIntakeForm />} />
      <Route path="/client-portal" element={<ClientPortal />} />
      <Route path="/client/login" element={<ClientLogin />} />
      <Route path="/client/invite" element={<ClientSignup />} />
      <Route path="/client/dashboard" element={<ClientDashboard />} />
      <Route path="/client/project/:id" element={<ClientProjectDetail />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
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
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/search" element={<GlobalSearch />} />
                  <Route path="/approvals" element={<AdminRoute><ApprovalQueue /></AdminRoute>} />
                  <Route path="/proposals" element={<Proposals />} />
                  <Route path="/proposal/:id" element={<ProposalDetail />} />
                  <Route path="/contracts" element={<Contracts />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/:id" element={<InvoiceDetail />} />
                  <Route path="/expenses" element={<Expenses />} />
                  <Route path="/pipeline" element={<Pipeline />} />
                  <Route path="/upwork" element={<Upwork />} />
                  <Route path="/upwork-contracts" element={<UpworkContracts />} />
                  <Route path="/credentials" element={<AdminRoute><Credentials /></AdminRoute>} />
                  <Route path="/outreach" element={<Outreach />} />
                  <Route path="/social" element={<Social />} />
                  <Route path="/blog" element={<Blog />} />
                  <Route path="/ai-team" element={<AiTeam />} />
                  <Route path="/ai-chat" element={<AIQuery />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/email-triage" element={<EmailAgent />} />
                  <Route path="/content-writer" element={<ContentAgent />} />
                  <Route path="/linkedin-outreach" element={<LinkedInAgent />} />
                  <Route path="/cold-email" element={<ColdEmail />} />
                  <Route path="/call-screener" element={<CallAgent />} />
                  <Route path="/lead-gen" element={<LeadGen />} />
                  <Route path="/social-content" element={<SocialContent />} />
                  <Route path="/seo-blog" element={<SeoBlog />} />
                  <Route path="/admin/settings/ai-context" element={<AdminRoute><AiContextSettings /></AdminRoute>} />
                  <Route path="/admin/command-center" element={<AdminRoute><CommandCenter /></AdminRoute>} />
                  <Route path="/admin/brand" element={<AdminRoute><BrandSettings /></AdminRoute>} />
                  <Route path="/admin/reports" element={<AdminRoute><Reports /></AdminRoute>} />
                  <Route path="/reports" element={<AdminRoute><Reports /></AdminRoute>} />
                  <Route path="/shopify" element={<ShopifyDashboard />} />
                  <Route path="/wordpress" element={<WordPressDashboard />} />
                  <Route path="/agents" element={<AgentTeamDashboard />} />
                  <Route path="/skills" element={<SkillsCatalog />} />
                  <Route path="/client-success" element={<AgentTeamDashboard />} />
                  <Route path="/integrations" element={<IntegrationDashboard />} />
                  <Route path="/activity" element={<ActivityFeed />} />
                  <Route path="/automations" element={<AdminRoute><Automations /></AdminRoute>} />
                  <Route path="/project-planner" element={<ProjectPlanner />} />
                  <Route path="/project-templates" element={<ProjectTemplates />} />
                  <Route path="/gantt" element={<GanttView />} />
                  <Route path="/intake-forms" element={<IntakeForms />} />
                  <Route path="/retainers" element={<AdminRoute><Retainers /></AdminRoute>} />
                  <Route path="/invoice-chaser" element={<AdminRoute><InvoiceChaser /></AdminRoute>} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/revenue" element={<AdminRoute><Revenue /></AdminRoute>} />
                </Routes>
              </Suspense>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
