import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { preferredScrollBehavior } from '../lib/motion';
import './client-portal/portal.css';
import { API, portalFetch, downloadPortalInvoice, downloadPortalContract, fmt, fmtDate, invoiceStatusBadge, StatusBadge, projectStatusLabel, projectStatusColor, Icons, useProjectChat, PortalChatComposer, PortalMessageAttachments, canSendPortalMessage, PortalProgress, usePortalLightTheme, portalFieldClass, portalFieldStyles, busyLabelButtonClass, pageTitleClass, sectionTitleClass, labelClass } from './client-portal/shared';
import { Alert, Button, Card, CardDescription, CardTitle, Input, LoadingState, StatCard } from '../components/ui';
import { buttonStyles } from '../components/ui/Button';
import SlowNotice, { SLOW_WRITE_INLINE as slowWrite } from '../components/ui/SlowNotice';
import { cn } from '../lib/utils';
import { formatInvoiceDate } from '../lib/format';
import { invoiceBalanceDue, isPartlyPaid, UNPAID_INVOICE_STATUSES } from '../lib/invoice-status';

// Heavy sections load on demand so the portal route chunk stays in budget.
// Their Suspense fallback is a named polite status with the slow-state copy.
const ProjectDetail = lazy(() => import('./client-portal/ProjectDetail'));
const DocumentsTab = lazy(() => import('./client-portal/DocumentsTab'));
// Media review is loaded only when the Reviews tab opens (it brings the review
// surface; its PDF viewer is a further lazy chunk plus a worker).
const ReviewsTab = lazy(() => import('./client-portal/ReviewsTab'));

// Interactive cards keep a full-strength boundary (#317): Card's default
// `border-border/60` is below 3:1 on the cream page.
const interactiveCardClass = 'block w-full border-border text-left';
// Non-interactive stat tiles: no hover lift or hover shadow.
const staticStatClass = 'hover:translate-y-0 hover:shadow-none';

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
    <div className="flex min-h-screen items-center justify-center bg-primary p-4">
      <Card padding="none" className="w-full max-w-[380px] px-8 py-10 text-center">
        <div className="mb-3 flex justify-center">{Icons.logo}</div>
        <h1 className="m-0 text-2xl font-bold text-foreground">Client Portal</h1>
        <CardDescription className="mt-1 font-medium">Sign in with your email</CardDescription>

        {sent ? (
          <div className="py-4">
            <div className="mb-2 text-[2rem]">&#9993;</div>
            <p className="font-semibold text-foreground">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              If we found an account for <strong>{email}</strong>, a login link is on its way.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">The link expires in 1 hour.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="mb-6 text-center text-sm text-muted-foreground">
              Enter your email to receive a secure login link.
            </p>
            <label htmlFor="client-portal-email" className={labelClass}>Email address</label>
            <Input
              id="client-portal-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'client-portal-login-error' : undefined}
              className={portalFieldClass}
            />
            {error && <p id="client-portal-login-error" role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className={cn('w-full', busyLabelButtonClass)} slowAfterMs={false}>
              {loading ? 'Sending...' : 'Send Login Link'}
            </Button>
            <SlowNotice active={loading} {...slowWrite} />
          </form>
        )}
      </Card>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ projects, invoices, retainer, unread, setActiveTab, setSelectedProject }) {
  const activeProjects = projects.filter(p => !['LAUNCHED', 'CANCELLED', 'ON_HOLD'].includes(p.status));
  const overdueInvoices = invoices.filter(i => i.status?.toUpperCase() === 'OVERDUE');
  // Outstanding is what is still owed (each open invoice's balance after
  // payments), summed per currency; different currencies are never added
  // together.
  const unpaidByCurrency = invoices
    .filter(i => UNPAID_INVOICE_STATUSES.includes(i.status?.toUpperCase()))
    .reduce((totals, i) => {
      const currency = (i.currency || 'CAD').toUpperCase();
      totals[currency] = Math.round(((totals[currency] || 0) + invoiceBalanceDue(i)) * 100) / 100;
      return totals;
    }, {});
  const unpaidEntries = Object.entries(unpaidByCurrency);
  const unpaidTotal = unpaidEntries.reduce((sum, [, amount]) => sum + amount, 0);
  const unpaidLabel = unpaidEntries.length === 0
    ? fmt(0)
    : unpaidEntries.map(([currency, amount]) => fmt(amount, currency)).join(' · ');

  const retainerTone = retainer
    ? retainer.percentUsed >= 100 ? 'bg-destructive' : retainer.percentUsed >= 80 ? 'bg-warning' : retainer.percentUsed >= 60 ? 'bg-accent' : 'bg-success'
    : '';

  return (
    <div className="space-y-6">
      {/* Urgent alerts: a static banner that is part of the page on load, so
          it is not a live region (live={false}). */}
      {overdueInvoices.length > 0 && (
        <Alert
          variant="error"
          live={false}
          title={`${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''}`}
          action={(
            <Button type="button" aria-label="View overdue invoices" variant="link" onClick={() => setActiveTab('invoices')}>
              View invoices &rarr;
            </Button>
          )}
        >
          Please review your invoices and make payment at your earliest convenience.
        </Alert>
      )}

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* The tiles are not interactive, so they drop StatCard's hover lift. */}
        <StatCard label="Active Projects" value={activeProjects.length} className={staticStatClass} />
        <StatCard label="Outstanding" value={unpaidLabel} variant={unpaidTotal > 0 ? 'warning' : 'success'} className={staticStatClass} />
        <StatCard label="Upcoming Deadlines" value={unread?.upcomingDeadlines ?? 0} variant={(unread?.upcomingDeadlines || 0) > 0 ? 'warning' : 'default'} className={staticStatClass} />
      </div>

      {/* Retainer (if exists) */}
      {retainer && (
        <Card padding="lg">
          <CardTitle className="mb-2 text-base font-semibold">Monthly Retainer</CardTitle>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Hours Included</p>
              <p className="font-semibold text-foreground">{retainer.hoursPerMonth}h</p>
            </div>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Hours Used</p>
              <p className={cn('font-semibold', retainer.percentUsed >= 90 ? 'text-destructive' : retainer.percentUsed >= 70 ? 'text-warning' : 'text-success')}>
                {retainer.hoursUsed}h
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground">Remaining</p>
              <p className="font-semibold text-foreground">{retainer.hoursRemaining >= 0 ? `${retainer.hoursRemaining}h` : `${Math.abs(retainer.hoursRemaining)}h over`}</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Monthly usage</span>
              <span className="font-semibold">{retainer.percentUsed}%</span>
            </div>
            <PortalProgress value={retainer.percentUsed} tone={retainerTone} />
          </div>
        </Card>
      )}

      {/* Active projects preview */}
      {activeProjects.length > 0 && (
        <div>
          <h3 className={sectionTitleClass}>Active Projects</h3>
          <div className="space-y-3">
            {activeProjects.slice(0, 4).map(p => (
              <Card as="button" type="button" isInteractive key={p.id} aria-label={`Open project ${p.name}`} onClick={() => { setSelectedProject(p.id); setActiveTab('projects'); }} className={interactiveCardClass}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{p.name}</span>
                  <StatusBadge color={projectStatusColor(p.status)}>{projectStatusLabel(p.status)}</StatusBadge>
                </div>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span className="font-semibold text-foreground">{p.progressPct}%</span>
                </div>
                <PortalProgress value={p.progressPct} tone={p.progressPct >= 80 ? 'bg-success' : 'bg-primary'} className="h-1.5" />
              </Card>
            ))}
            {activeProjects.length > 4 && (
              <Button type="button" aria-label="View all projects" variant="link" onClick={() => setActiveTab('projects')}>
                View all projects &rarr;
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Recent invoices */}
      {invoices.length > 0 && (
        <div>
          <h3 className={sectionTitleClass}>Recent Invoices</h3>
          <div className="space-y-2">
            {invoices.slice(0, 3).map(inv => (
              <Card key={inv.id} padding="none" className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-primary">{inv.invoiceNumber}</span>
                    {invoiceStatusBadge(inv)}
                  </div>
                  {inv.dueDate && inv.status !== 'PAID' && (
                    <p className="mt-1 text-xs text-muted-foreground">Due {formatInvoiceDate(inv.dueDate)}</p>
                  )}
                </div>
                <InvoiceAmount invoice={inv} className="text-lg" />
              </Card>
            ))}
            {invoices.length > 3 && (
              <Button type="button" aria-label="View all invoices" variant="link" onClick={() => setActiveTab('invoices')}>
                View all invoices &rarr;
              </Button>
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
    <div className="space-y-4">
      <h2 className={pageTitleClass}>Your Projects</h2>
      {projects.length === 0 ? (
        <Card padding="none" className="p-12 text-center">
          <p className="text-muted-foreground">No projects found.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map(p => (
            <Card as="button" type="button" isInteractive key={p.id} aria-label={`Open project ${p.name}`} onClick={() => setSelectedProject(p.id)} className={interactiveCardClass}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h3 className="mb-0.5 font-heading font-semibold text-foreground">{p.name}</h3>
                  <p className="text-xs text-muted-foreground">Updated {fmtDate(p.updatedAt)}</p>
                </div>
                <StatusBadge color={projectStatusColor(p.status)}>{projectStatusLabel(p.status)}</StatusBadge>
              </div>
              {p.totalTasks > 0 && (
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>{p.completedTasks} of {p.totalTasks} tasks</span>
                    <span className="font-semibold text-foreground">{p.progressPct}%</span>
                  </div>
                  <PortalProgress value={p.progressPct} tone={p.progressPct >= 80 ? 'bg-success' : p.progressPct >= 40 ? 'bg-primary' : 'bg-muted-foreground'} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// An invoice's amount: what is still owed on an open invoice (its balance
// after payments, with "Paid so far" once something is paid), the total on a
// paid one.
export function InvoiceAmount({ invoice, className }) {
  const isOpen = UNPAID_INVOICE_STATUSES.includes(invoice.status?.toUpperCase());
  if (!isOpen) {
    return <span className={cn('shrink-0 text-right font-bold text-foreground', className)}>{fmt(invoice.total, invoice.currency)}</span>;
  }
  const partlyPaid = isPartlyPaid(invoice);
  return (
    <div className="shrink-0 text-right">
      <span className={cn('block font-bold text-foreground', className)}>{fmt(invoiceBalanceDue(invoice), invoice.currency)}</span>
      {partlyPaid && (
        <>
          <span className="block text-xs text-muted-foreground">Balance due</span>
          <span className="block text-xs text-muted-foreground">
            Paid so far {fmt(invoice.amountPaid, invoice.currency)} of {fmt(invoice.total, invoice.currency)}
          </span>
        </>
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
    <div className="space-y-4">
      <h2 className={pageTitleClass}>Invoices</h2>
      {downloadError && <Alert variant="error">{downloadError}</Alert>}
      {invoices.length === 0 ? (
        <Card padding="none" className="p-12 text-center">
          <p className="text-muted-foreground">No invoices found.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => {
            const isPaid = inv.status?.toUpperCase() === 'PAID';
            // Pay opens the public invoice page, which starts a fresh Stripe
            // Checkout session; void and draft invoices are never payable.
            const canPay = !isPaid && UNPAID_INVOICE_STATUSES.includes(inv.status?.toUpperCase()) && Boolean(inv.payUrl);
            return (
              <Card key={inv.id} padding="none" className="p-5">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-primary">{inv.invoiceNumber}</span>
                        {invoiceStatusBadge(inv)}
                      </div>
                      {(inv.title || inv.notes) && (
                        <p className="mt-1 truncate text-sm text-muted-foreground">{inv.title || inv.notes}</p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {inv.issueDate && <span>Issued: {formatInvoiceDate(inv.issueDate)}</span>}
                        {inv.dueDate && !isPaid && <span>Due: {formatInvoiceDate(inv.dueDate)}</span>}
                        {inv.paidAt && <span>Paid: {fmtDate(inv.paidAt)}</span>}
                      </div>
                    </div>
                    <InvoiceAmount invoice={inv} className="text-xl" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canPay && (
                      <a href={inv.payUrl} className={buttonStyles({ size: 'sm' })}>
                        Pay Now
                      </a>
                    )}
                    <Button type="button" aria-label="Download invoice PDF" variant="outline" size="sm" leftIcon={Icons.download} onClick={() => downloadPdf(inv)}>
                      Download PDF
                    </Button>
                  </div>
                </div>
              </Card>
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
    <div className="space-y-4">
      <h2 className={pageTitleClass}>Contracts</h2>
      {downloadError && <Alert variant="error">{downloadError}</Alert>}
      {contracts.length === 0 ? (
        <Card padding="none" className="p-12 text-center">
          <p className="text-muted-foreground">No contracts are currently available.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {contracts.map(contract => (
            <Card as="article" key={contract.id} padding="none" className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <CardTitle className="mb-2 text-base font-semibold">{contract.title}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {contract.status === 'SIGNED' ? `Signed ${fmtDate(contract.signedAt)}` : 'Awaiting your signature'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {contract.canReview ? (
                  <a className={buttonStyles()} href={`/portal/contract/${contract.signToken}`}>Review and sign</a>
                ) : (
                  <StatusBadge color={contract.status === 'SIGNED' ? 'success' : 'default'}>{contract.status}</StatusBadge>
                )}
                {contract.canDownload && (
                  <Button
                    type="button"
                    aria-label={`Download signed contract PDF: ${contract.title}`}
                    onClick={() => downloadPdf(contract)}
                    disabled={downloadingId === contract.id}
                    aria-busy={downloadingId === contract.id || undefined}
                    variant="outline"
                    size="sm"
                    leftIcon={Icons.download}
                    className={busyLabelButtonClass}
                  >
                    {downloadingId === contract.id ? 'Preparing…' : 'Download PDF'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat Tab (Global) ─────────────────────────────────────────────────────────
function ChatTab({ projects, token }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || '');
  const { messages, connected, sendMessage, sendError, sending, messagesError, loadingMessages, reloadMessages, attachments } = useProjectChat(selectedProjectId, token);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!canSendPortalMessage(input, attachments)) return;
    try {
      await sendMessage(input);
      setInput('');
    } catch {
      // The composer preserves the entered text and the shared hook announces
      // the retry-safe error below.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn(pageTitleClass, 'mb-0')}>Chat</h2>
        {projects.length > 1 && (
          <select aria-label="Project for chat" value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} className={portalFieldStyles('max-w-[240px]')}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <div className="cp-chat-container">
        <div className="cp-chat-messages">
          {messagesError && <Alert variant="error" className="mb-2" action={<Button type="button" variant="link" onClick={reloadMessages}>Try again</Button>}>Chat messages could not be loaded. Try again.</Alert>}
          {loadingMessages && messages.length === 0 ? (
            <p role="status" className="text-muted-foreground">Loading messages…</p>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map(msg => (
              <Card key={msg.id} padding="none" className="mb-2 rounded-xl px-4 py-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{msg.author?.name || 'Team'}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm leading-normal text-foreground">{msg.content}</p>
                <PortalMessageAttachments attachments={msg.attachments} />
              </Card>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        <PortalChatComposer value={input} onChange={e => setInput(e.target.value)} onSubmit={handleSend} connected={connected} sending={sending} sendError={sendError} attachments={attachments} />
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
    return <LoadingState label="Loading your portal..." className="min-h-screen bg-background p-4" />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-[380px] text-center">
          <p className="mb-4 text-destructive">{error}</p>
          <a href="/client-portal" className={buttonStyles({ variant: 'link' })}>Request a new link</a>
        </Card>
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
    { id: 'reviews', label: 'Reviews', icon: Icons.overview },
    { id: 'chat', label: 'Chat', icon: Icons.chat },
  ];

  // The agency's name from GET /api/client-portal/me (its brand settings).
  const brandName = typeof me?.brand?.companyName === 'string' ? me.brand.companyName.trim() : '';

  // If a project is selected, show project detail
  const showProjectDetail = activeTab === 'projects' && selectedProject;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="cp-header sticky top-0 z-20 flex items-center justify-between bg-primary px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {Icons.logo}
            {brandName && <span className="text-lg font-bold text-primary-foreground">{brandName}</span>}
          </div>
          <span className="text-xs text-primary-foreground/30">|</span>
          <span className="text-sm text-primary-foreground/70">{clientName}</span>
        </div>
        <div className="flex items-center gap-4">
          {contactName && <span className="text-sm text-primary-foreground/50">Hi, {contactName}</span>}
          <Button type="button" aria-label="Log out of client portal" onClick={handleLogout} variant="ghost" size="sm" leftIcon={Icons.logout} className="border border-primary-foreground/20 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground">
            Logout
          </Button>
        </div>
      </header>

      {/* Tab navigation */}
      <div className="sticky top-14 z-10 border-b-2 border-border bg-card px-6">
        <div role="tablist" aria-label="Portal sections" className="mx-auto flex max-w-[960px] gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className="cp-tab"
              onClick={() => { setActiveTab(tab.id); if (tab.id !== 'projects') setSelectedProject(null); }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-[960px] px-6 py-8">
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
          <Suspense fallback={<LoadingState label="Loading project..." />}>
            <ProjectDetail
              projectId={selectedProject} token={token}
              onBack={() => setSelectedProject(null)}
            />
          </Suspense>
        )}
        {activeTab === 'invoices' && <InvoicesTab invoices={invoices} token={token} />}
        {activeTab === 'contracts' && <ContractsTab contracts={contracts} token={token} />}
        {activeTab === 'documents' && (
          <Suspense fallback={<LoadingState label="Loading documents..." />}>
            <DocumentsTab projects={projects} token={token} />
          </Suspense>
        )}
        {activeTab === 'reviews' && (
          <Suspense fallback={<LoadingState label="Loading reviews..." />}>
            <ReviewsTab token={token} />
          </Suspense>
        )}
        {activeTab === 'chat' && <ChatTab projects={projects} token={token} />}
      </main>

      {/* Footer */}
      <footer className="px-4 py-8 text-center text-xs text-muted-foreground">
        {brandName && <>&copy; {new Date().getFullYear()} {brandName}</>}
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
  usePortalLightTheme();

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

  // `.cp-root` scopes the portal focus contract (portal.css).
  let content;
  if (sessionState === 'checking') {
    content = <div className="flex min-h-screen items-center justify-center bg-primary p-4" role="status" aria-live="polite"><p className="text-primary-foreground">Verifying your secure session…</p></div>;
  } else if (sessionState === 'error') {
    content = (
      <div className="flex min-h-screen items-center justify-center bg-primary p-4">
        <Card padding="none" className="w-full max-w-[380px] px-8 py-10 text-center">
          <p className="text-destructive" role="alert">{sessionError}</p>
          <a href="/client-portal" className={buttonStyles({ variant: 'link' })}>Request a new login link</a>
        </Card>
      </div>
    );
  } else if (sessionState === 'anonymous') {
    content = <LoginScreen />;
  } else {
    content = <PortalDashboard token={null} />;
  }
  return <div className="cp-root">{content}</div>;
}

