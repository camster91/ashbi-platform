import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

process.env.CREDENTIALS_KEY = 'audit-test-legacy-key';
process.env.CREDENTIALS_KEYRING = JSON.stringify({ legacy: 'audit-test-legacy-key' });

const { encrypt } = await import('../../utils/crypto.js');
const {
  normalizeCredentialPurpose,
  revealCredentialSecret,
} = await import('../../services/credential-vault.service.js');
const { credentialCreateSchema, credentialUpdateSchema } = await import('../../validators/schemas.js');

test('reveal commits fixed audit metadata before returning plaintext', async () => {
  const writes = [];
  const prisma = { credentialAccessAudit: { create: async (args) => { writes.push(args.data); } } };
  const plaintext = await revealCredentialSecret({
    prisma,
    credential: { id: 'cred-1', password: encrypt('never-log-this') },
    context: {
      organizationId: 'org-1', actorUserId: 'user-1', purpose: 'deployment',
      route: '/api/credentials/:id/password', traceId: 'trace-1',
    },
  });
  assert.equal(plaintext, 'never-log-this');
  assert.deepEqual(writes, [{
    organizationId: 'org-1', credentialId: 'cred-1', actorUserId: 'user-1',
    purpose: 'deployment', outcome: 'SUCCESS', route: '/api/credentials/:id/password',
    traceId: 'trace-1', keyVersion: 'legacy',
  }]);
  assert.doesNotMatch(JSON.stringify(writes), /never-log-this/);
});

test('audit persistence failure prevents credential disclosure', async () => {
  const prisma = { credentialAccessAudit: { create: async () => { throw new Error('audit unavailable'); } } };
  await assert.rejects(() => revealCredentialSecret({
    prisma,
    credential: { id: 'cred-1', password: encrypt('secret') },
    context: { organizationId: 'org-1', actorUserId: 'user-1', purpose: 'incident response', route: 'route' },
  }), /audit unavailable/);
});

test('purpose is mandatory and bounded', () => {
  assert.equal(normalizeCredentialPurpose(' deployment '), 'deployment');
  assert.throws(() => normalizeCredentialPurpose(''), /purpose/);
  assert.throws(() => normalizeCredentialPurpose('client secret value'), /purpose/);
});

test('database migration makes access audits append-only and ownership fail-closed', () => {
  const migration = fs.readFileSync(new URL('../../../prisma/migrations/20260809094500_credential_vault_audit_rotation/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /unowned rows remain/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /credential access audits are immutable/);
  assert.match(migration, /credentials_enforce_ownership/);
  assert.match(migration, /cross-organization parent/);
  assert.match(migration, /legacy writers do/);
  assert.match(migration, /INTO NEW\."organizationId"/);
});

test('both reveal routes require purpose and use the durable disclosure gate', () => {
  const routes = fs.readFileSync(new URL('../../routes/credential.routes.js', import.meta.url), 'utf8');
  assert.equal((routes.match(/revealCredentialSecret\(/g) || []).length, 2);
  assert.equal((routes.match(/x-credential-purpose/g) || []).length, 2);
  assert.doesNotMatch(routes, /import\s*\{[^}]*\bdecrypt\b/);
});

test('credential validation requires ownership on create and permits safe partial updates', () => {
  const base = { label: 'Hosting', password: 'secret-value' };
  assert.equal(credentialCreateSchema.safeParse(base).success, false);
  assert.equal(credentialCreateSchema.safeParse({ ...base, clientId: 'cm1234567890123456789012' }).success, true);
  assert.equal(credentialUpdateSchema.safeParse({ label: 'Renamed' }).success, true);
  assert.equal(credentialUpdateSchema.safeParse({}).success, false);
});
