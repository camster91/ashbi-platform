// Daily operator queue (#461): one role-aware list of client-delivery work
// projected from existing records. The queue never owns state; every row
// points at its source record, and changes happen in that record's own
// workflow. See docs/operator-queue.md for the source-to-view mapping.

import logger from '../utils/logger.js';

export const WORK_QUEUE_VIEWS = Object.freeze(['needs_action', 'awaiting_approval', 'waiting_on_client', 'at_risk']);

/** Hard cap on rows read from each source per request. */
export const WORK_QUEUE_SOURCE_LIMIT = 100;

/** Roles that may open the queue at all (clients and bots may not). */
export const WORK_QUEUE_STAFF_ROLES = Object.freeze(['ADMIN', 'TEAM', 'STAFF']);

/**
 * Roles that see finance rows (proposals, contracts, invoices) and pending
 * approvals. Mirrors the SPA, which shows money and the approval queue only
 * to admins, and PATCH /api/approvals/:id, which is admin-only.
 */
export const WORK_QUEUE_ADMIN_ROLES = Object.freeze(['ADMIN']);

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'BLOCKED'];
const FAILED_DELIVERY = new Set(['FAILED', 'BOUNCED', 'COMPLAINED']);
const ROLE_OWNER_ADMIN = Object.freeze({ id: null, name: 'Admins', role: 'ADMIN' });

const clientSelect = { select: { id: true, name: true } };
const projectSelect = { select: { id: true, name: true, client: clientSelect } };
const userSelect = { select: { id: true, name: true } };

/** Whole days between `from` and `now`, never negative; null without a date. */
export function ageInDays(from, now = new Date()) {
  if (!from) return null;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / DAY_MS));
}

function isPast(date, now) {
  return Boolean(date) && new Date(date).getTime() < now.getTime();
}

function iso(date) {
  return date ? new Date(date).toISOString() : null;
}

function ref(record) {
  return record ? { id: record.id, name: record.name } : null;
}

function personOwner(user, fallbackId = null) {
  if (user) return { id: user.id, name: user.name, role: null };
  if (fallbackId) return { id: fallbackId, name: 'Former team member', role: null };
  return null;
}

// ─── Row mapping and view assignment (pure) ────────────────────────────────

/** @returns {{view: string, state: string, nextAction: string}} */
export function classifyTask(task, now = new Date()) {
  if (task.status === 'BLOCKED') {
    return {
      view: 'at_risk',
      state: 'BLOCKED',
      nextAction: task.blockedBy ? `Resolve blocker: ${task.blockedBy}` : 'Resolve the blocker or reassign',
    };
  }
  if (isPast(task.dueDate, now)) {
    return { view: 'at_risk', state: 'OVERDUE', nextAction: 'Complete the task or agree a new due date' };
  }
  if (task.category === 'WAITING_CLIENT') {
    return { view: 'waiting_on_client', state: task.status, nextAction: 'Waiting on the client; follow up if it stalls' };
  }
  if (!task.assigneeId) {
    return { view: 'needs_action', state: task.status, nextAction: 'Assign an owner' };
  }
  return {
    view: 'needs_action',
    state: task.status,
    nextAction: task.status === 'IN_PROGRESS' ? 'Finish and mark complete' : 'Start the task',
  };
}

export function mapTaskRow(task, now = new Date()) {
  const { view, state, nextAction } = classifyTask(task, now);
  return {
    type: 'task',
    id: task.id,
    title: task.title,
    sourceUrl: `/task/${task.id}`,
    client: ref(task.project?.client),
    project: ref(task.project),
    owner: personOwner(task.assignee, task.assigneeId),
    state,
    nextAction,
    dueAt: iso(task.dueDate),
    ageDays: ageInDays(task.createdAt, now),
    view,
  };
}

export function mapApprovalRow(approval, now = new Date()) {
  const expired = isPast(approval.expiresAt, now);
  return {
    type: 'approval',
    id: approval.id,
    title: approval.title,
    sourceUrl: '/approvals',
    client: ref(approval.project?.client) ?? (approval.clientName ? { id: null, name: approval.clientName } : null),
    project: ref(approval.project),
    owner: ROLE_OWNER_ADMIN,
    state: approval.status,
    nextAction: expired
      ? 'Past its expiry: approve, reject, or ask for a new request'
      : `Approve or reject this ${String(approval.type || 'request').toLowerCase()}`,
    dueAt: iso(approval.expiresAt),
    ageDays: ageInDays(approval.createdAt, now),
    view: 'awaiting_approval',
  };
}

/** @returns {{view: string, state: string, nextAction: string}} */
export function classifyReviewSession(session) {
  if (session.status === 'changes_requested') {
    return { view: 'needs_action', state: 'changes_requested', nextAction: 'Address requested changes and upload a new version' };
  }
  if (session.sharedWithClient) {
    return {
      view: 'waiting_on_client',
      state: 'open',
      nextAction: session.clientCanDecide ? 'Waiting on the client decision' : 'Waiting on client feedback',
    };
  }
  return { view: 'awaiting_approval', state: 'open', nextAction: 'Record a review decision or share with the client' };
}

export function mapReviewRow(session, owners, now = new Date()) {
  const { view, state, nextAction } = classifyReviewSession(session);
  return {
    type: 'review',
    id: session.id,
    title: session.title,
    sourceUrl: `/review/${session.id}`,
    client: ref(session.project?.client),
    project: ref(session.project),
    owner: personOwner(owners.get(session.createdById), session.createdById),
    state,
    nextAction,
    dueAt: null,
    ageDays: ageInDays(session.updatedAt ?? session.createdAt, now),
    view,
  };
}

function deliveryFailed(record) {
  return FAILED_DELIVERY.has(String(record.deliveryStatus || '').toUpperCase());
}

export function mapProposalRow(proposal, now = new Date()) {
  let view = 'waiting_on_client';
  let nextAction = 'Waiting on the client to accept or decline';
  if (deliveryFailed(proposal)) {
    view = 'needs_action';
    nextAction = 'Email delivery failed: check the address and resend';
  } else if (isPast(proposal.validUntil, now)) {
    view = 'at_risk';
    nextAction = 'Past its valid-until date: follow up or revise';
  }
  return {
    type: 'proposal',
    id: proposal.id,
    title: proposal.title,
    sourceUrl: `/proposal/${proposal.id}`,
    client: ref(proposal.client),
    project: ref(proposal.project),
    owner: personOwner(proposal.createdBy, proposal.createdById),
    state: proposal.status,
    nextAction,
    dueAt: iso(proposal.validUntil),
    ageDays: ageInDays(proposal.sentAt ?? proposal.createdAt, now),
    view,
  };
}

export function mapContractRow(contract, now = new Date()) {
  const failed = deliveryFailed(contract);
  return {
    type: 'contract',
    id: contract.id,
    title: contract.title,
    sourceUrl: '/contracts',
    client: ref(contract.client),
    project: ref(contract.proposal?.project),
    owner: personOwner(contract.createdBy, contract.createdById),
    state: contract.status,
    nextAction: failed ? 'Email delivery failed: check the address and resend' : 'Waiting on the client signature',
    dueAt: null,
    ageDays: ageInDays(contract.createdAt, now),
    view: failed ? 'needs_action' : 'waiting_on_client',
  };
}

export function mapInvoiceRow(invoice, now = new Date()) {
  const overdue = invoice.status === 'OVERDUE' || isPast(invoice.dueDate, now);
  let view = 'waiting_on_client';
  let state = invoice.status;
  let nextAction = 'Waiting on payment';
  if (deliveryFailed(invoice)) {
    view = 'needs_action';
    nextAction = 'Email delivery failed: check the address and resend';
  } else if (overdue) {
    view = 'at_risk';
    state = 'OVERDUE';
    nextAction = 'Payment overdue: send a reminder or call the client';
  }
  const label = invoice.title ? `${invoice.invoiceNumber} · ${invoice.title}` : `Invoice ${invoice.invoiceNumber}`;
  return {
    type: 'invoice',
    id: invoice.id,
    title: label,
    sourceUrl: `/invoices/${invoice.id}`,
    client: ref(invoice.client),
    project: ref(invoice.project),
    owner: personOwner(invoice.createdBy, invoice.createdById),
    state,
    nextAction,
    dueAt: iso(invoice.dueDate),
    ageDays: ageInDays(invoice.sentAt ?? invoice.issueDate ?? invoice.createdAt, now),
    view,
  };
}

/** Oldest due date first (undated last), then the longest-waiting row. */
export function compareRows(a, b) {
  const aDue = a.dueAt ? Date.parse(a.dueAt) : Infinity;
  const bDue = b.dueAt ? Date.parse(b.dueAt) : Infinity;
  if (aDue !== bDue) return aDue - bDue;
  return (b.ageDays ?? 0) - (a.ageDays ?? 0);
}

export function countByView(rows) {
  const counts = Object.fromEntries(WORK_QUEUE_VIEWS.map((view) => [view, 0]));
  for (const row of rows) counts[row.view] += 1;
  return counts;
}

// ─── Sources (tenant-scoped Prisma reads) ──────────────────────────────────

/**
 * Each source reads through the request-scoped Prisma client (tenant filter
 * injected by src/utils/prisma-tenant-proxy.js) and is bounded by `take`.
 * `adminOnly` sources are skipped entirely for other roles, so neither their
 * rows nor their counts reach the response.
 */
export const WORK_QUEUE_SOURCES = Object.freeze([
  {
    key: 'tasks',
    adminOnly: false,
    async load(prisma, { filters, user, now }) {
      const where = {
        deletedAt: null,
        status: { in: OPEN_TASK_STATUSES },
        project: {
          deletedAt: null,
          status: { notIn: ['CANCELLED'] },
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
        },
        OR: [
          { assigneeId: { not: null } },
          { status: 'BLOCKED' },
          { dueDate: { lt: now } },
        ],
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        ...(filters.owner === 'me' ? { assigneeId: user.id } : {}),
      };
      const tasks = await prisma.task.findMany({
        where,
        select: {
          id: true, title: true, status: true, category: true, dueDate: true, blockedBy: true,
          assigneeId: true, createdAt: true,
          assignee: userSelect,
          project: projectSelect,
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: WORK_QUEUE_SOURCE_LIMIT,
      });
      return tasks.map((task) => mapTaskRow(task, now));
    },
  },
  {
    key: 'approvals',
    adminOnly: true,
    async load(prisma, { filters, now }) {
      const projectFilter = {};
      if (filters.projectId) projectFilter.id = filters.projectId;
      if (filters.clientId) projectFilter.clientId = filters.clientId;
      const approvals = await prisma.approval.findMany({
        where: {
          status: 'PENDING',
          ...(Object.keys(projectFilter).length ? { project: projectFilter } : {}),
        },
        select: {
          id: true, type: true, status: true, title: true, clientName: true, expiresAt: true, createdAt: true,
          project: projectSelect,
        },
        orderBy: { createdAt: 'asc' },
        take: WORK_QUEUE_SOURCE_LIMIT,
      });
      return approvals.map((approval) => mapApprovalRow(approval, now));
    },
  },
  {
    key: 'reviews',
    adminOnly: false,
    async load(prisma, { filters, user, now }) {
      const sessions = await prisma.reviewSession.findMany({
        where: {
          status: { in: ['open', 'changes_requested'] },
          // Only the current version of each review needs attention.
          nextSession: { is: null },
          project: {
            deletedAt: null,
            ...(filters.clientId ? { clientId: filters.clientId } : {}),
          },
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.owner === 'me' ? { createdById: user.id } : {}),
        },
        select: {
          id: true, title: true, status: true, sharedWithClient: true, clientCanDecide: true,
          createdById: true, createdAt: true, updatedAt: true,
          project: projectSelect,
        },
        orderBy: { updatedAt: 'asc' },
        take: WORK_QUEUE_SOURCE_LIMIT,
      });
      const ownerIds = [...new Set(sessions.map((session) => session.createdById).filter(Boolean))];
      const owners = ownerIds.length
        ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true }, take: ownerIds.length })
        : [];
      const byId = new Map(owners.map((owner) => [owner.id, owner]));
      return sessions.map((session) => mapReviewRow(session, byId, now));
    },
  },
  {
    key: 'proposals',
    adminOnly: true,
    async load(prisma, { filters, user, now }) {
      const proposals = await prisma.proposal.findMany({
        where: {
          deletedAt: null,
          status: { in: ['SENT', 'VIEWED'] },
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.owner === 'me' ? { createdById: user.id } : {}),
        },
        select: {
          id: true, title: true, status: true, validUntil: true, sentAt: true, createdAt: true,
          deliveryStatus: true, createdById: true,
          client: clientSelect,
          project: { select: { id: true, name: true } },
          createdBy: userSelect,
        },
        orderBy: [{ validUntil: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: WORK_QUEUE_SOURCE_LIMIT,
      });
      return proposals.map((proposal) => mapProposalRow(proposal, now));
    },
  },
  {
    key: 'contracts',
    adminOnly: true,
    async load(prisma, { filters, user, now }) {
      const contracts = await prisma.contract.findMany({
        where: {
          deletedAt: null,
          status: 'SENT',
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.projectId ? { proposal: { is: { projectId: filters.projectId } } } : {}),
          ...(filters.owner === 'me' ? { createdById: user.id } : {}),
        },
        select: {
          id: true, title: true, status: true, createdAt: true, deliveryStatus: true, createdById: true,
          client: clientSelect,
          proposal: { select: { project: { select: { id: true, name: true } } } },
          createdBy: userSelect,
        },
        orderBy: { createdAt: 'asc' },
        take: WORK_QUEUE_SOURCE_LIMIT,
      });
      return contracts.map((contract) => mapContractRow(contract, now));
    },
  },
  {
    key: 'invoices',
    adminOnly: true,
    async load(prisma, { filters, user, now }) {
      const invoices = await prisma.invoice.findMany({
        where: {
          deletedAt: null,
          status: { in: ['SENT', 'OVERDUE'] },
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.owner === 'me' ? { createdById: user.id } : {}),
        },
        select: {
          id: true, invoiceNumber: true, title: true, status: true, dueDate: true, issueDate: true,
          sentAt: true, createdAt: true, deliveryStatus: true, createdById: true, projectId: true,
          client: clientSelect,
          createdBy: userSelect,
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: WORK_QUEUE_SOURCE_LIMIT,
      });
      // Invoice.projectId has no relation in the schema; resolve names here.
      const projectIds = [...new Set(invoices.map((invoice) => invoice.projectId).filter(Boolean))];
      const projects = projectIds.length
        ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true }, take: projectIds.length })
        : [];
      const byId = new Map(projects.map((project) => [project.id, project]));
      return invoices.map((invoice) => mapInvoiceRow({ ...invoice, project: byId.get(invoice.projectId) ?? null }, now));
    },
  },
]);

/** Source keys a role may read. */
export function sourcesForRole(role) {
  const admin = WORK_QUEUE_ADMIN_ROLES.includes(role);
  return WORK_QUEUE_SOURCES.filter((source) => admin || !source.adminOnly);
}

/**
 * Build the queue. A failing source marks the response `partial` and is
 * listed in `failedSources`; the other sources still load.
 *
 * @param {any} prisma request-scoped Prisma client
 * @param {{ user: {id: string, role: string}, filters?: {view?: string, owner?: string, clientId?: string, projectId?: string}, now?: Date, sources?: typeof WORK_QUEUE_SOURCES }} options
 */
export async function buildWorkQueue(prisma, { user, filters = {}, now = new Date(), sources } = /** @type {any} */ ({})) {
  const active = sources ?? sourcesForRole(user.role);
  const settled = await Promise.allSettled(active.map((source) => source.load(prisma, { filters, user, now })));
  const rows = [];
  const failedSources = [];
  const truncatedSources = [];
  settled.forEach((result, index) => {
    const { key } = active[index];
    if (result.status === 'fulfilled') {
      rows.push(...result.value);
      if (result.value.length >= WORK_QUEUE_SOURCE_LIMIT) truncatedSources.push(key);
    } else {
      failedSources.push(key);
      logger.warn({ source: key, errorName: result.reason?.name }, 'Work queue source failed');
    }
  });
  rows.sort(compareRows);
  const counts = countByView(rows);
  const view = filters.view ?? null;
  return {
    view,
    rows: view ? rows.filter((row) => row.view === view) : rows,
    counts,
    total: rows.length,
    sources: active.map((source) => source.key),
    partial: failedSources.length > 0,
    failedSources,
    truncatedSources,
    generatedAt: now.toISOString(),
  };
}
