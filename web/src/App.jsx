import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, AuthProvider } from './hooks/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
// Client Portal
import ClientLogin from './pages/ClientLogin';
import ClientSignup from './pages/ClientSignup';
import ClientDashboard from './pages/ClientDashboard';
import ClientProjectDetail from './pages/ClientProjectDetail';
// Task Management
import TaskKanban from './pages/TaskKanban';
import TimeTracking from './pages/TimeTracking';
import ApprovalQueue from './pages/ApprovalQueue';
import GlobalSearch from './pages/GlobalSearch';
import AIQuery from './pages/AIQuery';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ShopifyDashboard from './pages/ShopifyDashboard';
import WordPressDashboard from './pages/WordPressDashboard';
import AgentTeamDashboard from './pages/AgentTeamDashboard';
import SkillsCatalog from './pages/SkillsCatalog';
import IntegrationDashboard from './pages/IntegrationDashboard';
import Dashboard from './pages/Dashboard';
import SimplifiedDashboard from './pages/SimplifiedDashboard';
import Inbox from './pages/Inbox';
import SimplifiedInbox from './pages/SimplifiedInbox';
import Thread from './pages/Thread';
import Projects from './pages/Projects';
import Project from './pages/Project';
import Clients from './pages/Clients';
import Client from './pages/Client';
import Team from './pages/Team';
import Analytics from './pages/Analytics';
import Search from './pages/Search';
import PendingApprovals from './pages/PendingApprovals';
import TaskPage from './pages/TaskPage';
import Proposals from './pages/Proposals';
import ProposalDetail from './pages/ProposalDetail';
import Contracts from './pages/Contracts';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Upwork from './pages/Upwork';
import AiChat from './pages/AiChat';
import Credentials from './pages/Credentials';
import Portal from './pages/Portal';
import Outreach from './pages/Outreach';
import Social from './pages/Social';
import Blog from './pages/Blog';
import AiTeam from './pages/AiTeam';
// AI Employee Suite
import EmailAgent from './pages/EmailAgent';
import ContentAgent from './pages/ContentAgent';
import LinkedInAgent from './pages/LinkedInAgent';
import ColdEmail from './pages/ColdEmail';
import CallAgent from './pages/CallAgent';
import LeadGen from './pages/LeadGen';
import SocialContent from './pages/SocialContent';
import SeoBlog from './pages/SeoBlog';
import AiContextSettings from './pages/AiContextSettings';
import UpworkContracts from './pages/UpworkContracts';
import CommandCenter from './pages/CommandCenter';

function PrivateRoute({ children }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return user ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

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
      {/* Client Portal Routes */}
      <Route path="/client/login" element={<ClientLogin />} />
      <Route path="/client/invite" element={<ClientSignup />} />
      <Route path="/client/dashboard" element={<ClientDashboard />} />
      <Route path="/client/project/:id" element={<ClientProjectDetail />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<SimplifiedDashboard />} />
                <Route path="/dashboard/full" element={<Dashboard />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/inbox/simple" element={<SimplifiedInbox />} />
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
                <Route path="/upwork" element={<Upwork />} />
                <Route path="/ai-chat" element={<AIQuery />} />
                <Route path="/credentials" element={<AdminRoute><Credentials /></AdminRoute>} />
                <Route path="/outreach" element={<Outreach />} />
                <Route path="/social" element={<Social />} />
                <Route path="/blog" element={<Blog />} />
                <Route path="/ai-team" element={<AiTeam />} />
                {/* AI Employee Suite */}
                <Route path="/email-triage" element={<EmailAgent />} />
                <Route path="/content-writer" element={<ContentAgent />} />
                <Route path="/linkedin-outreach" element={<LinkedInAgent />} />
                <Route path="/cold-email" element={<ColdEmail />} />
                <Route path="/call-screener" element={<CallAgent />} />
                <Route path="/lead-gen" element={<LeadGen />} />
                <Route path="/social-content" element={<SocialContent />} />
                <Route path="/seo-blog" element={<SeoBlog />} />
                <Route path="/admin/settings/ai-context" element={<AdminRoute><AiContextSettings /></AdminRoute>} />
                <Route path="/upwork-contracts" element={<UpworkContracts />} />
                <Route path="/admin/command-center" element={<AdminRoute><CommandCenter /></AdminRoute>} />
                {/* Agent Team & Skills */}
                <Route path="/agents" element={<AgentTeamDashboard />} />
                <Route path="/skills" element={<SkillsCatalog />} />
                <Route path="/shopify" element={<ShopifyDashboard />} />
                <Route path="/wordpress" element={<WordPressDashboard />} />
                <Route path="/client-success" element={<AgentTeamDashboard />} />
                <Route path="/integrations" element={<IntegrationDashboard />} />
              </Routes>
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
