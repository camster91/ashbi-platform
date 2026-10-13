import { expect, test } from '@playwright/test';
import { createClientWithContact, json, loginAdminThroughUi } from './support';

test('financial portfolios preserve clients and currency-separated summaries through reload', async ({ page }) => {
  await loginAdminThroughUi(page);
  const admin = page.request;
  const { client, suffix } = await createClientWithContact(admin, 'Finance portfolios QA');
  const agency = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `Agency finance ${suffix}`, portfolio: 'ASHBI_DESIGN' } }), 201);
  const freelance = await json(await admin.post('/api/projects', { data: { clientId: client.id, name: `Freelance finance ${suffix}`, portfolio: 'FREELANCE' } }), 201);
  const invoices = [];
  for (const project of [agency, freelance]) {
    invoices.push(await json(await admin.post('/api/invoices', { data: { clientId: client.id, projectId: project.id, title: `Finance ${suffix}`, currency: 'CAD', taxRate: 0, lineItems: [{ description: 'Synthetic QA work', quantity: 1, unitPrice: 10 }] } })));
  }
  for (const [currency, amount] of [['CAD', 15], ['USD', 30]] as const) {
    await json(await admin.post('/api/expenses', { data: { clientId: client.id, projectId: freelance.id, description: `${currency} receipt ${suffix}`, currency, amount, category: 'SOFTWARE', date: new Date().toISOString().slice(0, 10) } }), 201);
  }
  await json(await admin.post('/api/expenses', { data: { clientId: client.id, description: `Unlinked receipt ${suffix}`, currency: 'CAD', amount: 5, category: 'SOFTWARE', date: new Date().toISOString().slice(0, 10) } }), 201);
  await page.goto('/invoices?portfolio=FREELANCE');
  await expect(page.getByRole('link', { name: invoices[1].invoiceNumber, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: invoices[0].invoiceNumber, exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Work portfolio')).toHaveValue('FREELANCE');
  await page.goto('/expenses?portfolio=FREELANCE');
  await page.getByPlaceholder('Search...', { exact: true }).fill(suffix);
  await expect(page.getByText(`CAD receipt ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`USD receipt ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Unlinked receipt ${suffix}`, { exact: true })).toHaveCount(0);
  await page.getByLabel('Expense summary currency').selectOption('USD');
  await page.getByLabel('Work portfolio').selectOption('UNCLASSIFIED');
  await expect(page.getByText(`Unlinked receipt ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`CAD receipt ${suffix}`, { exact: true })).toHaveCount(0);
  const summary = await json(await admin.get('/api/expenses/summary?portfolio=FREELANCE'));
  expect(summary.mixedCurrency).toBe(true);
  expect(summary.allTimeTotal).toBeNull();
  expect(summary.byCurrency.CAD.allTimeTotal).toBeGreaterThanOrEqual(15);
  expect(summary.byCurrency.USD.allTimeTotal).toBeGreaterThanOrEqual(30);
  expect((await json(await admin.get(`/api/invoices/${invoices[1].id}`))).clientId).toBe(client.id);
  expect((await json(await admin.get(`/api/invoices/${invoices[1].id}`))).status).toBe('DRAFT');
});
