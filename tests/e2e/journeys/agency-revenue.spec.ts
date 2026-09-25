// Agency revenue journey (issue #283): proposal -> contract -> invoice -> paid,
// driven through the real SPA and API with no request mocking.

import { expect, test } from '@playwright/test';
import {
  createClientWithContact,
  createProposal,
  json,
  loginAdminThroughUi,
  money,
  recentPaidRevenue,
  signInToPortal,
  waitForGeneratedContract,
} from './support';

const LINE_ITEMS = [
  { description: 'Discovery and brand strategy', quantity: 2, unitPrice: 500 },
  { description: 'Website build', quantity: 1, unitPrice: 1500 },
];
const PROPOSAL_TOTAL = 2500;
// Invoices from proposals carry Ontario HST at 13%.
const INVOICE_TOTAL = 2825;

test('agency sells, contracts, invoices and collects payment end to end', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const admin = page.request;
  const clientBrowser = await browser.newContext();
  const clientPage = await clientBrowser.newPage();

  await test.step('admin signs in through the login form', async () => {
    await loginAdminThroughUi(page);
  });

  const invoiceStatsBefore = await json(await admin.get('/api/invoices/stats'));
  const dashboardBefore = await json(await admin.get('/api/dashboard/stats'));

  const { client, contactEmail, suffix } = await createClientWithContact(admin, 'Revenue Client');
  const project = await json(await admin.post('/api/projects', { data: { name: `Revenue Project ${suffix}`, clientId: client.id } }), 201);
  const proposalTitle = `Brand and website ${suffix}`;

  const proposal = await test.step('admin drafts a proposal with line items', async () => {
    const created = await createProposal(admin, client.id, proposalTitle, LINE_ITEMS, project.id);
    expect(created.status).toBe('DRAFT');
    expect(created.lineItems).toHaveLength(2);
    expect(created.total).toBe(PROPOSAL_TOTAL);
    return created;
  });

  const proposalLink = await test.step('admin sends the proposal from its detail page', async () => {
    await page.goto(`/proposal/${proposal.id}`);
    await expect(page.getByRole('heading', { name: proposalTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Send to Client' }).click();
    await expect(page.getByText(/^Sent on /)).toBeVisible();
    // Email delivery is not configured in the stack; read the public link back.
    const sent = await json(await admin.get(`/api/proposals/${proposal.id}`));
    expect(sent.status).toBe('SENT');
    expect(sent.viewToken).toBeTruthy();
    return `/portal/proposal/${sent.viewToken}`;
  });

  await test.step('client reviews and accepts the proposal on the public page', async () => {
    await clientPage.goto(proposalLink);
    await expect(clientPage.getByRole('heading', { name: proposalTitle })).toBeVisible();
    for (const item of LINE_ITEMS) {
      await expect(clientPage.getByRole('cell', { name: item.description })).toBeVisible();
    }
    await expect(clientPage.getByText(money(PROPOSAL_TOTAL), { exact: true })).toBeVisible();
    await clientPage.getByRole('button', { name: 'Approve Proposal' }).click();
    await expect(clientPage.getByRole('heading', { name: 'Proposal Approved' })).toBeVisible();
  });

  const contract = await test.step('approval generates a draft contract that admin sends', async () => {
    const generated = await waitForGeneratedContract(admin, client.id, proposal.id);
    await page.goto('/contracts');
    const sendButton = page.getByRole('button', { name: 'Send', exact: true });
    // Innermost element holding both this contract's title and a Send action.
    const row = page.locator('div')
      .filter({ has: page.getByRole('button', { name: `Expand contract ${generated.title}` }) })
      .filter({ has: sendButton })
      .last();
    await row.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(async () => (await json(await admin.get(`/api/contracts/${generated.id}`))).status).toBe('SENT');
    return generated;
  });

  await test.step('client signs the contract from the client portal', async () => {
    await signInToPortal(clientPage, contactEmail);
    await clientPage.getByRole('tab', { name: /^Contracts/ }).click();
    await expect(clientPage.getByRole('heading', { name: contract.title })).toBeVisible();
    await clientPage.getByRole('link', { name: 'Review and sign' }).click();
    await expect(clientPage).toHaveURL(/\/portal\/contract\//);
    await expect(clientPage.getByText('Website build', { exact: false }).first()).toBeVisible();
    await clientPage.getByLabel('Full Legal Name').fill('Revenue Client Contact');
    await clientPage.getByRole('button', { name: 'Type', exact: true }).click();
    await clientPage.getByRole('button', { name: 'Sign Contract' }).click();
    await expect(clientPage.getByRole('heading', { name: 'Contract Signed' })).toBeVisible();

    const signed = await json(await admin.get(`/api/contracts/${contract.id}`));
    expect(signed.status).toBe('SIGNED');
    expect(signed.clientSigName).toBe('Revenue Client Contact');
    expect(signed.signedContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  const invoice = await test.step('admin invoices the accepted work', async () => {
    await page.goto(`/proposal/${proposal.id}`);
    await page.getByRole('button', { name: 'Create Invoice' }).click();
    await expect(page).toHaveURL(/\/invoices$/);
    const { invoices } = await json(await admin.get(`/api/invoices?clientId=${client.id}`));
    expect(invoices).toHaveLength(1);
    const created = invoices[0];
    expect(created.proposalId).toBe(proposal.id);
    expect(created.status).toBe('DRAFT');
    expect(created.subtotal).toBe(PROPOSAL_TOTAL);
    expect(created.total).toBe(INVOICE_TOTAL);
    return created;
  });

  const invoiceLink = await test.step('admin sends the invoice to the client', async () => {
    await page.goto(`/invoices/${invoice.id}`);
    await expect(page.getByRole('heading', { name: invoice.invoiceNumber })).toBeVisible();
    await page.getByRole('button', { name: 'Send to Client' }).click();
    await expect(page.getByRole('button', { name: 'Mark as Paid', exact: true })).toBeVisible();
    const sent = await json(await admin.get(`/api/invoices/${invoice.id}`));
    expect(sent.status).toBe('SENT');
    return `/portal/invoice/${sent.viewToken}`;
  });

  await test.step('the public invoice page shows the correct total', async () => {
    await clientPage.goto(invoiceLink);
    await expect(clientPage.getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible();
    await expect(clientPage.getByText(invoice.invoiceNumber).first()).toBeVisible();
    await expect(clientPage.getByText(money(INVOICE_TOTAL), { exact: true })).toBeVisible();
    await expect(clientPage.getByRole('button', { name: `Pay Now - $${money(INVOICE_TOTAL)}` })).toBeVisible();
  });

  await test.step('admin records the manual payment', async () => {
    await page.getByRole('button', { name: 'Mark as Paid', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Record payment' });
    await dialog.getByLabel('Payment method').selectOption('BANK');
    await dialog.getByLabel(/Transaction ID/).fill(`E2E-${suffix}`);
    await dialog.getByRole('button', { name: 'Mark as paid', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Mark as Paid', exact: true })).toBeHidden();

    const paid = await json(await admin.get(`/api/invoices/${invoice.id}`));
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).toBeTruthy();
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ amount: INVOICE_TOTAL, method: 'BANK', transactionId: `E2E-${suffix}` });
  });

  await test.step('client sees the invoice as paid', async () => {
    await clientPage.goto(invoiceLink);
    await expect(clientPage.getByRole('heading', { name: 'Payment Received' })).toBeVisible();
    await expect(clientPage.getByRole('button', { name: /Pay Now/ })).toHaveCount(0);
  });

  await test.step('finance and dashboard reflect the collected revenue', async () => {
    const stats = await json(await admin.get('/api/invoices/stats'));
    expect(stats.paid.count).toBe(invoiceStatsBefore.paid.count + 1);
    expect(stats.paid.amount).toBeCloseTo(invoiceStatsBefore.paid.amount + INVOICE_TOTAL, 2);
    expect(stats.totalOutstanding).toBeCloseTo(invoiceStatsBefore.totalOutstanding, 2);

    const dashboard = await json(await admin.get('/api/dashboard/stats'));
    expect(recentPaidRevenue(dashboard)).toBeCloseTo(recentPaidRevenue(dashboardBefore) + INVOICE_TOTAL, 2);
    expect(dashboard.totalOutstanding).toBeCloseTo(dashboardBefore.totalOutstanding, 2);

    // The list renders separate mobile and desktop layouts; assert on the visible one.
    const listed = page.getByText(invoice.invoiceNumber, { exact: true }).filter({ visible: true });
    await page.goto('/invoices');
    await expect(listed).toHaveCount(1);
    await page.getByRole('button', { name: 'SENT', exact: true }).click();
    await expect(page.getByRole('button', { name: 'SENT', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(listed).toHaveCount(0);
    await page.getByRole('button', { name: 'PAID', exact: true }).click();
    await expect(listed).toHaveCount(1);
  });

  await clientBrowser.close();
});
