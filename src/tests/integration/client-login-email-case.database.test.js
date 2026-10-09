// Client accounts created before addresses were normalised are stored with
// the invited address as typed (mixed case). Login and signup must still
// match them in any case, or those clients are locked out after release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('client login and signup match a legacy mixed-case account in any case', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { buildApp } = await import('../../index.js');
  const { rawPrisma } = await import('../../config/db.js');
  const { hashPassword } = await import('../../auth/password.js');

  const suffix = randomUUID().slice(0, 8);
  const orgId = `case-org-${suffix}`;
  const storedEmail = `Jane.${suffix}@Acme.Example`;
  const password = 'Str0ng!Passphrase';
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'client-email-case-integration-secret-0123' });
  await app.ready();

  try {
    await rawPrisma.organization.create({ data: { id: orgId, name: 'Case Org', slug: `case-${suffix}` } });
    const client = await rawPrisma.client.create({
      data: { name: 'Case Client', organizationId: orgId, status: 'ACTIVE', contacts: { create: [{ name: 'Jane', email: storedEmail, isPrimary: true }] } },
    });
    await rawPrisma.user.create({ data: {
      email: storedEmail, password: await hashPassword(password), name: 'Jane', role: 'CLIENT',
      clientId: client.id, organizationId: orgId, isActive: true,
    } });

    for (const typed of [storedEmail, storedEmail.toLowerCase(), storedEmail.toUpperCase()]) {
      const login = await app.inject({ method: 'POST', url: '/api/auth/client/login', payload: { email: typed, password } });
      assert.equal(login.statusCode, 200, `${typed}: ${login.body}`);
      const cookie = login.cookies.find(value => value.name === 'token');
      const portal = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { cookie: `token=${cookie.value}` } });
      assert.equal(portal.statusCode, 200, `password sign-in must open the portal: ${portal.body}`);
    }

    // A new invitation for the same person in another case is not a second account.
    const token = `case-invite-${randomUUID()}`;
    await rawPrisma.clientInvitation.create({ data: {
      token, email: storedEmail.toLowerCase(), clientId: client.id, expiresAt: new Date(Date.now() + 86_400_000),
    } });
    const signup = await app.inject({ method: 'POST', url: '/api/auth/client/signup', payload: { token, email: storedEmail.toLowerCase(), password } });
    assert.equal(signup.statusCode, 400, signup.body);
    assert.equal(signup.json().error, 'Account already exists');
    assert.equal(await rawPrisma.user.count({ where: { organizationId: orgId } }), 1);
  } finally {
    await app.close();
    await rawPrisma.clientInvitation.deleteMany({ where: { client: { organizationId: orgId } } });
    await rawPrisma.user.deleteMany({ where: { organizationId: orgId } });
    await rawPrisma.contact.deleteMany({ where: { client: { organizationId: orgId } } });
    await rawPrisma.client.deleteMany({ where: { organizationId: orgId } });
    await purgeFixtureAuditEvents(rawPrisma, { ids: [orgId] });
    await rawPrisma.organization.deleteMany({ where: { id: orgId } });
  }
});
