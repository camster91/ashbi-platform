// UI payload contract: the request bodies the staff SPA really sends must pass
// the Zod schema validateBody() runs before the handler, and must keep every
// field the handler reads (Zod's default strip drops unknown keys silently).
//
// Each payload below is copied from the web component that builds it (file
// named in the test). When a form changes shape, update the payload here and
// the schema together. A few checks also read the component source so that a
// new <option> value the schema does not know fails here, not in production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

const schemas = await import('../../validators/schemas.js');
const { default: estimateRoutes, computeEstimateTotals, estimateValidThrough } = await import('../../routes/estimate.routes.js');
const { expenseListOrderBy } = await import('../../routes/expense.routes.js');
const { default: timeSessionRoutes } = await import('../../routes/time-sessions.routes.js');
const { default: invoiceChaserRoutes, CHASE_ALL_LIMIT } = await import('../../routes/invoice-chaser.routes.js');
const { default: rateCardRoutes } = await import('../../routes/rate-card.routes.js');
const { default: responseRoutes } = await import('../../routes/response.routes.js');
const { default: assetLibraryRoutes } = await import('../../routes/asset-library.routes.js');
const { encodeAssetTags, serializeAsset } = await import('../../services/assetLibrary.service.js');
const { CONTRACT_TEMPLATE_TYPES } = await import('../../services/contractTemplates.service.js');
const { enterRequestContext } = await import('../../utils/request-context.js');
const formPayloads = await import('../../../web/src/lib/form-payloads.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const optionValues = (text) => [...text.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]).filter(Boolean);

function parses(schema, payload) {
  const result = schema.safeParse(payload);
  assert.ok(result.success, result.success ? '' : JSON.stringify(result.error.issues, null, 2));
  return result.data;
}

function rejects(schema, payload) {
  assert.equal(schema.safeParse(payload).success, false, `expected ${JSON.stringify(payload)} to be rejected`);
}

// A Fastify app whose authenticate hook gives the handler `prisma` both as
// request.prisma and through the request context (services and fastify.prisma
// read it from there in production).
async function appWith(t, routes, prefix, prisma, user = { id: 'user_1', organizationId: 'org_1', role: 'ADMIN' }) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  const authenticate = async (request) => {
    request.user = user;
    request.prisma = prisma;
    enterRequestContext({ prisma, organizationId: user.organizationId });
  };
  app.decorate('authenticate', authenticate);
  // Like src/index.js adminOnly: authenticated, then ADMIN only.
  app.decorate('adminOnly', async (request, reply) => {
    await authenticate(request);
    if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    return undefined;
  });
  await app.register(routes, { prefix });
  t.after(() => app.close());
  return app;
}

// What fetch sends: JSON drops undefined fields.
const wire = (payload) => JSON.parse(JSON.stringify(payload));

const sliceBetween = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} not found`);
  return text.slice(from, text.indexOf(end, from));
};

describe('Expenses page (web/src/pages/Expenses.jsx handleSubmit)', () => {
  const created = {
    description: 'Figma seat',
    amount: 24.5,
    currency: 'CAD',
    category: 'SOFTWARE',
    date: '2026-09-30',
    billable: false,
    notes: '',
    clientId: null,
    projectId: null,
    receiptUrl: null,
  };

  it('creates with a date-only value, null links and no receipt', () => {
    const body = parses(schemas.createExpenseSchema, created);
    assert.equal(body.date, '2026-09-30T00:00:00.000Z');
    for (const key of ['currency', 'billable', 'clientId', 'projectId', 'receiptUrl', 'notes']) {
      assert.ok(key in body, `${key} reaches the handler`);
    }
  });

  it('keeps currency, billable and the uploaded receipt on create', () => {
    const body = parses(schemas.createExpenseSchema, {
      ...created, currency: 'USD', billable: true, clientId: 'client_1', projectId: 'project_1',
      receiptUrl: '/uploads/receipt-3f1c7d2e-1b2a-4c3d-9e8f-0a1b2c3d4e5f.pdf',
    });
    assert.deepEqual(
      [body.currency, body.billable, body.clientId, body.projectId, body.receiptUrl],
      ['USD', true, 'client_1', 'project_1', '/uploads/receipt-3f1c7d2e-1b2a-4c3d-9e8f-0a1b2c3d4e5f.pdf'],
    );
  });

  it('updates with links, a receipt and a date-only value', () => {
    const receiptUrl = '/uploads/receipt-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png';
    const body = parses(schemas.expenseUpdateSchema, { ...created, clientId: 'client_1', projectId: null, receiptUrl });
    assert.equal(body.clientId, 'client_1');
    assert.equal(body.projectId, null);
    assert.equal(body.receiptUrl, receiptUrl);
    assert.equal(body.date, '2026-09-30T00:00:00.000Z');
    assert.equal(parses(schemas.expenseUpdateSchema, { receiptUrl: '' }).receiptUrl, '');
  });

  it('accepts only the receipt path the upload route returns', () => {
    for (const receiptUrl of [
      'javascript:alert(1)', '/uploads/../.env', '/uploads/receipt-a.png', '/uploads/brand/logo-1.png',
      'https://example.com/receipt.pdf', '/uploads/receipt-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png/../x',
    ]) {
      rejects(schemas.createExpenseSchema, { ...created, receiptUrl });
    }
    rejects(schemas.createExpenseSchema, { ...created, date: '2026-02-30' });
  });

  it('offers only currencies the schema accepts', () => {
    const page = source('web/src/pages/Expenses.jsx');
    const currencySelect = page.slice(page.indexOf('aria-label="Currency"'), page.indexOf('</select>', page.indexOf('aria-label="Currency"')));
    const offered = optionValues(currencySelect);
    assert.ok(offered.length > 0);
    for (const currency of offered) assert.ok(schemas.EXPENSE_CURRENCIES.includes(currency), currency);
  });

  it('allowlists the list sort field and order', () => {
    assert.deepEqual(expenseListOrderBy(undefined, undefined), { date: 'desc' });
    assert.deepEqual(expenseListOrderBy('amount', 'asc'), { amount: 'asc' });
    assert.deepEqual(expenseListOrderBy('client', 'asc'), { date: 'asc' });
    assert.deepEqual(expenseListOrderBy('__proto__', 'sideways'), { date: 'desc' });
    assert.deepEqual(expenseListOrderBy(['date', 'amount'], ['asc']), { date: 'desc' });
  });
});

describe('Create project modal (web/src/components/CreateProjectModal.jsx)', () => {
  it('accepts no default owner (null)', () => {
    const body = parses(schemas.createProjectSchema, {
      name: 'Website refresh', description: '', clientId: 'client_1', defaultOwnerId: null,
    });
    assert.equal(body.defaultOwnerId, null);
    parses(schemas.createProjectSchema, { name: 'Website refresh', description: '', clientId: 'client_1', defaultOwnerId: 'user_1' });
  });
});

describe('Create team member modal (web/src/components/CreateTeamMemberModal.jsx)', () => {
  const member = { email: 'new@ashbi.test', name: 'New Person', password: 'correct-horse-battery', role: 'TEAM', skills: ['design'], capacity: 100 };

  it('accepts the default TEAM role and ADMIN', () => {
    assert.equal(parses(schemas.teamInviteSchema, member).role, 'TEAM');
    assert.equal(parses(schemas.teamInviteSchema, { ...member, role: 'ADMIN' }).role, 'ADMIN');
    const { role: _omitted, ...withoutRole } = member;
    assert.equal(parses(schemas.teamInviteSchema, withoutRole).role, 'TEAM');
  });

  it('never creates or promotes to client-portal or legacy roles', () => {
    for (const role of ['CLIENT', 'BOT', 'STAFF']) {
      rejects(schemas.teamInviteSchema, { ...member, role });
      rejects(schemas.teamUpdateSchema, { role });
    }
  });

  it('offers only roles the schema accepts', () => {
    const offered = optionValues(source('web/src/components/CreateTeamMemberModal.jsx'));
    assert.ok(offered.includes('TEAM'));
    for (const role of offered) assert.ok(schemas.TEAM_MEMBER_ROLES.includes(role), role);
  });
});

describe('Brand settings page (web/src/pages/BrandSettings.jsx handleSave)', () => {
  const saved = {
    companyName: 'Ashbi Design',
    primaryColor: '#c9a84c',
    accentColor: '#1e293b',
    address: null,
    phone: '',
    email: 'hello@ashbi.test',
    website: 'ashbi.ca',
    taxId: '123456789RT0001',
    invoiceFooter: 'Thank you!',
    proposalFooter: null,
    contractHeader: null,
  };

  it('keeps every column the handler writes', () => {
    const body = parses(schemas.brandSettingsSchema, saved);
    for (const key of Object.keys(saved)) assert.ok(key in body, `${key} reaches the handler`);
  });

  it('drops a logoUrl (set only by the upload route) and ids from older clients', () => {
    const body = parses(schemas.brandSettingsSchema, {
      ...saved, id: 'brand_1', organizationId: 'org_1', logoUrl: '/uploads/brand/logo-1.png',
    });
    assert.equal('logoUrl' in body, false);
    assert.equal('organizationId' in body, false);
    parses(schemas.brandSettingsSchema, { ...saved, logoUrl: null });
  });

  it('keeps the stored color for an emptied color field and rejects non-hex', () => {
    const body = parses(schemas.brandSettingsSchema, { ...saved, primaryColor: '' });
    assert.equal(body.primaryColor, undefined);
    rejects(schemas.brandSettingsSchema, { ...saved, accentColor: 'red;}body{display:none' });
    rejects(schemas.brandSettingsSchema, { ...saved, email: 'not-an-email' });
  });

  it('sends exactly the schema fields', () => {
    const page = source('web/src/pages/BrandSettings.jsx');
    const list = page.slice(page.indexOf('const BRAND_EDITABLE_FIELDS'), page.indexOf('];', page.indexOf('const BRAND_EDITABLE_FIELDS')));
    const fields = [...list.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
    assert.deepEqual([...fields].sort(), Object.keys(schemas.brandSettingsSchema.shape).sort());
  });
});

describe('Milestones (web/src/components/Milestones.jsx MilestoneModal)', () => {
  const created = { name: 'Design sign-off', description: '', dueDate: '2026-10-15', status: 'PENDING', color: '#3B82F6' };

  it('creates with a date-only due date', () => {
    assert.equal(parses(schemas.milestoneCreateSchema, created).dueDate, '2026-10-15T00:00:00.000Z');
    rejects(schemas.milestoneCreateSchema, { ...created, dueDate: '' });
  });

  it('updates with the statuses the modal offers', () => {
    const offered = optionValues(source('web/src/components/Milestones.jsx'));
    assert.deepEqual([...offered].sort(), [...schemas.MILESTONE_STATUS_VALUES].sort());
    for (const status of offered) assert.equal(parses(schemas.milestoneUpdateSchema, { ...created, status }).status, status);
    const cleared = parses(schemas.milestoneUpdateSchema, { ...created, dueDate: '' });
    assert.equal(cleared.dueDate, undefined);
  });
});

describe('Schedule page (web/src/pages/Schedule.jsx EventModal handleSubmit)', () => {
  const event = {
    title: 'Kickoff call',
    description: '',
    type: 'CALL',
    location: '',
    projectId: null,
    isAllDay: false,
    attendeeIds: ['user_1', 'user_2'],
    startTime: '2026-10-02T14:00:00.000Z',
    endTime: '2026-10-02T15:00:00.000Z',
  };

  it('creates and updates with the page types, no project and attendees', () => {
    const page = source('web/src/pages/Schedule.jsx');
    const offered = [...page.slice(page.indexOf('const EVENT_TYPES'), page.indexOf('];', page.indexOf('const EVENT_TYPES')))
      .matchAll(/value: '([A-Z_]+)'/g)].map((match) => match[1]);
    assert.ok(offered.length >= 4);
    for (const type of offered) {
      const body = parses(schemas.calendarEventCreateSchema, { ...event, type });
      assert.equal(body.type, type);
      assert.deepEqual(body.attendeeIds, ['user_1', 'user_2']);
      parses(schemas.calendarEventUpdateSchema, { ...event, type });
    }
  });

  it('treats an empty project as none and accepts the allDay alias', () => {
    const body = parses(schemas.calendarEventCreateSchema, { ...event, projectId: '', isAllDay: undefined, allDay: true });
    assert.equal(body.projectId, null);
    assert.equal(body.isAllDay, true);
    rejects(schemas.calendarEventCreateSchema, { ...event, endTime: '2026-10-02T13:00:00.000Z' });
  });
});

describe('Estimates page (web/src/pages/Estimates.jsx handleCreate/handleUpdate)', () => {
  const lineItems = [
    { description: 'Discovery', quantity: 3, rate: 125 },
    { description: 'Design', quantity: 7.5, rate: 110.33 },
  ];
  const created = {
    clientId: 'client_1', title: 'Website estimate', description: undefined, taxRate: 13, validUntil: '2026-10-31', lineItems,
  };
  // The page's own totals (Estimates.jsx lineAmount / estimateTotals): each
  // line rounded to cents, the subtotal the sum of those lines.
  const round2 = (value) => parseFloat((Number(value) || 0).toFixed(2));
  const formSubtotal = round2(lineItems.reduce((sum, li) => sum + round2((parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0)), 0));
  const formTax = round2((formSubtotal * 13) / 100);
  const formTotal = round2(formSubtotal + formTax);

  it('keeps taxRate and accepts a date-only validUntil', () => {
    const body = parses(schemas.createEstimateSchema, created);
    assert.equal(body.taxRate, 13);
    assert.equal(body.validUntil, '2026-10-31T23:59:59.999Z');
    const update = parses(schemas.updateEstimateSchema, { title: 'Website estimate', taxRate: 5, validUntil: null, lineItems });
    assert.equal(update.taxRate, 5);
    assert.equal(update.validUntil, null);
    rejects(schemas.createEstimateSchema, { ...created, tax: 10 });
  });

  it('computes the same tax and total the page shows', () => {
    const totals = computeEstimateTotals(lineItems, { taxRate: 13 });
    assert.equal(totals.tax, formTax);
    assert.equal(totals.total, formTotal);
    assert.equal(computeEstimateTotals(lineItems, { tax: 10 }).tax, 10);
  });

  it('makes the subtotal the sum of the rounded line amounts', () => {
    // 1.5 x 10.01 = 15.015 per line: each line shows and stores 15.02, so
    // the subtotal is 30.04 (rounding the raw 30.03 would disagree).
    const items = [{ description: 'A', quantity: 1.5, rate: 10.01 }, { description: 'B', quantity: 1.5, rate: 10.01 }];
    const totals = computeEstimateTotals(items, { taxRate: 13 });
    assert.equal(totals.subtotal, 30.04);
    assert.equal(totals.tax, 3.91);
    assert.equal(totals.total, 33.95);
  });

  it('keeps a date-only validUntil answerable until the day ends in UTC-12', () => {
    assert.equal(estimateValidThrough('2026-10-31T23:59:59.999Z').toISOString(), '2026-11-01T11:59:59.999Z');
    assert.equal(estimateValidThrough('2026-10-31T17:00:00.000Z').toISOString(), '2026-10-31T17:00:00.000Z');
    assert.equal(estimateValidThrough(null), null);
  });

  it('stores the tax and total staff saw through POST and PUT /api/estimates', async (t) => {
    const rows = new Map();
    const prisma = {
      estimate: {
        create: async ({ data }) => { const row = { id: 'est_1', status: 'DRAFT', ...data }; rows.set(row.id, row); return row; },
        findUnique: async ({ where }) => rows.get(where.id) ?? null,
        updateMany: async ({ where, data }) => {
          const row = rows.get(where.id);
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          rows.set(where.id, { ...row, ...data });
          return { count: 1 };
        },
      },
    };
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = { id: 'user_1', organizationId: 'org_1', role: 'ADMIN' };
      request.prisma = prisma;
    });
    await app.register(estimateRoutes, { prefix: '/api/estimates' });
    t.after(() => app.close());

    const create = await app.inject({ method: 'POST', url: '/api/estimates', payload: created });
    assert.equal(create.statusCode, 201, create.body);
    const stored = rows.get('est_1');
    assert.deepEqual([stored.tax, stored.taxRate, stored.total], [formTax, 13, formTotal]);
    assert.equal(stored.validUntil.toISOString(), '2026-10-31T23:59:59.999Z');

    const update = await app.inject({
      method: 'PUT', url: '/api/estimates/est_1',
      payload: { clientId: 'client_1', title: 'Website estimate', taxRate: 5, validUntil: null, lineItems },
    });
    assert.equal(update.statusCode, 200, update.body);
    const fivePercent = round2((formSubtotal * 5) / 100);
    assert.deepEqual([rows.get('est_1').tax, rows.get('est_1').total], [fivePercent, round2(formSubtotal + fivePercent)]);
    assert.equal(rows.get('est_1').taxRate, 5, 'the rate staff entered is stored and returned');
    assert.equal(update.json().taxRate, 5);
    assert.equal(rows.get('est_1').validUntil, null);

    // Editing only the lines re-applies the stored rate.
    const linesOnly = await app.inject({ method: 'PUT', url: '/api/estimates/est_1', payload: { lineItems: [{ description: 'One', quantity: 3.33, rate: 1 }] } });
    assert.equal(linesOnly.statusCode, 200, linesOnly.body);
    assert.deepEqual([rows.get('est_1').subtotal, rows.get('est_1').tax, rows.get('est_1').taxRate], [3.33, 0.17, 5]);

    // An estimate sent between the read and the write is not edited.
    rows.set('est_1', { ...rows.get('est_1'), status: 'SENT' });
    const late = await app.inject({ method: 'PUT', url: '/api/estimates/est_1', payload: { title: 'Too late' } });
    assert.equal(late.statusCode, 400, late.body);
    assert.equal(rows.get('est_1').title, 'Website estimate');
  });
});

describe('Clients (web/src/components/CreateClientModal.jsx and PUT /api/clients/:id)', () => {
  it('accepts every status the create modal offers', () => {
    const offered = optionValues(source('web/src/components/CreateClientModal.jsx'));
    assert.ok(offered.includes('PAUSED') && offered.includes('CHURNED'));
    for (const status of offered) {
      assert.equal(parses(schemas.createClientSchema, { name: 'Acme', domain: '', status }).status, status);
    }
  });

  it('keeps the fields the update handler writes, including portal-revoking state', () => {
    const payload = {
      status: 'PAUSED', relationshipStatus: 'ARCHIVED', tier: 'T1', phone: '+1 555 0100', notes: 'Prefers email',
      clientNotes: 'Net 30', address: '1 Main St', city: 'Toronto', country: 'CA', contactPerson: 'Sam',
      serviceType: 'Retainer', communicationPrefs: { tone: 'casual' }, knowledgeBase: [],
    };
    const body = parses(schemas.updateClientSchema, payload);
    for (const key of Object.keys(payload)) assert.ok(key in body, `${key} reaches the handler`);
    rejects(schemas.updateClientSchema, { relationshipStatus: 'GONE' });
  });
});

describe('Header timer (web/src/components/LiveTimer.jsx handleStart)', () => {
  it('starts with the project chosen in the picker', () => {
    const body = parses(schemas.timeSessionStartSchema, { projectId: 'project_1', description: undefined });
    assert.equal(body.projectId, 'project_1');
    const page = source('web/src/components/LiveTimer.jsx');
    assert.match(page, /startMutation\.mutate\(\{ projectId, description:/);
  });

  it('answers 400 without a project, 404 for a project outside the organization, 201 otherwise', async (t) => {
    const sessions = [];
    const prisma = {
      project: { findFirst: async ({ where }) => (where.id === 'project_1' && where.deletedAt === null ? { id: 'project_1' } : null) },
      timeSession: {
        findMany: async () => [],
        create: async ({ data }) => { const row = { id: `s${sessions.length + 1}`, ...data }; sessions.push(row); return row; },
      },
    };
    prisma.$transaction = async (fn) => fn(prisma);
    const app = await appWith(t, timeSessionRoutes, '/api/time-sessions', prisma);

    const noProject = await app.inject({ method: 'POST', url: '/api/time-sessions', payload: { description: 'Header timer' } });
    assert.equal(noProject.statusCode, 400, noProject.body);
    assert.match(noProject.json().error, /projectId/);

    const foreign = await app.inject({ method: 'POST', url: '/api/time-sessions', payload: { projectId: 'project_other' } });
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal(sessions.length, 0, 'no session is started for an unknown project');

    const started = await app.inject({ method: 'POST', url: '/api/time-sessions', payload: { projectId: 'project_1' } });
    assert.equal(started.statusCode, 201, started.body);
    assert.equal(sessions[0].projectId, 'project_1');
    assert.equal(sessions[0].isRunning, true);
  });
});

describe('Retainers page (web/src/pages/Retainers.jsx)', () => {
  // createForm as the page initialises it, then as staff fill it in.
  const blankForm = { clientId: 'client_1', tier: 'custom', hoursPerMonth: 20, monthlyAmountUsd: '', monthlyAmountCad: '' };

  it('creates with the default custom tier, number inputs coerced and empty amounts omitted', () => {
    const body = parses(schemas.createRetainerSchema, wire(formPayloads.buildRetainerCreatePayload(blankForm)));
    assert.deepEqual(body, { clientId: 'client_1', tier: 'custom', hoursPerMonth: 20 });
    const typed = parses(schemas.createRetainerSchema, formPayloads.buildRetainerCreatePayload({
      ...blankForm, hoursPerMonth: '40', monthlyAmountUsd: '2000', monthlyAmountCad: '2700.50',
    }));
    assert.deepEqual([typed.hoursPerMonth, typed.monthlyAmountUsd, typed.monthlyAmountCad], [40, 2000, 2700.5]);
    rejects(schemas.createRetainerSchema, formPayloads.buildRetainerCreatePayload({ ...blankForm, hoursPerMonth: '' }));
  });

  it('accepts every tier that is stored or offered', () => {
    for (const tier of ['999', '1999', '3999', 'custom']) {
      assert.equal(parses(schemas.createRetainerSchema, { clientId: 'client_1', tier, hoursPerMonth: 20 }).tier, tier);
      assert.equal(parses(schemas.updateRetainerSchema, { tier }).tier, tier);
    }
    rejects(schemas.updateRetainerSchema, { tier: 'gold' });
  });

  it('edits without resending the tier and clears an emptied amount', () => {
    // handleEdit: amounts fall back to '' when the plan has none.
    const plan = { tier: '1999', hoursPerMonth: 40, monthlyAmountUsd: 1999, monthlyAmountCad: null };
    const toEditForm = (p) => ({ hoursPerMonth: p.hoursPerMonth, monthlyAmountUsd: p.monthlyAmountUsd ?? '', monthlyAmountCad: p.monthlyAmountCad ?? '' });
    assert.match(source('web/src/pages/Retainers.jsx'), /monthlyAmountUsd: plan\.monthlyAmountUsd \?\? '',\s*monthlyAmountCad: plan\.monthlyAmountCad \?\? '',/);
    const editForm = toEditForm(plan);
    const body = parses(schemas.updateRetainerSchema, formPayloads.buildRetainerUpdatePayload(editForm));
    assert.deepEqual(body, { hoursPerMonth: 40, monthlyAmountUsd: 1999, monthlyAmountCad: null });
    // A stored 0 round-trips as 0, not as a cleared amount.
    const zero = parses(schemas.updateRetainerSchema, formPayloads.buildRetainerUpdatePayload(toEditForm({ ...plan, monthlyAmountUsd: 0, monthlyAmountCad: 0 })));
    assert.deepEqual([zero.monthlyAmountUsd, zero.monthlyAmountCad], [0, 0]);
    assert.equal(parses(schemas.updateRetainerSchema, formPayloads.buildRetainerUpdatePayload({ ...editForm, monthlyAmountUsd: '0' })).monthlyAmountUsd, 0);
    const typed = parses(schemas.updateRetainerSchema, formPayloads.buildRetainerUpdatePayload({ ...editForm, hoursPerMonth: '30', monthlyAmountUsd: '2500' }));
    assert.deepEqual([typed.hoursPerMonth, typed.monthlyAmountUsd], [30, 2500]);
  });

  it('logs hours entered as text', () => {
    const body = parses(schemas.logRetainerHoursSchema, wire(formPayloads.buildRetainerLogHoursPayload({ hours: '1.5', description: '' })));
    assert.deepEqual(body, { hours: 1.5 });
    rejects(schemas.logRetainerHoursSchema, formPayloads.buildRetainerLogHoursPayload({ hours: '', description: 'x' }));
  });

  it('builds every request through the payload helpers', () => {
    const page = source('web/src/pages/Retainers.jsx');
    assert.match(page, /createMutation\.mutate\(buildRetainerCreatePayload\(createForm\)\)/);
    assert.match(page, /data: buildRetainerUpdatePayload\(editForm\)/);
    assert.match(page, /data: buildRetainerLogHoursPayload\(logForm\)/);
    assert.ok(schemas.RETAINER_TIER_VALUES.includes('custom'));
  });
});

describe('Project page (web/src/pages/Project.jsx)', () => {
  it('opens a revision round without notes', () => {
    assert.deepEqual(parses(schemas.revisionCreateNewSchema, {}), {});
    assert.equal(parses(schemas.revisionCreateNewSchema, { notes: ' Logo tweaks ' }).notes, 'Logo tweaks');
    assert.match(source('web/src/pages/Project.jsx'), /createRevisionMutation\.mutate\(\{\}\)/);
  });

  it('pastes a message from every offered source', () => {
    const page = source('web/src/pages/Project.jsx');
    const offered = optionValues(sliceBetween(page, 'id="paste-message-source"', '</select>'));
    assert.deepEqual([...offered].sort(), [...schemas.MESSAGE_PASTE_SOURCES].sort());
    for (const pasteSource of offered) {
      const body = parses(schemas.messagePasteSchema, { content: 'Can we move the launch?', source: pasteSource, projectId: 'project_1' });
      assert.deepEqual(body, { content: 'Can we move the launch?', source: pasteSource, projectId: 'project_1' });
    }
    rejects(schemas.messagePasteSchema, { content: '   ', source: 'email', projectId: 'project_1' });
    rejects(schemas.messagePasteSchema, { content: 'x', source: 'fax', projectId: 'project_1' });
  });

  it('drafts a client update with the notes and the revision toggle', () => {
    // api.draftProjectUpdate(id, data) sends { projectId, ...data }.
    const body = parses(schemas.aiDraftUpdateSchema, { projectId: 'project_1', rawNotes: 'Homepage done', includeRevisionStatus: true });
    assert.deepEqual(body, { projectId: 'project_1', rawNotes: 'Homepage done', includeRevisionStatus: true });
    rejects(schemas.aiDraftUpdateSchema, { projectId: 'project_1', rawNotes: '', includeRevisionStatus: false });
    assert.match(source('web/src/pages/Project.jsx'), /draftUpdateMutation\.mutate\(\{ rawNotes: draftNotes, includeRevisionStatus: includeRevisions \}\)/);
  });
});

describe('Thread response (web/src/pages/Thread.jsx submitMutation)', () => {
  it('submits a response with the thread only in the URL', async (t) => {
    const payload = { subject: 'Re: Launch date', body: 'We can launch Friday.', tone: 'professional' };
    parses(schemas.responseCreateSchema, payload);
    const created = [];
    const prisma = {
      thread: { findFirst: async ({ where }) => (where.id === 'thread_1' ? { id: 'thread_1' } : null) },
      response: { create: async ({ data }) => { created.push(data); return { id: 'resp_1', ...data }; } },
    };
    const app = await appWith(t, responseRoutes, '/api/responses', prisma);

    const ok = await app.inject({ method: 'POST', url: '/api/responses/thread_1/drafts', payload });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(created[0].threadId, 'thread_1');
    assert.equal(created[0].status, 'DRAFT');

    const foreign = await app.inject({ method: 'POST', url: '/api/responses/thread_other/drafts', payload });
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal(created.length, 1);
  });
});

describe('Credentials page (web/src/pages/Credentials.jsx handleSubmit)', () => {
  const form = { label: 'WP Admin', username: '', password: 'placeholder-value', url: '', notes: '', category: 'WP_ADMIN', clientId: 'client_1', projectId: '' };

  it('creates without empty username and URL', () => {
    const body = parses(schemas.credentialCreateSchema, wire(formPayloads.buildCredentialPayload(form)));
    assert.equal('username' in body, false);
    assert.equal('url' in body, false);
    assert.equal(body.clientId, 'client_1');
    const full = parses(schemas.credentialCreateSchema, formPayloads.buildCredentialPayload({ ...form, username: 'admin', url: 'https://example.com/wp-admin' }));
    assert.deepEqual([full.username, full.url], ['admin', 'https://example.com/wp-admin']);
  });

  it('keeps the client-or-project rule; the page asks for a client first', () => {
    rejects(schemas.credentialCreateSchema, formPayloads.buildCredentialPayload({ ...form, clientId: '' }));
    const page = source('web/src/pages/Credentials.jsx');
    assert.match(page, /if \(!form\.clientId && !form\.projectId\) \{\s*setFormError\('Choose the client this credential belongs to\.'\)/);
  });

  it('clears an emptied username or URL on edit', () => {
    const body = parses(schemas.credentialUpdateSchema, formPayloads.buildCredentialPayload(form, { editing: true }));
    assert.equal(body.username, null);
    assert.equal(body.url, null);
    assert.equal(body.notes, '');
  });

  it('masks the password, not the label', () => {
    const page = source('web/src/pages/Credentials.jsx');
    assert.match(sliceBetween(page, 'Label *</label>', '/>'), /type="text"/);
    assert.match(sliceBetween(page, 'Password *</label>', '/>'), /type="password"/);
  });
});

describe('Asset Library (web/src/pages/AssetLibrary.jsx handleCreate)', () => {
  const newAsset = { name: 'Primary logo', type: 'IMAGE', category: 'logo', url: 'https://cdn.example.com/logo.svg', description: 'Full-colour mark' };

  it('sends the API type values and keeps client, category and description', () => {
    const page = source('web/src/pages/AssetLibrary.jsx');
    const offered = [...sliceBetween(page, 'const ASSET_TYPES', '];').matchAll(/value: '([A-Z_]+)'/g)].map((m) => m[1]);
    assert.ok(offered.length >= 5);
    const categories = [...sliceBetween(page, 'const CATEGORIES', '];').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(categories, schemas.ASSET_CATEGORIES);
    for (const type of offered) {
      const body = parses(schemas.assetCreateSchema, formPayloads.buildAssetCreatePayload({ ...newAsset, type }, ' client_1 '));
      assert.deepEqual(body, { ...newAsset, type, clientId: 'client_1' });
    }
    rejects(schemas.assetCreateSchema, { ...newAsset, type: 'image', clientId: 'client_1' });
    rejects(schemas.assetCreateSchema, { ...newAsset });
    assert.equal('clientId' in parses(schemas.assetUpdateSchema, { clientId: 'client_2', name: 'x' }), false);
    assert.deepEqual(parses(schemas.assetCreateSchema, { ...newAsset, clientId: 'client_1', tags: ['brand'] }).tags, ['brand']);
    for (const tag of ['category:photo', 'Category:logo']) {
      rejects(schemas.assetCreateSchema, { ...newAsset, clientId: 'client_1', tags: [tag] });
      rejects(schemas.assetUpdateSchema, { tags: ['brand', tag] });
    }
  });

  it('stores the category as a tag and the description as alt text', () => {
    const stored = encodeAssetTags(['brand'], 'logo');
    assert.deepEqual(JSON.parse(stored), ['category:logo', 'brand']);
    const asset = serializeAsset({ id: 'a1', tags: stored, altText: 'Full-colour mark' });
    assert.deepEqual([asset.tags, asset.category, asset.description], [['brand'], 'logo', 'Full-colour mark']);
    assert.deepEqual(serializeAsset({ id: 'a2', tags: 'not json', altText: null }).tags, []);
  });

  it('creates only for a client in the organization', async (t) => {
    const rows = [];
    const prisma = {
      client: { findFirst: async ({ where }) => (where.id === 'client_1' ? { id: 'client_1' } : null) },
      asset: { create: async ({ data }) => { const row = { id: 'asset_1', ...data }; rows.push(row); return row; } },
    };
    const app = await appWith(t, assetLibraryRoutes, '/api/assets', prisma);
    const payload = formPayloads.buildAssetCreatePayload(newAsset, 'client_1');

    const foreign = await app.inject({ method: 'POST', url: '/api/assets', payload: { ...payload, clientId: 'client_other' } });
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal(rows.length, 0);

    const created = await app.inject({ method: 'POST', url: '/api/assets', payload });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual([rows[0].clientId, rows[0].type, rows[0].altText, rows[0].tags], ['client_1', 'IMAGE', 'Full-colour mark', '["category:logo"]']);
    assert.deepEqual([created.json().category, created.json().description], ['logo', 'Full-colour mark']);
  });
});

describe('Rate cards (web/src/pages/RateCards.jsx handleSubmit)', () => {
  // A card is scoped to the organization only through its client, so the
  // modal requires one and the API refuses null (the database-backed proof is
  // src/tests/integration/rate-card-tenancy.database.test.js).
  const card = {
    name: 'Standard rates',
    clientId: 'client_1',
    isDefault: false,
    rates: [{ serviceName: 'Design', unit: 'hour', rate: 120, description: '' }],
  };

  it('creates and updates with the chosen client, never null', () => {
    assert.equal(parses(schemas.rateCardSchema, card).clientId, 'client_1');
    assert.equal(parses(schemas.rateCardSchema.partial(), card).clientId, 'client_1');
    rejects(schemas.rateCardSchema, { ...card, clientId: null });
    const { clientId: _omitted, ...withoutClient } = card;
    rejects(schemas.rateCardSchema, withoutClient);
    rejects(schemas.rateCardSchema.partial(), { clientId: null });
    assert.equal('clientId' in parses(schemas.rateCardSchema.partial(), withoutClient), false);
  });

  it('offers no client-less option', () => {
    const page = source('web/src/pages/RateCards.jsx');
    const select = sliceBetween(page, 'id="rate-card-client"', '</select>');
    assert.match(select, /<option value="" disabled>Select a client<\/option>/);
    assert.match(select, /\brequired\b/);
    assert.doesNotMatch(page, /clientId: clientId \|\| null/);
  });

  it('PUT keeps the client when it is omitted and refuses null', async (t) => {
    const rows = new Map([['rc_1', { id: 'rc_1', name: 'Acme rates', clientId: 'client_1', rates: [], isDefault: false }]]);
    const prisma = {
      rateCard: {
        findUnique: async ({ where }) => rows.get(where.id) ?? null,
        updateMany: async () => ({ count: 0 }),
        update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; },
      },
    };
    const app = await appWith(t, rateCardRoutes, '/api/rate-cards', prisma);
    const cleared = await app.inject({ method: 'PUT', url: '/api/rate-cards/rc_1', payload: { ...card, clientId: null } });
    assert.equal(cleared.statusCode, 400, cleared.body);
    assert.equal(rows.get('rc_1').clientId, 'client_1');

    const renamed = await app.inject({ method: 'PUT', url: '/api/rate-cards/rc_1', payload: { name: 'Renamed' } });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.deepEqual([rows.get('rc_1').name, rows.get('rc_1').clientId], ['Renamed', 'client_1']);
  });
});

describe('Invoice Chaser (web/src/pages/InvoiceChaser.jsx)', () => {
  it('generates all with {} and one with an invoiceId', () => {
    assert.deepEqual(parses(schemas.invoiceChaserSchema, {}), {});
    assert.equal(parses(schemas.invoiceChaserSchema, { invoiceId: 'inv_1' }).invoiceId, 'inv_1');
    assert.match(source('web/src/pages/InvoiceChaser.jsx'), /chaseMutation\.mutate\(\{\}\)/);
  });

  it('chases the 20 longest-overdue invoices when no invoiceId is sent', async (t) => {
    const queries = [];
    const prisma = { invoice: { findMany: async (args) => { queries.push(args); return []; } } };
    const app = await appWith(t, invoiceChaserRoutes, '/api/invoice-chaser', prisma);
    const res = await app.inject({ method: 'POST', url: '/api/invoice-chaser/chase', payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { message: 'No overdue invoices found', reminders: [] });
    assert.equal('id' in queries[0].where, false);
    assert.ok(queries[0].where.dueDate.lt instanceof Date);
    assert.equal(queries[0].take, CHASE_ALL_LIMIT);
    assert.equal(CHASE_ALL_LIMIT, 20);
    assert.deepEqual(queries[0].orderBy, { dueDate: 'asc' });

    // One named invoice: no date filter and no cap.
    await app.inject({ method: 'POST', url: '/api/invoice-chaser/chase', payload: { invoiceId: 'inv_1' } });
    assert.equal(queries[1].where.id, 'inv_1');
    assert.equal('take' in queries[1], false);
  });

  it('is admin-only, like the page (AdminRoute)', async (t) => {
    const queries = [];
    const prisma = { invoice: { findMany: async (args) => { queries.push(args); return []; } } };
    const app = await appWith(t, invoiceChaserRoutes, '/api/invoice-chaser', prisma, { id: 'user_2', organizationId: 'org_1', role: 'TEAM' });
    const chase = await app.inject({ method: 'POST', url: '/api/invoice-chaser/chase', payload: {} });
    assert.equal(chase.statusCode, 403, chase.body);
    const overdue = await app.inject({ method: 'GET', url: '/api/invoice-chaser/overdue' });
    assert.equal(overdue.statusCode, 403, overdue.body);
    assert.equal(queries.length, 0);
    assert.match(source('web/src/App.jsx'), /path="\/invoice-chaser" element=\{<AdminRoute><InvoiceChaser \/><\/AdminRoute>\}/);
  });
});

describe('Contracts page (web/src/pages/Contracts.jsx)', () => {
  it('creates from every offered template, including the Mutual NDA', () => {
    const page = source('web/src/pages/Contracts.jsx');
    const offered = [...sliceBetween(page, 'const templateTypes', '];').matchAll(/value: '([A-Z_]+)'/g)].map((m) => m[1]);
    assert.ok(offered.includes('NDA'));
    assert.deepEqual([...offered].sort(), [...CONTRACT_TEMPLATE_TYPES].sort());
    for (const templateType of offered) {
      assert.equal(parses(schemas.createContractSchema, { clientId: 'client_1', title: 'Agreement', templateType }).templateType, templateType);
    }
    rejects(schemas.createContractSchema, { clientId: 'client_1', title: 'Agreement', templateType: 'HOURLY' });
  });

  it('refines with the single message /api/ai/chat expects', () => {
    const payload = formPayloads.buildContractRefineChatPayload('Make it shorter', '<h1>Retainer Service Agreement</h1>');
    const body = parses(schemas.aiChatSchema, payload);
    assert.match(body.message, /Make it shorter/);
    assert.equal(formPayloads.buildContractRefineChatPayload('x', 'y'.repeat(formPayloads.AI_CHAT_MESSAGE_MAX_LENGTH)), null);
    assert.doesNotMatch(source('web/src/pages/Contracts.jsx'), /messages: \[/);
  });
});

describe('Public booking (web/src/pages/PortalBooking.jsx handleSubmit)', () => {
  it('sends the topic as notes', () => {
    const body = parses(schemas.bookingSchema, { date: '2026-10-05', time: '10:00', name: 'Sam', email: 'sam@example.com', notes: 'Website refresh' });
    assert.equal(body.notes, 'Website refresh');
    parses(schemas.bookingSchema, { date: '2026-10-05', time: '10:00', name: 'Sam', email: 'sam@example.com', notes: undefined });
    const page = source('web/src/pages/PortalBooking.jsx');
    assert.match(page, /notes: topic\.trim\(\) \|\| undefined/);
    assert.doesNotMatch(page, /\btopic: topic/);
  });

  it('selects slots by the HH:MM time the availability route returns', () => {
    assert.match(source('src/routes/portal.routes.js'), /time: `\$\{String\(hour\)\.padStart\(2, '0'\)\}:00`/);
    assert.match(source('web/src/pages/PortalBooking.jsx'), /slot\.time/);
  });
});
