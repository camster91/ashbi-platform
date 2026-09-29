// B1 against a real database: a browser holding a pre-release (untyped) staff
// or client `token` cookie can still request a portal link, redeem it (and
// receive a fresh session cookie), and view and answer an estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('a stale session cookie never blocks the public portal and estimate routes', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { buildApp } = await import('../../index.js');
  const { rawPrisma } = await import('../../config/db.js');
  const { magicLinkClaims } = await import('../../routes/client-portal.routes.js');

  const suffix = randomUUID().slice(0, 8);
  const orgId = `stale-org-${suffix}`;
  const email = `stale-${suffix}@example.test`;
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'stale-cookie-integration-secret-0123456789' });
  await app.ready();

  try {
    await rawPrisma.organization.create({ data: { id: orgId, name: 'Stale Cookie Org', slug: `stale-${suffix}` } });
    const client = await rawPrisma.client.create({
      data: { name: 'Stale Cookie Client', organizationId: orgId, contacts: { create: [{ name: 'Casey', email, isPrimary: true }] } },
      include: { contacts: true },
    });
    const viewTokens = [`stale-a-${randomUUID()}`, `stale-b-${randomUUID()}`];
    for (const viewToken of viewTokens) {
      await rawPrisma.estimate.create({
        data: {
          clientId: client.id, title: 'Estimate', status: 'SENT', total: 100, viewToken,
          publicAccessExpiresAt: new Date(Date.now() + 86_400_000), sentAt: new Date(),
        },
      });
    }

    const staleCookies = {
      staff: app.jwt.sign({ id: 'someone', role: 'ADMIN', organizationId: orgId, sessionVersion: 0 }, { expiresIn: '7d' }),
      client: app.jwt.sign({ id: 'someone', role: 'CLIENT', clientId: client.id, contactId: client.contacts[0].id, organizationId: orgId, sessionVersion: 0 }, { expiresIn: '7d' }),
    };

    let round = 0;
    for (const [name, stale] of Object.entries(staleCookies)) {
      const headers = { cookie: `token=${stale}` };
      const requested = await app.inject({ method: 'POST', url: '/api/client-portal/request-access', headers, payload: { email } });
      assert.equal(requested.statusCode, 200, `${name}: ${requested.body}`);
      assert.match(String(requested.headers['set-cookie']), /token=;/, `${name}: the stale cookie is cleared`);

      const user = await rawPrisma.user.findUnique({ where: { email } });
      const contact = { ...client.contacts[0], client: { organizationId: orgId } };
      const link = app.jwt.sign(magicLinkClaims(user, contact), { expiresIn: '1h' });
      const redeemed = await app.inject({ method: 'POST', url: '/api/client-portal/verify-token', headers, payload: { token: link } });
      assert.equal(redeemed.statusCode, 200, `${name}: ${redeemed.body}`);
      const setCookie = [].concat(redeemed.headers['set-cookie']);
      assert.equal(setCookie.filter((c) => c.startsWith('token=')).length, 1, `${name}: exactly one token cookie`);
      assert.doesNotMatch(setCookie.find((c) => c.startsWith('token=')), /^token=;/, `${name}: the new session is not cleared`);

      const viewed = await app.inject({ method: 'GET', url: `/api/estimates/view/${viewTokens[round]}`, headers });
      assert.equal(viewed.statusCode, 200, `${name}: ${viewed.body}`);
      const answered = await app.inject({ method: 'POST', url: `/api/estimates/view/${viewTokens[round]}/approve`, headers, payload: { action: 'decline' } });
      assert.equal(answered.statusCode, 200, `${name}: ${answered.body}`);
      round += 1;
    }
  } finally {
    await app.close();
    await rawPrisma.estimate.deleteMany({ where: { client: { organizationId: orgId } } });
    await rawPrisma.user.deleteMany({ where: { organizationId: orgId } });
    await rawPrisma.contact.deleteMany({ where: { client: { organizationId: orgId } } });
    await rawPrisma.client.deleteMany({ where: { organizationId: orgId } });
    await purgeFixtureAuditEvents(rawPrisma, { ids: [orgId] });
    await rawPrisma.organization.deleteMany({ where: { id: orgId } });
  }
});
