import test from 'node:test';
import assert from 'node:assert/strict';
import { tenancyMiddleware } from '../../middleware/tenancy.js';

function fakeReply() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };
}

test('client-portal sessions are refused on staff APIs even with an organization claim', async () => {
  for (const url of ['/api/invoices/inv-b', '/api/contracts/ctr-b', '/api/proposals/prop-b', '/api/clients']) {
    const request = { url, user: { id: 'u-a', role: 'CLIENT', clientId: 'client-a', organizationId: 'org-1' } };
    const reply = fakeReply();
    await tenancyMiddleware(request, reply);
    assert.equal(reply.statusCode, 403, url);
    assert.equal(reply.body.code, 'CLIENT_SESSION_FORBIDDEN', url);
    assert.equal(request.prisma, undefined, `${url} must not receive a scoped client`);
  }
});

test('client-portal sessions still reach the client-portal and public token routes', async () => {
  for (const url of ['/api/client-portal/invoices', '/api/portal/invoice/tok', '/api/auth/me']) {
    const request = { url, user: { id: 'u-a', role: 'CLIENT', clientId: 'client-a', organizationId: 'org-1' } };
    const reply = fakeReply();
    await tenancyMiddleware(request, reply);
    assert.equal(reply.statusCode, null, url);
    assert.ok(request.prisma, `${url} gets the route-scoped client`);
  }
});

test('staff sessions keep organization scoping', async () => {
  for (const role of ['ADMIN', 'TEAM']) {
    const request = { url: '/api/invoices', user: { id: 'u-s', role, organizationId: 'org-1' } };
    const reply = fakeReply();
    await tenancyMiddleware(request, reply);
    assert.equal(reply.statusCode, null, role);
    assert.equal(request.organizationId, 'org-1');
  }
});
