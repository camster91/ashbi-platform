import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const authRoutes = readFileSync(new URL('../../routes/auth.routes.js', import.meta.url), 'utf8');
const localProvider = readFileSync(new URL('../../auth/providers/local.provider.js', import.meta.url), 'utf8');
const clientPortal = readFileSync(new URL('../../routes/client-portal.routes.js', import.meta.url), 'utf8');
const auditScript = readFileSync(new URL('../../../scripts/audit-password-hashes.mjs', import.meta.url), 'utf8');
const server = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');

describe('authentication session contract', () => {
  it('does not return reusable client JWTs in authentication response bodies', () => {
    assert.doesNotMatch(authRoutes, /token:\s*jwtToken/);
    assert.doesNotMatch(authRoutes, /\n\s{8}token\s*\n/);
  });

  it('uses the bounded session signer for staff and password-authenticated clients', () => {
    assert.match(localProvider, /signUserSession\(this\.jwt/);
    assert.equal((authRoutes.match(/signUserSession\(fastify\.jwt/g) || []).length, 2);
  });

  it('never stores an unhashed random password for portal-created users', () => {
    assert.doesNotMatch(clientPortal, /password:\s*randomUUID\(\)/);
    assert.equal((clientPortal.match(/password:\s*await bcrypt\.hash\(randomUUID\(\), 12\)/g) || []).length, 2);
  });

  it('provides a sanitized production audit and reset path for legacy hashes', () => {
    assert.match(auditScript, /legacyAccounts/);
    assert.match(auditScript, /--reset-legacy/);
    assert.match(auditScript, /sessionVersion:\s*\{ increment: 1 \}/);
    assert.doesNotMatch(auditScript, /email:\s*true/);
  });

  it('checks the database session version for both HTTP and Socket.IO', () => {
    assert.ok((server.match(/isCurrentUserSession\(prisma,/g) || []).length >= 3);
    assert.match(server, /io\.use\([\s\S]*isCurrentUserSession\(prisma, decoded\)/);
  });

  it('removes account-bound push endpoints during authenticated logout', () => {
    assert.match(authRoutes, /pushSubscription\.deleteMany\(\{\s*where:\s*\{ userId: request\.user\.id \}/);
    assert.ok(
      authRoutes.indexOf('pushSubscription.deleteMany') < authRoutes.indexOf('revokeUserSessions(request.prisma, request.user.id)'),
      'push endpoints should be removed before the user session is revoked',
    );
  });
});
