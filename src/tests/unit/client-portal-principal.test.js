import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePortalPrincipal } from '../../routes/client-portal.routes.js';

const payload = {
  id: 'user-a',
  contactId: 'contact-a',
  clientId: 'client-a',
  organizationId: 'org-a',
  role: 'CLIENT',
  sessionVersion: 3,
};

function prismaFor(overrides = {}) {
  const user = {
    id: 'user-a', email: 'client@example.com', name: 'Client', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 3,
    ...overrides.user,
  };
  const contact = {
    id: 'contact-a', email: 'client@example.com', name: 'Client', clientId: 'client-a',
    ...overrides.contact,
  };
  const client = { id: 'client-a', organizationId: 'org-a', name: 'Example', ...overrides.client };
  return {
    user: { findUnique: async () => overrides.user === null ? null : user },
    contact: { findFirst: async () => overrides.contact === null ? null : contact },
    client: { findFirst: async () => overrides.client === null ? null : client },
  };
}

describe('client portal principal resolution', () => {
  it('accepts only a current active client identity with matching tenant ownership', async () => {
    const principal = await resolvePortalPrincipal(prismaFor(), payload);
    assert.equal(principal.user.id, 'user-a');
    assert.equal(principal.contact.id, 'contact-a');
    assert.equal(principal.client.id, 'client-a');
  });

  for (const [name, prisma, claims = payload] of [
    ['missing user identity claim', prismaFor(), { ...payload, id: undefined }],
    ['inactive user', prismaFor({ user: { isActive: false } })],
    ['revoked session version', prismaFor({ user: { sessionVersion: 4 } })],
    ['different client', prismaFor({ user: { clientId: 'client-b' } })],
    ['different organization', prismaFor({ client: { organizationId: 'org-b' } })],
    ['removed contact', prismaFor({ contact: null })],
    ['paused or removed client', prismaFor({ client: null })],
    ['contact email mismatch', prismaFor({ contact: { email: 'other@example.com' } })],
  ]) {
    it(`rejects ${name}`, async () => {
      assert.equal(await resolvePortalPrincipal(prisma, claims), null);
    });
  }
});
