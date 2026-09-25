// tests/e2e/journeys/support.ts
//
// Shared helpers for the full-stack browser journeys. Everything talks to the
// real hub (API + built SPA) from docker-compose.test.yml and its Postgres;
// nothing is mocked. External delivery (Mailgun, Stripe) is not configured in
// the test stack, so links that would arrive by email are read back through
// the admin API, and the portal magic link is minted from the same claims the
// request-access endpoint signs into the emailed link.

import crypto from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
// Plain ESM helper shared with the Vitest smoke.
import { findPortalPrincipal } from '../helpers/db.mjs';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'cameron@ashbi.ca';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestPass123!';
// Must match JWT_SECRET of the hub service in docker-compose.test.yml.
const HUB_JWT_SECRET = process.env.HUB_JWT_SECRET || 'test-jwt-secret-do-not-use-in-prod';

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export async function json<T = any>(response: APIResponse, expectedStatus = 200): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} -> ${text.slice(0, 300)}`).toBe(expectedStatus);
  return (text ? JSON.parse(text) : null) as T;
}

/** Sign in through the real login form; the page's context then holds the admin session cookie. */
export async function loginAdminThroughUi(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/email/i).fill(ADMIN_EMAIL);
  await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Sign in over HTTP only (for setup that does not exercise the UI). */
export async function loginAdminOverApi(request: APIRequestContext): Promise<void> {
  await json(await request.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }));
}

export type LineItem = { description: string; quantity: number; unitPrice: number };

export async function createClientWithContact(admin: APIRequestContext, label: string) {
  const suffix = uniqueSuffix();
  const contactEmail = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}@e2e.example.test`;
  const client = await json(await admin.post('/api/clients', {
    data: {
      name: `${label} ${suffix}`,
      status: 'ACTIVE',
      contacts: [{ email: contactEmail, name: `${label} Contact`, isPrimary: true }],
    },
  }), 201);
  return { client, contactEmail, suffix };
}

export async function createProposal(admin: APIRequestContext, clientId: string, title: string, lineItems: LineItem[], projectId?: string) {
  return json(await admin.post('/api/proposals', {
    data: { clientId, title, lineItems, ...(projectId ? { projectId } : {}) },
  }), 201);
}

/** Poll until the proposal-approval automation has generated the draft contract. */
export async function waitForGeneratedContract(admin: APIRequestContext, clientId: string, proposalId: string) {
  let contract: any = null;
  await expect.poll(async () => {
    const contracts = await json<any[]>(await admin.get(`/api/contracts?clientId=${clientId}`));
    contract = contracts.find((c) => c.proposal?.id === proposalId) || null;
    return contract?.status ?? null;
  }, { message: 'approval automation generates a draft contract', timeout: 15_000 }).toBe('DRAFT');
  return contract;
}

/** Drive a document all the way to a sent invoice over the API (setup only). */
export async function sellThroughApi(admin: APIRequestContext, anonymous: APIRequestContext, clientId: string, title: string, lineItems: LineItem[]) {
  const proposal = await createProposal(admin, clientId, title, lineItems);
  const sent = await json(await admin.post(`/api/proposals/${proposal.id}/send`));
  await json(await anonymous.post(`/api/portal/proposal/${sent.viewToken}/approve`, { data: {} }));
  const contract = await waitForGeneratedContract(admin, clientId, proposal.id);
  const sentContract = await json(await admin.post(`/api/contracts/${contract.id}/send`));
  await json(await anonymous.post(`/api/portal/contract/${sentContract.signToken}/sign`, {
    data: { signerName: `${title} Signer`, signatureType: 'type', agreement: true },
  }));
  const invoice = await json(await admin.post(`/api/invoices/from-proposal/${proposal.id}`));
  const sentInvoice = await json(await admin.post(`/api/invoices/${invoice.id}/send`, { data: {} }));
  return { proposal: { ...proposal, viewToken: sent.viewToken }, contract, invoice: sentInvoice };
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Request a portal login link through the real endpoint, then reproduce the
 * link the email would carry. The hub provisions the portal user during the
 * request; the token claims mirror POST /api/client-portal/request-access.
 */
export async function portalMagicLink(contactEmail: string): Promise<string> {
  const principal = await findPortalPrincipal(contactEmail);
  expect(principal, `request-access provisioned a portal user for ${contactEmail}`).toBeTruthy();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    id: principal.id,
    contactId: principal.contactId,
    clientId: principal.clientId,
    organizationId: principal.organizationId,
    role: 'CLIENT',
    sessionVersion: principal.sessionVersion,
    iat: now,
    exp: now + 3600,
  });
  const signature = crypto.createHmac('sha256', HUB_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `/client-portal/verify?token=${header}.${payload}.${signature}`;
}

/** Request access through the portal login form, then follow the magic link. */
export async function signInToPortal(page: Page, contactEmail: string): Promise<void> {
  await page.goto('/client-portal');
  await page.getByLabel('Email address').fill(contactEmail);
  await page.getByRole('button', { name: 'Send Login Link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  await page.goto(await portalMagicLink(contactEmail));
  await expect(page).toHaveURL(/\/client-portal$/);
  await expect(page.getByRole('tablist', { name: 'Portal sections' })).toBeVisible();
}

export function money(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Paid revenue across the dashboard's six-month history (timezone-agnostic). */
export function recentPaidRevenue(dashboard: any): number {
  return (dashboard.revenueHistory || []).reduce((sum: number, entry: any) => sum + Number(entry.total || 0), 0);
}
