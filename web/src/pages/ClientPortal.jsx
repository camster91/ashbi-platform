import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { preferredScrollBehavior } from '../lib/motion';
import './client-portal/portal.css';
import { API, portalFetch, downloadPortalInvoice, downloadPortalContract, BRAND, fmt, fmtDate, statusBadge, projectStatusLabel, projectStatusColor, Icons, useProjectChat, PortalChatComposer } from './client-portal/shared';
import SlowNotice, { SlowLoadingStatus, SLOW_WRITE_INLINE as slowWrite } from '../components/ui/SlowNotice';

// Heavy sections load on demand so the portal route chunk stays in budget.
// Their Suspense fallback is a named polite status with the slow-state copy.
const ProjectDetail = lazy(() => import('./client-portal/ProjectDetail'));
const DocumentsTab = lazy(() => import('./client-portal/DocumentsTab'));

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
            <SlowNotice active={loading} {...slowWrite} />
          </form>
        )}
      </div>
    </div>
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

function ContractsTab({ contracts, token }) {
  const [downloadError, setDownloadError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);

  async function downloadPdf(contract) {
    setDownloadError('');
    setDownloadingId(contract.id);
    try {
      await downloadPortalContract(token, contract);
    } catch {
      setDownloadError('The signed contract could not be downloaded. Refresh your session and try again.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="cp-space-y-4">
      <h2 className="cp-page-title">Contracts</h2>
      {downloadError && <p className="cp-error" role="alert">{downloadError}</p>}
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
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {contract.canReview ? (
                  <a className="cp-btn-primary" href={`/portal/contract/${contract.signToken}`}>Review and sign</a>
                ) : (
                  <span className={`cp-badge ${contract.status === 'SIGNED' ? 'cp-badge--green' : 'cp-badge--muted'}`}>{contract.status}</span>
                )}
                {contract.canDownload && (
                  <button
                    type="button"
                    aria-label={`Download signed contract PDF: ${contract.title}`}
                    onClick={() => downloadPdf(contract)}
                    disabled={downloadingId === contract.id}
                    aria-busy={downloadingId === contract.id || undefined}
                    className="cp-btn-secondary"
                    style={{ fontSize: '0.8rem' }}
                  >
                    {Icons.download} {downloadingId === contract.id ? 'Preparing…' : 'Download PDF'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
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
      <SlowLoadingStatus
        label="Loading your portal..."
        style={{ minHeight: '100vh', background: BRAND.bg, color: BRAND.textMuted, padding: '1rem' }}
      />
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
          <Suspense fallback={<SlowLoadingStatus label="Loading project..." className="cp-loading" />}>
            <ProjectDetail
              projectId={selectedProject} token={token}
              onBack={() => setSelectedProject(null)}
            />
          </Suspense>
        )}
        {activeTab === 'invoices' && <InvoicesTab invoices={invoices} token={token} />}
        {activeTab === 'contracts' && <ContractsTab contracts={contracts} token={token} />}
        {activeTab === 'documents' && (
          <Suspense fallback={<SlowLoadingStatus label="Loading documents..." className="cp-loading" />}>
            <DocumentsTab projects={projects} token={token} />
          </Suspense>
        )}
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

