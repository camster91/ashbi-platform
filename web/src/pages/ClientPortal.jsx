import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { preferredScrollBehavior } from '../lib/motion';
import ConfirmDialog from '../components/ConfirmDialog';

const API = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '';
const SOCKET_URL = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';

function portalFetch(pathname, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${API}${pathname}`, { ...options, headers, credentials: 'include' });
}

async function downloadPortalDocument(token, doc) {
  const response = await portalFetch(`/api/client-portal/documents/${doc.id}/download`, token);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = doc.originalName || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

async function downloadPortalInvoice(token, invoice) {
  const response = await portalFetch(`/api/client-portal/invoices/${invoice.id}/pdf`, token);
  if (!response.ok) throw new Error(`Invoice download failed (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `invoice-${invoice.invoiceNumber || invoice.id}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

async function deletePortalDocument(token, documentId) {
  const response = await portalFetch(`/api/client-portal/documents/${documentId}`, token, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`Delete failed (${response.status}) — the file remains available.`);
}

// ── Ashbi Design Brand ────────────────────────────────────────────────────────
export const BRAND = {
  primary: '#2e2958',
  accent: '#e6f354',
  bg: '#faf9f2',
  white: '#ffffff',
  text: '#2e2958',
  textMuted: '#6b667f',
  danger: '#b91c1c',
  border: '#918c9f',
  cardBg: '#ffffff',
  hoverBg: '#f5f3ea',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(amount, currency) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency || 'USD' }).format(amount || 0);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
      // SECURITY/UX: distinguish three failure modes so users get an
      // actionable message and devs get a console breadcrumb:
      //   - non-OK HTTP status (server returned an error JSON)
      //   - non-JSON body (proxy/CDN HTML error page → misleading SyntaxError)
      //   - JSON without `sent` (server returned an unexpected shape)
      // Previously all three fell into the same catch block with no
      // console.error, so a 502 from a misconfigured CDN looked identical
      // to "the user typed a wrong email" — silent failure.
      let data;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error('[client-portal] non-JSON response', { status: res.status, contentType });
        setError(`Server error (${res.status}) — please try again or contact support.`);
        return;
      }
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error('[client-portal] JSON parse failed', { status: res.status, err: parseErr });
        setError(`Server returned an unexpected response — please try again.`);
        return;
      }
      if (data?.sent) {
        setSent(true);
      } else if (data?.error) {
        setError(data.error);
      } else {
        console.error('[client-portal] unexpected response shape', data);
        setError('Something went wrong — please try again.');
      }
    } catch (fetchErr) {
      console.error('[client-portal] network error', fetchErr);
      setError('Network error — please check your connection and try again.');
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
            <label htmlFor="client-portal-email" className="cp-label">Email address</label>
            <input
              id="client-portal-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'client-portal-login-error' : undefined}
              className="cp-input"
            />
            {error && <p id="client-portal-login-error" role="alert" className="cp-error">{error}</p>}
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
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const socketRef = useRef(null);
  const sendInFlightRef = useRef(false);

  const reloadMessages = useCallback(async () => {
    if (!projectId) return;
    setLoadingMessages(true);
    setMessagesError('');
    try {
      const response = await portalFetch(`/api/client-portal/projects/${projectId}/messages`, token);
      if (!response.ok) throw new Error(`Chat messages could not be loaded (${response.status}).`);
      const data = await response.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessagesError(error?.message || 'Chat messages could not be loaded. Try again.');
    } finally {
      setLoadingMessages(false);
    }
  }, [projectId, token]);

  useEffect(() => {
    if (!projectId) return;
    setMessages([]);
    setMessagesError('');

    const socket = io(SOCKET_URL, {
      auth: token ? { token } : {},
      withCredentials: true,
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

    void reloadMessages();

    return () => {
      socket.emit('leave-project', projectId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [projectId, token]);

  const sendMessage = useCallback(async (content) => {
    if (!content.trim()) return;
    if (sendInFlightRef.current) {
      throw new Error('A message is already sending. Wait for it to finish before retrying.');
    }
    sendInFlightRef.current = true;
    setSending(true);
    setSendError('');
    try {
      const res = await portalFetch(`/api/client-portal/projects/${projectId}/messages`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Message could not be sent (${res.status}).`);
      }
      const msg = await res.json();
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      return msg;
    } catch (error) {
      setSendError(error?.message || 'Message could not be sent. Your text is still in the composer.');
      throw error;
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }, [projectId, reloadMessages, token]);

  return { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages };
}

function PortalChatComposer({ value, onChange, onSubmit, connected, sending, sendError }) {
  return (
    <form onSubmit={onSubmit} className="cp-chat-input-bar">
      <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: connected ? '#15803d' : '#b91c1c' }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#15803d' : '#b91c1c', display: 'inline-block' }} />
        {connected ? 'Connected' : 'Reconnecting...'}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input type="text" value={value} onChange={onChange} placeholder="Type a message..." aria-label="Message to project team" className="cp-input" style={{ flex: 1 }} />
        <button type="submit" className="cp-btn-primary" style={{ padding: '0.5rem 1rem' }} disabled={!value.trim() || sending} aria-busy={sending || undefined} aria-label="Send message">
          {sending ? 'Sending…' : Icons.send}
        </button>
      </div>
      {sendError && <p role="alert" className="cp-error" style={{ fontSize: '0.8rem' }}>{sendError} Your text is still in the composer.</p>}
    </form>
  );
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
          <button type="button" aria-label="View overdue invoices" onClick={() => setActiveTab('invoices')} className="cp-link" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
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
          <p className="cp-stat-value" style={{ color: unpaidTotal > 0 ? '#b45309' : '#15803d' }}>
            {fmt(unpaidTotal, 'USD')}
          </p>
        </div>
        <div className="cp-card cp-stat">
          <p className="cp-stat-label">Upcoming Deadlines</p>
          <p className="cp-stat-value" style={{ color: (unread?.upcomingDeadlines || 0) > 0 ? '#b45309' : BRAND.primary }}>
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
              <p className="cp-text" style={{ fontWeight: 600, color: retainer.percentUsed >= 90 ? '#b91c1c' : retainer.percentUsed >= 70 ? '#b45309' : '#15803d' }}>
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
                background: retainer.percentUsed >= 100 ? '#b91c1c' : retainer.percentUsed >= 80 ? '#b45309' : retainer.percentUsed >= 60 ? BRAND.accent : '#15803d'
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
              <button type="button" key={p.id} aria-label={`Open project ${p.name}`} className="cp-card cp-card--interactive" onClick={() => { setSelectedProject(p.id); setActiveTab('projects'); }} style={{ width: '100%', textAlign: 'left' }}>
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
                    background: p.progressPct >= 80 ? '#15803d' : BRAND.primary
                  }} />
                </div>
              </button>
            ))}
            {activeProjects.length > 4 && (
              <button type="button" aria-label="View all projects" onClick={() => setActiveTab('projects')} className="cp-link" style={{ fontSize: '0.85rem' }}>
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
              <button type="button" aria-label="View all invoices" onClick={() => setActiveTab('invoices')} className="cp-link" style={{ fontSize: '0.85rem' }}>
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
            <button type="button" key={p.id} aria-label={`Open project ${p.name}`} className="cp-card cp-card--interactive" onClick={() => setSelectedProject(p.id)} style={{ width: '100%', textAlign: 'left' }}>
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
                      background: p.progressPct >= 80 ? '#15803d' : p.progressPct >= 40 ? BRAND.primary : BRAND.textMuted
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
  const [uploadError, setUploadError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [revisionFeedback, setRevisionFeedback] = useState({});
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [submittingWorkflow, setSubmittingWorkflow] = useState(false);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages } = useProjectChat(projectId, token);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [projRes, tasksRes, docsRes] = await Promise.all([
          portalFetch(`/api/client-portal/projects/${projectId}`, token),
          portalFetch(`/api/client-portal/projects/${projectId}/tasks`, token),
          portalFetch(`/api/client-portal/projects/${projectId}/documents`, token),
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
    chatEndRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() });
  }, [messages]);

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    try {
      await sendMessage(chatInput);
      setChatInput('');
    } catch {
      // The composer preserves the entered text and the shared hook announces
      // the retry-safe error below.
    }
  }

  async function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const failed = [];
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await portalFetch(`/api/client-portal/projects/${projectId}/upload`, token, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) {
          failed.push({ name: file.name, status: res.status });
        }
      }
      // Refresh documents list regardless — partial success is still a refresh
      const res = await portalFetch(`/api/client-portal/projects/${projectId}/documents`, token);
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
      if (failed.length > 0) {
        setUploadError(`${failed.length} file(s) failed to upload — ${failed.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      setUploadError(err?.message ?? 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc() {
    if (!documentToDelete || deletingDocument) return;
    setDeletingDocument(true);
    setDeleteError('');
    try {
      await deletePortalDocument(token, documentToDelete.id);
      setDocuments(prev => prev.filter(d => d.id !== documentToDelete.id));
      setDocumentToDelete(null);
    } catch (err) {
      setDeleteError(err?.message ?? 'Delete failed — the file remains available.');
    } finally {
      setDeletingDocument(false);
    }
  }

  async function handleDownloadDoc(doc) {
    try {
      await downloadPortalDocument(token, doc);
    } catch (err) {
      setUploadError(err?.message ?? 'Download failed — please try again');
    }
  }

  async function handleRevisionResponse(revision, action) {
    const feedback = revisionFeedback[revision.id]?.trim() || '';
    if (action === 'REQUEST_CHANGES' && !feedback) {
      setWorkflowError('Describe the changes you need before submitting.');
      return;
    }
    setSubmittingWorkflow(true);
    setWorkflowError('');
    setWorkflowStatus('');
    try {
      const response = await portalFetch(`/api/client-portal/projects/${projectId}/revisions/${revision.id}/respond`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback: feedback || undefined }),
      });
      if (!response.ok) throw new Error(`Response failed (${response.status})`);
      const updated = await response.json();
      setProject(current => ({
        ...current,
        revisionRounds: current.revisionRounds.map(item => item.id === updated.id ? { ...item, ...updated } : item),
      }));
      setWorkflowStatus(action === 'APPROVE' ? `Revision round ${revision.roundNumber} approved.` : `Change request sent for revision round ${revision.roundNumber}.`);
      setRevisionFeedback(current => ({ ...current, [revision.id]: '' }));
    } catch (err) {
      setWorkflowError(err?.message || 'The revision response could not be saved.');
    } finally {
      setSubmittingWorkflow(false);
    }
  }

  async function handleGeneralFeedback(event) {
    event.preventDefault();
    if (!generalFeedback.trim()) return;
    setSubmittingWorkflow(true);
    setWorkflowError('');
    setWorkflowStatus('');
    try {
      const response = await portalFetch(`/api/client-portal/projects/${projectId}/feedback`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: generalFeedback.trim() }),
      });
      if (!response.ok) throw new Error(`Feedback failed (${response.status})`);
      setGeneralFeedback('');
      setWorkflowStatus('Your feedback was sent to the project team.');
    } catch (err) {
      setWorkflowError(err?.message || 'Your feedback could not be saved.');
    } finally {
      setSubmittingWorkflow(false);
    }
  }

  if (loading) {
    return <div className="cp-loading">Loading project...</div>;
  }
  if (error || !project) {
    return (
      <div className="cp-error-box">
        <p className="cp-error">{error || 'Project not found'}</p>
        <button type="button" aria-label="Back to projects" onClick={onBack} className="cp-link">Go back</button>
      </div>
    );
  }

  const kanbanColumns = [
    { key: 'TODO', label: 'To Do', tasks: tasks.TODO, color: '#b45309' },
    { key: 'IN_PROGRESS', label: 'In Progress', tasks: tasks.IN_PROGRESS, color: '#4d7c0f' },
    { key: 'DONE', label: 'Done', tasks: tasks.DONE, color: '#15803d' },
    { key: 'BLOCKED', label: 'Blocked', tasks: tasks.BLOCKED || [], color: '#b91c1c' },
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
        <button type="button" aria-label="Back to projects" onClick={onBack} className="cp-link" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
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
            background: project.progressPct >= 80 ? '#15803d' : BRAND.primary
          }} />
        </div>
      </div>

      {project.milestones?.length > 0 && (
        <section className="cp-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="portal-milestones-title">
          <h3 id="portal-milestones-title" className="cp-section-title">Milestones</h3>
          <div className="cp-space-y-2">
            {project.milestones.map(milestone => (
              <div key={milestone.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <p className="cp-text" style={{ fontWeight: 600 }}>{milestone.name}</p>
                  {milestone.description && <p className="cp-text-muted" style={{ fontSize: '0.8rem' }}>{milestone.description}</p>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`cp-badge ${milestone.status === 'COMPLETED' ? 'cp-badge--green' : 'cp-badge--blue'}`}>{milestone.status.replaceAll('_', ' ')}</span>
                  <p className="cp-text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Due {fmtDate(milestone.dueDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {project.revisionRounds?.length > 0 && (
        <section className="cp-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="portal-revisions-title">
          <h3 id="portal-revisions-title" className="cp-section-title">Revision approvals</h3>
          <div className="cp-space-y-3">
            {project.revisionRounds.map(revision => (
              <div key={revision.id} style={{ borderTop: `1px solid ${BRAND.border}`, paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <p className="cp-text" style={{ fontWeight: 600 }}>Round {revision.roundNumber}</p>
                  <span className={`cp-badge ${revision.status === 'APPROVED' ? 'cp-badge--green' : 'cp-badge--orange'}`}>{revision.status.replaceAll('_', ' ')}</span>
                </div>
                {revision.notes && <p className="cp-text-muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>{revision.notes}</p>}
                {revision.status !== 'APPROVED' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label htmlFor={`revision-feedback-${revision.id}`} className="cp-label">Feedback for round {revision.roundNumber}</label>
                    <textarea id={`revision-feedback-${revision.id}`} className="cp-input" rows={3} value={revisionFeedback[revision.id] || ''} onChange={event => setRevisionFeedback(current => ({ ...current, [revision.id]: event.target.value }))} placeholder="Describe requested changes, or approve when everything looks right." />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" className="cp-btn-primary" disabled={submittingWorkflow} aria-busy={submittingWorkflow || undefined} onClick={() => handleRevisionResponse(revision, 'APPROVE')}>Approve round</button>
                      <button type="button" className="cp-btn-secondary" disabled={submittingWorkflow} aria-busy={submittingWorkflow || undefined} onClick={() => handleRevisionResponse(revision, 'REQUEST_CHANGES')}>Request changes</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="cp-card" style={{ padding: '1rem 1.25rem' }} aria-labelledby="portal-feedback-title">
        <h3 id="portal-feedback-title" className="cp-section-title">Project feedback</h3>
        <form onSubmit={handleGeneralFeedback}>
          <label htmlFor="portal-project-feedback" className="cp-label">Message to the project team</label>
          <textarea id="portal-project-feedback" className="cp-input" rows={3} value={generalFeedback} onChange={event => setGeneralFeedback(event.target.value)} required />
          <button type="submit" className="cp-btn-primary" style={{ marginTop: '0.5rem' }} disabled={submittingWorkflow || !generalFeedback.trim()} aria-busy={submittingWorkflow || undefined}>Send feedback</button>
        </form>
      </section>

      {workflowStatus && <p role="status" aria-live="polite" className="cp-alert" style={{ background: '#f0fdf4', color: '#166534' }}>{workflowStatus}</p>}
      {workflowError && <p role="alert" className="cp-alert cp-alert--red cp-error">{workflowError}</p>}

      {/* Detail tabs */}
      <div role="tablist" aria-label="Project detail sections" style={{ display: 'flex', gap: '0.25rem', borderBottom: `2px solid ${BRAND.border}` }}>
        {detailTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeView === tab.id}
            className="cp-tab"
            onClick={() => setActiveView(tab.id)}
            style={{
              padding: '0.625rem 1rem',
              fontSize: '0.85rem',
              fontWeight: activeView === tab.id ? 600 : 400,
              color: activeView === tab.id ? BRAND.primary : BRAND.textMuted,
              borderBottom: activeView === tab.id ? `2px solid ${BRAND.accent}` : '2px solid transparent',
              borderTop: 0,
              borderRight: 0,
              borderLeft: 0,
              marginBottom: '-2px',
              background: 'none',
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
            {messagesError && <div role="alert" className="cp-alert cp-alert--red"><p>Chat messages could not be loaded. Try again.</p><button type="button" className="cp-link" onClick={reloadMessages}>Try again</button></div>}
            {loadingMessages && messages.length === 0 ? (
              <p role="status" className="cp-text-muted">Loading messages…</p>
            ) : messages.length === 0 ? (
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
          <PortalChatComposer value={chatInput} onChange={e => setChatInput(e.target.value)} onSubmit={handleSendMessage} connected={connected} sending={sending} sendError={sendError} />
        </div>
      )}

      {/* Documents view */}
      {activeView === 'documents' && (
        <div className="cp-space-y-4">
          {/* Upload area */}
          <input
            type="file"
            ref={fileInputRef}
            multiple
            className="cp-visually-hidden"
            aria-label="Choose project documents to upload"
            onChange={e => { if (e.target.files.length > 0) handleFileUpload(e.target.files); }}
          />
          <button
            type="button"
            className="cp-upload-zone"
            aria-describedby="project-upload-help"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BRAND.primary; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = BRAND.border; }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.style.borderColor = BRAND.border;
              if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
            }}
          >
            {Icons.upload}
            <p className="cp-text" style={{ fontWeight: 600, marginTop: '0.5rem' }}>
              {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
            </p>
            <p id="project-upload-help" className="cp-text-muted" style={{ fontSize: '0.8rem' }}>PDF, images, documents — up to 50MB</p>
          </button>

          {/* Upload error — surfaced so the user sees what failed instead of a ghost-success */}
          {uploadError && (
            <div
              role="alert"
              className="cp-card"
              style={{
                padding: '0.75rem 1rem',
                borderLeft: `4px solid ${BRAND.danger}`,
                background: '#fef2f2',
                color: BRAND.danger,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <span style={{ fontSize: '0.875rem' }}>{uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: BRAND.danger,
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                  lineHeight: 1,
                  padding: '0 0.25rem',
                }}
                aria-label="Dismiss upload error"
              >
                ×
              </button>
            </div>
          )}

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
                    <button type="button" onClick={() => handleDownloadDoc(doc)} className="cp-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                      {Icons.download} Download
                    </button>
                    <button type="button" onClick={() => { setDeleteError(''); setDocumentToDelete(doc); }} disabled={deletingDocument} className="cp-btn-danger" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', minWidth: 44, minHeight: 44 }} aria-label={`Delete ${doc.originalName}`}>
                      {Icons.trash}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(documentToDelete)}
        title="Delete document?"
        description={documentToDelete ? `Permanently delete “${documentToDelete.originalName}”? This removes the file from the client portal and cannot be undone.` : ''}
        confirmLabel="Permanently delete"
        onConfirm={handleDeleteDoc}
        onCancel={() => { setDeleteError(''); setDocumentToDelete(null); }}
        pending={deletingDocument}
        error={deleteError}
      />
    </div>
  );
}

// ── Invoices Tab ──────────────────────────────────────────────────────────────
function InvoicesTab({ invoices, token }) {
  const [downloadError, setDownloadError] = useState('');

  async function downloadPdf(invoice) {
    setDownloadError('');
    try {
      await downloadPortalInvoice(token, invoice);
    } catch {
      setDownloadError('The invoice could not be downloaded. Refresh your session and try again.');
    }
  }

  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Invoices</h2>
      {downloadError && <p className="cp-error" role="alert">{downloadError}</p>}
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
                    <button type="button" aria-label="Download invoice PDF" onClick={() => downloadPdf(inv)} className="cp-btn-secondary" style={{ fontSize: '0.8rem' }}>
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

function ContractsTab({ contracts }) {
  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Contracts</h2>
      {contracts.length === 0 ? (
        <div className="cp-card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p className="cp-text-muted">No contracts are currently available.</p>
        </div>
      ) : (
        <div className="cp-space-y-3">
          {contracts.map(contract => (
            <article key={contract.id} className="cp-card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h3 className="cp-card-title">{contract.title}</h3>
                <p className="cp-text-muted" style={{ fontSize: '0.8rem' }}>
                  {contract.status === 'SIGNED' ? `Signed ${fmtDate(contract.signedAt)}` : 'Awaiting your signature'}
                </p>
              </div>
              {contract.canReview ? (
                <a className="cp-btn-primary" href={`/portal/contract/${contract.signToken}`}>Review and sign</a>
              ) : (
                <span className={`cp-badge ${contract.status === 'SIGNED' ? 'cp-badge--green' : 'cp-badge--muted'}`}>{contract.status}</span>
              )}
            </article>
          ))}
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
  const [uploadError, setUploadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    portalFetch(`/api/client-portal/projects/${selectedProjectId}/documents`, token)
      .then(r => r.json())
      .then(data => { setDocuments(Array.isArray(data) ? data : []); })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [selectedProjectId, token]);

  async function handleFileUpload(files) {
    if (!files || files.length === 0 || !selectedProjectId) return;
    setUploading(true);
    setUploadError(null);
    const failed = [];
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await portalFetch(`/api/client-portal/projects/${selectedProjectId}/upload`, token, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) {
          failed.push({ name: file.name, status: res.status });
        }
      }
      const res = await portalFetch(`/api/client-portal/projects/${selectedProjectId}/documents`, token);
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
      if (failed.length > 0) {
        setUploadError(`${failed.length} file(s) failed to upload — ${failed.map(f => f.name).join(', ')}`);
      }
    } catch (err) {
      setUploadError(err?.message ?? 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc() {
    if (!documentToDelete || deletingDocument) return;
    setDeletingDocument(true);
    setDeleteError('');
    try {
      await deletePortalDocument(token, documentToDelete.id);
      setDocuments(prev => prev.filter(d => d.id !== documentToDelete.id));
      setDocumentToDelete(null);
    } catch (err) {
      setDeleteError(err?.message ?? 'Delete failed — the file remains available.');
    } finally {
      setDeletingDocument(false);
    }
  }

  async function handleDownloadDoc(doc) {
    try {
      await downloadPortalDocument(token, doc);
    } catch (err) {
      setUploadError(err?.message ?? 'Download failed — please try again');
    }
  }

  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Documents</h2>

      {/* Project selector */}
      {projects.length > 1 && (
        <select
          aria-label="Project for documents"
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
      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="cp-visually-hidden"
        aria-label="Choose documents to upload"
        onChange={e => { if (e.target.files.length > 0) handleFileUpload(e.target.files); }}
      />
      <button
        type="button"
        className="cp-upload-zone"
        aria-describedby="documents-upload-help"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || !selectedProjectId}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = BRAND.primary; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = BRAND.border; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = BRAND.border;
          if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files);
        }}
      >
        {Icons.upload}
        <p className="cp-text" style={{ fontWeight: 600, marginTop: '0.5rem' }}>
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <p id="documents-upload-help" className="cp-text-muted" style={{ fontSize: '0.8rem' }}>PDF, images, documents — up to 50MB</p>
      </button>

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
                <button type="button" onClick={() => handleDownloadDoc(doc)} className="cp-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}>
                  {Icons.download} Download
                </button>
                <button type="button" onClick={() => { setDeleteError(''); setDocumentToDelete(doc); }} disabled={deletingDocument} className="cp-btn-danger" style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', minWidth: 44, minHeight: 44 }} aria-label={`Delete ${doc.originalName}`}>
                  {Icons.trash}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(documentToDelete)}
        title="Delete document?"
        description={documentToDelete ? `Permanently delete “${documentToDelete.originalName}”? This removes the file from the client portal and cannot be undone.` : ''}
        confirmLabel="Permanently delete"
        onConfirm={handleDeleteDoc}
        onCancel={() => { setDeleteError(''); setDocumentToDelete(null); }}
        pending={deletingDocument}
        error={deleteError}
      />
    </div>
  );
}

// ── Chat Tab (Global) ─────────────────────────────────────────────────────────
function ChatTab({ projects, token }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages } = useProjectChat(selectedProjectId, token);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim()) return;
    try {
      await sendMessage(input);
      setInput('');
    } catch {
      // The composer preserves the entered text and the shared hook announces
      // the retry-safe error below.
    }
  }

  return (
    <div className="cp-space-y-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="cp-page-title" style={{ marginBottom: 0 }}>Chat</h2>
        {projects.length > 1 && (
          <select aria-label="Project for chat" value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} className="cp-input" style={{ maxWidth: 240 }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <div className="cp-chat-container">
        <div className="cp-chat-messages">
          {messagesError && <div role="alert" className="cp-alert cp-alert--red"><p>Chat messages could not be loaded. Try again.</p><button type="button" className="cp-link" onClick={reloadMessages}>Try again</button></div>}
          {loadingMessages && messages.length === 0 ? (
            <p role="status" className="cp-text-muted">Loading messages…</p>
          ) : messages.length === 0 ? (
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
        <PortalChatComposer value={input} onChange={e => setInput(e.target.value)} onSubmit={handleSend} connected={connected} sending={sending} sendError={sendError} />
      </div>
    </div>
  );
}

// ── Portal Dashboard (Main) ───────────────────────────────────────────────────
function PortalDashboard({ token }) {
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [contracts, setContracts] = useState([]);
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
        const [meRes, invRes, contractRes, projRes, retRes, unreadRes] = await Promise.all([
          portalFetch('/api/client-portal/me', token),
          portalFetch('/api/client-portal/invoices', token),
          portalFetch('/api/client-portal/contracts', token),
          portalFetch('/api/client-portal/projects', token),
          portalFetch('/api/client-portal/retainer', token),
          portalFetch('/api/client-portal/unread-count', token).catch(() => ({ json: () => ({ recentMessages: 0, upcomingDeadlines: 0 }) })),
        ]);
        if (meRes.status === 401) {
          setError('Your session has expired. Please request a new login link.');
          setLoading(false);
          return;
        }
        const [meData, invData, contractData, projData, retData, unreadData] = await Promise.all([
          meRes.json(), invRes.json(), contractRes.json(), projRes.json(), retRes.json(), unreadRes.json ? unreadRes.json() : unreadRes
        ]);
        setMe(meData);
        setInvoices(Array.isArray(invData) ? invData : []);
        setContracts(Array.isArray(contractData) ? contractData : []);
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

  async function handleLogout() {
    try {
      await portalFetch('/api/client-portal/logout', token, { method: 'POST' });
    } finally {
      window.location.assign('/client-portal');
    }
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
    { id: 'contracts', label: `Contracts (${contracts.length})`, icon: Icons.documents },
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
          <button type="button" aria-label="Log out of client portal" onClick={handleLogout} className="cp-btn-ghost" style={{ color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.2)' }}>
            {Icons.logout} Logout
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <div style={{
        background: BRAND.white, borderBottom: `2px solid ${BRAND.border}`,
        padding: '0 1.5rem', position: 'sticky', top: 56, zIndex: 10
      }}>
        <div role="tablist" aria-label="Portal sections" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: '0.25rem', overflowX: 'auto' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className="cp-tab"
              onClick={() => { setActiveTab(tab.id); if (tab.id !== 'projects') setSelectedProject(null); }}
              style={{
                padding: '0.75rem 1rem', fontSize: '0.85rem', fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? BRAND.primary : BRAND.textMuted,
                borderBottom: activeTab === tab.id ? `3px solid ${BRAND.accent}` : '3px solid transparent',
                borderTop: 0, borderRight: 0, borderLeft: 0,
                marginBottom: '-2px', background: 'none', cursor: 'pointer',
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
        {activeTab === 'contracts' && <ContractsTab contracts={contracts} />}
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
  const magicToken = searchParams.get('token');
  const [sessionState, setSessionState] = useState('checking');
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function establishSession() {
      try {
        const response = magicToken
          ? await portalFetch('/api/client-portal/verify-token', null, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: magicToken }),
            })
          : await portalFetch('/api/client-portal/me', null);
        if (cancelled) return;
        if (response.ok) {
          window.history.replaceState({}, '', '/client-portal');
          setSessionState('active');
          return;
        }
        if (magicToken) {
          setSessionError('This login link is invalid, expired, or has been revoked. Request a new link.');
          setSessionState('error');
        } else {
          setSessionState('anonymous');
        }
      } catch {
        if (!cancelled) {
          setSessionError('We could not verify your session. Check your connection and try again.');
          setSessionState('error');
        }
      }
    }
    establishSession();
    return () => { cancelled = true; };
  }, [magicToken]);

  if (sessionState === 'checking') {
    return <div className="cp-login-bg" role="status" aria-live="polite"><p style={{ color: BRAND.white }}>Verifying your secure session…</p></div>;
  }
  if (sessionState === 'error') {
    return (
      <div className="cp-login-bg">
        <div className="cp-login-card">
          <p className="cp-error" role="alert">{sessionError}</p>
          <a href="/client-portal" className="cp-link">Request a new login link</a>
        </div>
      </div>
    );
  }
  if (sessionState === 'anonymous') return <LoginScreen />;
  return <PortalDashboard token={null} />;
}

// ── Global Styles ─────────────────────────────────────────────────────────────
// Injected once at module level via a style tag rendered in LoginScreen
const globalStyles = `
  /* Ashbi Client Portal — Design System */
  .cp-text { color: ${BRAND.text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .cp-text-muted { color: ${BRAND.textMuted}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .cp-error { color: #b91c1c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
   .cp-link { color: ${BRAND.primary}; cursor: pointer; text-decoration: none; font-weight: 500; background: none; border: none; font-size: inherit; font-family: inherit; min-height: 44px; padding: 0.5rem 0; }
  .cp-link:hover { text-decoration: underline; }
   .cp-link:focus-visible, .cp-input:focus-visible, .cp-btn-primary:focus-visible, .cp-btn-secondary:focus-visible,
   .cp-btn-danger:focus-visible, .cp-btn-ghost:focus-visible, .cp-card--interactive:focus-visible {
     outline: 3px solid ${BRAND.primary}; outline-offset: 2px;
   }
   .cp-tab:focus-visible { outline: 3px solid ${BRAND.primary}; outline-offset: -3px; }

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
    background: ${BRAND.primary}; color: ${BRAND.white}; opacity: 1 !important; border: none; border-radius: 10px;
     font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: transform 0.2s; min-height: 44px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-btn-primary:hover { background: #211d40; transform: translateY(-1px); }
  .cp-btn-primary:disabled { opacity: 1; cursor: not-allowed; transform: none; }

  .cp-btn-secondary {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.5rem 1rem;
    background: ${BRAND.white}; color: ${BRAND.primary}; border: 1.5px solid ${BRAND.border}; border-radius: 10px;
     font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: all 0.2s; min-height: 44px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    text-decoration: none;
  }
  .cp-btn-secondary:hover { border-color: ${BRAND.primary}; background: ${BRAND.bg}; }

  .cp-btn-danger {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.5rem 1rem;
    background: transparent; color: #b91c1c; border: 1.5px solid #b91c1c; border-radius: 10px;
     font-size: 0.85rem; font-weight: 500; cursor: pointer; transition: all 0.2s; min-height: 44px; min-width: 44px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-btn-danger:hover { background: #fef2f2; }

  .cp-btn-ghost {
    display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.375rem 0.75rem;
    background: transparent; color: ${BRAND.textMuted}; border: 1.5px solid ${BRAND.border}; border-radius: 10px;
     font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: all 0.2s; min-height: 44px; min-width: 44px;
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
  .cp-badge--green { background: #dcfce7; color: #166534; }
  .cp-badge--lime { background: #ecfccb; color: #4d7c0f; }
  .cp-badge--orange { background: #ffedd5; color: #9a3412; }
  .cp-badge--red { background: #fee2e2; color: #b91c1c; }
  .cp-badge--blue { background: #dbeafe; color: #1d4ed8; }
  .cp-badge--purple { background: #ede9fe; color: #6d28d9; }
  .cp-badge--muted { background: #f1f0eb; color: ${BRAND.textMuted}; }

  .cp-alert {
    padding: 1rem 1.25rem; border-radius: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cp-alert--red { background: #fef2f2; border: 1.5px solid #b91c1c; }

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
  .cp-kanban { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; overflow-x: auto; -webkit-overflow-scrolling: touch; }
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
    display: block; width: 100%; color: inherit; font: inherit;
    text-align: center; cursor: pointer; transition: all 0.2s; background: ${BRAND.white};
  }
  .cp-upload-zone:hover { border-color: ${BRAND.primary}; background: ${BRAND.bg}; }
  .cp-upload-zone:disabled { cursor: wait; opacity: 0.7; }
  .cp-visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }

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
