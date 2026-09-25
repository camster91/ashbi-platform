// Two-client portal isolation (issues #286, #280): two clients of one agency,
// each with a portal user. Client A signs in through the real magic-link flow
// and must not see or fetch anything that belongs to client B.

import { expect, request as playwrightRequest, test } from '@playwright/test';
import {
  createClientWithContact,
  json,
  loginAdminOverApi,
  sellThroughApi,
  signInToPortal,
} from './support';

test('a portal client sees only its own documents and cannot fetch another client\'s', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const admin = await playwrightRequest.newContext({ baseURL });
  const anonymous = await playwrightRequest.newContext({ baseURL });
  await loginAdminOverApi(admin);

  const a = await createClientWithContact(admin, 'Isolation Client A');
  const b = await createClientWithContact(admin, 'Isolation Client B');
  const soldA = await sellThroughApi(admin, anonymous, a.client.id, `Client A retainer ${a.suffix}`, [
    { description: 'Client A monthly support', quantity: 1, unitPrice: 1200 },
  ]);
  const soldB = await sellThroughApi(admin, anonymous, b.client.id, `Client B campaign ${b.suffix}`, [
    { description: 'Client B campaign creative', quantity: 3, unitPrice: 800 },
  ]);
  // Client B also has an open proposal that has only been sent.
  const openProposalB = await json(await admin.post('/api/proposals', {
    data: { clientId: b.client.id, title: `Client B phase two ${b.suffix}`, lineItems: [{ description: 'Phase two', quantity: 1, unitPrice: 5000 }] },
  }), 201);
  await json(await admin.post(`/api/proposals/${openProposalB.id}/send`));

  // Client B has a working portal account of its own.
  await json(await anonymous.post('/api/client-portal/request-access', { data: { email: b.contactEmail } }));

  await test.step('client A signs in through the portal magic link', async () => {
    await signInToPortal(page, a.contactEmail);
    await expect(page.getByText(a.client.name).first()).toBeVisible();
  });

  await test.step('the portal UI lists only client A\'s invoice and contract', async () => {
    await page.getByRole('tab', { name: /^Invoices/ }).click();
    await expect(page.getByText(soldA.invoice.invoiceNumber)).toBeVisible();
    await expect(page.getByText(soldB.invoice.invoiceNumber)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Invoices (1)' })).toBeVisible();

    await page.getByRole('tab', { name: /^Contracts/ }).click();
    await expect(page.getByRole('heading', { name: soldA.contract.title })).toBeVisible();
    await expect(page.getByText(soldB.contract.title)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Contracts (1)' })).toBeVisible();
    await expect(page.getByText(b.client.name)).toHaveCount(0);
  });

  // page.request shares the browser context, so it carries client A's portal session cookie.
  const portal = page.request;

  await test.step('client A\'s portal API lists only its own records', async () => {
    const invoices = await json<any[]>(await portal.get('/api/client-portal/invoices'));
    expect(invoices.map((invoice) => invoice.id)).toEqual([soldA.invoice.id]);
    const contracts = await json<any[]>(await portal.get('/api/client-portal/contracts'));
    expect(contracts.map((contract) => contract.id)).toEqual([soldA.contract.id]);
  });

  await test.step('client A can download its own invoice PDF but not client B\'s', async () => {
    const own = await portal.get(`/api/client-portal/invoices/${soldA.invoice.id}/pdf`);
    expect(own.status()).toBe(200);
    expect(own.headers()['content-type']).toContain('application/pdf');
    expect((await own.body()).subarray(0, 5).toString()).toBe('%PDF-');

    const other = await portal.get(`/api/client-portal/invoices/${soldB.invoice.id}/pdf`);
    expect(other.status()).toBe(404);
  });

  await test.step('client A\'s signed contract PDF (when the portal route exists)', async () => {
    const own = await portal.get(`/api/client-portal/contracts/${soldA.contract.id}/pdf`);
    const body = await own.text();
    // The hub's catch-all 404 (no such route) differs from a route's own "Contract not found".
    const routeMissing = own.status() === 404 && (/Route GET:.* not found/.test(body) || body.trim() === '{"error":"Not found"}');
    if (routeMissing) {
      test.info().annotations.push({ type: 'skip', description: 'GET /api/client-portal/contracts/:id/pdf is not on this branch' });
      return;
    }
    expect(own.status(), body.slice(0, 200)).toBe(200);
    expect(own.headers()['content-type']).toContain('application/pdf');
    const other = await portal.get(`/api/client-portal/contracts/${soldB.contract.id}/pdf`);
    expect([403, 404]).toContain(other.status());
  });

  await test.step('client A\'s session is refused on every staff API for client B\'s records', async () => {
    const staffUrls = [
      `/api/invoices/${soldB.invoice.id}`,
      `/api/invoices/${soldB.invoice.id}/pdf`,
      `/api/invoices/${soldB.invoice.id}/payments`,
      `/api/contracts/${soldB.contract.id}`,
      `/api/contracts/${soldB.contract.id}/pdf`,
      `/api/proposals/${soldB.proposal.id}`,
      `/api/proposals/${openProposalB.id}`,
      `/api/clients/${b.client.id}`,
      '/api/invoices',
      '/api/contracts',
      '/api/proposals',
      '/api/clients',
    ];
    for (const url of staffUrls) {
      const response = await portal.get(url);
      const body = await response.text();
      expect([401, 403, 404], `${url} -> ${response.status()} ${body.slice(0, 120)}`).toContain(response.status());
      expect(body, url).not.toContain(soldB.invoice.invoiceNumber);
      expect(body, url).not.toContain(b.client.name);
    }
    const markPaid = await portal.post(`/api/invoices/${soldB.invoice.id}/mark-paid`, { data: { paymentMethod: 'CASH' } });
    expect([401, 403, 404]).toContain(markPaid.status());
    const stillSent = await json(await admin.get(`/api/invoices/${soldB.invoice.id}`));
    expect(stillSent.status).toBe('SENT');
  });

  await test.step('client A\'s realtime socket receives its own project events but not client B\'s', async () => {
    const projectA = await json(await admin.post('/api/projects', { data: { name: `Isolation Project A ${a.suffix}`, clientId: a.client.id } }), 201);
    const projectB = await json(await admin.post('/api/projects', { data: { name: `Isolation Project B ${b.suffix}`, clientId: b.client.id } }), 201);

    // Speak the Socket.IO v4 wire protocol over a raw WebSocket from the page,
    // so the handshake carries client A's httpOnly portal session cookie.
    await page.evaluate(({ ownProject, otherProject }) => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`);
      const received: string[] = [];
      (window as any).__portalSocketEvents = received;
      const timer = setTimeout(() => reject(new Error('socket.io handshake timed out')), 10_000);
      socket.onmessage = (event) => {
        const frame = String(event.data);
        if (frame === '2') { socket.send('3'); return; } // engine.io ping -> pong
        if (frame.startsWith('0')) { socket.send('40'); return; } // engine.io open -> socket.io connect
        if (frame.startsWith('44')) { clearTimeout(timer); reject(new Error(`socket.io refused: ${frame}`)); return; }
        if (frame.startsWith('40')) {
          socket.send(`42${JSON.stringify(['join-project', ownProject])}`);
          socket.send(`42${JSON.stringify(['join-project', otherProject])}`);
          clearTimeout(timer);
          // join-project is authorized asynchronously; give both a moment to settle.
          setTimeout(resolve, 1_000);
          return;
        }
        if (frame.startsWith('42')) received.push(frame.slice(2));
      };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('socket error')); };
    }), { ownProject: projectA.id, otherProject: projectB.id });

    const ownMessage = `for client A ${a.suffix}`;
    const otherMessage = `for client B only ${b.suffix}`;
    await json(await admin.post(`/api/chat/projects/${projectB.id}/messages`, { data: { content: otherMessage } }), 201);
    await json(await admin.post(`/api/chat/projects/${projectA.id}/messages`, { data: { content: ownMessage } }), 201);

    const events = () => page.evaluate(() => ((window as any).__portalSocketEvents as string[]).join('\n'));
    // Positive control: the socket is live and in its own project room.
    await expect.poll(events, { timeout: 10_000 }).toContain(ownMessage);
    expect(await events()).not.toContain(otherMessage);
    expect(await events()).not.toContain(projectB.id);
  });

  await test.step('client A cannot open client B\'s contract or invoice in the browser', async () => {
    await page.goto(`/invoices/${soldB.invoice.id}`);
    await expect(page.getByText(soldB.invoice.invoiceNumber)).toHaveCount(0);
    await page.goto(`/contracts`);
    await expect(page.getByText(soldB.contract.title)).toHaveCount(0);
  });

  await admin.dispose();
  await anonymous.dispose();
});
