// Issue #531: client-facing output (emails, PDFs, contracts, proposals) is
// branded with the sending organization's own name, never one agency's.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

// email.service reads MAILGUN_* at module load; fetch is stubbed so nothing
// reaches Mailgun.
process.env.MAILGUN_API_KEY = 'test-only-mailgun-key';
process.env.MAILGUN_DOMAIN = 'mg.example.test';
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), body: new URLSearchParams(init.body) });
  return new Response(JSON.stringify({ id: '<msg-1@mg.example.test>' }), { status: 200 });
};
after(() => { globalThis.fetch = originalFetch; });

const {
  LEGACY_DEFAULT_COMPANY_NAME, PRODUCT_NAME, brandSlug, brandedPdfFilename, brandedSender, formatFromHeader,
  publicBrand, resolveBranding, resolveBrandingForDocument, systemSender,
} = await import('../../services/branding.service.js');
const { getOrCreateBrandSettings } = await import('../../services/brand-settings.service.js');
const { sendInvoiceDeliveryEmail, sendContractSignEmail, loadTemplate, brandEmailVariables } = await import('../../services/email.service.js');
const { renderTemplate } = await import('../../services/contractTemplates.service.js');
const { generateInvoicePdf } = await import('../../utils/generate-invoice-pdf.js');
const { generateContractPdf } = await import('../../utils/generate-contract-pdf.js');
const { buildProposalHtml, generateProposal } = await import('../../agents/proposal-builder.agent.js');
const { buildFallbackProposalHtml } = await import('../../routes/proposal-builder.routes.js');

const LEGACY = /Ashbi Design|ASHBI|ashbi\.ca|cameron@/;

/**
 * A fake Prisma client with organizations, brand rows and clients. Records
 * every write so a test can prove reads never create rows.
 */
function fakeDb({ organizations = {}, brands = {}, clients = {} } = {}) {
  const writes = [];
  const db = {
    writes,
    organization: { findUnique: async ({ where }) => (organizations[where.id] ? { ...organizations[where.id] } : null) },
    client: { findUnique: async ({ where }) => (clients[where.id] ? { ...clients[where.id] } : null) },
    brandSettings: {
      findUnique: async ({ where }) => (brands[where.organizationId] ? { ...brands[where.organizationId] } : null),
      upsert: async ({ where, create }) => {
        writes.push({ op: 'upsert', create });
        if (!brands[where.organizationId]) {
          brands[where.organizationId] = { id: `brand-${where.organizationId}`, companyName: LEGACY_DEFAULT_COMPANY_NAME, ...create };
        }
        return { ...brands[where.organizationId] };
      },
      create: async (args) => { writes.push({ op: 'create', args }); return args.data; },
      update: async (args) => { writes.push({ op: 'update', args }); return args.data; },
    },
  };
  return db;
}

// Organization B is a second workspace whose brand row was auto-created with
// the legacy default; organization C chose its own name.
const DB_FIXTURE = () => fakeDb({
  organizations: {
    'org-a': { name: 'Ashbi Design', logo: null },
    'org-b': { name: 'Northwind Studio', logo: 'https://cdn.northwind.test/org-logo.png' },
    'org-c': { name: 'Gamma Workspace', logo: null },
    'org-d': { name: 'Delta Co', logo: null },
  },
  brands: {
    'org-a': { companyName: 'Ashbi Design', logoUrl: null },
    'org-b': { companyName: 'Ashbi Design', logoUrl: null, website: 'northwind.test', email: 'billing@northwind.test', taxId: 'NW-123', address: '1 Main St' },
    'org-c': { companyName: 'Gamma Creative', logoUrl: '/uploads/brand/logo-1.png' },
  },
  clients: { 'client-b': { organizationId: 'org-b' } },
});

function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  return [...raw.matchAll(/<([0-9a-f]+)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join('');
}

describe('resolveBranding', () => {
  it("uses the organization's name when it has no brand row", async () => {
    const db = DB_FIXTURE();
    const branding = await resolveBranding(db, 'org-d');
    assert.equal(branding.companyName, 'Delta Co');
    assert.equal(branding.logoUrl, null);
  });

  it("reads a legacy default row as the organization's own name", async () => {
    const branding = await resolveBranding(DB_FIXTURE(), 'org-b');
    assert.equal(branding.companyName, 'Northwind Studio');
    assert.equal(branding.taxId, 'NW-123');
  });

  it('keeps a custom company name, and the legacy name for the organization that is called that', async () => {
    const db = DB_FIXTURE();
    assert.equal((await resolveBranding(db, 'org-c')).companyName, 'Gamma Creative');
    assert.equal((await resolveBranding(db, 'org-a')).companyName, 'Ashbi Design');
  });

  it("falls back to the organization's logo, and prefers the brand logo", async () => {
    const db = DB_FIXTURE();
    assert.equal((await resolveBranding(db, 'org-b')).logoUrl, 'https://cdn.northwind.test/org-logo.png');
    assert.equal((await resolveBranding(db, 'org-c')).logoUrl, '/uploads/brand/logo-1.png');
  });

  it('never creates or changes a row', async () => {
    const db = DB_FIXTURE();
    for (const org of ['org-a', 'org-b', 'org-c', 'org-d', 'missing']) await resolveBranding(db, org);
    await resolveBrandingForDocument(db, { clientId: 'client-b' });
    assert.deepEqual(db.writes, []);
  });

  it('names no agency without an organization', async () => {
    assert.equal((await resolveBranding(DB_FIXTURE(), null)).companyName, '');
    assert.equal((await resolveBrandingForDocument(DB_FIXTURE(), { clientId: 'unknown' })).companyName, '');
  });

  it('resolves a document through its own organization or its client', async () => {
    const db = DB_FIXTURE();
    assert.equal((await resolveBrandingForDocument(db, { organizationId: 'org-c' })).companyName, 'Gamma Creative');
    assert.equal((await resolveBrandingForDocument(db, { clientId: 'client-b' })).companyName, 'Northwind Studio');
  });

  it('exposes only the name and an https logo publicly', () => {
    assert.deepEqual(publicBrand({ companyName: 'Gamma Creative', logoUrl: '/uploads/brand/logo-1.png', email: 'x@y.test' }), { companyName: 'Gamma Creative', logoUrl: null });
    assert.deepEqual(publicBrand({ companyName: 'N', logoUrl: 'https://cdn.test/l.png' }), { companyName: 'N', logoUrl: 'https://cdn.test/l.png' });
    assert.equal(publicBrand({ companyName: '', logoUrl: 'javascript:alert(1)' }), null);
  });
});

describe('getOrCreateBrandSettings', () => {
  it("creates a new row with the organization's name", async () => {
    const db = DB_FIXTURE();
    const row = await getOrCreateBrandSettings(db, 'org-d');
    assert.equal(row.companyName, 'Delta Co');
    assert.deepEqual(db.writes, [{ op: 'upsert', create: { organizationId: 'org-d', companyName: 'Delta Co' } }]);
  });

  it('leaves an existing row unchanged', async () => {
    const db = DB_FIXTURE();
    const row = await getOrCreateBrandSettings(db, 'org-b');
    assert.equal(row.companyName, 'Ashbi Design', 'the stored value is not rewritten');
  });
});

describe('sender headers', () => {
  it('quotes the display name and keeps the configured address', () => {
    assert.equal(brandedSender({ companyName: 'Northwind Studio' }, 'mg.example.test'), '"Northwind Studio" <noreply@mg.example.test>');
    assert.equal(systemSender('mg.example.test'), `"${PRODUCT_NAME}" <noreply@mg.example.test>`);
    assert.equal(brandedSender({ companyName: '' }, 'mg.example.test'), '"Ashbi Hub" <noreply@mg.example.test>');
  });

  it('cannot inject a header or break out of the quoted name', () => {
    const from = formatFromHeader('Evil Co\r\nBcc: victim@example.test "x" \\', 'noreply@mg.example.test');
    assert.doesNotMatch(from, /[\r\n]/);
    assert.equal(from, '"Evil Co Bcc: victim@example.test x" <noreply@mg.example.test>');
  });
});

describe('client emails', () => {
  const northwind = { companyName: 'Northwind Studio', website: 'northwind.test' };

  it("send the invoice in the second organization's name (subject, body, From)", async () => {
    const result = await sendInvoiceDeliveryEmail({
      to: 'client@example.test', clientName: 'Avery', invoiceNumber: 'INV-9', total: 10,
      viewUrl: 'https://hub.example.test/portal/invoice/x', invoiceId: 'inv-9', branding: northwind,
    });
    assert.equal(result.ok, true);
    const { body } = requests.at(-1);
    assert.equal(body.get('from'), '"Northwind Studio" <hub@mg.example.test>');
    assert.equal(body.get('subject'), 'Invoice INV-9 from Northwind Studio');
    const html = body.get('html');
    assert.match(html, /here's your invoice from Northwind Studio\./);
    assert.match(html, /<a href="https:\/\/northwind\.test\/"[^>]*>northwind\.test<\/a>/);
    assert.doesNotMatch(html, LEGACY);
    assert.doesNotMatch(html, /\{\{/, 'every placeholder is filled');
  });

  it('send in the product name and show no agency without branding', async () => {
    await sendContractSignEmail({ to: 'client@example.test', clientName: 'C', contractTitle: 'T', signLink: 'https://x.test', expiresDate: 'October 30, 2026' });
    const { body } = requests.at(-1);
    assert.equal(body.get('from'), '"Ashbi Hub" <hub@mg.example.test>');
    assert.doesNotMatch(body.get('html'), LEGACY);
    assert.doesNotMatch(body.get('html'), /\{\{|href=""/);
  });

  it('escape the company name in the body and strip CR/LF from headers', async () => {
    await sendInvoiceDeliveryEmail({
      to: 'client@example.test', invoiceNumber: 'INV-10', total: 1, viewUrl: 'https://x.test',
      branding: { companyName: 'Evil <b>Co</b>\r\nBcc: victim@example.test' },
    });
    const { body } = requests.at(-1);
    assert.doesNotMatch(body.get('from'), /[\r\n]/);
    assert.doesNotMatch(body.get('subject'), /[\r\n]/);
    assert.doesNotMatch(body.get('html'), /<b>Co<\/b>/);
    assert.match(body.get('html'), /Evil &lt;b&gt;Co&lt;\/b&gt;/);
  });

  it('render every client template with brand placeholders filled', async () => {
    for (const template of ['welcome.html', 'invoice-created.html', 'invoice-overdue.html', 'invoice-paid.html', 'proposal-sent.html', 'contract-sign.html', 'project-update.html', 'message-new.html']) {
      const html = await loadTemplate(template, { ...brandEmailVariables(northwind), clientName: 'Avery', senderName: 'Pat' });
      assert.match(html, /Northwind Studio/, template);
      assert.doesNotMatch(html, LEGACY, template);
      assert.doesNotMatch(html, /\{\{#|\{\{\//, template);
    }
  });
});

describe('documents for a second organization', () => {
  const northwind = { companyName: 'Northwind Studio', website: 'northwind.test', email: 'billing@northwind.test', taxId: 'NW-123', address: '1 Main St' };

  it('the invoice PDF carries its name, contact details and tax ID', async () => {
    const invoice = {
      invoiceNumber: 'INV-2026-0042', status: 'SENT', currency: 'CAD', total: 100, subtotal: 100, tax: 0,
      client: { name: 'Avery Client' }, lineItems: [{ description: 'Design', quantity: 1, unitPrice: 100, total: 100 }], payments: [],
    };
    const text = pdfText(await generateInvoicePdf(invoice, { compress: false, branding: northwind }));
    assert.match(text, /NORTHWIND STUDIO/);
    assert.match(text, /billing@northwind\.test/);
    assert.match(text, /Tax ID: NW-123/);
    assert.doesNotMatch(text, LEGACY);

    const custom = pdfText(await generateInvoicePdf(invoice, { compress: false, branding: { ...northwind, invoiceFooter: 'Payable within 15 days' } }));
    assert.match(custom, /Payable within 15 days/);

    const bare = pdfText(await generateInvoicePdf(invoice, { compress: false }));
    assert.doesNotMatch(bare, LEGACY);
  });

  it('the contract template and PDF name its agency', async () => {
    const rendered = renderTemplate('RETAINER', { clientName: 'Avery Client' }, { companyName: 'Northwind <Studio>', contractHeader: 'Master services terms apply' });
    assert.match(rendered.content, /<strong>Northwind &lt;Studio&gt;<\/strong> \("Agency"\)/);
    assert.match(rendered.content, /Agency: Northwind &lt;Studio&gt;/);
    assert.match(rendered.content, /^<p>Master services terms apply<\/p>/);
    assert.doesNotMatch(rendered.content, LEGACY);
    for (const type of ['PROJECT', 'NDA']) {
      assert.doesNotMatch(renderTemplate(type, {}, northwind).content, /Ashbi Design|\{agencyName\}/);
    }

    const pdf = pdfText(await generateContractPdf(
      { title: 'Retainer', content: rendered.content, createdAt: new Date(), client: { name: 'Avery Client' } },
      northwind,
      { compress: false },
    ));
    assert.match(pdf, /NORTHWIND STUDIO/);
    assert.match(pdf, /northwind\.test/);
    assert.doesNotMatch(pdf, LEGACY);
  });

  it('proposal-builder output uses its name and footer', async () => {
    const lead = { name: 'Avery', email: 'avery@example.test' };
    const html = buildProposalHtml({ title: 'Rebrand', id: 'p1' }, lead, northwind);
    assert.match(html, /<div class="logo">Northwind Studio<\/div>/);
    assert.match(html, /Thank you for considering Northwind Studio/);
    assert.match(html, /billing@northwind\.test/);
    assert.doesNotMatch(html, LEGACY);
    assert.doesNotMatch(html, /ashbi\.design/);

    const generated = await generateProposal({ ...lead, projectType: 'branding' }, { branding: northwind });
    assert.match(generated.html, /Northwind Studio/);
    assert.doesNotMatch(generated.html, LEGACY);

    const fallback = buildFallbackProposalHtml({ title: 'Rebrand', pricingTiers: [] }, lead, { ...northwind, proposalFooter: 'Northwind <terms>' });
    assert.match(fallback, /Northwind &lt;terms&gt;/);
    assert.doesNotMatch(fallback, /Ashbi|ashbi/);
  });

  it('download filenames use an ASCII slug of the company name', () => {
    assert.equal(brandSlug('Café Nørd & Co.'), 'Cafe_N_rd_Co');
    assert.equal(brandedPdfFilename('Northwind Studio', 'Proposal', 'p1'), 'Northwind_Studio_Proposal_p1.pdf');
    assert.equal(brandedPdfFilename('', 'Proposal', 'p1'), 'Proposal_p1.pdf');
    assert.equal(brandedPdfFilename('"\r\n', 'Proposal', 'p/1'), 'Proposal_p1.pdf');
  });
});
