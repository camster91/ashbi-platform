import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { preferredScrollBehavior } from '../lib/motion';
import './client-portal/portal.css';
import { API, portalFetch, downloadPortalInvoice, downloadPortalContract, fmt, fmtDate, invoiceStatusBadge, StatusBadge, projectStatusLabel, projectStatusColor, Icons, useProjectChat, PortalChatComposer, PortalMessageAttachments, canSendPortalMessage, PortalProgress, usePortalLightTheme, portalFieldClass, portalFieldStyles, busyLabelButtonClass, pageTitleClass, sectionTitleClass, labelClass } from './client-portal/shared';
import { Alert, Badge, Button, Card, CardDescription, CardTitle, Input, LoadingState, StatCard } from '../components/ui';
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
export function LoginScreen({ onSignedIn = () => window.location.assign('/client-portal') }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (passwordMode) {
        const res = await fetch(`${API}/api/auth/client/login`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) throw new Error('Invalid email or password. Please try again.');
        onSignedIn();
        return;
      }
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
      if (passwordMode) { setError(fetchErr.message || 'Sign-in failed. Please try again.'); return; }
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
              {passwordMode ? 'Use the password you created when accepting your invitation.' : 'Enter your email to receive a secure login link.'}
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
            {passwordMode && <>
              <label htmlFor="client-portal-password" className={labelClass}>Password</label>
              <Input id="client-portal-password" type="password" autoComplete="current-password" required
                value={password} onChange={event => setPassword(event.target.value)} className={portalFieldClass} />
            </>}
            {error && <p id="client-portal-login-error" role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className={cn('w-full', busyLabelButtonClass)} slowAfterMs={false}>
              {loading ? (passwordMode ? 'Signing in…' : 'Sending...') : (passwordMode ? 'Sign In' : 'Send Login Link')}
            </Button>
            <Button type="button" variant="link" disabled={loading}
              onClick={() => { setPasswordMode(!passwordMode); setPassword(''); setError(''); }}>
              {passwordMode ? 'Use an email login link' : 'Sign in with a password'}
            </Button>
            <SlowNotice active={loading} {...slowWrite} />
          </form>
        )}
      </Card>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
// The delivery stages a client project moves through, in order. Projects in
// another status (Active, On hold, …) show their status badge instead.
const PROJECT_STAGES = ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED'];

// Pay opens the public invoice page, which starts a fresh Stripe Checkout
// session; void and draft invoices are never payable.
function canPayInvoice(inv) {
  const isPaid = inv.status?.toUpperCase() === 'PAID';
  return !isPaid && UNPAID_INVOICE_STATUSES.includes(inv.status?.toUpperCase()) && Boolean(inv.payUrl);
}

function firstNameOf(name) {
  return (typeof name === 'string' ? name.trim().split(/\s+/)[0] : '') || '';
}

function initialsOf(name) {
  const parts = (typeof name === 'string' ? name.trim() : '').split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';
}

function todayLabel(now = new Date()) {
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// GET a client-portal list for the Overview. Every list is the client's own,
// from the session-scoped portal API. Each section loads on its own, so one
// failed request never blanks the page.
async function portalList(path, token, pick = data => data) {
  const response = await portalFetch(path, token);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const data = pick(await response.json());
  return Array.isArray(data) ? data : [];
}

const LOADING_LIST = { status: 'loading', items: [] };

// Settles a list request into section state; the returned cleanup ignores a
// response that arrives after the section unmounted or its inputs changed.
function settleList(promise, setState) {
  let cancelled = false;
  promise.then(
    items => { if (!cancelled) setState({ status: 'ready', items }); },
    () => { if (!cancelled) setState({ status: 'error', items: [] }); },
  );
  return () => { cancelled = true; };
}

function ProjectStages({ status, needsReview }) {
  const current = PROJECT_STAGES.indexOf(status);
  if (current < 0) return null;
  return (
    <ol aria-label="Project stages" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {PROJECT_STAGES.map((stage, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'next';
        const note = state === 'done' ? 'Done' : state === 'next' ? 'Up next' : needsReview ? 'Needs your OK' : 'In progress';
        return (
          <li key={stage} aria-current={state === 'current' ? 'step' : undefined} className="flex min-w-0 flex-col gap-1.5">
            <span aria-hidden="true" className={cn('h-1.5 rounded-full', state === 'next' ? 'bg-muted' : 'bg-primary')} />
            <span className="text-sm font-semibold text-foreground">{projectStatusLabel(stage)}</span>
            <span className={cn('text-xs', state === 'current' && needsReview ? 'font-semibold text-warning' : 'text-muted-foreground')}>{note}</span>
          </li>
        );
      })}
    </ol>
  );
}

function WaitingOnYou({ reviews, contracts, invoices, onOpenReview, setActiveTab }) {
  // Reviews still open on their newest version, contracts to sign, then what
  // is still owed (overdue first).
  const openReviews = reviews.filter(review => review.status === 'open' && !review.nextSessionId);
  const toSign = contracts.filter(contract => contract.canReview && contract.signToken);
  const owed = invoices
    .filter(inv => UNPAID_INVOICE_STATUSES.includes(inv.status?.toUpperCase()))
    .sort((a, b) => Number(b.status?.toUpperCase() === 'OVERDUE') - Number(a.status?.toUpperCase() === 'OVERDUE'));

  const items = [
    ...openReviews.map(review => ({
      key: `review-${review.id}`,
      title: `Review ${review.title}`,
      detail: [review.projectName, `${review.openAnnotationCount || 0} open comment${review.openAnnotationCount === 1 ? '' : 's'}`, 'comment right on the file'].filter(Boolean).join(' · '),
      action: (
        <Button type="button" onClick={() => onOpenReview(review.id)}>
          Review{' '}<span className="sr-only">{review.title}</span>
        </Button>
      ),
    })),
    ...toSign.map(contract => ({
      key: `contract-${contract.id}`,
      title: `Sign ${contract.title}`,
      detail: 'Awaiting your signature',
      action: (
        <a className={buttonStyles({ variant: 'outline' })} href={`/portal/contract/${contract.signToken}`}>
          Review and sign{' '}<span className="sr-only">{contract.title}</span>
        </a>
      ),
    })),
    ...owed.map(inv => {
      const overdue = inv.status?.toUpperCase() === 'OVERDUE';
      return {
        key: `invoice-${inv.id}`,
        title: `Pay invoice ${inv.invoiceNumber}`,
        detail: (
          <>
            <span className="figure">{fmt(invoiceBalanceDue(inv), inv.currency)}</span>
            {inv.dueDate && <> · {overdue ? 'overdue, was due' : 'due'} {formatInvoiceDate(inv.dueDate)}</>}
            {isPartlyPaid(inv) && <> · balance after {fmt(inv.amountPaid, inv.currency)} paid</>}
          </>
        ),
        action: canPayInvoice(inv) ? (
          <a href={inv.payUrl} className={buttonStyles({ variant: 'outline' })}>
            View and pay{' '}<span className="sr-only">invoice {inv.invoiceNumber}</span>
          </a>
        ) : (
          <Button type="button" variant="outline" onClick={() => setActiveTab('invoices')}>
            View invoice{' '}<span className="sr-only">{inv.invoiceNumber}</span>
          </Button>
        ),
      };
    }),
  ];

  return (
    <Card as="section" aria-labelledby="portal-waiting-heading" padding="lg" className="border-2 border-foreground">
      <div className="flex items-center gap-2">
        <h2 id="portal-waiting-heading" className="text-lg font-semibold tracking-tight text-foreground">Waiting on you</h2>
        {items.length > 0 && (
          <Badge variant="subtle" color="accent" className="figure">
            {items.length}<span className="sr-only"> {items.length === 1 ? 'item' : 'items'}</span>
          </Badge>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing needs you right now. Anything to approve, sign or pay shows up here.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border/40">
          {items.map(item => (
            <li key={item.key} className="flex flex-wrap items-center gap-3 py-4 last:pb-0">
              <div className="min-w-0 flex-[1_1_16rem]">
                <p className="break-words font-semibold text-foreground">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
              </div>
              {item.action}
            </li>
          ))}
        </ul>
      )}
      {invoices.length > 0 && (
        <Button type="button" aria-label="View all invoices" variant="link" onClick={() => setActiveTab('invoices')} className="mt-2">
          View all invoices &rarr;
        </Button>
      )}
    </Card>
  );
}

function RetainerCard({ retainer }) {
  const over = retainer.hoursRemaining < 0;
  const month = new Date().toLocaleDateString(undefined, { month: 'long' });
  return (
    <section aria-labelledby="portal-retainer-heading" className="rounded-2xl bg-primary p-5 text-primary-foreground">
      <p className="text-eyebrow text-primary-foreground/80">Retainer · {month}</p>
      <h2 id="portal-retainer-heading" className="mt-1.5 text-lg font-semibold tracking-tight">
        {over
          ? <><span className="font-display italic font-normal text-accent">{Math.abs(retainer.hoursRemaining)}h</span> over this month&rsquo;s hours</>
          : <><span className="font-display italic font-normal text-accent">{retainer.hoursRemaining}h</span> left this month</>}
      </h2>
      <ul className="mt-3 space-y-1 text-sm text-primary-foreground/80">
        <li><span className="figure">{retainer.hoursUsed}h</span> of <span className="figure">{retainer.hoursPerMonth}h</span> used</li>
        <li><span className="figure">{retainer.percentUsed}%</span> of your monthly hours</li>
      </ul>
      <PortalProgress value={retainer.percentUsed} tone="bg-accent" className="mt-3 bg-primary-foreground/25" />
    </section>
  );
}

function RecentFiles({ files, setActiveTab }) {
  return (
    <Card as="section" aria-labelledby="portal-files-heading" padding="lg">
      <h2 id="portal-files-heading" className="text-lg font-semibold tracking-tight text-foreground">Recent files</h2>
      {files.status === 'loading' && <p role="status" className="mt-2 text-sm text-muted-foreground">Loading files…</p>}
      {files.status === 'error' && <p className="mt-2 text-sm text-muted-foreground">Recent files could not be loaded. Open Files to see them all.</p>}
      {files.status === 'ready' && files.items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No files shared yet.</p>}
      {files.items.length > 0 && (
        <ul className="mt-2">
          {files.items.map(doc => (
            <li key={doc.id} className="flex items-baseline justify-between gap-3 border-t border-border/40 py-2.5 first:border-t-0">
              <span className="min-w-0 truncate text-sm text-foreground" title={doc.originalName}>{doc.originalName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(doc.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="link" onClick={() => setActiveTab('documents')}>
        All files &rarr;
      </Button>
    </Card>
  );
}

function RecentMessages({ project, messages, teamName, onOpenChat }) {
  return (
    <Card as="section" aria-labelledby="portal-messages-heading" padding="lg">
      <h2 id="portal-messages-heading" className="text-lg font-semibold tracking-tight text-foreground">
        Messages with {teamName || 'your team'}
      </h2>
      <p className="text-sm text-muted-foreground">{project.name}</p>
      {messages.status === 'loading' && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading messages…</p>}
      {messages.status === 'error' && <p className="mt-3 text-sm text-muted-foreground">Recent messages could not be loaded. Open Messages to see the conversation.</p>}
      {messages.status === 'ready' && messages.items.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No messages yet. Ask a question or share feedback any time.</p>}
      {messages.items.length > 0 && (
        <ul className="mt-3 space-y-3">
          {messages.items.map(msg => (
            <li key={msg.id} className="flex gap-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                {initialsOf(msg.author?.name)}
              </span>
              <div className="min-w-0 max-w-[38rem] rounded-lg bg-muted px-3.5 py-2.5">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {msg.content || (msg.attachments?.length ? 'Shared a file' : '')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {msg.author?.name || 'Team'} · {fmtDate(msg.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" className="mt-4" onClick={() => onOpenChat(project.id)}>
        Write a message
      </Button>
    </Card>
  );
}

function OverviewTab({ token, contactName, teamName, projects, invoices, contracts, retainer, unread, setActiveTab, setSelectedProject, onOpenReview, onOpenChat }) {
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

  // The project in focus is the most recently updated active one (the API
  // sorts by update); recent files come from the three latest projects.
  const featured = activeProjects[0] || null;
  const otherProjects = activeProjects.slice(1, 4);

  const [reviews, setReviews] = useState(LOADING_LIST);
  const [files, setFiles] = useState(LOADING_LIST);
  const [messages, setMessages] = useState(LOADING_LIST);
  const fileKey = projects.slice(0, 3).map(p => p.id).join(',');
  const featuredId = featured?.id || '';
  useEffect(() => settleList(portalList('/api/client-portal/reviews', token, data => data?.sessions), setReviews), [token]);
  useEffect(() => settleList(
    Promise.all(fileKey.split(',').filter(Boolean).map(id => portalList(`/api/client-portal/projects/${id}/documents`, token)))
      .then(lists => lists.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3)),
    setFiles,
  ), [fileKey, token]);
  useEffect(() => settleList(
    featuredId ? portalList(`/api/client-portal/projects/${featuredId}/messages?limit=2`, token) : Promise.resolve([]),
    setMessages,
  ), [featuredId, token]);

  const featuredNeedsReview = Boolean(featured) && reviews.items.some(review => review.projectId === featured.id && review.status === 'open' && !review.nextSessionId);
  const firstName = firstNameOf(contactName);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-eyebrow text-muted-foreground">{todayLabel()}</p>
        <h1 className="mt-1.5 font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Hi <span className="font-display italic font-normal text-primary">{firstName || 'there'}</span>, here&rsquo;s where things stand
        </h1>
      </div>

      {/* Urgent alerts: a static banner that is part of the page on load, so
          it is not a live region (live={false}). */}
      {overdueInvoices.length > 0 && (
        <Alert
          variant="error"
          live={false}
          title={`${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''}`}
          action={(
            <Button type="button" variant="link" onClick={() => setActiveTab('invoices')}>
              View invoices &rarr;{' '}<span className="sr-only">that are overdue</span>
            </Button>
          )}
        >
          Please review your invoices and make payment at your earliest convenience.
        </Alert>
      )}

      <WaitingOnYou
        reviews={reviews.items} contracts={contracts} invoices={invoices}
        onOpenReview={onOpenReview} setActiveTab={setActiveTab}
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_30rem] flex-col gap-4">
          <Card as="section" aria-labelledby="portal-project-heading" padding="lg">
            {featured ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-eyebrow text-muted-foreground">Current project</p>
                    <h2 id="portal-project-heading" className="mt-1 break-words text-lg font-semibold tracking-tight text-foreground">{featured.name}</h2>
                  </div>
                  {featured.endDate && (
                    <span className="text-sm text-muted-foreground">Launch planned for <strong className="font-semibold text-foreground">{fmtDate(featured.endDate)}</strong></span>
                  )}
                </div>
                {PROJECT_STAGES.includes(featured.status) ? (
                  <ProjectStages status={featured.status} needsReview={featuredNeedsReview} />
                ) : (
                  <div className="mt-3"><StatusBadge color={projectStatusColor(featured.status)}>{projectStatusLabel(featured.status)}</StatusBadge></div>
                )}
                {featured.totalTasks > 0 && (
                  <div className="mt-5">
                    <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>{featured.completedTasks} of {featured.totalTasks} tasks done</span>
                      <span className="figure font-semibold text-foreground">{featured.progressPct}%</span>
                    </div>
                    <PortalProgress value={featured.progressPct} tone={featured.progressPct >= 80 ? 'bg-success' : 'bg-primary'} className="h-1.5" />
                  </div>
                )}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-background px-4 py-3">
                  <p className="text-sm text-muted-foreground">Updated {fmtDate(featured.updatedAt)}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setSelectedProject(featured.id); setActiveTab('projects'); }}>
                    Open project{' '}<span className="sr-only">{featured.name}</span>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 id="portal-project-heading" className="text-lg font-semibold tracking-tight text-foreground">Your projects</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {projects.length > 0 ? 'No project is in progress right now.' : 'Your projects will show here once they start.'}
                </p>
                {projects.length > 0 && (
                  <Button type="button" variant="link" onClick={() => setActiveTab('projects')}>All projects &rarr;</Button>
                )}
              </>
            )}
          </Card>

          {otherProjects.length > 0 && (
            <div>
              <h2 className={sectionTitleClass}>Also in progress</h2>
              <div className="space-y-3">
                {otherProjects.map(p => (
                  <Card as="button" type="button" isInteractive key={p.id} onClick={() => { setSelectedProject(p.id); setActiveTab('projects'); }} className={interactiveCardClass}>
                    <span className="sr-only">Open project</span>{' '}
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
        </div>

        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4">
          {retainer && <RetainerCard retainer={retainer} />}
          <RecentFiles files={files} setActiveTab={setActiveTab} />
        </div>
      </div>

      {/* At a glance. The tiles are not interactive, so they drop StatCard's hover lift. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active projects" value={activeProjects.length} className={staticStatClass} />
        <StatCard label="Outstanding" value={unpaidLabel} variant={unpaidTotal > 0 ? 'warning' : 'success'} className={staticStatClass} />
        <StatCard label="Upcoming deadlines" value={unread?.upcomingDeadlines ?? 0} variant={(unread?.upcomingDeadlines || 0) > 0 ? 'warning' : 'default'} className={staticStatClass} />
      </div>

      {featured && <RecentMessages project={featured} messages={messages} teamName={teamName} onOpenChat={onOpenChat} />}
    </div>
  );
}

// ── Projects Tab ──────────────────────────────────────────────────────────────
function ProjectsTab({ projects, setSelectedProject }) {
  return (
    <div className="space-y-4">
      <h2 className={pageTitleClass}>Your projects</h2>
      {projects.length === 0 ? (
        <Card padding="none" className="p-12 text-center">
          <p className="text-muted-foreground">No projects found.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map(p => (
            <Card as="button" type="button" isInteractive key={p.id} onClick={() => setSelectedProject(p.id)} className={interactiveCardClass}>
              <span className="sr-only">Open project</span>{' '}
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
            const canPay = canPayInvoice(inv);
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
                    <Button type="button" variant="outline" size="sm" leftIcon={Icons.download} onClick={() => downloadPdf(inv)}>
                      Download PDF{' '}<span className="sr-only">for this invoice</span>
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
                    onClick={() => downloadPdf(contract)}
                    disabled={downloadingId === contract.id}
                    aria-busy={downloadingId === contract.id || undefined}
                    variant="outline"
                    size="sm"
                    leftIcon={Icons.download}
                    className={busyLabelButtonClass}
                  >
                    {downloadingId === contract.id ? 'Preparing…' : 'Download PDF'}{' '}<span className="sr-only">for signed contract {contract.title}</span>
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

// ── Messages Tab (Global) ─────────────────────────────────────────────────────────
function ChatTab({ projects, token, initialProjectId }) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || projects[0]?.id || '');
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
        <h2 className={cn(pageTitleClass, 'mb-0')}>Messages</h2>
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
  // Set when the Overview opens a review or a project's messages directly.
  const [reviewToOpen, setReviewToOpen] = useState(null);
  const [chatProjectId, setChatProjectId] = useState(null);

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

  // Mockup order: Overview, Projects, Files, Invoices, Messages, with Reviews
  // and Contracts beside the work they belong to. Counts stay in the names.
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'projects', label: `Projects (${projects.length})` },
    { id: 'reviews', label: 'Reviews' },
    { id: 'documents', label: 'Files' },
    { id: 'invoices', label: `Invoices (${invoices.length})` },
    { id: 'contracts', label: `Contracts (${contracts.length})` },
    { id: 'chat', label: 'Messages' },
  ];

  function openTab(id) {
    setActiveTab(id);
    if (id !== 'projects') setSelectedProject(null);
    setReviewToOpen(null);
    setChatProjectId(null);
  }

  // The agency's name from GET /api/client-portal/me (its brand settings).
  const brandName = typeof me?.brand?.companyName === 'string' ? me.brand.companyName.trim() : '';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Ink header band: the brand row (.cp-header) and, below it, the
          section tabs. Sticky from the sm breakpoint; on phones the wrapped
          tabs would cover too much of the screen. */}
      <div className="z-20 bg-foreground text-background sm:sticky sm:top-0">
        <header className="cp-header mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3 sm:px-6">
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-2 gap-y-1 sm:basis-auto">
            {Icons.logo}
            {brandName && <span className="min-w-0 break-words text-lg font-bold tracking-tight">{brandName}</span>}
            {brandName && <span className="text-sm text-secondary">for</span>}
            <span className="min-w-0 break-words text-sm text-secondary">{clientName}</span>
          </div>
          <div className="flex max-w-full items-center gap-3">
            {contactName && (
              <span role="img" aria-label={`Signed in as ${contactName}`} title={contactName} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                <span aria-hidden="true">{initialsOf(contactName)}</span>
              </span>
            )}
            <Button type="button" onClick={handleLogout} variant="ghost" size="sm" leftIcon={Icons.logout} className="shrink-0 border border-background/40 text-background hover:bg-background/10 hover:text-background">
              Logout{' '}<span className="sr-only">of client portal</span>
            </Button>
          </div>
        </header>

        {/* Tab navigation */}
        <div data-portal-nav="" className="border-t border-background/15">
          <div role="tablist" aria-label="Portal sections" className="mx-auto flex max-w-[1120px] flex-wrap gap-1 px-4 py-2 sm:px-6">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className="cp-tab"
                onClick={() => openTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6">
        {activeTab === 'overview' && (
          <OverviewTab
            token={token} contactName={contactName} teamName={brandName}
            projects={projects} invoices={invoices} contracts={contracts} retainer={retainer}
            unread={unread} setActiveTab={openTab} setSelectedProject={setSelectedProject}
            onOpenReview={(id) => { openTab('reviews'); setReviewToOpen(id); }}
            onOpenChat={(id) => { openTab('chat'); setChatProjectId(id); }}
          />
        )}
        {activeTab === 'projects' && !selectedProject && (
          <ProjectsTab projects={projects} setSelectedProject={setSelectedProject} />
        )}
        {activeTab === 'projects' && selectedProject && (
          <Suspense fallback={<LoadingState label="Loading project..." />}>
            <ProjectDetail
              projectId={selectedProject} token={token} handoffIdentity={me?.handoffIdentity}
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
            <ReviewsTab token={token} initialOpenId={reviewToOpen} />
          </Suspense>
        )}
        {activeTab === 'chat' && <ChatTab projects={projects} token={token} initialProjectId={chatProjectId} />}
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

