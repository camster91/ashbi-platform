// The Gmail sync files a sender's mail under a client of the mailbox's own
// organization only (src/services/gmail-sync-matcher.js), and only that
// organization's admins can trigger it (POST /api/gmail/sync-now).
import test from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { matchSenderToClient, senderDomainMatches } from '../../services/gmail-sync-matcher.js';
import { clientDomainFromEmail } from '../../utils/client-identity.js';
import env from '../../config/env.js';
import gmailRoutes from '../../routes/gmail.routes.js';

// ILIKE semantics, as PostgreSQL applies `{ equals, mode: 'insensitive' }`.
function ilike(actual, pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const character = pattern[i];
    if (character === '\\') { i += 1; source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (character === '%') source += '.*';
    else if (character === '_') source += '.';
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i').test(actual);
}

function fakePrisma({ clients, contacts }) {
  const calls = [];
  const clientMatches = (client, where = {}) => (
    (where.organizationId === undefined || client.organizationId === where.organizationId)
    && (where.deletedAt === undefined || (client.deletedAt ?? null) === where.deletedAt)
    && (where.status === undefined || where.status.in.includes(client.status ?? 'ACTIVE'))
    && (where.relationshipStatus === undefined || !where.relationshipStatus.notIn.includes(client.relationshipStatus ?? 'ACTIVE'))
    && (where.domain === undefined
      || (typeof where.domain === 'string' ? client.domain === where.domain : client.domain !== null))
  );
  return {
    calls,
    contact: {
      findMany: async ({ where }) => {
        calls.push(['contact.findMany', where]);
        const found = contacts.filter((row) => {
          const client = clients.find((c) => c.id === row.clientId);
          return ilike(row.email, where.email.equals) && clientMatches(client, where.client);
        });
        return found.map(contact => ({ ...contact, client: { status: 'ACTIVE', relationshipStatus: 'ACTIVE', ...clients.find((c) => c.id === contact.clientId) } }));
      },
    },
    client: {
      findFirst: async ({ where }) => { calls.push(['client.findFirst', where]); return clients.find((c) => clientMatches(c, where)) ?? null; },
      findMany: async ({ where }) => { calls.push(['client.findMany', where]); return clients.filter((c) => clientMatches(c, where)); },
    },
  };
}

const clients = [
  { id: 'b-acme', organizationId: 'org-b', domain: 'acme.com', deletedAt: null, name: 'Acme (tenant B)' },
  { id: 'b-sub', organizationId: 'org-b', domain: 'mail.globex.com', deletedAt: null, name: 'Globex mail (tenant B)' },
  { id: 'a-globex', organizationId: 'org-a', domain: 'globex.com', deletedAt: null, name: 'Globex' },
  { id: 'a-deleted', organizationId: 'org-a', domain: 'initech.com', deletedAt: new Date(), name: 'Initech (deleted)' },
  { id: 'a-acme', organizationId: 'org-a', domain: 'acme.com', deletedAt: null, name: 'Acme' },
];
const contacts = [
  { id: 'cb', clientId: 'b-acme', email: 'Jane@Partner.test', createdAt: new Date(1) },
  { id: 'ca', clientId: 'a-globex', email: 'john@partner.test', createdAt: new Date(2) },
];

test('a sender is matched only to live clients of the mailbox organization', async () => {
  const prisma = fakePrisma({ clients, contacts });
  // Contact of tenant B only: no match for org A, whatever the case.
  assert.equal(await matchSenderToClient(prisma, 'org-a', 'jane@partner.test'), null);
  // Contact of org A, any case; a LIKE pattern matches nothing else.
  assert.equal((await matchSenderToClient(prisma, 'org-a', 'JOHN@partner.test')).client.id, 'a-globex');
  assert.equal(await matchSenderToClient(prisma, 'org-a', 'j_hn@partner.test'), null);
  assert.equal(await matchSenderToClient(prisma, 'org-a', '%@partner.test'), null);
  // Exact domain: org A's own Acme, never tenant B's.
  const acme = await matchSenderToClient(prisma, 'org-a', 'someone@acme.com');
  assert.deepEqual([acme.client.id, acme.confidence], ['a-acme', 0.9]);
  // Subdomain of an org A client domain; tenant B's more specific domain is not consulted.
  const sub = await matchSenderToClient(prisma, 'org-a', 'x@mail.globex.com');
  assert.deepEqual([sub.client.id, sub.confidence], ['a-globex', 0.7]);
  // Soft-deleted clients and substring look-alikes never match.
  assert.equal(await matchSenderToClient(prisma, 'org-a', 'x@initech.com'), null);
  assert.equal(await matchSenderToClient(prisma, 'org-a', 'x@notglobex.com'), null);
  assert.equal(await matchSenderToClient(prisma, 'org-a', 'x@globex.com.evil.test'), null);
  // Free providers never match by domain.
  assert.equal(await matchSenderToClient(prisma, 'org-a', 'stranger@gmail.com'), null);

  for (const [name, where] of prisma.calls) {
    const scope = name === 'contact.findMany' ? where.client : where;
    assert.equal(scope.organizationId, 'org-a', `${name} is scoped to the organization`);
    if (name !== 'contact.findMany') assert.equal(scope.deletedAt, null, `${name} skips deleted domain clients`);
  }
});

test('matching without an organization is refused', async () => {
  await assert.rejects(matchSenderToClient(fakePrisma({ clients, contacts }), '', 'a@acme.com'), /organizationId is required/);
});

test('ineligible exact contacts require review before another active domain can receive the body', async () => {
  for (const lifecycle of [{ status: 'PAUSED' }, { status: 'CHURNED' }, { relationshipStatus: 'ARCHIVED' }, { relationshipStatus: 'CHURNED' }, { deletedAt: new Date() }]) {
    const historical = { id: 'old', organizationId: 'org-a', domain: 'old.test', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE', ...lifecycle };
    const current = { id: 'current', organizationId: 'org-a', domain: 'partner.test', deletedAt: null, status: 'ACTIVE', relationshipStatus: 'ACTIVE' };
    const prisma = fakePrisma({ clients: [historical, current], contacts: [{ id: 'old-contact', clientId: 'old', email: 'sender@partner.test' }] });
    assert.deepEqual(await matchSenderToClient(prisma, 'org-a', 'sender@partner.test'), { ambiguous: true });
    assert.deepEqual(prisma.calls.map(([name]) => name), ['contact.findMany']);
    historical.organizationId = 'org-b';
    assert.equal((await matchSenderToClient(prisma, 'org-a', 'sender@partner.test')).client.id, 'current');
  }
});

test('senderDomainMatches accepts the domain and its subdomains only', () => {
  assert.equal(senderDomainMatches('acme.com', 'acme.com'), true);
  assert.equal(senderDomainMatches('mail.ACME.com', 'acme.com'), true);
  assert.equal(senderDomainMatches('notacme.com', 'acme.com'), false);
  assert.equal(senderDomainMatches('acme.com', 'mail.acme.com'), false);
  assert.equal(senderDomainMatches('acme.com.evil.test', 'acme.com'), false);
  assert.equal(senderDomainMatches('acme.com', ''), false);
});

test('clientDomainFromEmail never yields a consumer mailbox domain', () => {
  assert.equal(clientDomainFromEmail('Jane@Acme.COM '), 'acme.com');
  assert.equal(clientDomainFromEmail('bob@GMail.com'), null);
  assert.equal(clientDomainFromEmail('x@outlook.com'), null);
  assert.equal(clientDomainFromEmail('no-at-sign'), null);
  assert.equal(clientDomainFromEmail(''), null);
});

test('POST /sync-now is refused unless configured and requested by that organization', async (t) => {
  const saved = env.gmailSyncOrganizationId;
  t.after(() => { env.gmailSyncOrganizationId = saved; });
  let user = { id: 'u1', role: 'ADMIN', organizationId: 'org-b' };
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = user; });
  app.decorate('adminOnly', async (request, reply) => {
    request.user = user;
    if (user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    return undefined;
  });
  await app.register(gmailRoutes);
  t.after(() => app.close());

  env.gmailSyncOrganizationId = undefined;
  assert.equal((await app.inject({ method: 'POST', url: '/sync-now' })).statusCode, 503);

  env.gmailSyncOrganizationId = 'org-a';
  const otherOrg = await app.inject({ method: 'POST', url: '/sync-now' });
  assert.equal(otherOrg.statusCode, 403, 'an admin of another organization');

  user = { id: 'u2', role: 'TEAM', organizationId: 'org-a' };
  const team = await app.inject({ method: 'POST', url: '/sync-now' });
  assert.equal(team.statusCode, 403, 'a non-admin of the organization');
});


test('a shared contact address across live clients requires review; duplicates on one client remain unique', async () => {
  const shared = [...contacts, { id: 'duplicate-client', clientId: 'a-acme', email: 'JOHN@partner.test' }];
  assert.deepEqual(await matchSenderToClient(fakePrisma({ clients, contacts: shared }), 'org-a', 'john@partner.test'), { ambiguous: true });
  const sameClient = [...contacts, { id: 'same-client', clientId: 'a-globex', email: 'JOHN@partner.test' }];
  assert.equal((await matchSenderToClient(fakePrisma({ clients, contacts: sameClient }), 'org-a', 'john@partner.test')).client.id, 'a-globex');
});


test('actual sync-now HTTP responses never expose raw child stdout, stderr, provider errors or mailbox content', async t => {
  const saved = env.gmailSyncOrganizationId; env.gmailSyncOrganizationId = 'org-a';
  t.after(() => { env.gmailSyncOrganizationId = saved; });
  let failed = false;
  const summary = { version: 1, scope: 'INBOX_WINDOW', lookbackHours: 48, pages: 1, listed: 1, stored: 0, replayed: 0, skipped: 0, held: 1, errors: 0, partial: true };
  t.mock.method(childProcess, 'execFile', (_exe, _argv, _opts, callback) => callback(failed ? Error('secret-token') : null,
    `private-client@example.test secret-body\nGMAIL_SYNC_SUMMARY ${JSON.stringify(summary)}`, 'secret-provider-response'));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = { id: 'admin', role: 'ADMIN', organizationId: 'org-a' }; });
  app.decorate('adminOnly', async request => { request.user = { id: 'admin', role: 'ADMIN', organizationId: 'org-a' }; });
  await app.register(gmailRoutes); t.after(() => app.close());
  const ok = await app.inject({ method: 'POST', url: '/sync-now' });
  assert.deepEqual(ok.json(), { success: false, ...summary });
  assert.doesNotMatch(ok.body, /secret|private-client/);
  failed = true;
  const error = await app.inject({ method: 'POST', url: '/sync-now' });
  assert.deepEqual(error.json(), { success: false, partial: true, error: 'Gmail sync failed; the scan is incomplete.' });
  assert.doesNotMatch(error.body, /secret|private-client/);
});


test('Gmail matching admits ACTIVE and PROSPECT clients, excludes PAUSED and CHURNED even for exact contacts', async () => {
  for (const status of ['ACTIVE', 'PROSPECT', 'PAUSED', 'CHURNED']) {
    const scoped = clients.map(client => client.id === 'a-globex' ? { ...client, status } : client);
    const match = await matchSenderToClient(fakePrisma({ clients: scoped, contacts }), 'org-a', 'john@partner.test');
    assert.equal(match?.client?.id ?? null, ['ACTIVE', 'PROSPECT'].includes(status) ? 'a-globex' : null);
  }
});


test('relationship lifecycle excludes ARCHIVED and CHURNED even when Client.status remains ACTIVE; LEAD stays eligible', async () => {
  for (const relationshipStatus of ['ACTIVE', 'LEAD', 'ARCHIVED', 'CHURNED']) {
    const scoped = clients.map(client => client.id === 'a-globex' ? { ...client, status: 'ACTIVE', relationshipStatus } : client);
    const match = await matchSenderToClient(fakePrisma({ clients: scoped, contacts }), 'org-a', 'john@partner.test');
    assert.equal(match?.client?.id ?? null, ['ACTIVE', 'LEAD'].includes(relationshipStatus) ? 'a-globex' : null);
  }
});
