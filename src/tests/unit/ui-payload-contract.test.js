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
const { default: estimateRoutes, computeEstimateTotals } = await import('../../routes/estimate.routes.js');
const { expenseListOrderBy } = await import('../../routes/expense.routes.js');

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
    const body = parses(schemas.expenseUpdateSchema, {
      ...created, clientId: 'client_1', projectId: null, receiptUrl: '/uploads/receipt-a.png',
    });
    assert.equal(body.clientId, 'client_1');
    assert.equal(body.projectId, null);
    assert.equal(body.receiptUrl, '/uploads/receipt-a.png');
    assert.equal(body.date, '2026-09-30T00:00:00.000Z');
  });

  it('rejects receipt links that are not an upload path or http(s)', () => {
    rejects(schemas.createExpenseSchema, { ...created, receiptUrl: 'javascript:alert(1)' });
    rejects(schemas.createExpenseSchema, { ...created, receiptUrl: '/uploads/../.env' });
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
  // The page's own totals (Estimates.jsx formSubtotal / formTax / formTotal).
  const formSubtotal = lineItems.reduce((sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.rate) || 0), 0);
  const formTax = parseFloat(((formSubtotal * 13) / 100).toFixed(2));
  const formTotal = parseFloat((formSubtotal + formTax).toFixed(2));

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

  it('stores the tax and total staff saw through POST and PUT /api/estimates', async (t) => {
    const rows = new Map();
    const prisma = {
      estimate: {
        create: async ({ data }) => { const row = { id: 'est_1', status: 'DRAFT', ...data }; rows.set(row.id, row); return row; },
        findUnique: async ({ where }) => rows.get(where.id) ?? null,
        update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; },
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
    assert.deepEqual([stored.tax, stored.total], [formTax, formTotal]);
    assert.equal(stored.validUntil.toISOString(), '2026-10-31T23:59:59.999Z');

    const update = await app.inject({
      method: 'PUT', url: '/api/estimates/est_1',
      payload: { clientId: 'client_1', title: 'Website estimate', taxRate: 5, validUntil: null, lineItems },
    });
    assert.equal(update.statusCode, 200, update.body);
    const fivePercent = parseFloat(((formSubtotal * 5) / 100).toFixed(2));
    assert.deepEqual([rows.get('est_1').tax, rows.get('est_1').total], [fivePercent, parseFloat((formSubtotal + fivePercent).toFixed(2))]);
    assert.equal(rows.get('est_1').validUntil, null);
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
