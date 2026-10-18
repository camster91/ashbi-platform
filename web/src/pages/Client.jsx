import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, Mail, Plus, StickyNote } from 'lucide-react';
import { api } from '../lib/api';
import LoadingState from '../components/ui/LoadingState';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../hooks/useAuth';
import { formatRelativeTime, getHealthColor, getProjectStatusColor, getProjectStatusLabel, cn } from '../lib/utils';
import { formatDate, formatMoney } from '../lib/format';
import { Button, Card, StatusBadge, Tabs, TabList, Tab, TabPanel } from '../components/ui';
import { invoiceBalanceDue, invoiceDisplayStatus } from '../lib/invoice-status';
import ClientAccountManager from '../components/ClientAccountManager';
import ClientCommunications from '../components/ClientCommunications';
import ClientServicePanels from '../components/ClientServicePanels';
import ClientActivityFeed from '../components/client/ClientActivityFeed';
import ClientNotePanel from '../components/client/ClientNotePanel';
import ClientPortalAccess from '../components/client/ClientPortalAccess';
import ClientTimeTab from '../components/client/ClientTimeTab';
import ClientFilesTab from '../components/client/ClientFilesTab';
import ClientLoginsTab from '../components/client/ClientLoginsTab';
import useClientMonthHours from '../components/client/useClientMonthHours';
import { emptyClass, panelHeaderClass, panelLinkClass, panelTitleClass } from '../components/client/clientPageStyles';

// Ashbi Hub client page (design: Client mockup). Overview first; the full
// invoice, project, time, file, login and conversation lists sit in their own
// tabs, kept in ?tab= so a link or the back button lands on the same view.
// Admins see money and logins; team members see the work.

const CLIENT_STATUS = {
  ACTIVE: { label: 'Active', className: 'bg-success/15 text-success' },
  PAUSED: { label: 'Paused', className: 'bg-warning/15 text-warning' },
  CHURNED: { label: 'Past client', className: 'bg-muted text-muted-foreground' },
};

// Project stages in order, so a project can show how far along it is.
const PROJECT_STAGES = ['STARTING_UP', 'DESIGN_DEV', 'ADDING_CONTENT', 'FINALIZING', 'LAUNCHED'];
const CLOSED_PROJECTS = new Set(['LAUNCHED', 'CANCELLED']);

// "$830.00" for one currency, "$830.00 · US$120.00" when the amounts are in
// several (different currencies are never added together).
function moneyByCurrency(byCurrency, amount, currency) {
  const entries = Object.entries(byCurrency || {}).filter(([, value]) => value > 0);
  if (entries.length > 0) return entries.map(([code, value]) => formatMoney(value, code)).join(' · ');
  return formatMoney(amount, currency || undefined);
}

function hasMoney(byCurrency, amount) {
  return Object.values(byCurrency || {}).some((value) => value > 0) || Number(amount) > 0;
}

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function monthYear(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Median days from sending (or issuing) an invoice to it being paid.
function usualDaysToPay(invoices = []) {
  const days = invoices
    .filter((invoice) => invoice.paidAt && (invoice.sentAt || invoice.issueDate))
    .map((invoice) => (new Date(invoice.paidAt) - new Date(invoice.sentAt || invoice.issueDate)) / 86400000)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (days.length === 0) return null;
  const middle = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[middle] : (days[middle - 1] + days[middle]) / 2;
  return Math.round(median);
}

// Last word of the name in the italic serif accent, as on the mockup.
function ClientName({ name }) {
  const words = String(name).trim().split(/\s+/);
  if (words.length < 2) return name;
  const last = words.pop();
  return <>{words.join(' ')} <span className="font-display italic font-normal text-primary">{last}</span></>;
}

function Tile({ label, value, detail, tone }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-5 flex flex-col gap-1.5">
      <span className="text-eyebrow text-muted-foreground">{label}</span>
      <span className={cn('figure text-2xl font-medium break-words', tone === 'warning' && 'text-warning')}>{value}</span>
      {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
    </div>
  );
}

function ProjectRow({ project }) {
  const stage = PROJECT_STAGES.indexOf(project.status);
  const percent = stage >= 0 ? Math.round(((stage + 1) / PROJECT_STAGES.length) * 100) : null;
  return (
    <li className="border-t border-border/40 first:border-t-0">
      <Link
        to={`/project/${project.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-muted/50 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="min-w-0 flex-[1_1_220px]">
          <div className="font-semibold text-foreground break-words">{project.name}</div>
          <div className="text-sm text-muted-foreground">
            {project._count?.tasks || 0} tasks · {project._count?.threads || 0} conversations
            {project.endDate && <> · due {formatDate(project.endDate, { dateOnly: true })}</>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', getProjectStatusColor(project.status))}>
            {getProjectStatusLabel(project.status)}
          </span>
          {project.health && (
            <span className={cn('px-2 py-0.5 text-xs font-medium rounded', getHealthColor(project.health))}>
              {project.health.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
        </div>
        {percent !== null && (
          <div className="flex flex-[0_1_180px] items-center gap-2" aria-hidden="true">
            <div className="h-1.5 flex-grow rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <span className="figure text-xs text-muted-foreground">{stage + 1}/{PROJECT_STAGES.length}</span>
          </div>
        )}
      </Link>
    </li>
  );
}

function InvoiceTable({ invoices }) {
  return (
    <div className="overflow-x-auto px-5 pb-3">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left">
            <th scope="col" className="py-2 pr-2 text-eyebrow text-muted-foreground">Invoice</th>
            <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground">For</th>
            <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground text-right">Amount</th>
            <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground">Due</th>
            <th scope="col" className="py-2 pl-2 text-eyebrow text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const displayStatus = invoiceDisplayStatus(invoice);
            const owing = ['PARTLY_PAID', 'OVERDUE'].includes(displayStatus) && invoice.amountPaid > 0;
            return (
              <tr key={invoice.id} className="border-t border-border/40">
                <td className="py-3 pr-2">
                  <Link to={`/invoices/${invoice.id}`} className="figure text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                    {invoice.invoiceNumber || 'Invoice'}
                  </Link>
                </td>
                <td className="py-3 px-2 text-foreground">{invoice.title || '—'}</td>
                <td className="py-3 px-2 text-right">
                  <span className="figure">{formatMoney(invoice.total, invoice.currency)}</span>
                  {owing && (
                    <span className="block text-xs text-muted-foreground">{formatMoney(invoiceBalanceDue(invoice), invoice.currency)} left to pay</span>
                  )}
                </td>
                <td className={cn('py-3 px-2', displayStatus === 'OVERDUE' ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                  {invoice.dueDate ? formatDate(invoice.dueDate, { dateOnly: true }) : '—'}
                </td>
                <td className="py-3 pl-2">
                  <StatusBadge domain="invoice" status={displayStatus} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ThreadList({ threads }) {
  return (
    <ol className="px-5 pb-3">
      {threads.map((thread) => (
        <li key={thread.id} className="border-t border-border/40 first:border-t-0">
          <Link
            to={`/thread/${thread.id}`}
            className="flex gap-3 py-3 -mx-2 px-2 rounded-md hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-secondary-foreground/40" />
            <span className="min-w-0">
              <span className="block text-foreground break-words">{thread.subject || 'No subject'}</span>
              <span className="block text-xs text-muted-foreground">
                {formatRelativeTime(thread.lastActivityAt)} · {thread.project?.name || 'No project'} · {thread.assignedTo?.name || 'Unassigned'}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function RetainerCard({ plan }) {
  const amount = plan.currency === 'CAD' ? plan.monthlyAmountCad : plan.monthlyAmountUsd;
  const amountLabel = amount ? formatMoney(amount, plan.currency) : null;
  return (
    <Card as="section" padding="none" aria-labelledby="client-retainer-heading" className="rounded-lg border-primary bg-primary text-primary-foreground p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-[1_1_280px]">
        <div className="text-eyebrow text-primary-foreground/80">Retainer</div>
        <h2 id="client-retainer-heading" className="mt-1 text-xl font-semibold tracking-tight">
          {plan.serviceDescription || 'Monthly retainer'}
        </h2>
        <p className="mt-1 text-primary-foreground/85">
          {amountLabel && <><span className="figure text-accent">{amountLabel}</span> a month · </>}
          billed on day {plan.billingDay || 1}
          {plan.nextBillingDate && <> · next {formatDate(plan.nextBillingDate, { dateOnly: true })}</>}
        </p>
        <p className="mt-2 text-sm text-primary-foreground/85">
          <span className="figure">{plan.hoursUsed ?? 0}</span> of <span className="figure">{plan.hoursPerMonth}</span> hours used this cycle
          {plan.scopeCreepRisk && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">Near the limit</span>}
        </p>
      </div>
      <Link to="/retainers" className="inline-flex min-h-11 items-center rounded-md border border-primary-foreground/60 px-3 font-mono text-xs font-medium uppercase tracking-[0.1em] hover:bg-primary-foreground/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
        Manage retainer
      </Link>
    </Card>
  );
}

export default function Client() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isStaff = ['ADMIN', 'TEAM'].includes(user?.role);
  const [noteEditing, setNoteEditing] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  // Moving to another client closes this one's note form and portal dialog.
  useEffect(() => {
    setNoteEditing(false);
    setPortalOpen(false);
  }, [id]);

  const {
    data: client,
    isLoading,
    isError: clientError,
    error: clientRequestError,
    refetch: refetchClient,
    isFetching: clientFetching,
  } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.getClient(id),
  });

  const {
    data: insights,
    isError: insightsError,
    error: insightsRequestError,
    refetch: refetchInsights,
    isFetching: insightsFetching,
  } = useQuery({
    queryKey: ['client-insights', id],
    queryFn: () => api.getClientInsights(id),
  });

  // The retainer card shows money, so only admins ask for it.
  const { data: retainers } = useQuery({
    queryKey: ['retainers'],
    queryFn: () => api.getRetainerList(),
    enabled: isAdmin,
    retry: false,
  });

  const monthHours = useClientMonthHours({ projects: client?.projects || [], role: user?.role, enabled: isStaff && Boolean(client) });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingState label="Loading client…" compact />
      </div>
    );
  }

  if (clientError) {
    return (
      <QueryErrorState
        error={clientRequestError}
        message="Client details could not be loaded"
        onRetry={refetchClient}
        isRetrying={clientFetching}
      />
    );
  }

  if (!client) {
    return <div className="text-center py-8">Client not found</div>;
  }

  const contacts = client.contacts || [];
  const projects = client.projects || [];
  const threads = client.threads || [];
  const invoices = isAdmin ? client.invoices || [] : [];
  const primaryContact = contacts.find((c) => c.isPrimary) || contacts[0];
  const openProjects = projects.filter((project) => !CLOSED_PROJECTS.has(project.status));
  const status = CLIENT_STATUS[client.status] || { label: client.status, className: 'bg-muted text-muted-foreground' };
  const since = monthYear(client.createdAt);
  const billsIn = invoices[0]?.currency;
  const daysToPay = isAdmin ? usualDaysToPay(invoices) : null;
  const retainer = isAdmin && Array.isArray(retainers)
    ? retainers.find((plan) => (plan.clientId || plan.client?.id) === client.id && plan.retainerStatus !== 'CANCELLED')
    : null;

  const tabs = ['overview', ...(isAdmin ? ['invoices'] : []), 'projects', ...(isStaff ? ['time', 'files'] : []), ...(isAdmin ? ['logins'] : []), 'conversations'];
  const requested = params.get('tab');
  const tab = tabs.includes(requested) ? requested : 'overview';
  const selectTab = (next) => {
    const nextParams = new URLSearchParams(params);
    if (next === 'overview') nextParams.delete('tab'); else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  };
  const openNote = () => {
    if (tab !== 'overview') selectTab('overview');
    setNoteEditing(true);
  };
  const hoursValue = monthHours.isError ? '—' : monthHours.isLoading ? '…' : `${monthHours.hours} h`;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-eyebrow text-muted-foreground">
        <Link to="/clients" className="rounded-sm hover:text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Clients</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{client.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-accent text-lg font-bold text-accent-foreground">
            {initials(client.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-heading font-semibold tracking-tight text-foreground break-words">
              <ClientName name={client.name} />
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground min-w-0">
              <span className={cn('rounded-full px-2 py-0.5 font-semibold', status.className)}>{status.label}</span>
              {client.serviceType && <span>{client.serviceType}</span>}
              {client.domain && <span className="break-all">{client.domain}</span>}
              {since && <span>Client since {since}</span>}
              {billsIn && <span>Bills in {billsIn}</span>}
              {primaryContact?.email && (
                <span className="flex min-w-0 items-center gap-1 break-all">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {primaryContact.email}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <Button variant="outline" type="button" onClick={openNote} aria-expanded={noteEditing}>
              <StickyNote className="h-3.5 w-3.5" aria-hidden="true" /> {client.clientNotes ? 'Edit note' : 'Add note'}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" type="button" onClick={() => setPortalOpen(true)} aria-haspopup="dialog">
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Client portal
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate(`/projects?create=true&clientId=${id}`)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New project
          </Button>
          {isAdmin && (
            <Button onClick={() => navigate(`/invoices?create=true&clientId=${id}`)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New invoice
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabList aria-label="Client sections" className="border-border/60">
          <Tab value="overview">Overview</Tab>
          {isAdmin && <Tab value="invoices">Invoices <span className="figure text-xs">{invoices.length}</span></Tab>}
          <Tab value="projects">Projects <span className="figure text-xs">{projects.length}</span></Tab>
          {isStaff && <Tab value="time">Time</Tab>}
          {isStaff && <Tab value="files">Files</Tab>}
          {isAdmin && <Tab value="logins">Logins</Tab>}
          <Tab value="conversations">Conversations <span className="figure text-xs">{threads.length}</span></Tab>
        </TabList>

        <TabPanel value="overview" className="pt-5 space-y-5">
          <section aria-label="Client numbers" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {isAdmin ? (
              <>
                <Tile
                  label="Total billed"
                  value={hasMoney(client.revenueByCurrency, client.totalRevenue)
                    ? moneyByCurrency(client.revenueByCurrency, client.totalRevenue, client.revenueCurrency)
                    : '—'}
                />
                <Tile
                  label="Outstanding"
                  value={hasMoney(client.outstandingByCurrency, client.outstandingBalance)
                    ? moneyByCurrency(client.outstandingByCurrency, client.outstandingBalance, client.outstandingCurrency)
                    : 'Nothing owed'}
                  tone={hasMoney(client.outstandingByCurrency, client.outstandingBalance) ? 'warning' : undefined}
                />
                <Tile label={`Hours in ${monthHours.month}`} value={hoursValue} detail={monthHours.isError ? 'Hours could not be loaded' : `${monthHours.billableHours} h billable`} />
                <Tile label="Usually pays in" value={daysToPay === null ? '—' : `${daysToPay} ${daysToPay === 1 ? 'day' : 'days'}`} detail={daysToPay === null ? 'No paid invoices yet' : undefined} />
              </>
            ) : (
              <>
                <Tile label="Open projects" value={openProjects.length} detail={`${projects.length} in total`} />
                <Tile label={`Your hours in ${monthHours.month}`} value={hoursValue} detail={monthHours.isError ? 'Hours could not be loaded' : 'On this client\'s projects'} />
                <Tile label="Conversations" value={threads.length} detail="Most recent 10" />
                <Tile label="Contacts" value={contacts.length} />
              </>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <div className="lg:col-span-2 space-y-5 min-w-0">
              {retainer && <RetainerCard plan={retainer} />}

              <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-projects-heading">
                <div className={panelHeaderClass}>
                  <h2 id="client-projects-heading" className={panelTitleClass}>Open projects</h2>
                  {projects.length > openProjects.length && (
                    <button type="button" className={panelLinkClass} onClick={() => selectTab('projects')}>
                      All {projects.length} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {openProjects.length > 0 ? (
                  <ul className="pb-1">{openProjects.slice(0, 5).map((project) => <ProjectRow key={project.id} project={project} />)}</ul>
                ) : (
                  <p className={emptyClass}>No open projects.</p>
                )}
              </Card>

              {isAdmin && (
                <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-invoices-heading">
                  <div className={panelHeaderClass}>
                    <h2 id="client-invoices-heading" className={panelTitleClass}>Invoices</h2>
                    {invoices.length > 3 && (
                      <button type="button" className={panelLinkClass} onClick={() => selectTab('invoices')}>
                        See all {invoices.length} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {invoices.length > 0 ? <InvoiceTable invoices={invoices.slice(0, 3)} /> : <p className={emptyClass}>No invoices yet.</p>}
                </Card>
              )}

              {isStaff && (
                <div className="space-y-3">
                  <ClientAccountManager key={id} clientId={id} clientName={client.name} role={user.role} />
                  <ClientServicePanels key={`service-panels-${id}`} clientId={id} />
                </div>
              )}
            </div>

            <div className="space-y-5 min-w-0">
              <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-contacts-heading">
                <div className={panelHeaderClass}>
                  <h2 id="client-contacts-heading" className={panelTitleClass}>Contacts</h2>
                </div>
                {contacts.length > 0 ? (
                  <ul className="px-5 pb-3">
                    {contacts.map((contact) => (
                      <li key={contact.id} className="flex gap-3 border-t border-border/40 py-3 first:border-t-0">
                        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                          {initials(contact.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground break-words">
                            {contact.name}
                            {contact.role && <span className="text-xs font-normal text-muted-foreground"> · {contact.role}</span>}
                          </div>
                          {contact.email && <div className="text-sm text-muted-foreground break-all">{contact.email}</div>}
                          {contact.isPrimary && <div className="text-xs font-semibold text-success">Primary contact</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={emptyClass}>No contacts yet.</p>
                )}
              </Card>

              {isStaff && <ClientActivityFeed key={`activity-${id}`} clientId={id} role={user.role} />}

              <ClientNotePanel
                key={`note-${id}`}
                clientId={id}
                note={client.clientNotes}
                canEdit={isStaff}
                editing={noteEditing}
                onEditingChange={setNoteEditing}
              />

              {insightsError ? (
                <QueryErrorState
                  error={insightsRequestError}
                  message="Client insights could not be loaded"
                  onRetry={refetchInsights}
                  isRetrying={insightsFetching}
                />
              ) : insights && (
                <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-insights-heading">
                  <div className={panelHeaderClass}>
                    <h2 id="client-insights-heading" className={panelTitleClass}>Insights</h2>
                  </div>
                  <dl className="px-5 pb-4 space-y-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Recent conversations</dt>
                      <dd className="figure font-medium text-foreground">{insights.recentThreadCount}</dd>
                    </div>
                    {insights.sentimentBreakdown && Object.keys(insights.sentimentBreakdown).length > 0 && (
                      <div>
                        <dt className="text-muted-foreground">Mood</dt>
                        <dd className="mt-1 flex flex-wrap gap-2">
                          {Object.entries(insights.sentimentBreakdown).map(([sentiment, count]) => (
                            <span key={sentiment} className="rounded bg-muted px-2 py-1 text-xs">{sentiment}: {count}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">Satisfaction</dt>
                      <dd className="font-medium capitalize text-foreground">{insights.satisfactionTrend}</dd>
                    </div>
                  </dl>
                </Card>
              )}

              {client.communicationPrefs && Object.keys(client.communicationPrefs).length > 0 && (
                <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-prefs-heading">
                  <div className={panelHeaderClass}>
                    <h2 id="client-prefs-heading" className={panelTitleClass}>How they like to hear from us</h2>
                  </div>
                  <dl className="px-5 pb-4 space-y-2 text-sm">
                    {Object.entries(client.communicationPrefs).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</dt>
                        <dd className="font-medium text-foreground text-right break-words">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              )}
            </div>
          </div>
        </TabPanel>

        {isAdmin && (
          <TabPanel value="invoices" className="pt-5">
            <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-all-invoices-heading">
              <div className={panelHeaderClass}>
                <h2 id="client-all-invoices-heading" className={panelTitleClass}>All invoices</h2>
                <Link to={`/invoices?clientId=${id}`} className={panelLinkClass}>Open in Invoices <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
              </div>
              {invoices.length > 0 ? <InvoiceTable invoices={invoices} /> : <p className={emptyClass}>No invoices yet.</p>}
            </Card>
          </TabPanel>
        )}

        <TabPanel value="projects" className="pt-5">
          <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-all-projects-heading">
            <div className={panelHeaderClass}>
              <h2 id="client-all-projects-heading" className={panelTitleClass}>All projects</h2>
            </div>
            {projects.length > 0 ? (
              <ul className="pb-1">{projects.map((project) => <ProjectRow key={project.id} project={project} />)}</ul>
            ) : (
              <p className={emptyClass}>No projects yet.</p>
            )}
          </Card>
        </TabPanel>

        {isStaff && (
          <TabPanel value="time" className="pt-5">
            <ClientTimeTab projects={projects} monthHours={monthHours} isAdmin={isAdmin} />
          </TabPanel>
        )}

        {isStaff && (
          <TabPanel value="files" className="pt-5">
            <ClientFilesTab projects={projects} />
          </TabPanel>
        )}

        {isAdmin && (
          <TabPanel value="logins" className="pt-5">
            <ClientLoginsTab clientId={id} />
          </TabPanel>
        )}

        <TabPanel value="conversations" className="pt-5 space-y-5">
          <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-all-threads-heading">
            <div className={panelHeaderClass}>
              <h2 id="client-all-threads-heading" className={panelTitleClass}>Recent conversations</h2>
            </div>
            {threads.length > 0 ? <ThreadList threads={threads} /> : <p className={emptyClass}>No conversations yet.</p>}
          </Card>
          {isStaff && <ClientCommunications key={`communications-${id}`} clientId={id} />}
        </TabPanel>
      </Tabs>

      {isAdmin && (
        <ClientPortalAccess
          key={`portal-${id}`}
          clientId={id}
          clientName={client.name}
          contacts={contacts}
          isOpen={portalOpen}
          onClose={() => setPortalOpen(false)}
        />
      )}
    </div>
  );
}
