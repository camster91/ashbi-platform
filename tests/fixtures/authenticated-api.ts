import type { Page, Route } from '@playwright/test';

/**
 * Hermetic API fixtures for authenticated browser smoke tests.
 *
 * The required "Browser and accessibility smoke" job runs without a backend,
 * so every `/api/**` request is answered here with realistic, internally
 * consistent records (one agency, one client, one project, one invoice...).
 * Shapes mirror the Fastify route responses consumed by the SPA; keep them in
 * sync when a route's response contract changes.
 */

const NOW = '2026-08-20T15:00:00.000Z';
const YESTERDAY = '2026-08-19T15:00:00.000Z';
const NEXT_WEEK = '2026-08-27T15:00:00.000Z';
const LAST_WEEK = '2026-08-13T15:00:00.000Z';

export const adminUser = {
  id: 'user-admin',
  name: 'Cameron Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  skills: ['strategy', 'design'],
  capacity: 40,
};

const client = {
  id: 'client-a',
  name: 'Northwind Studio',
  domain: 'northwind.example',
  status: 'ACTIVE',
  health: 'HEALTHY',
  score: 86,
  notes: 'Prefers weekly email updates.',
  updatedAt: YESTERDAY,
  lastContactDate: YESTERDAY,
  daysSinceContact: 1,
  openTasks: 3,
  overdueTasks: 0,
  retainerPct: 40,
  contacts: [{ id: 'contact-a', name: 'Dana Rivera', email: 'dana@northwind.example', isPrimary: true }],
  projects: [{ id: 'project-a', name: 'Website Redesign', status: 'ACTIVE' }],
  _count: { projects: 1, threads: 2, invoices: 1 },
};

const clientRef = { id: client.id, name: client.name, domain: client.domain };

const tasks = [
  { id: 'task-a', title: 'Finalize homepage wireframe', status: 'IN_PROGRESS', priority: 'HIGH', category: 'IMMEDIATE', dueDate: NEXT_WEEK, assignee: { id: adminUser.id, name: adminUser.name }, project: { id: 'project-a', name: 'Website Redesign' } },
  { id: 'task-b', title: 'Collect brand assets', status: 'PENDING', priority: 'MEDIUM', category: 'WAITING_CLIENT', dueDate: NEXT_WEEK, assignee: null, project: { id: 'project-a', name: 'Website Redesign' } },
  { id: 'task-c', title: 'Kickoff call', status: 'COMPLETED', priority: 'LOW', category: 'UPCOMING', dueDate: LAST_WEEK, assignee: { id: adminUser.id, name: adminUser.name }, project: { id: 'project-a', name: 'Website Redesign' } },
];

const project = {
  id: 'project-a',
  name: 'Website Redesign',
  description: 'Marketing site rebuild.',
  status: 'DESIGN_DEV',
  health: 'ON_TRACK',
  healthScore: 82,
  aiSummary: 'Design is on schedule; waiting on brand assets from the client.',
  viewToken: 'project-view-token',
  budget: 12000,
  hourlyBudget: 100,
  startDate: LAST_WEEK,
  endDate: NEXT_WEEK,
  updatedAt: YESTERDAY,
  createdAt: LAST_WEEK,
  clientId: client.id,
  client: clientRef,
  tags: ['web'],
  completedTaskCount: 1,
  _count: { tasks: 3, threads: 1 },
  tasks,
  threads: [{ id: 'thread-a', subject: 'Homepage feedback', status: 'OPEN', priority: 'MEDIUM', lastActivityAt: YESTERDAY }],
  risks: [{ risk: 'Brand assets arrive late', mitigation: 'Use placeholder imagery', likelihood: 'MEDIUM', impact: 'LOW' }],
};

const invoice = {
  id: 'invoice-a',
  invoiceNumber: 'INV-2026-001',
  title: 'Website Redesign — Phase 1',
  status: 'SENT',
  isOverdue: false,
  issueDate: LAST_WEEK,
  dueDate: NEXT_WEEK,
  sentAt: LAST_WEEK,
  paidAt: null,
  createdAt: LAST_WEEK,
  updatedAt: LAST_WEEK,
  subtotal: 4000,
  tax: 520,
  taxRate: 13,
  taxType: 'HST',
  discountAmount: 0,
  total: 4520,
  notes: 'Thank you for your business.',
  internalNotes: 'Deposit invoice.',
  isRecurring: false,
  recurringInterval: null,
  paymentMethod: null,
  paymentNotes: null,
  stripePaymentLink: null,
  viewToken: 'invoice-view-token',
  clientId: client.id,
  projectId: project.id,
  client: { ...clientRef, contacts: client.contacts },
  project: { id: project.id, name: project.name },
  createdBy: { id: adminUser.id, name: adminUser.name },
  lineItems: [
    { id: 'line-a', description: 'Discovery and wireframes', itemType: 'SERVICE', quantity: 20, unitPrice: 120, total: 2400 },
    { id: 'line-b', description: 'Visual design', itemType: 'SERVICE', quantity: 10, unitPrice: 160, total: 1600 },
  ],
  _count: { lineItems: 2, payments: 0 },
};

const proposal = {
  id: 'proposal-a',
  title: 'Website Redesign Proposal',
  status: 'SENT',
  total: 12000,
  subtotal: 12000,
  validUntil: NEXT_WEEK,
  viewToken: 'proposal-view-token',
  createdAt: LAST_WEEK,
  updatedAt: LAST_WEEK,
  clientId: client.id,
  client: clientRef,
  lineItems: [{ id: 'proposal-line-a', description: 'Website redesign', quantity: 1, unitPrice: 12000, total: 12000 }],
};

// Media review (#417): one image attachment under review on the project.
// A 1x1 PNG stands in for the reviewed file.
export const reviewImagePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const reviewAttachment = {
  id: 'attachment-review-a',
  filename: 'homepage-draft.png',
  originalName: 'homepage-draft.png',
  mimeType: 'image/png',
  size: reviewImagePng.length,
  entityType: 'PROJECT',
  entityId: 'project-a',
  createdAt: YESTERDAY,
  uploadedBy: { id: 'user-admin', name: 'Cameron Admin' },
};

const reviewSession = {
  id: 'review-a',
  projectId: 'project-a',
  attachmentId: reviewAttachment.id,
  title: 'Homepage draft',
  status: 'changes_requested',
  version: 1,
  previousSessionId: null,
  nextSessionId: null,
  createdById: 'user-admin',
  createdAt: YESTERDAY,
  updatedAt: YESTERDAY,
  media: { fileName: reviewAttachment.originalName, filename: reviewAttachment.filename, mimeType: 'image/png', size: reviewAttachment.size, kind: 'image' },
};

export const reviewAnnotations = [
  { id: 'annotation-a', parentId: null, authorType: 'staff', authorName: 'Cameron Admin', body: 'The logo feels small next to the headline.', timecodeMs: null, region: { x: 0.4, y: 0.25, w: 0, h: 0 }, pageNumber: null, resolved: false, resolvedAt: null, createdAt: YESTERDAY },
  { id: 'annotation-b', parentId: 'annotation-a', authorType: 'guest', authorName: 'Dana Rivera', body: 'Agreed, about 20% larger.', timecodeMs: null, region: null, pageNumber: null, resolved: false, resolvedAt: null, createdAt: YESTERDAY },
  { id: 'annotation-c', parentId: null, authorType: 'guest', authorName: 'Dana Rivera', body: 'Love the colour palette.', timecodeMs: null, region: null, pageNumber: null, resolved: true, resolvedAt: YESTERDAY, createdAt: YESTERDAY },
];

export const reviewDecisions = [
  { id: 'decision-a', decision: 'changes_requested', actorType: 'guest', actorName: 'Dana Rivera', note: 'Please enlarge the logo.', createdAt: YESTERDAY },
];

const notifications = [
  { id: 'notification-a', type: 'TASK_ASSIGNED', title: 'Task assigned', message: 'You were assigned “Finalize homepage wireframe”.', read: false, createdAt: YESTERDAY, data: { taskId: 'task-a' } },
  { id: 'notification-b', type: 'INVOICE_VIEWED', title: 'Invoice viewed', message: 'Northwind Studio viewed INV-2026-001.', read: true, createdAt: LAST_WEEK, data: { invoiceId: invoice.id } },
];

export type ApiState = {
  notes: Array<Record<string, unknown>>;
  createdNotes: Array<Record<string, unknown>>;
  unmocked: string[];
};

// Requests that reached no fixture, per page. Specs assert this stays empty
// in afterEach (see expectNoUnmockedRequests) so fixture drift — a screen
// starting to call an endpoint these fixtures do not know — fails loudly
// instead of rendering a half-populated page that still passes axe.
const unmockedByPage = new WeakMap<Page, string[]>();

function trackUnmocked(page: Page) {
  const unmocked: string[] = [];
  unmockedByPage.set(page, unmocked);
  return unmocked;
}

/** Unmocked `/api` requests the page made since its fixture was installed. */
export function unmockedRequests(page: Page): string[] {
  return unmockedByPage.get(page) ?? [];
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Routes every `/api/**` call for a signed-in staff user. Pass
 * `{ signedIn: false }` to start signed out; `/api/auth/login` then signs the
 * session in, so a keyboard-only login can be exercised end to end.
 */
export async function mockAuthenticatedApi(page: Page, { user = adminUser, signedIn = true } = {}) {
  let session = signedIn;
  const state: ApiState = {
    notes: [
      { id: 'note-a', title: 'Kickoff notes', content: 'Client wants a lighter palette.', type: 'MEETING_NOTES', tags: ['kickoff'], isPinned: true, updatedAt: LAST_WEEK, author: { id: adminUser.id, name: adminUser.name } },
    ],
    createdNotes: [],
    unmocked: trackUnmocked(page),
  };

  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const path = pathname.replace(/^\/api/, '');

    if (path === '/auth/login' && method === 'POST') {
      session = true;
      return json(route, { user });
    }
    if (path === '/auth/me') return session ? json(route, user) : json(route, { error: 'Unauthorized' }, 401);
    if (!session) return json(route, { error: 'Unauthorized' }, 401);

    // Shell-wide requests (Layout, notifications, timer, onboarding).
    if (path === '/onboarding/progress') return json(route, { supported: true, role: user.role, state: 'completed', completedCount: 3, totalCount: 3, tasks: [] });
    if (path === '/notifications/unread-count') return json(route, { count: 1 });
    if (path === '/notifications') return json(route, { notifications, total: notifications.length });
    if (path === '/inbox/stats') return json(route, { total: 2, needsTriage: 1, awaitingResponse: 1, critical: 0 });
    if (path === '/time-sessions/running') return json(route, null);
    if (path.startsWith('/draft/')) return json(route, null);

    // Dashboard.
    if (path === '/dashboard/stats') {
      return json(route, {
        mrr: 2500,
        totalOutstanding: invoice.total,
        overdueAmount: 0,
        overdueCount: 0,
        activeProjects: 1,
        pendingApprovals: 1,
        recentActivity: [{ id: 'activity-a', action: 'TASK_COMPLETED', entityName: 'Kickoff call', createdAt: YESTERDAY, user: { name: adminUser.name }, project: { id: project.id, name: project.name } }],
        unreadNotifications: notifications.filter(n => !n.read),
        clientHealth: [{ id: client.id, name: client.name, healthScore: 86, healthStatus: 'ON_TRACK', retainerStatus: 'ACTIVE', retainerTier: 'GROWTH', monthlyAmount: 2500, activeProjects: 1, lastActivity: YESTERDAY }],
        atRiskProjects: [],
        inboxTriage: { untriagedCount: 1, latest: [{ id: 'thread-a', subject: 'Homepage feedback', status: 'OPEN', priority: 'MEDIUM', lastActivityAt: YESTERDAY, client: client.name, project: project.name }] },
        overdueTasks: [],
        timeTracking: { today: 150, todayBillable: 120, week: 1500, weekBillable: 1200, capacity: 40, userName: user.name, weekGoalHours: 40 },
        upcomingEvents: [{ id: 'event-a', title: 'Design review', startTime: NEXT_WEEK, endTime: NEXT_WEEK, type: 'MEETING', color: '#2563eb', location: 'Video call', isAllDay: false, project: project.name }],
        outreach: {},
        coldEmail: {},
        linkedIn: {},
        revenueHistory: [{ month: 'Jul', year: '2026', total: 8200 }, { month: 'Aug', year: '2026', total: 4520 }],
      });
    }
    if (path === '/tasks/my') return json(route, { IMMEDIATE: [tasks[0]], THIS_WEEK: [], UPCOMING: [], WAITING_CLIENT: [tasks[1]], WAITING_US: [] });

    // Clients.
    if (path === '/clients') return json(route, { clients: [client], total: 1 });
    if (path === '/ai/client-health') return json(route, { clients: [{ id: client.id, name: client.name, score: 86, status: 'HEALTHY', summary: 'Responsive and engaged.' }] });

    // Projects.
    if (path === '/projects' && method === 'GET') return json(route, { projects: [project], total: 1 });
    if (path === `/projects/${project.id}`) return json(route, project);
    if (path === `/projects/${project.id}/revisions`) return json(route, [{ id: 'revision-a', roundNumber: 1, status: 'OPEN', notes: 'Homepage copy tweaks', requestedAt: YESTERDAY, createdAt: YESTERDAY }]);
    if (path === `/projects/${project.id}/communications`) return json(route, { communications: [{ id: 'comm-a', subject: 'Homepage feedback', summary: 'Client approved the layout direction.', direction: 'INBOUND', from: 'dana@northwind.example', to: 'hello@ashbi.ca', receivedAt: YESTERDAY, sentiment: 'POSITIVE' }], total: 1 });
    if (path === `/projects/${project.id}/context`) return json(route, { aiSummary: 'Weekly cadence, email-first client.', humanNotes: 'Prefers async updates.', lastCompactedAt: YESTERDAY });
    if (path === `/projects/${project.id}/budget`) return json(route, { budget: 12000, budgetUsed: 4800, totalCost: 4800, percentUsed: 40, burnRate: 1200, time: { totalHours: 34, billableHours: 32 }, expenses: { total: 600, count: 2 }, costByUser: [{ user: { id: adminUser.id, name: adminUser.name }, hours: 32, cost: 4200 }] });
    if (path === `/projects/${project.id}/notes`) {
      if (method === 'POST') {
        const body = request.postDataJSON();
        const note = { id: `note-${state.notes.length + 1}`, isPinned: false, updatedAt: NOW, author: { id: user.id, name: user.name }, ...body };
        state.createdNotes.push(body);
        state.notes = [note, ...state.notes];
        return json(route, note, 201);
      }
      return json(route, state.notes);
    }
    if (path === `/chat/projects/${project.id}/messages`) return json(route, [{ id: 'message-a', content: 'Homepage draft is ready for review.', createdAt: YESTERDAY, authorId: adminUser.id, author: { id: adminUser.id, name: adminUser.name }, isEdited: false, reactions: [] }]);
    if (path === '/attachments') return json(route, [reviewAttachment]);
    if (path === `/attachments/uploads/${reviewAttachment.filename}`) return route.fulfill({ status: 200, contentType: 'image/png', body: reviewImagePng });

    // Media review (#417).
    if (path === '/reviews' && method === 'GET') return json(route, { sessions: [{ ...reviewSession, openAnnotationCount: 1 }] });
    if (path === `/reviews/${reviewSession.id}`) {
      return json(route, {
        session: reviewSession,
        annotations: reviewAnnotations.map(annotation => ({ ...annotation, authorUserId: annotation.authorType === 'staff' ? adminUser.id : null, authorEmail: null, viaShareLinkId: null, resolvedById: annotation.resolved ? adminUser.id : null })),
        decisions: reviewDecisions,
        shareLinks: [{ id: 'share-link-a', label: 'Dana review', allowDecision: true, expiresAt: NEXT_WEEK, revokedAt: null, lastUsedAt: YESTERDAY, createdAt: YESTERDAY, createdById: adminUser.id, state: 'active' }],
      });
    }

    // Invoices.
    if (path === '/invoices' && method === 'GET') return json(route, { invoices: [invoice], total: 1, stats: { draft: 0, sent: 1, paid: 0, overdue: 0, totalOutstanding: invoice.total } });
    if (path === '/invoices/templates') return json(route, []);
    if (path === `/invoices/${invoice.id}`) return json(route, invoice);
    if (path === `/invoices/${invoice.id}/payments`) return json(route, []);

    // Proposals.
    if (path === '/proposals' && method === 'GET') return json(route, [proposal]);

    // Settings.
    if (path === '/google-calendar/connection') return json(route, { connection: null });
    if (path === '/slack') return json(route, { installations: [] });
    if (path === '/api-keys') return json(route, { keys: [{ id: 'key-a', name: 'Zapier', createdAt: LAST_WEEK, lastUsedAt: YESTERDAY, expiresAt: null }] });
    if (path === '/settings/ai-provider') return json(route, { provider: 'ollama', ollamaModel: 'llama3.1:8b', ollamaModels: ['llama3.1:8b'], canManage: true });
    if (path === '/settings/ai-provider/ollama-models') return json(route, { models: ['llama3.1:8b', 'qwen2.5:14b'] });
    if (path === '/ai-tools/approvals') return json(route, { approvals: [] });
    if (path === '/ai-tools/receipts') return json(route, { receipts: [], nextBefore: null });
    if (path === '/ai-connections') return json(route, {
      connection: null,
      aiDisabled: false,
      platformAiDisabled: false,
      pricedModels: [],
      usage: { since: '2026-08-01T00:00:00.000Z', calls: 0, promptTokens: 0, completionTokens: 0, unpricedTokens: 0, spentCents: 0, budgetCents: null, alertThresholdPercent: 80 },
    });
    if (path === '/auth/mfa') return json(route, { eligible: true, enabled: false, enabledAt: null, pendingEnrollment: false, recoveryCodesRemaining: 0 });
    if (path === '/audit-events/catalog') return json(route, { actions: ['auth.login', 'invoice.sent', 'auth.mfa_enabled'], entityTypes: ['user', 'invoice'], actorTypes: ['USER', 'CLIENT', 'SYSTEM', 'WEBHOOK', 'BOT'] });
    if (path === '/audit-events') return json(route, { events: [
      { id: 'audit-a', organizationId: 'org-a', actorUserId: adminUser.id, actorName: adminUser.name, actorType: 'USER', action: 'invoice.sent', entityType: 'invoice', entityId: invoice.id, requestId: 'req-a', ip: '203.0.113.0/24', metadata: { invoiceNumber: 'INV-2026-001' }, createdAt: YESTERDAY },
      { id: 'audit-b', organizationId: 'org-a', actorUserId: adminUser.id, actorName: adminUser.name, actorType: 'USER', action: 'auth.login', entityType: 'user', entityId: adminUser.id, requestId: 'req-b', ip: '203.0.113.0/24', metadata: {}, createdAt: LAST_WEEK },
    ], nextCursor: null, limit: 50 });

    // Unmocked endpoints are recorded (and asserted empty after each test)
    // and answered with 501 so the page's own error handling shows too.
    state.unmocked.push(`${method} ${pathname}`);
    return json(route, { error: `Unmocked endpoint in authenticated fixture: ${method} ${pathname}` }, 501);
  });

  return state;
}

export const portalFixture = {
  me: { client: { id: client.id, name: client.name }, contact: { id: 'contact-a', name: 'Dana Rivera', email: 'dana@northwind.example' } },
  projects: [{ id: project.id, name: project.name, status: 'DESIGN_DEV', updatedAt: YESTERDAY, totalTasks: 3, completedTasks: 1, progressPct: 33 }],
  invoices: [{ id: invoice.id, invoiceNumber: invoice.invoiceNumber, title: invoice.title, status: 'SENT', total: invoice.total, dueDate: invoice.dueDate, issueDate: invoice.issueDate, viewToken: invoice.viewToken }],
  contracts: [{ id: 'contract-a', title: 'Project agreement', status: 'SENT', signToken: 'sign-a', canReview: true }],
  documents: [{ id: 'document-a', originalName: 'brand-guidelines.pdf', size: 204800, createdAt: YESTERDAY, uploadedBy: { name: 'Dana Rivera' } }],
  messages: [{ id: 'portal-message-a', content: 'Homepage draft is ready for review.', createdAt: YESTERDAY, author: { name: adminUser.name }, authorId: adminUser.id }],
};

/** Routes every `/api/client-portal/**` call for a signed-in CLIENT contact. */
export async function mockClientPortalApi(page: Page) {
  const state = {
    uploads: 0,
    deleted: [] as string[],
    messages: [...portalFixture.messages],
    documents: [...portalFixture.documents],
    unmocked: trackUnmocked(page),
  };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    const path = pathname.replace(/^\/api\/client-portal/, '');
    const projectId = portalFixture.projects[0].id;

    // The SPA shell still probes the staff session; a portal contact has none.
    if (pathname === '/api/auth/me') return json(route, { error: 'Unauthorized' }, 401);
    if (path === '/verify-token') return json(route, { user: { role: 'CLIENT' } });
    if (path === '/me') return json(route, portalFixture.me);
    if (path === '/projects') return json(route, portalFixture.projects);
    if (path === '/invoices') return json(route, portalFixture.invoices);
    if (path === '/contracts') return json(route, portalFixture.contracts);
    if (path === '/retainer') return json(route, null);
    if (path === '/unread-count') return json(route, { recentMessages: 1, upcomingDeadlines: 1 });
    if (path === `/projects/${projectId}`) {
      return json(route, {
        ...portalFixture.projects[0],
        milestones: [{ id: 'milestone-a', name: 'Design review', description: 'Review the homepage design.', dueDate: NEXT_WEEK, status: 'IN_PROGRESS' }],
        revisionRounds: [],
      });
    }
    if (path === `/projects/${projectId}/tasks`) return json(route, { columns: { TODO: [], IN_PROGRESS: [], DONE: [], BLOCKED: [] } });
    if (path === `/projects/${projectId}/documents`) return json(route, state.documents);
    if (path === `/projects/${projectId}/upload` && method === 'POST') {
      state.uploads += 1;
      state.documents = [...state.documents, { id: `document-upload-${state.uploads}`, originalName: 'uploaded-brief.txt', size: 1024, createdAt: NOW, uploadedBy: { name: 'Dana Rivera' } }];
      return json(route, state.documents.at(-1), 201);
    }
    if (path === `/projects/${projectId}/messages`) {
      if (method === 'POST') {
        const message = { id: `portal-message-${state.messages.length + 1}`, content: request.postDataJSON().content, createdAt: NOW, author: { name: 'Dana Rivera' }, authorId: 'contact-a' };
        state.messages.push(message);
        return json(route, message, 201);
      }
      return json(route, state.messages);
    }
    const documentMatch = path.match(/^\/documents\/([^/]+)$/);
    if (documentMatch && method === 'DELETE') {
      state.deleted.push(documentMatch[1]);
      state.documents = state.documents.filter(document => document.id !== documentMatch[1]);
      return json(route, { success: true });
    }
    state.unmocked.push(`${method} ${pathname}`);
    return json(route, { error: `Unmocked endpoint in client portal fixture: ${method} ${pathname}` }, 501);
  });
  return state;
}

// Share tokens are 43 base64url characters.
export const portalReviewToken = 'a11y-review-share-token'.padEnd(43, '0');

/**
 * Routes the public media review share-link API (`/api/portal/review/:token`)
 * for a client with no session (#417). Comments and decisions are kept in
 * the returned state so a spec can assert what the page sent.
 */
export async function mockPortalReviewApi(page: Page, { allowDecision = true } = {}) {
  const state = {
    annotations: reviewAnnotations.map(annotation => ({ ...annotation })),
    decisions: reviewDecisions.map(decision => ({ ...decision })),
    posted: [] as Array<Record<string, unknown>>,
    decided: false,
    unmocked: trackUnmocked(page),
  };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/auth/me') return json(route, { error: 'Unauthorized' }, 401);
    const base = `/api/portal/review/${portalReviewToken}`;
    if (pathname === `${base}/file`) return route.fulfill({ status: 200, contentType: 'image/png', body: reviewImagePng });
    if (pathname === base && method === 'GET') {
      return json(route, {
        session: { title: reviewSession.title, status: reviewSession.status, version: 1, media: { fileName: reviewAttachment.originalName, mimeType: 'image/png', size: reviewAttachment.size, kind: 'image' } },
        link: { expiresAt: NEXT_WEEK, allowDecision, canComment: true, decisionRecorded: state.decided, canDecide: allowDecision && !state.decided },
        annotations: state.annotations,
        decisions: state.decisions,
      });
    }
    if (pathname === `${base}/annotations` && method === 'POST') {
      const body = request.postDataJSON();
      state.posted.push(body);
      const annotation = { id: `annotation-new-${state.posted.length}`, parentId: body.parentId ?? null, authorType: 'guest', authorName: body.name, body: body.body, timecodeMs: body.timecodeMs ?? null, region: body.region ?? null, pageNumber: body.pageNumber ?? null, resolved: false, resolvedAt: null, createdAt: NOW };
      state.annotations.push(annotation);
      return json(route, { annotation }, 201);
    }
    if (pathname === `${base}/decisions` && method === 'POST') {
      const body = request.postDataJSON();
      state.posted.push(body);
      const decision = { id: `decision-new-${state.posted.length}`, decision: body.decision, actorType: 'guest', actorName: body.name, note: body.note ?? null, createdAt: NOW };
      state.decisions.unshift(decision);
      state.decided = true;
      return json(route, { decision, status: body.decision }, 201);
    }
    state.unmocked.push(`${method} ${pathname}`);
    return json(route, { error: `Unmocked endpoint in portal review fixture: ${method} ${pathname}` }, 501);
  });
  return state;
}
