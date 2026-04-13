import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '';
const SOCKET_URL = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';

// ── Ashbi Design Brand ────────────────────────────────────────────────────────
const BRAND = {
  primary: '#2e2958',
  accent: '#e6f354',
  bg: '#faf9f2',
  white: '#ffffff',
  text: '#2e2958',
  textMuted: '#8a85a0',
  border: '#e8e5dc',
  cardBg: '#ffffff',
  hoverBg: '#f5f3ea',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(amount, currency) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency || 'USD' }).format(amount || 0);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtRelative(d) {
  if (!d) return '';
  const now = new Date();
  const date = new Date(d);
  const diff = date - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) return `${days}d left`;
  return fmtDate(d);
}

function statusBadge(status) {
  const s = (status || '').toUpperCase();
  if (s === 'PAID') return <span className="cp-badge cp-badge--green">PAID</span>;
  if (s === 'OVERDUE') return <span className="cp-badge cp-badge--red">OVERDUE</span>;
  if (s === 'SENT' || s === 'PENDING' || s === 'DRAFT') return <span className="cp-badge cp-badge--orange">DUE</span>;
  if (s === 'VOID') return <span className="cp-badge cp-badge--muted">VOID</span>;
  return <span className="cp-badge cp-badge--muted">{s}</span>;
}

function projectStatusLabel(s) {
  const map = {
    STARTING_UP: 'Starting Up', DESIGN_DEV: 'Design & Dev', ADDING_CONTENT: 'Adding Content',
    FINALIZING: 'Finalizing', LAUNCHED: 'Launched', ON_HOLD: 'On Hold',
    CANCELLED: 'Cancelled', ACTIVE: 'Active',
  };
  return map[s] || s;
}

function projectStatusColor(s) {
  const map = {
    STARTING_UP: 'cp-badge--blue', DESIGN_DEV: 'cp-badge--purple',
    ADDING_CONTENT: 'cp-badge--lime', FINALIZING: 'cp-badge--orange',
    LAUNCHED: 'cp-badge--green', ON_HOLD: 'cp-badge--muted',
    CANCELLED: 'cp-badge--red', ACTIVE: 'cp-badge--green',
  };
  return map[s] || 'cp-badge--muted';
}

function taskStatusLabel(s) {
  const map = { PENDING: 'To Do', UPCOMING: 'To Do', IMMEDIATE: 'To Do', IN_PROGRESS: 'In Progress', COMPLETED: 'Done', BLOCKED: 'Blocked' };
  return map[s] || s;
}

function taskStatusColor(s) {
  const map = { PENDING: 'cp-badge--orange', UPCOMING: 'cp-badge--orange', IMMEDIATE: 'cp-badge--orange', IN_PROGRESS: 'cp-badge--lime', COMPLETED: 'cp-badge--green', BLOCKED: 'cp-badge--red' };
  return map[s] || 'cp-badge--muted';
}

function priorityLabel(p) {
  const map = { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
  return map[p] || p;
}

function priorityColor(p) {
  const map = { CRITICAL: 'cp-badge--red', HIGH: 'cp-badge--orange', NORMAL: 'cp-badge--muted', LOW: 'cp-badge--muted' };
  return map[p] || 'cp-badge--muted';
}

// ── Icons (inline SVG — no dependency needed) ──────────────────────────────────
const Icons = {
  logo: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill={BRAND.accent}/><text x="4" y="18" fontSize="16" fontWeight="bold" fill={BRAND.primary}>A</text></svg>,
  overview: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  projects: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  invoices: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  documents: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  chat: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  arrow: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  download: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  upload: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  back: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/client-portal/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.sent) {
        setSent(true);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cp-login-bg">
      <div className="cp-login-card">
        <div className="cp-login-logo">{Icons.logo}</div>
        <h1 className="cp-login-title">Ashbi Design</h1>
        <p className="cp-login-subtitle">Client Portal</p>

        {sent ? (
          <div className="cp-login-sent">
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>&#9993;</div>
            <p className="cp-text" style={{ fontWeight: 600 }}>Check your inbox</p>
            <p className="cp-text-muted" style={{ fontSize: '0.875rem' }}>
              If we found an account for <strong>{email}</strong>, a login link is on its way.
            </p>
            <p className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>The link expires in 1 hour.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="cp-login-form">
            <p className="cp-text-muted" style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              Enter your email to receive a secure login link.
            </p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="cp-input"
            />
            {error && <p className="cp-error">{error}</p>}
            <button type="submit" disabled={loading} className="cp-btn-primary" style={{ width: '100%' }}>
              {loading ? 'Sending...' : 'Send Login Link'}
            </button>
          </form>
        )}
      </div>

      <style>{`
        .cp-login-bg {
          min-height: 100vh;
          background: ${BRAND.primary};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .cp-login-card {
          width: 100%;
          max-width: 380px;
          background: ${BRAND.white};
          border-radius: 20px;
          padding: 2.5rem 2rem;
          text-align: center;
        }
        .cp-login-logo { margin-bottom: 0.75rem; display: flex; justify-content: center; }
        .cp-login-title { font-size: 1.5rem; font-weight: 700; color: ${BRAND.text}; margin: 0; }
        .cp-login-subtitle { color: ${BRAND.textMuted}; font-size: 0.875rem; font-weight: 500; margin: 0.25rem 0 0; }
        .cp-login-form { display: flex; flex-direction: column; gap: 0.75rem; }
        .cp-login-sent { padding: 1rem 0; }
      `}</style>
    </div>
  );
}

// ── Chat Hook (Socket.IO) ─────────────────────────────────────────────────────
function useProjectChat(projectId, token) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!projectId || !token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-project', projectId);
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('chat:message', (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    // Load initial messages
    fetch(`${API}/api/client-portal/projects/${projectId}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => setMessages(Array.isArray(data) ? data : []))
      .catch(() => {});

    return () => {
      socket.emit('leave-project', projectId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [projectId, token]);

  const sendMessage = useCallback(async (content) => {
    if (!content.trim()) return;
    const res = await fetch(`${API}/api/client-portal/projects/${projectId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }
  }, [projectId, token]);

  return { messages, connected, sendMessage };
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ projects, invoices, retainer, unread, setActiveTab, setSelectedProject }) {
  const activeProjects = projects.filter(p => !['LAUNCHED', 'CANCELLED', 'ON_HOLD'].includes(p.status));
  const overdueInvoices = invoices.filter(i => i.status?.toUpperCase() === 'OVERDUE');
  const unpaidTotal = invoices
    .filter(i => ['SENT', 'OVERDUE', 'PENDING'].includes(i.status?.toUpperCase()))
    .reduce((s, i) => s + (i.total || 0), 0);

  return (
    <div className="cp-space-y-6">
      {/* Urgent alerts */}
      {overdueInvoices.length > 0 && (
        <div className="cp-alert cp-alert--red">
          <p className="cp-text" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            {overdueInvoices.length} overdue invoice{overdueInvoices.length > 1 ? 's' : ''}
          </p>
          <p className="cp-text-muted" style={{ fontSize: '0.8rem' }}>
            Please review your invoices and make payment at your earliest convenience.
          </p>
          <button onClick={() => setActiveTab('invoices')} className="cp-link" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            View invoices &rarr;
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="cp-grid-3">
        <div className="cp-card cp-stat">
          <p className="cp-stat-label">Active Projects</p>
          <p className="cp-stat-value" style={{ color: BRAND.primary }}>{activeProjects.length}</p>
        </div>
        <div className="cp-card cp-stat">
          <p className="cp-stat-label">Outstanding</p>
          <p className="cp-stat-value" style={{ color: unpaidTotal > 0 ? '#d97706' : '#16a34a' }}>
            {fmt(unpaidTotal, 'USD')}
          </p>
        </div>
        <div className="cp-card cp-stat">
          <p className="cp-stat-label">Upcoming Deadlines</p>
          <p className="cp-stat-value" style={{ color: (unread?.upcomingDeadlines || 0) > 0 ? '#d97706' : BRAND.primary }}>
            {unread?.upcomingDeadlines ?? 0}
          </p>
        </div>
      </div>

      {/* Retainer (if exists) */}
      {retainer && (
        <div className="cp-card" style={{ padding: '1.5rem' }}>
          <h3 className="cp-card-title">Monthly Retainer</h3>
          <div className="cp-grid-3" style={{ marginTop: '0.75rem' }}>
            <div>
              <p className="cp-stat-label">Hours Included</p>
              <p className="cp-text" style={{ fontWeight: 600 }}>{retainer.hoursPerMonth}h</p>
            </div>
            <div>
              <p className="cp-stat-label">Hours Used</p>
              <p className="cp-text" style={{ fontWeight: 600, color: retainer.percentUsed >= 90 ? '#dc2626' : retainer.percentUsed >= 70 ? '#d97706' : '#16a34a' }}>
                {retainer.hoursUsed}h
              </p>
            </div>
            <div>
              <p className="cp-stat-label">Remaining</p>
              <p className="cp-text" style={{ fontWeight: 600 }}>{retainer.hoursRemaining >= 0 ? `${retainer.hoursRemaining}h` : `${Math.abs(retainer.hoursRemaining)}h over`}</p>
            </div>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: BRAND.textMuted, marginBottom: '0.25rem' }}>
              <span>Monthly usage</span>
              <span style={{ fontWeight: 600 }}>{retainer.percentUsed}%</span>
            </div>
            <div style={{ width: '100%', height: 8, background: BRAND.border, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4, transition: 'width 0.3s',
                width: `${Math.min(retainer.percentUsed, 100)}%`,
                background: retainer.percentUsed >= 100 ? '#dc2626' : retainer.percentUsed >= 80 ? '#d97706' : retainer.percentUsed >= 60 ? BRAND.accent : '#16a34a'
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Active projects preview */}
      {activeProjects.length > 0 && (
        <div>
          <h3 className="cp-section-title">Active Projects</h3>
          <div className="cp-space-y-3">
            {activeProjects.slice(0, 4).map(p => (
              <button key={p.id} className="cp-card cp-card--interactive" onClick={() => { setSelectedProject(p.id); setActiveTab('projects'); }} style={{ width: '100%', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span className="cp-text" style={{ fontWeight: 600 }}>{p.name}</span>
                  <span className={`cp-badge ${projectStatusColor(p.status)}`}>{projectStatusLabel(p.status)}</span>
                </div>
                {p.aiSummary && <p className="cp-text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>{p.aiSummary}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: BRAND.textMuted, marginBottom: '0.375rem' }}>
                  <span>Progress</span>
                  <span style={{ fontWeight: 600, color: BRAND.text }}>{p.progressPct}%</span>
                </div>
                <div style={{ width: '100%', height: 6, background: BRAND.border, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 0.3s',
                    width: `${p.progressPct}%`,
                    background: p.progressPct >= 80 ? '#16a34a' : BRAND.primary
                  }} />
                </div>
              </button>
            ))}
            {activeProjects.length > 4 && (
              <button onClick={() => setActiveTab('projects')} className="cp-link" style={{ fontSize: '0.85rem' }}>
                View all projects &rarr;
              </button>
            )}
          </div>
        </div>
      )}

      {/* Recent invoices */}
      {invoices.length > 0 && (
        <div>
          <h3 className="cp-section-title">Recent Invoices</h3>
          <div className="cp-space-y-2">
            {invoices.slice(0, 3).map(inv => (
              <div key={inv.id} className="cp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1.25rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', color: BRAND.primary, fontSize: '0.875rem', fontWeight: 600 }}>{inv.invoiceNumber}</span>
                    {statusBadge(inv.status)}
                  </div>
                  {inv.dueDate && inv.status !== 'PAID' && (
                    <p className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Due {fmtDate(inv.dueDate)}</p>
                  )}
                </div>
                <span className="cp-text" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{fmt(inv.total, inv.currency)}</span>
              </div>
            ))}
            {invoices.length > 3 && (
              <button onClick={() => setActiveTab('invoices')} className="cp-link" style={{ fontSize: '0.85rem' }}>
                View all invoices &rarr;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Projects Tab ──────────────────────────────────────────────────────────────
function ProjectsTab({ projects, setSelectedProject }) {
  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Your Projects</h2>
      {projects.length === 0 ? (
        <div className="cp-card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p className="cp-text-muted">No projects found.</p>
        </div>
      ) : (
        <div className="cp-grid-2">
          {projects.map(p => (
            <button key={p.id} className="cp-card cp-card--interactive" onClick={() => setSelectedProject(p.id)} style={{ width: '100%', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <h3 className="cp-text" style={{ fontWeight: 600, marginBottom: '0.125rem' }}>{p.name}</h3>
                  <p className="cp-text-muted" style={{ fontSize: '0.75rem' }}>Updated {fmtDate(p.updatedAt)}</p>
                </div>
                <span className={`cp-badge ${projectStatusColor(p.status)}`}>{projectStatusLabel(p.status)}</span>
              </div>
              {p.aiSummary && <p className="cp-text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{p.aiSummary}</p>}
              {p.totalTasks > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: BRAND.textMuted, marginBottom: '0.375rem' }}>
                    <span>{p.completedTasks} of {p.totalTasks} tasks</span>
                    <span style={{ fontWeight: 600, color: BRAND.text }}>{p.progressPct}%</span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: BRAND.border, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 4, transition: 'width 0.3s',
                      width: `${p.progressPct}%`,
                      background: p.progressPct >= 80 ? '#16a34a' : p.progressPct >= 40 ? BRAND.primary : BRAND.textMuted
                    }} />
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Project Detail (Kanban + Chat + Documents) ────────────────────────────────
function ProjectDetail({ projectId, token, onBack }) {
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState({ TODO: [], IN_PROGRESS: [], DONE: [], BLOCKED: [] });
  const [activeView, setActiveView] = useState('kanban'); // kanban | chat | documents
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const { messages, connected, sendMessage } = useProjectChat(projectId, token);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const [projRes, tasksRes, docsRes] = await Promise.all([
          fetch(`${API}/api/client-portal/projects/${projectId}`, { headers }),
          fetch(`${API}/api/client-portal/projects/${projectId}/tasks`, { headers }),
          fetch(`${API}/api/client-portal/projects/${projectId}/documents`, { headers }),
        ]);
        if (!projRes.ok) throw new Error('Failed to load project');
        const projData = await projRes.json();
        const tasksData = await tasksRes.json();
        const docsData = await docsRes.json();
        setProject(projData);
        setTasks(tasksData.columns || { TODO: [], IN_PROGRESS: [], DONE: [], BLOCKED: [] });
        setDocuments(Array.isArray(docsData) ? docsData : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (projectId) load();
  }, [projectId, token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput;
    setChatInput('');
    await sendMessage(msg);
  }

  async function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        await fetch(`${API}/api/client-portal/projects/${projectId}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
      }
      // Refresh documents
      const res = await fetch(`${API}/api/client-portal/projects/${projectId}/documents`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch {
      // Silently handle upload errors
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc(docId) {
    try {
      await fetch(`${API}/api/client-portal/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setDocuments(prev => prev.filter(d => d.id !== docId));
    } catch {
      // Silently handle
    }
  }

  if (loading) {
    return <div className="cp-loading">Loading project...</div>;
  }
  if (error || !project) {
    return (
      <div className="cp-error-box">
        <p className="cp-error">{error || 'Project not found'}</p>
        <button onClick={onBack} className="cp-link">Go back</button>
      </div>
    );
  }

  const kanbanColumns = [
    { key: 'TODO', label: 'To Do', tasks: tasks.TODO, color: '#d97706' },
    { key: 'IN_PROGRESS', label: 'In Progress', tasks: tasks.IN_PROGRESS, color: '#84cc16' },
    { key: 'DONE', label: 'Done', tasks: tasks.DONE, color: '#16a34a' },
    { key: 'BLOCKED', label: 'Blocked', tasks: tasks.BLOCKED || [], color: '#dc2626' },
  ];

  const detailTabs = [
    { id: 'kanban', label: 'Tasks', icon: Icons.projects },
    { id: 'chat', label: `Chat${connected ? ' \u2022' : ''}`, icon: Icons.chat },
    { id: 'documents', label: 'Documents', icon: Icons.documents },
  ];

  return (
    <div className="cp-space-y-4">
      {/* Back button + header */}
      <div>
        <button onClick={onBack} className="cp-link" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {Icons.back} Back to Projects
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 className="cp-page-title" style={{ marginBottom: 0 }}>{project.name}</h2>
          <span className={`cp-badge ${projectStatusColor(project.status)}`}>{projectStatusLabel(project.status)}</span>
        </div>
        {project.aiSummary && <p className="cp-text-muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>{project.aiSummary}</p>}
      </div>

      {/* Progress */}
      <div className="cp-card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.375rem' }}>
          <span className="cp-text-muted">Progress</span>
          <span className="cp-text" style={{ fontWeight: 600 }}>{project.progressPct}%</span>
        </div>
        <div style={{ width: '100%', height: 10, background: BRAND.border, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 5, transition: 'width 0.3s',
            width: `${project.progressPct}%`,
            background: project.progressPct >= 80 ? '#16a34a' : BRAND.primary
          }} />
        </div>
      </div>

      {/* Detail tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: `2px solid ${BRAND.border}` }}>
        {detailTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            style={{
              padding: '0.625rem 1rem',
              fontSize: '0.85rem',
              fontWeight: activeView === tab.id ? 600 : 400,
              color: activeView === tab.id ? BRAND.primary : BRAND.textMuted,
              borderBottom: activeView === tab.id ? `2px solid ${BRAND.accent}` : '2px solid transparent',
              marginBottom: '-2px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              transition: 'all 0.2s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Kanban view */}
      {activeView === 'kanban' && (
        <div className="cp-kanban">
          {kanbanColumns.map(col => (
            <div key={col.key} className="cp-kanban-col">
              <div className="cp-kanban-col-header">
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, display: 'inline-block' }} />
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{col.label}</span>
                <span className="cp-text-muted" style={{ fontSize: '0.75rem' }}>{col.tasks.length}</span>
              </div>
              <div className="cp-kanban-col-body">
                {col.tasks.length === 0 ? (
                  <p className="cp-text-muted" style={{ fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>No tasks</p>
                ) : (
                  col.tasks.map(task => (
                    <div key={task.id} className="cp-kanban-card">
                      <h4 className="cp-text" style={{ fontSize: '0.85rem', fontWeight: 500 }}>{task.title}</h4>
                      {task.description && <p className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{task.description}</p>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.25rem' }}>
                        <span className={`cp-badge ${priorityColor(task.priority)}`}>{priorityLabel(task.priority)}</span>
                        {task.assignee && <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>{task.assignee.name}</span>}
                        {task.dueDate && (
                          <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>
                            {fmtRelative(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chat view */}
      {activeView === 'chat' && (
        <div className="cp-chat-container">
          <div className="cp-chat-messages">
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <p className="cp-text-muted">No messages yet. Start the conversation!</p>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className="cp-chat-bubble">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: BRAND.text }}>
                      {msg.author?.name || 'Team'}
                    </span>
                    <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="cp-text" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{msg.content}</p>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={handleSendMessage} className="cp-chat-input-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: connected ? '#16a34a' : '#dc2626' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#16a34a' : '#dc2626', display: 'inline-block' }} />
              {connected ? 'Connected' : 'Reconnecting...'}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="cp-input"
                style={{ flex: 1 }}
              />
              <button type="submit" className="cp-btn-primary" style={{ padding: '0.5rem 1rem' }} disabled={!chatInput.trim()}>
                {Icons.send}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Documents view */}
      {activeView === 'documents' && (
        <div className="cp-space-y-4">
          {/* Upload area */}
          <div
            className="cp-upload-zone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BRAND.primary; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = BRAND.border; }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.style.borderColor = BRAND.border;
              if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files.length > 0) handleFileUpload(e.target.files); }}
            />
            {Icons.upload}
            <p className="cp-text" style={{ fontWeight: 600, marginTop: '0.5rem' }}>
              {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
            </p>
            <p className="cp-text-muted" style={{ fontSize: '0.8rem' }}>PDF, images, documents — up to 50MB</p>
          </div>

          {/* Document list */}
          {documents.length === 0 ? (
            <div className="cp-card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p className="cp-text-muted">No documents yet. Upload one above.</p>
            </div>
          ) : (
            <div className="cp-space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="cp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1.25rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="cp-text" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.originalName}</p>
                    <p className="cp-text-muted" style={{ fontSize: '0.75rem' }}>
                      {(doc.size / 1024).toFixed(1)} KB &middot; {fmtDate(doc.createdAt)} &middot; {doc.uploadedBy?.name || 'Unknown'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem' }}>
                    <a href={`${API}${doc.path}`} target="_blank" rel="noopener noreferrer" className="cp-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                      {Icons.download} Download
                    </a>
                    <button onClick={() => handleDeleteDoc(doc.id)} className="cp-btn-danger" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                      {Icons.trash}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Invoices Tab ──────────────────────────────────────────────────────────────
function InvoicesTab({ invoices, token }) {
  function downloadPdf(invoiceId) {
    window.open(`${API}/api/client-portal/invoices/${invoiceId}/pdf?token=${token}`, '_blank');
  }

  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Invoices</h2>
      {invoices.length === 0 ? (
        <div className="cp-card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p className="cp-text-muted">No invoices found.</p>
        </div>
      ) : (
        <div className="cp-space-y-3">
          {invoices.map(inv => {
            const isPaid = inv.status?.toUpperCase() === 'PAID';
            const canPay = !isPaid && ['SENT', 'OVERDUE', 'PENDING', 'DRAFT'].includes(inv.status?.toUpperCase());
            return (
              <div key={inv.id} className="cp-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'monospace', color: BRAND.primary, fontSize: '0.9rem', fontWeight: 600 }}>{inv.invoiceNumber}</span>
                        {statusBadge(inv.status)}
                      </div>
                      {(inv.title || inv.notes) && (
                        <p className="cp-text-muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.title || inv.notes}</p>
                      )}
                      <div className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                        {inv.issueDate && <span>Issued: {fmtDate(inv.issueDate)}</span>}
                        {inv.dueDate && !isPaid && <span>Due: {fmtDate(inv.dueDate)}</span>}
                        {inv.paidAt && <span>Paid: {fmtDate(inv.paidAt)}</span>}
                      </div>
                    </div>
                    <span className="cp-text" style={{ fontWeight: 700, fontSize: '1.25rem', marginLeft: '1rem' }}>{fmt(inv.total, inv.currency)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {canPay && inv.stripePaymentLink && (
                      <a href={inv.stripePaymentLink} target="_blank" rel="noopener noreferrer" className="cp-btn-primary" style={{ fontSize: '0.8rem' }}>
                        Pay Now
                      </a>
                    )}
                    <button onClick={() => downloadPdf(inv.id)} className="cp-btn-secondary" style={{ fontSize: '0.8rem' }}>
                      {Icons.download} Download PDF
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────
function DocumentsTab({ projects, token }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    fetch(`${API}/api/client-portal/projects/${selectedProjectId}/documents`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { setDocuments(Array.isArray(data) ? data : []); })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [selectedProjectId, token]);

  async function handleFileUpload(files) {
    if (!files || files.length === 0 || !selectedProjectId) return;
    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        await fetch(`${API}/api/client-portal/projects/${selectedProjectId}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
      }
      // Refresh
      const res = await fetch(`${API}/api/client-portal/projects/${selectedProjectId}/documents`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setUploading(false); }
  }

  async function handleDeleteDoc(docId) {
    try {
      await fetch(`${API}/api/client-portal/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setDocuments(prev => prev.filter(d => d.id !== docId));
    } catch { /* silent */ }
  }

  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Documents</h2>

      {/* Project selector */}
      {projects.length > 1 && (
        <select
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value)}
          className="cp-input"
          style={{ maxWidth: 300 }}
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {/* Upload area */}
      <div
        className="cp-upload-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BRAND.primary; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = BRAND.border; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = BRAND.border;
          if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files.length > 0) handleFileUpload(e.target.files); }}
        />
        {Icons.upload}
        <p className="cp-text" style={{ fontWeight: 600, marginTop: '0.5rem' }}>
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <p className="cp-text-muted" style={{ fontSize: '0.8rem' }}>PDF, images, documents — up to 50MB</p>
      </div>

      {/* Document list */}
      {loading ? (
        <div className="cp-loading">Loading documents...</div>
      ) : documents.length === 0 ? (
        <div className="cp-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p className="cp-text-muted">No documents yet. Upload one above.</p>
        </div>
      ) : (
        <div className="cp-space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="cp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1.25rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="cp-text" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.originalName}</p>
                <p className="cp-text-muted" style={{ fontSize: '0.75rem' }}>
                  {(doc.size / 1024).toFixed(1)} KB &middot; {fmtDate(doc.createdAt)} &middot; {doc.uploadedBy?.name || 'Unknown'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.75rem' }}>
                <a href={`${API}${doc.path}`} target="_blank" rel="noopener noreferrer" className="cp-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                  {Icons.download} Download
                </a>
                <button onClick={() => handleDeleteDoc(doc.id)} className="cp-btn-danger" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                  {Icons.trash}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat Tab (Global) ─────────────────────────────────────────────────────────
function ChatTab({ projects, token }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const { messages, connected, sendMessage } = useProjectChat(selectedProjectId, token);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const msg = input;
    setInput('');
    await sendMessage(msg);
  }

  return (
    <div className="cp-space-y-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="cp-page-title" style={{ marginBottom: 0 }}>Chat</h2>
        {projects.length > 1 && (
          <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} className="cp-input" style={{ maxWidth: 240 }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <div className="cp-chat-container">
        <div className="cp-chat-messages">
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}>
              <p className="cp-text-muted">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className="cp-chat-bubble">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: BRAND.text }}>{msg.author?.name || 'Team'}</span>
                  <span className="cp-text-muted" style={{ fontSize: '0.7rem' }}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="cp-text" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{msg.content}</p>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={handleSend} className="cp-chat-input-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: connected ? '#16a34a' : '#dc2626' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#16a34a' : '#dc2626', display: 'inline-block' }} />
            {connected ? 'Connected' : 'Reconnecting...'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a message..."
              className="cp-input"
              style={{ flex: 1 }}
            />
            <button type="submit" className="cp-btn-primary" style={{ padding: '0.5rem 1rem' }} disabled={!input.trim()}>
              {Icons.send}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Portal Dashboard (Main) ───────────────────────────────────────────────────
function PortalDashboard({ token }) {
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [retainer, setRetainer] = useState(null);
  const [unread, setUnread] = useState({ recentMessages: 0, upcomingDeadlines: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [meRes, invRes, projRes, retRes, unreadRes] = await Promise.all([
          fetch(`${API}/api/client-portal/me`, { headers }),
          fetch(`${API}/api/client-portal/invoices`, { headers }),
          fetch(`${API}/api/client-portal/projects`, { headers }),
          fetch(`${API}/api/client-portal/retainer`, { headers }),
          fetch(`${API}/api/client-portal/unread-count`, { headers }).catch(() => ({ json: () => ({ recentMessages: 0, upcomingDeadlines: 0 }) })),
        ]);
        if (meRes.status === 401) {
          setError('Your session has expired. Please request a new login link.');
          setLoading(false);
          return;
        }
        const [meData, invData, projData, retData, unreadData] = await Promise.all([
          meRes.json(), invRes.json(), projRes.json(), retRes.json(), unreadRes.json ? unreadRes.json() : unreadRes
        ]);
        setMe(meData);
        setInvoices(Array.isArray(invData) ? invData : []);
        setProjects(Array.isArray(projData) ? projData : []);
        setRetainer(retData || null);
        setUnread(unreadData || { recentMessages: 0, upcomingDeadlines: 0 });
      } catch {
        setError('Failed to load your portal. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  function handleLogout() {
    window.location.href = '/client-portal';
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: BRAND.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: BRAND.textMuted }}>Loading your portal...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: BRAND.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div className="cp-card" style={{ maxWidth: 380, textAlign: 'center' }}>
          <p className="cp-error" style={{ marginBottom: '1rem' }}>{error}</p>
          <a href="/client-portal" className="cp-link">Request a new link</a>
        </div>
      </div>
    );
  }

  const clientName = me?.client?.name || 'Client';
  const contactName = me?.contact?.name || '';

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Icons.overview },
    { id: 'projects', label: `Projects (${projects.length})`, icon: Icons.projects },
    { id: 'invoices', label: `Invoices (${invoices.length})`, icon: Icons.invoices },
    { id: 'documents', label: 'Documents', icon: Icons.documents },
    { id: 'chat', label: 'Chat', icon: Icons.chat },
  ];

  // If a project is selected, show project detail
  const showProjectDetail = activeTab === 'projects' && selectedProject;

  return (
    <div style={{ minHeight: '100vh', background: BRAND.bg, color: BRAND.text }}>
      {/* Header */}
      <header style={{
        background: BRAND.primary, padding: '1rem 1.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'sticky', top: 0, zIndex: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {Icons.logo}
            <span style={{ fontWeight: 700, color: BRAND.white, fontSize: '1.1rem' }}>Ashbi</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>|</span>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>{clientName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {contactName && <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>Hi, {contactName}</span>}
          <button onClick={handleLogout} className="cp-btn-ghost" style={{ color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)' }}>
            {Icons.logout} Logout
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <div style={{
        background: BRAND.white, borderBottom: `2px solid ${BRAND.border}`,
        padding: '0 1.5rem', position: 'sticky', top: 56, zIndex: 10
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: '0.25rem', overflowX: 'auto' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); if (tab.id !== 'projects') setSelectedProject(null); }}
              style={{
                padding: '0.75rem 1rem', fontSize: '0.85rem', fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? BRAND.primary : BRAND.textMuted,
                borderBottom: activeTab === tab.id ? `3px solid ${BRAND.accent}` : '3px solid transparent',
                marginBottom: '-2px', background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.375rem', transition: 'all 0.2s', whiteSpace: 'nowrap'
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {activeTab === 'overview' && (
          <OverviewTab
            projects={projects} invoices={invoices} retainer={retainer}
            unread={unread} setActiveTab={setActiveTab} setSelectedProject={setSelectedProject}
          />
        )}
        {activeTab === 'projects' && !selectedProject && (
          <ProjectsTab projects={projects} setSelectedProject={setSelectedProject} />
        )}
        {activeTab === 'projects' && selectedProject && (
          <ProjectDetail
            projectId={selectedProject} token={token}
            onBack={() => setSelectedProject(null)}
          />
        )}
        {activeTab === 'invoices' && <InvoicesTab invoices={invoices} token={token} />}
        {activeTab === 'documents' && <DocumentsTab projects={projects} token={token} />}
        {activeTab === 'chat' && <ChatTab projects={projects} token={token} />}
      </main>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '2rem 1rem', color: BRAND.textMuted, fontSize: '0.75rem' }}>
        &copy; {new Date().getFullYear()} Ashbi Design &mdash; ashbi.ca
      </footer>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ClientPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  if (!token) return <LoginScreen />;
  return <PortalDashboard token={token} />;
}

// ── Global Styles ─────────────────────────────────────────────────────────────
// Injected once at module level via a style tag rendered in LoginScreen
const globalStyles = `
  /* Ashbi Client Portal — Design System */
  .cp-text { color: ${BRAND.text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .cp-text-muted { color: ${BRAND.textMuted}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .cp-error { color: #dc2626; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .cp-link { color: ${BRAND.primary}; cursor: pointer; text-decoration: none; font-weight: 500; background: none; border: none; font-size: inherit; font-family: inherit; }
  .cp-link:hover { text-decoration: underline; }

  .cp-input {
    width: 100%; padding: 0.625rem 0.875rem; border: 1.5px solid ${BRAND.border}; border-radius: 10px;
    font-size: 0.875rem; color: ${BRAND.text}; background: ${BRAND.white}; outline: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    transition: border-color 0.2s;
  }
  .cp-input:focus { border-color: ${BRAND.primary}; }
  .cp-input::placeholder { color: ${BRAND.textMuted}; }

  .cp-btn-primary {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.5rem 1.25rem;
    background: ${BRAND.primary}; color: ${BRAND.white}; border: none; border-radius: 10px;
    font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
  .cp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .cp-btn-secondary {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.5rem 1rem;
    background: ${BRAND.white}; color: ${BRAND.primary}; border: 1.5px solid ${BRAND.border}; border-radius: 10px;
    font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: all 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    text-decoration: none;
  }
  .cp-btn-secondary:hover { border-color: ${BRAND.primary}; background: ${BRAND.bg}; }

  .cp-btn-danger {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.5rem 1rem;
    background: transparent; color: #dc2626; border: 1.5px solid #fecaca; border-radius: 10px;
    font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: all 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-btn-danger:hover { background: #fef2f2; }

  .cp-btn-ghost {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0.75rem;
    background: transparent; color: ${BRAND.textMuted}; border: 1.5px solid ${BRAND.border}; border-radius: 10px;
    font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: all 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-btn-ghost:hover { border-color: currentColor; }

  .cp-card {
    background: ${BRAND.white}; border: 1.5px solid ${BRAND.border}; border-radius: 20px;
    transition: all 0.2s;
  }
  .cp-card--interactive {
    cursor: pointer;
  }
  .cp-card--interactive:hover {
    border-color: ${BRAND.primary}; box-shadow: 0 4px 16px rgba(46,41,88,0.08);
    transform: translateY(-1px);
  }
  .cp-card-title { font-size: 1rem; font-weight: 600; color: ${BRAND.text}; margin: 0 0 0.5rem; }
  .cp-stat { padding: 1.25rem; }
  .cp-stat-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${BRAND.textMuted}; margin: 0 0 0.375rem; }
  .cp-stat-value { font-size: 1.75rem; font-weight: 700; color: ${BRAND.text}; margin: 0; }

  .cp-badge {
    display: inline-flex; align-items: center; padding: 0.125rem 0.5rem;
    border-radius: 6px; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap;
  }
  .cp-badge--green { background: #dcfce7; color: #16a34a; }
  .cp-badge--lime { background: #ecfccb; color: #65a30d; }
  .cp-badge--orange { background: #ffedd5; color: #c2410c; }
  .cp-badge--red { background: #fee2e2; color: #dc2626; }
  .cp-badge--blue { background: #dbeafe; color: #2563eb; }
  .cp-badge--purple { background: #ede9fe; color: #7c3aed; }
  .cp-badge--muted { background: #f1f0eb; color: ${BRAND.textMuted}; }

  .cp-alert {
    padding: 1rem 1.25rem; border-radius: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-alert--red { background: #fef2f2; border: 1.5px solid #fecaca; }

  .cp-page-title { font-size: 1.25rem; font-weight: 700; color: ${BRAND.text}; margin: 0 0 1rem; }
  .cp-section-title { font-size: 1rem; font-weight: 600; color: ${BRAND.text}; margin: 0 0 0.75rem; }

  .cp-grid-2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
  .cp-grid-3 { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }

  .cp-space-y-2 > * + * { margin-top: 0.5rem; }
  .cp-space-y-3 > * + * { margin-top: 0.75rem; }
  .cp-space-y-4 > * + * { margin-top: 1rem; }
  .cp-space-y-6 > * + * { margin-top: 1.5rem; }

  .cp-loading { display: flex; align-items: center; justify-content: center; min-height: 200px; color: ${BRAND.textMuted}; }
  .cp-error-box { max-width: 400px; margin: 2rem auto; text-align: center; }

  /* Kanban board */
  .cp-kanban { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
  .cp-kanban-col { background: ${BRAND.bg}; border-radius: 14px; padding: 0.75rem; }
  .cp-kanban-col-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; padding: 0 0.25rem; }
  .cp-kanban-col-body { display: flex; flex-direction: column; gap: 0.5rem; }
  .cp-kanban-card {
    background: ${BRAND.white}; border: 1.5px solid ${BRAND.border}; border-radius: 12px;
    padding: 0.75rem; transition: all 0.2s;
  }
  .cp-kanban-card:hover { box-shadow: 0 2px 8px rgba(46,41,88,0.06); }

  /* Chat */
  .cp-chat-container { display: flex; flex-direction: column; height: 500px; }
  .cp-chat-messages {
    flex: 1; overflow-y: auto; padding: 1rem; background: ${BRAND.bg}; border-radius: 14px 14px 0 0;
    border: 1.5px solid ${BRAND.border}; border-bottom: none;
  }
  .cp-chat-bubble {
    background: ${BRAND.white}; border-radius: 12px; padding: 0.75rem 1rem;
    margin-bottom: 0.5rem; border: 1px solid ${BRAND.border};
  }
  .cp-chat-input-bar {
    padding: 0.75rem 1rem; background: ${BRAND.white}; border-radius: 0 0 14px 14px;
    border: 1.5px solid ${BRAND.border}; border-top: 1px solid ${BRAND.border};
    display: flex; flex-direction: column; gap: 0.5rem;
  }

  /* Upload */
  .cp-upload-zone {
    border: 2px dashed ${BRAND.border}; border-radius: 16px; padding: 2rem;
    text-align: center; cursor: pointer; transition: all 0.2s; background: ${BRAND.white};
  }
  .cp-upload-zone:hover { border-color: ${BRAND.primary}; background: ${BRAND.bg}; }

  /* Responsive */
  @media (max-width: 640px) {
    .cp-grid-2 { grid-template-columns: 1fr; }
    .cp-grid-3 { grid-template-columns: 1fr 1fr; }
    .cp-kanban { grid-template-columns: 1fr; }
    .cp-chat-container { height: 400px; }
  }
`;

// Inject global styles once
if (typeof document !== 'undefined' && !document.getElementById('cp-styles')) {
  const style = document.createElement('style');
  style.id = 'cp-styles';
  style.textContent = globalStyles;
  document.head.appendChild(style);
}